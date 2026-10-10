package com.noth2.mangamanager;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.widget.Toast;

import androidx.activity.result.ActivityResult;
import androidx.webkit.ProxyConfig;
import androidx.webkit.ProxyController;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// JS bridge for the TS backend (src/backend): file system, network (doujin
// DoH / comic cookies), system pickers, and the comic scraper WebView.
// All paths are absolute file-system paths.
@CapacitorPlugin(
    name = "MM",
    permissions = {
        @Permission(strings = {Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE}, alias = "storage")
    }
)
public class MMPlugin extends Plugin {
    static MMPlugin instance;

    private final ExecutorService io = Executors.newFixedThreadPool(8);
    private ComicWeb comic;

    @Override
    public void load() {
        instance = this;
        closing = false;
        pipWanted = false;
        Net.init(getContext());
        NasStore.init(getContext());
        ViewGroup root = (ViewGroup) getBridge().getWebView().getParent();
        comic = new ComicWeb(getActivity(), root, visible -> {
            JSObject o = new JSObject();
            o.put("visible", visible);
            notifyListeners("comicVisible", o);
        });
    }

    // Android back button. True = handled here or forwarded to JS.
    boolean handleBack() {
        if (comic != null && comic.back()) return true;
        if (!hasListeners("back")) return false;
        notifyListeners("back", new JSObject());
        return true;
    }

    private interface Job {
        void run() throws Exception;
    }

