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

// JS bridge for the TS backend (src/backend): file system, network (hitomi
// DoH / toki cookies), system pickers, and the toki scraper WebView.
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
    private TokiWeb toki;

    @Override
    public void load() {
        instance = this;
        Net.init(getContext());
        ViewGroup root = (ViewGroup) getBridge().getWebView().getParent();
        toki = new TokiWeb(getActivity(), root, visible -> {
            JSObject o = new JSObject();
            o.put("visible", visible);
            notifyListeners("tokiVisible", o);
        });
    }

    // Android back button. True = handled here or forwarded to JS.
    boolean handleBack() {
        if (toki != null && toki.back()) return true;
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
            File f = new File(need(call, "path"));
            byte[] b = Files.readAllBytes(f.toPath());
            JSObject o = new JSObject();
            o.put("data", "base64".equals(call.getString("encoding")) ? Base64.encodeToString(b, Base64.NO_WRAP) : new String(b, StandardCharsets.UTF_8));
            call.resolve(o);
        });
    }

    @PluginMethod
    public void fsWrite(PluginCall call) {
        bg(call, () -> {
            File f = new File(need(call, "path"));
            String data = need(call, "data");
            byte[] b = "base64".equals(call.getString("encoding")) ? Base64.decode(data, Base64.DEFAULT) : data.getBytes(StandardCharsets.UTF_8);
            File parent = f.getParentFile();
            if (parent != null) //noinspection ResultOfMethodCallIgnored
                parent.mkdirs();
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
        bg(call, () -> call.resolve(statOf(new File(need(call, "path")))));
    }

    @PluginMethod
    public void fsReaddir(PluginCall call) {
        bg(call, () -> {
            File dir = new File(need(call, "path"));
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

    @PluginMethod
    public void fsMkdir(PluginCall call) {
        bg(call, () -> {
            File d = new File(need(call, "path"));
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
            File f = new File(need(call, "path"));
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
            File from = new File(need(call, "from"));
            File to = new File(need(call, "to"));
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
            long n = Net.download(call.getString("kind", "plain"), need(call, "url"), headersOf(call), new File(need(call, "path")));
            JSObject o = new JSObject();
            o.put("size", n);
            call.resolve(o);
        });
    }

    // Fetch a remote image through the same cache the reader uses, into a file.
    @PluginMethod
    public void imageToFile(PluginCall call) {
        bg(call, () -> {
            byte[] b = Net.cachedImage(call.getString("kind", "hitomi"), need(call, "url"));
            File f = new File(need(call, "path"));
            File parent = f.getParentFile();
            if (parent != null) //noinspection ResultOfMethodCallIgnored
                parent.mkdirs();
            try (OutputStream out = new FileOutputStream(f)) {
                out.write(b);
            }
            call.resolve();
        });
    }

    // Reader 이미지 저장: copy one page (a /_mm/{img|web|toki}/<b64> reader url —
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
                    ? Files.readAllBytes(new File(target).toPath())
                    : Net.cachedImage("toki".equals(kind) ? "toki" : "hitomi", target);
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
        Net.tokiBase = call.getString("tokiBase", "");
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
            applyWebViewProxy(port > 0 ? "127.0.0.1:" + port : proxy);
            JSObject o = new JSObject();
            o.put("tunnelPort", port);
            call.resolve(o);
        });
    }

    // WebView proxy (applies to every WebView in the app; the app's own
    // https://localhost content is served by the interceptor, never proxied).
    private void applyWebViewProxy(String rule) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) return;
        String r = rule == null ? "" : rule.trim().replaceFirst("^https?://", "");
        getActivity().runOnUiThread(() -> {
            ProxyController pc = ProxyController.getInstance();
            if (r.isEmpty()) {
                pc.clearProxyOverride(Runnable::run, () -> {});
            } else {
                ProxyConfig cfg = new ProxyConfig.Builder()
                    .addProxyRule(r)
                    .addBypassRule("localhost")
                    .addBypassRule("127.0.0.1")
                    .build();
                pc.setProxyOverride(cfg, Runnable::run, () -> {});
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

    // ---- toki WebView ------------------------------------------------------------

    @PluginMethod
    public void tokiLoad(PluginCall call) {
        JSObject o = new JSObject();
        o.put("nav", toki.load(need(call, "url")));
        call.resolve(o);
    }

    @PluginMethod
    public void tokiState(PluginCall call) {
        call.resolve(toki.state());
    }

    @PluginMethod
    public void tokiEval(PluginCall call) {
        String script = need(call, "script");
        toki.eval(script, json -> {
            JSObject o = new JSObject();
            o.put("json", json);
            call.resolve(o);
        });
    }

    @PluginMethod
    public void tokiShow(PluginCall call) {
        toki.show(call.getString("title", ""));
        call.resolve();
    }

    @PluginMethod
    public void tokiHide(PluginCall call) {
        toki.hide();
        call.resolve();
    }

    @PluginMethod
    public void tokiCookie(PluginCall call) {
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
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().finish());
    }

    @PluginMethod
    public void restartApp(PluginCall call) {
        call.resolve();
        getActivity().runOnUiThread(() -> getBridge().getWebView().reload());
    }
}