    private void bg(PluginCall call, Job job) {
        io.execute(() -> {
            try {
                job.run();
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage() != null ? e.getMessage() : e));
            }
        });
    }

    private static String need(PluginCall call, String key) {
        String v = call.getString(key);
        if (v == null) throw new IllegalArgumentException("missing " + key);
        return v;
    }

    // ---- paths / storage --------------------------------------------------------

    // ---- NAS (WebDAV / SMB) -------------------------------------------------------
    // Connections are stored natively (NasStore); JS never gets the passwords.
    // A connection's files are reached as /nas/<id>/<path> through the fs methods.

    @PluginMethod
    public void nasList(PluginCall call) {
        try {
            JSArray a = new JSArray();
            for (NasStore.Conn c : NasStore.list()) a.put(c.toJson(true, NasStore.password(c.id)));
            JSObject o = new JSObject();
            o.put("conns", a);
            call.resolve(o);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    private static NasStore.Conn connOf(PluginCall call) {
        JSObject j = call.getObject("conn");
        return NasStore.Conn.fromJson(j == null ? new JSObject() : j);
    }

    // Try the connection (list its root); password null = use the stored one.
    @PluginMethod
    public void nasTest(PluginCall call) {
        bg(call, () -> {
            NasStore.Conn c = connOf(call);
            String pw = call.getString("password");
            if (pw == null && c.id != null && !c.id.isEmpty()) pw = NasStore.password(c.id);
            RemoteFs fs = Vfs.create(c, pw);
            try {
                JSObject o = new JSObject();
                o.put("count", fs.list("").size());
                call.resolve(o);
            } finally {
                fs.close();
            }
        });
    }

    @PluginMethod
    public void nasSave(PluginCall call) {
        bg(call, () -> {
            NasStore.Conn c = connOf(call);
            if (c.id == null || c.id.isEmpty()) c.id = "n" + Long.toString(System.currentTimeMillis(), 36);
            NasStore.save(c, call.getString("password"));
            Vfs.forget(c.id);
            JSObject o = new JSObject();
            o.put("id", c.id);
            call.resolve(o);
        });
    }

    @PluginMethod
    public void nasRemove(PluginCall call) {
        bg(call, () -> {
            String id = need(call, "id");
            NasStore.remove(id);
            Vfs.forget(id);
            call.resolve();
        });
    }

    @PluginMethod
    public void appInfo(PluginCall call) {
        JSObject o = new JSObject();
        try {
            android.content.pm.PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            o.put("version", pi.versionName);
            o.put("code", Build.VERSION.SDK_INT >= 28 ? (int) pi.getLongVersionCode() : pi.versionCode);
        } catch (Exception e) {
            o.put("version", "0");
            o.put("code", 0);
        }
        call.resolve(o);
    }

    // Auto-update: open the system installer for a downloaded APK (cache dir,
    // shared through the FileProvider). Without the "install unknown apps"
    // permission, its settings page opens first.
    @PluginMethod
    public void installApk(PluginCall call) {
        Context ctx = getContext();
        File f = new File(need(call, "path"));
        JSObject o = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ctx.getPackageManager().canRequestPackageInstalls()) {
            Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
            s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(s);
            o.put("needPermission", true);
            call.resolve(o);
            return;
        }
        Uri uri = androidx.core.content.FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
        call.resolve(o);
    }

    @PluginMethod
    public void getPaths(PluginCall call) {
        JSObject o = new JSObject();
        o.put("files", getContext().getFilesDir().getAbsolutePath());
        o.put("cache", getContext().getCacheDir().getAbsolutePath());
        o.put("external", Environment.getExternalStorageDirectory().getAbsolutePath());
        o.put("download", Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).getAbsolutePath());
        o.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(o);
    }

    private boolean storageGranted() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) return Environment.isExternalStorageManager();
        return getPermissionState("storage") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void storageStatus(PluginCall call) {
        JSObject o = new JSObject();
        o.put("granted", storageGranted());
        call.resolve(o);
    }

    // Android 11+: "모든 파일에 접근" settings page; older: runtime permission.
    @PluginMethod
    public void requestStorage(PluginCall call) {
        if (storageGranted()) {
            storageStatus(call);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
            try {
                startActivityForResult(call, i, "storageResult");
            } catch (Exception e) {
                startActivityForResult(call, new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION), "storageResult");
            }
        } else {
            requestPermissionForAlias("storage", call, "storagePermResult");
        }
    }

    @ActivityCallback
    private void storageResult(PluginCall call, ActivityResult result) {
        storageStatus(call);
    }

    @PermissionCallback
    private void storagePermResult(PluginCall call) {
        storageStatus(call);
    }

    // ---- file system -------------------------------------------------------------

    @PluginMethod
    public void fsRead(PluginCall call) {
        bg(call, () -> {
            byte[] b = Vfs.read(need(call, "path"));
            // Byte range (big files are read in pieces — see node/fs.ts).
            Integer off = call.getInt("offset");
            if (off != null) {
                int start = Math.max(0, Math.min(off, b.length));
                int len = Math.max(0, Math.min(call.getInt("length", b.length), b.length - start));
                b = java.util.Arrays.copyOfRange(b, start, start + len);
            }
            JSObject o = new JSObject();
            o.put("data", "base64".equals(call.getString("encoding")) ? Base64.encodeToString(b, Base64.NO_WRAP) : new String(b, StandardCharsets.UTF_8));
            call.resolve(o);
        });
    }

    @PluginMethod
    public void fsWrite(PluginCall call) {
        bg(call, () -> {
            String path = need(call, "path");
            String data = need(call, "data");
            byte[] b = "base64".equals(call.getString("encoding")) ? Base64.decode(data, Base64.DEFAULT) : data.getBytes(StandardCharsets.UTF_8);
            if (Vfs.isRemote(path)) {
                boolean app = Boolean.TRUE.equals(call.getBoolean("append", false));
                if (app) {
                    byte[] old = Vfs.stat(path).exists ? Vfs.read(path) : new byte[0];
                    byte[] all = new byte[old.length + b.length];
                    System.arraycopy(old, 0, all, 0, old.length);
                    System.arraycopy(b, 0, all, old.length, b.length);
                    b = all;
                }
                Vfs.write(path, b);
                call.resolve();
                return;
            }
            File f = new File(path);
            File parent = f.getParentFile();
            if (parent != null) //noinspection ResultOfMethodCallIgnored
                parent.mkdirs();
            // Big writes arrive in pieces: part=new/append build <path>.part,
            // commit renames it over <path> (still an atomic replace).
            String part = call.getString("part");
            if (part != null || Boolean.TRUE.equals(call.getBoolean("commit", false))) {
                File pf = new File(f.getPath() + ".part");
                if (part != null) {
                    try (OutputStream out = new FileOutputStream(pf, "append".equals(part))) {
                        out.write(b);
                    }
                } else {
                    if (f.exists() && !f.delete()) throw new IOException("cannot replace " + f);
                    if (!pf.renameTo(f)) throw new IOException("rename failed: " + f);
                }
                call.resolve();
                return;
            }
            boolean append = Boolean.TRUE.equals(call.getBoolean("append", false));
            if (append) {
                try (OutputStream out = new FileOutputStream(f, true)) {
                    out.write(b);
                }
            } else {
                // Atomic replace: write a sibling temp file, then rename over.
                File tmp = new File(f.getPath() + ".tmp");
                try (OutputStream out = new FileOutputStream(tmp)) {
                    out.write(b);
                }
                if (f.exists() && !f.delete()) throw new IOException("cannot replace " + f);
                if (!tmp.renameTo(f)) throw new IOException("rename failed: " + f);
            }
            call.resolve();
        });
    }

    private static JSObject statOf(RemoteFs.Entry e) {
        JSObject o = new JSObject();
        o.put("exists", e.exists);
        o.put("isDir", e.exists && e.dir);
        o.put("isFile", e.exists && !e.dir);
        o.put("size", e.size);
        o.put("mtime", e.mtime);
        return o;
    }

    private static JSObject statOf(File f) {
        JSObject o = new JSObject();
        o.put("exists", f.exists());
        o.put("isDir", f.isDirectory());
        o.put("isFile", f.isFile());
        o.put("size", f.length());
        o.put("mtime", f.lastModified());
        return o;
    }

    @PluginMethod
    public void fsStat(PluginCall call) {
        bg(call, () -> {
            String path = need(call, "path");
            call.resolve(Vfs.isRemote(path) ? statOf(Vfs.stat(path)) : statOf(new File(path)));
        });
    }

    @PluginMethod
    public void fsReaddir(PluginCall call) {
        bg(call, () -> {
            String path = need(call, "path");
            if (Vfs.isRemote(path)) {
                JSArray arr = new JSArray();
                for (RemoteFs.Entry e : Vfs.list(path)) {
                    JSObject o = statOf(e);
                    o.put("name", e.name);
                    arr.put(o);
                }
                JSObject res = new JSObject();
                res.put("entries", arr);
                call.resolve(res);
                return;
            }
            File dir = new File(path);
            File[] list = dir.listFiles();
            if (list == null) throw new IOException("ENOENT: " + dir);
            JSArray arr = new JSArray();
            for (File f : list) {
                JSObject o = statOf(f);
                o.put("name", f.getName());
                arr.put(o);
            }
            JSObject res = new JSObject();
            res.put("entries", arr);
            call.resolve(res);
        });
    }

    // ---- library scan --------------------------------------------------------------
    // The whole folder walk in one call (the JS walk did a readdir + stat +
    // sidecar read per folder over the bridge, with a full stat of every image).
    // Per folder: name, mtime, image count (by extension — no stat per image),
    // meta.<x>.json names, child folders. Depth-limited (symlink loops).

    @PluginMethod
    public void scanTree(PluginCall call) {
        JSArray roots = call.getArray("roots", new JSArray());
        JSArray exts = call.getArray("exts", new JSArray());
        bg(call, () -> {
            java.util.Set<String> ext = new java.util.HashSet<>();
            for (int i = 0; i < exts.length(); i++) ext.add(exts.optString(i, "").toLowerCase());
            JSArray out = new JSArray();
            for (int i = 0; i < roots.length(); i++) {
                String root = roots.optString(i, "");
                JSObject n = root.isEmpty() ? null : scanPool.submit(() -> scanNode(root, ext, 0, -1)).get();
                out.put(n == null ? org.json.JSONObject.NULL : n);
            }
            JSObject res = new JSObject();
            res.put("roots", out);
            call.resolve(res);
        });
    }

    // Folder listings are I/O-latency bound (shared storage goes through FUSE,
    // NAS over the network): sibling folders are walked in parallel.
    private static final java.util.concurrent.ForkJoinPool scanPool = new java.util.concurrent.ForkJoinPool(16);

    private static final java.util.regex.Pattern META_NAME =
        java.util.regex.Pattern.compile("^meta\\.[^.]+\\.json$", java.util.regex.Pattern.CASE_INSENSITIVE);

    private static boolean hasExt(String name, java.util.Set<String> ext) {
        int dot = name.lastIndexOf('.');
        return dot > 0 && ext.contains(name.substring(dot).toLowerCase());
    }

    // mtime < 0 = not known from the parent's listing (a root).
    private static JSObject scanNode(String path, java.util.Set<String> ext, int depth, long mtime) {
        if (depth > 32) return null;
        int images = 0;
        JSArray metas = new JSArray();
        java.util.List<String[]> kids = new java.util.ArrayList<>(); // name, mtime
        if (Vfs.isRemote(path)) {
            java.util.List<RemoteFs.Entry> list;
            try {
                list = Vfs.list(path);
                if (mtime < 0) mtime = Vfs.stat(path).mtime;
            } catch (Exception e) {
                return null;
            }
            for (RemoteFs.Entry e : list) {
                if (e.dir) kids.add(new String[] { e.name, String.valueOf(e.mtime) });
                else if (hasExt(e.name, ext)) images++;
                else if (META_NAME.matcher(e.name).matches()) metas.put(e.name);
            }
        } else {
            File d = new File(path);
            String[] names = d.list();
            if (names == null) return null;
            if (mtime < 0) mtime = d.lastModified();
            for (String name : names) {
                if (hasExt(name, ext)) {
                    images++;
                    continue;
                }
                if (META_NAME.matcher(name).matches()) {
                    metas.put(name);
                    continue;
                }
                File f = new File(d, name);
                if (f.isDirectory()) kids.add(new String[] { name, String.valueOf(f.lastModified()) });
            }
        }
        JSObject o = new JSObject();
        o.put("mtime", mtime);
        if (images > 0) o.put("images", images);
        if (metas.length() > 0) o.put("metas", metas);
        if (!kids.isEmpty()) {
            JSArray arr = new JSArray();
            String base = path.endsWith("/") ? path : path + "/";
            final int d = depth;
            // (NAS stays sequential: one SMB / WebDAV session per connection.)
            java.util.stream.Stream<String[]> st = Vfs.isRemote(path) ? kids.stream() : kids.parallelStream();
            java.util.List<JSObject> nodes = st.map(k -> {
                JSObject c = scanNode(base + k[0], ext, d + 1, Long.parseLong(k[1]));
                if (c != null) c.put("name", k[0]);
                return c;
            }).collect(java.util.stream.Collectors.toList());
            for (JSObject c : nodes) if (c != null) arr.put(c);
            if (arr.length() > 0) o.put("kids", arr);
        }
        return o;
    }

    // Several small text files at once (scan: the works' sidecars). Missing /
    // unreadable → null in its slot. Callers keep batches small (bridge size).
    @PluginMethod
    public void readTexts(PluginCall call) {
        JSArray paths = call.getArray("paths", new JSArray());
        bg(call, () -> {
            java.util.List<Integer> idx = new java.util.ArrayList<>();
            for (int i = 0; i < paths.length(); i++) idx.add(i);
            boolean remote = paths.length() > 0 && Vfs.isRemote(paths.optString(0, ""));
            java.util.List<String> texts = scanPool.submit(() -> (remote ? idx.stream() : idx.parallelStream()).map(i -> {
                String p = paths.optString(i, "");
                try {
                    byte[] b = Vfs.isRemote(p) ? Vfs.read(p) : Files.readAllBytes(new File(p).toPath());
                    return new String(b, StandardCharsets.UTF_8);
                } catch (Exception e) {
                    return null;
                }
            }).collect(java.util.stream.Collectors.toList())).get();
            JSArray out = new JSArray();
            for (String t : texts) out.put(t == null ? org.json.JSONObject.NULL : t);
            JSObject res = new JSObject();
            res.put("texts", out);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void fsMkdir(PluginCall call) {
        bg(call, () -> {
            String path = need(call, "path");
            if (Vfs.isRemote(path)) {
                Vfs.mkdirs(path);
                call.resolve();
                return;
            }
            File d = new File(path);
            if (!d.isDirectory() && !d.mkdirs()) throw new IOException("mkdir failed: " + d);
            call.resolve();
        });
    }

    private static void deleteTree(File f) throws IOException {
        File[] kids = f.isDirectory() ? f.listFiles() : null;
        if (kids != null) for (File k : kids) deleteTree(k);
        if (f.exists() && !f.delete()) throw new IOException("delete failed: " + f);
    }

    @PluginMethod
    public void fsRm(PluginCall call) {
        bg(call, () -> {
            String path = need(call, "path");
            if (Vfs.isRemote(path)) {
                Vfs.delete(path, Boolean.TRUE.equals(call.getBoolean("recursive", false)));
                call.resolve();
                return;
            }
            File f = new File(path);
            if (Boolean.TRUE.equals(call.getBoolean("recursive", false))) deleteTree(f);
            else if (f.exists() && !f.delete()) throw new IOException("delete failed: " + f);
            call.resolve();
        });
    }

    private static void copyTree(File src, File dest) throws IOException {
        if (src.isDirectory()) {
            if (!dest.isDirectory() && !dest.mkdirs()) throw new IOException("mkdir failed: " + dest);
            File[] kids = src.listFiles();
            if (kids != null) for (File k : kids) copyTree(k, new File(dest, k.getName()));
        } else {
            try (InputStream in = new FileInputStream(src); OutputStream out = new FileOutputStream(dest)) {
                byte[] buf = new byte[64 * 1024];
                int r;
                while ((r = in.read(buf)) != -1) out.write(buf, 0, r);
            }
        }
    }

    // Rename/move; falls back to copy + delete across volumes.
    @PluginMethod
    public void fsRename(PluginCall call) {
        bg(call, () -> {
            String fromP = need(call, "from"), toP = need(call, "to");
            if (Vfs.isRemote(fromP) || Vfs.isRemote(toP)) {
                Vfs.rename(fromP, toP);
                call.resolve();
                return;
            }
            File from = new File(fromP);
            File to = new File(toP);
            if (!from.exists()) throw new IOException("ENOENT: " + from);
            File parent = to.getParentFile();
            if (parent != null) //noinspection ResultOfMethodCallIgnored
                parent.mkdirs();
            if (!from.renameTo(to)) {
                copyTree(from, to);
                deleteTree(from);
            }
            call.resolve();
        });
    }

    // ---- network -------------------------------------------------------------------

    private static Map<String, String> headersOf(PluginCall call) {
        Map<String, String> h = new HashMap<>();
        JSObject o = call.getObject("headers");
        if (o != null) {
            Iterator<String> it = o.keys();
            while (it.hasNext()) {
                String k = it.next();
                h.put(k, o.optString(k));
            }
        }
        return h;
    }

    @PluginMethod
    public void httpGet(PluginCall call) {
        bg(call, () -> {
            Net.Result r = Net.get(call.getString("kind", "plain"), need(call, "url"), headersOf(call));
            JSObject o = new JSObject();
            o.put("status", r.status);
            JSObject h = new JSObject();
            for (Map.Entry<String, String> e : r.headers.entrySet()) h.put(e.getKey(), e.getValue());
            o.put("headers", h);
            o.put("data", "base64".equals(call.getString("responseType"))
                ? Base64.encodeToString(r.body, Base64.NO_WRAP)
                : new String(r.body, StandardCharsets.UTF_8));
            call.resolve(o);
        });
    }

    @PluginMethod
    public void httpDownload(PluginCall call) {
        bg(call, () -> {
            String path = need(call, "path");
            long n;
            if (Vfs.isRemote(path)) {
                // NAS target: download to a local temp file, then upload it.
                File tmp = File.createTempFile("nasdl", ".part", getContext().getCacheDir());
                n = Net.download(call.getString("kind", "plain"), need(call, "url"), headersOf(call), tmp);
                Vfs.upload(tmp, path);
            } else {
                n = Net.download(call.getString("kind", "plain"), need(call, "url"), headersOf(call), new File(path));
            }
            JSObject o = new JSObject();
            o.put("size", n);
            call.resolve(o);
        });
    }

    // Fetch a remote image through the same cache the reader uses, into a file.
    @PluginMethod
    public void imageToFile(PluginCall call) {
        bg(call, () -> {
            byte[] b = Net.cachedImage(call.getString("kind", "doujin"), need(call, "url"));
            String path = need(call, "path");
            if (Vfs.isRemote(path)) {
                Vfs.write(path, b);
                call.resolve();
                return;
            }
            File f = new File(path);
            File parent = f.getParentFile();
            if (parent != null) //noinspection ResultOfMethodCallIgnored
                parent.mkdirs();
            try (OutputStream out = new FileOutputStream(f)) {
                out.write(b);
            }
            call.resolve();
        });
    }

    // Reader 이미지 저장: copy one page (a /_mm/{img|web|comic}/<b64> reader url —
    // local file or online image, from the disk cache when possible) into the
    // public Download folder as its own file. Returns the saved name.
    @PluginMethod
    public void saveImageToDownloads(PluginCall call) {
        bg(call, () -> {
            String src = need(call, "src");
            int at = src.indexOf("/_mm/");
            if (at < 0) throw new IllegalArgumentException("bad image url");
            String rest = src.substring(at + 5);
            int slash = rest.indexOf('/');
            String kind = rest.substring(0, slash);
            String seg = rest.substring(slash + 1);
            int q = seg.indexOf('?');
            if (q >= 0) seg = seg.substring(0, q);
            String target = new String(Base64.decode(seg, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP), StandardCharsets.UTF_8);
            byte[] b = "img".equals(kind)
                    ? (Vfs.isRemote(target) ? Net.cachedNas(target) : Files.readAllBytes(new File(target).toPath()))
                    : Net.cachedImage("comic".equals(kind) ? "comic" : "doujin", target);
            String file = target;
            int qq = file.indexOf('?');
            if (qq >= 0) file = file.substring(0, qq);
            file = file.substring(file.lastIndexOf('/') + 1);
            int dot = file.lastIndexOf('.');
            String ext = dot >= 0 ? file.substring(dot + 1).toLowerCase() : "jpg";
            String base = call.getString("name", "");
            base = base == null ? "" : base.replaceAll("[\\/:*?\"<>|\n\r]", "_").trim();
            if (base.length() > 120) base = base.substring(0, 120);
            String name = (base.isEmpty() ? (dot >= 0 ? file.substring(0, dot) : file) : base) + "." + ext;
            String mime = "png".equals(ext) ? "image/png" : "webp".equals(ext) ? "image/webp"
                    : "gif".equals(ext) ? "image/gif" : "avif".equals(ext) ? "image/avif" : "image/jpeg";
            String saved;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // MediaStore: shows up in Downloads / the gallery; a name clash is
                // renamed by the system ("x (1).jpg").
                ContentResolver cr = getContext().getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new IOException("저장 실패");
                try (OutputStream out = cr.openOutputStream(uri)) {
                    if (out == null) throw new IOException("저장 실패");
                    out.write(b);
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(uri, done, null, null);
                saved = name;
                try (Cursor c = cr.query(uri, new String[]{MediaStore.MediaColumns.DISPLAY_NAME}, null, null, null)) {
                    if (c != null && c.moveToFirst()) saved = c.getString(0);
                }
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                String stem = name.substring(0, name.length() - ext.length() - 1);
                File f = new File(dir, name);
                for (int i = 1; f.exists(); i++) f = new File(dir, stem + " (" + i + ")." + ext);
                try (OutputStream out = new FileOutputStream(f)) {
                    out.write(b);
                }
                saved = f.getName();
            }
            JSObject o = new JSObject();
            o.put("name", saved);
            call.resolve(o);
        });
    }

    @PluginMethod
    public void doh(PluginCall call) {
        bg(call, () -> {
            JSONArray a = Net.dohAnswers(need(call, "name"), call.getString("type", "A"));
            JSObject o = new JSObject();
            o.put("answers", a);
            call.resolve(o);
        });
    }

    @PluginMethod
    public void setNetwork(PluginCall call) {
        String proxy = call.getString("proxy", "");
        boolean tunnel = Boolean.TRUE.equals(call.getBoolean("tunnel", false));
        Net.setProxy(proxy);
        Net.comicBase = call.getString("comicBase", "");
        Net.doujinSite = call.getString("doujinSite", "");
        bg(call, () -> {
            int port = 0;
            if (tunnel) {
                try {
                    port = Tunnel.start();
                } catch (Exception e) {
                    port = 0; // start failed → direct connection
                }
            } else {
                Tunnel.stop();
            }
            Net.setTunnelPort(port);
            // WebViews start direct even with the tunnel on: on Cloudflare sites the
            // WebView's ECH hides the SNI anyway, and Cloudflare's challenge fails
            // through the fragmenting tunnel. ComicWeb switches to the tunnel only
            // when a page fails to connect (webTunnelFallback).
            webTunnel = port > 0 ? "127.0.0.1:" + port : null;
            webTunnelOn = false;
            webProxy = proxy;
            applyWebViewProxy(getActivity(), proxy, null);
            JSObject o = new JSObject();
            o.put("tunnelPort", port);
            call.resolve(o);
        });
    }

    static volatile String webTunnel; // tunnel rule when 우회 is on, else null
    static volatile boolean webTunnelOn;
    static volatile String webProxy = "";

    // A comic page failed to connect directly → route WebViews through the tunnel
    // (once per setNetwork) and run `after`. false = no tunnel / already on.
    static boolean webTunnelFallback(Activity act, Runnable after) {
        String t = webTunnel;
        if (t == null || webTunnelOn) return false;
        webTunnelOn = true;
        applyWebViewProxy(act, t, after);
        return true;
    }

    // WebView proxy (applies to every WebView in the app; the app's own
    // https://localhost content is served by the interceptor, never proxied).
    private static void applyWebViewProxy(Activity act, String rule, Runnable after) {
        Runnable done = after == null ? () -> {} : after;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) { act.runOnUiThread(done); return; }
        String r = rule == null ? "" : rule.trim().replaceFirst("^https?://", "");
        act.runOnUiThread(() -> {
            ProxyController pc = ProxyController.getInstance();
            if (r.isEmpty()) {
                pc.clearProxyOverride(Runnable::run, done);
            } else {
                ProxyConfig.Builder b = new ProxyConfig.Builder()
                    .addProxyRule(r)
                    .addBypassRule("localhost")
                    .addBypassRule("127.0.0.1");
                // Cloudflare's challenge host isn't blocked; a fragmented
                // ClientHello there stalls the verify widget.
                if (r.startsWith("127.0.0.1:")) b.addBypassRule("challenges.cloudflare.com");
                pc.setProxyOverride(b.build(), Runnable::run, done);
            }
        });
    }

    @PluginMethod
    public void netReset(PluginCall call) {
        Net.resetConnections();
        call.resolve();
    }

    // ---- clipboard ------------------------------------------------------------------

    @PluginMethod
    public void clipboardRead(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            String text = "";
            if (cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip() != null && cm.getPrimaryClip().getItemCount() > 0) {
                CharSequence t = cm.getPrimaryClip().getItemAt(0).coerceToText(getContext());
                text = t == null ? "" : t.toString();
            }
            JSObject o = new JSObject();
            o.put("text", text);
            call.resolve(o);
        });
    }

    @PluginMethod
    public void clipboardWrite(PluginCall call) {
        String text = call.getString("text", "");
        getActivity().runOnUiThread(() -> {
            ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("text", text));
            call.resolve();
        });
    }

    @PluginMethod
    public void setImageCache(PluginCall call) {
        Integer mb = call.getInt("mb", 400);
        Net.setCacheLimit((long) (mb == null ? 400 : mb) * 1024 * 1024);
        call.resolve();
    }

    @PluginMethod
    public void imageCacheInfo(PluginCall call) {
        bg(call, () -> {
            long[] u = Net.cacheUsage();
            JSObject o = new JSObject();
            o.put("bytes", u[0]);
            o.put("files", u[1]);
            call.resolve(o);
        });
    }

    // Rescan folders (and every file under them) so MediaStore / the gallery picks
    // up a new or removed .nomedia: hidden folders drop out, unhidden ones come back.
    // Theme for the next start: MainActivity paints the WebView background with
    // it before the page loads (no white / light flash in dark mode).
    @PluginMethod
    public void setTheme(PluginCall call) {
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        getContext().getSharedPreferences("halftone", android.content.Context.MODE_PRIVATE)
            .edit().putBoolean("dark", dark).apply();
        getActivity().runOnUiThread(() -> getBridge().getWebView().setBackgroundColor(dark ? 0xFF0B0D13 : 0xFFF4F5F8));
        call.resolve();
    }

    @PluginMethod
    public void mediaScan(PluginCall call) {
        JSArray a = call.getArray("paths", new JSArray());
        bg(call, () -> {
            java.util.ArrayList<String> files = new java.util.ArrayList<>();
            for (int i = 0; i < a.length(); i++) {
                String p = a.optString(i, "");
                if (p.isEmpty()) continue;
                collect(new java.io.File(p), files, 0);
            }
            if (!files.isEmpty())
                android.media.MediaScannerConnection.scanFile(getContext(), files.toArray(new String[0]), null, null);
            call.resolve();
        });
    }

    private static void collect(java.io.File f, java.util.List<String> out, int depth) {
        out.add(f.getAbsolutePath());
        if (depth > 4 || !f.isDirectory()) return;
        java.io.File[] kids = f.listFiles();
        if (kids != null) for (java.io.File k : kids) collect(k, out, depth + 1);
    }

    @PluginMethod
    public void clearImageCache(PluginCall call) {
        bg(call, () -> {
            Net.clearImgCache();
            call.resolve();
        });
    }

    // ---- pickers --------------------------------------------------------------------

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        startActivityForResult(call, i, "folderResult");
    }

    // content://…/tree/primary%3ADownload%2FX → /storage/emulated/0/Download/X
    @ActivityCallback
    private void folderResult(PluginCall call, ActivityResult result) {
        JSObject o = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            o.put("path", null);
            call.resolve(o);
            return;
        }
        String docId = DocumentsContract.getTreeDocumentId(data.getData());
        int colon = docId.indexOf(':');
        String vol = colon >= 0 ? docId.substring(0, colon) : docId;
        String rel = colon >= 0 ? docId.substring(colon + 1) : "";
        String base = "primary".equalsIgnoreCase(vol)
            ? Environment.getExternalStorageDirectory().getAbsolutePath()
            : "/storage/" + vol;
        o.put("path", rel.isEmpty() ? base : base + "/" + rel);
        call.resolve(o);
    }

    @PluginMethod
    public void pickFiles(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(call.getString("mime", "*/*"));
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, Boolean.TRUE.equals(call.getBoolean("multiple", false)));
        startActivityForResult(call, i, "filesResult");
    }

    @ActivityCallback
    private void filesResult(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        java.util.List<Uri> uris = new java.util.ArrayList<>();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                for (int k = 0; k < data.getClipData().getItemCount(); k++) uris.add(data.getClipData().getItemAt(k).getUri());
            } else if (data.getData() != null) {
                uris.add(data.getData());
            }
        }
        boolean asText = !"file".equals(call.getString("as", "text"));
        bg(call, () -> {
            JSArray arr = new JSArray();
            for (Uri u : uris) {
                JSObject f = new JSObject();
                String name = displayName(u);
                f.put("name", name);
                if (asText) {
                    f.put("text", new String(readAll(u), StandardCharsets.UTF_8));
                } else {
                    // Copy into the app cache so it can be served as a local file.
                    File dir = new File(getContext().getCacheDir(), "picked");
                    //noinspection ResultOfMethodCallIgnored
                    dir.mkdirs();
                    File out = new File(dir, System.currentTimeMillis() + "_" + name.replaceAll("[\\\\/:*?\"<>|]", "_"));
                    try (OutputStream os = new FileOutputStream(out)) {
                        os.write(readAll(u));
                    }
                    f.put("path", out.getAbsolutePath());
                }
                arr.put(f);
            }
            JSObject o = new JSObject();
            o.put("files", arr);
            call.resolve(o);
        });
    }

    private byte[] readAll(Uri u) throws IOException {
        ContentResolver cr = getContext().getContentResolver();
        try (InputStream in = cr.openInputStream(u); ByteArrayOutputStream bo = new ByteArrayOutputStream()) {
            if (in == null) throw new IOException("cannot open " + u);
            byte[] buf = new byte[64 * 1024];
            int r;
            while ((r = in.read(buf)) != -1) bo.write(buf, 0, r);
            return bo.toByteArray();
        }
    }

    private String displayName(Uri u) {
        try (Cursor c = getContext().getContentResolver().query(u, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String n = c.getString(0);
                if (n != null) return n;
            }
        } catch (Exception ignored) {
            // fall through
        }
        String last = u.getLastPathSegment();
        return last == null ? "file" : last;
    }

    // Save a text file wherever the user picks (system "save as").
    @PluginMethod
    public void saveTextFile(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(call.getString("mime", "application/json"));
        i.putExtra(Intent.EXTRA_TITLE, call.getString("name", "file.json"));
        startActivityForResult(call, i, "saveResult");
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject o = new JSObject();
            o.put("ok", false);
            call.resolve(o);
            return;
        }
        Uri u = data.getData();
        String text = call.getString("text", "");
        bg(call, () -> {
            try (OutputStream out = getContext().getContentResolver().openOutputStream(u, "wt")) {
                if (out == null) throw new IOException("cannot write " + u);
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
            JSObject o = new JSObject();
            o.put("ok", true);
            o.put("name", displayName(u));
            call.resolve(o);
        });
    }

    // ---- comic WebView ------------------------------------------------------------

    @PluginMethod
    public void comicLoad(PluginCall call) {
        JSObject o = new JSObject();
        o.put("nav", comic.load(need(call, "url")));
        call.resolve(o);
    }

    @PluginMethod
    public void comicState(PluginCall call) {
        call.resolve(comic.state());
    }

    @PluginMethod
    public void comicEval(PluginCall call) {
        String script = need(call, "script");
        comic.eval(script, json -> {
            JSObject o = new JSObject();
            o.put("json", json);
            call.resolve(o);
        });
    }

    @PluginMethod
    public void comicShow(PluginCall call) {
        comic.show(call.getString("title", ""));
        call.resolve();
    }

    @PluginMethod
    public void comicHide(PluginCall call) {
        comic.hide();
        call.resolve();
    }

    @PluginMethod
    public void comicCookie(PluginCall call) {
        JSObject o = new JSObject();
        o.put("cookie", CookieManager.getInstance().getCookie(need(call, "url")));
        call.resolve(o);
    }

    // ---- app -----------------------------------------------------------------------

    @PluginMethod
    public void toast(PluginCall call) {
        String text = call.getString("text", "");
        getActivity().runOnUiThread(() -> Toast.makeText(getContext(), text, Toast.LENGTH_SHORT).show());
        call.resolve();
    }

    @PluginMethod
    public void exitApp(PluginCall call) {
        Boolean keep = call.getBoolean("keepDownloads");
        if (keep != null) keepOnExit = keep;
        call.resolve();
        getActivity().runOnUiThread(() -> exit(getActivity()));
    }

    // 설정 · 종료 후에도 다운로드 유지 (sent with every downloadService / exitApp).
    static volatile boolean keepOnExit;

    // Exit (뒤로가기 / 종료) = close the app, downloads included. With
    // keepOnExit and downloads running: only go to the background instead
    // (finishing destroys the WebView the downloads run in). Leaving with the
    // home button never comes here — the service keeps those running.
    static void exit(Activity act) {
        if (DownloadService.running && keepOnExit) {
            act.moveTaskToBack(true);
            return;
        }
        closing = true;
        DownloadService.stop(act);
        act.finish();
    }

    // Set once the app is closing: progress calls still in flight from the
    // dying WebView must not bring the service (and its notification) back.
    static volatile boolean closing;

    // 일반 만화 downloads only work while the scraper page is on screen →
    // with the user's OK (settings.comicDownloadPip) the app goes into a small
    // picture-in-picture window when left with the home button.
    static volatile boolean pipWanted;

    // ---- background downloads ------------------------------------------------------

    private boolean askedNotify;
    static final int NOTIFY_REQ = 7301;

    // active: downloads queued / running → keep the foreground service up and
    // its notification current; false → stop it.
    @PluginMethod
    public void downloadService(PluginCall call) {
        Context ctx = getContext();
        Boolean keep = call.getBoolean("keepOnExit");
        if (keep != null) keepOnExit = keep;
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false)) && !closing;
        boolean pip = active && Boolean.TRUE.equals(call.getBoolean("pip", false));
        String title = call.getString("title", "");
        String text = call.getString("text", "");
        int done = call.getInt("done", 0);
        int total = call.getInt("total", 0);
        Activity act = getActivity();
        if (act instanceof MainActivity) {
            MainActivity m = (MainActivity) act;
            act.runOnUiThread(() -> {
                if (pip != pipWanted) {
                    pipWanted = pip;
                    m.updatePip();
                }
                m.pipProgress(active, title, text, done, total);
            });
        }
        if (!active) {
            DownloadService.stop(ctx);
            call.resolve();
            return;
        }
        if (Build.VERSION.SDK_INT >= 33 && !askedNotify
            && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            askedNotify = true;
            androidx.core.app.ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.POST_NOTIFICATIONS }, NOTIFY_REQ);
        }
        DownloadService.update(ctx, title, text, done, total);
        call.resolve();
    }

    void comicFreeze(boolean on) {
        if (comic != null) comic.freezeSize(on);
    }

    // Service started / stopped → renderer priority of both WebViews.
    static void onDownloadService() {
        MMPlugin p = instance;
        if (p == null) return;
        p.getActivity().runOnUiThread(() -> {
            DownloadService.applyPriority(p.getBridge().getWebView());
            if (p.comic != null) DownloadService.applyPriority(p.comic.webView());
        });
    }

    @PluginMethod
    public void restartApp(PluginCall call) {
        call.resolve();
        getActivity().runOnUiThread(() -> getBridge().getWebView().reload());
    }
}
