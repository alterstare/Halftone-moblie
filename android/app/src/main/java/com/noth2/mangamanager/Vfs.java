package com.noth2.mangamanager;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

// Path-level file access used by the plugin and the image server. Ordinary
// paths are local files; "/nas/<connId>/<rel>" goes to that NAS connection
// (WebDAV or SMB). The JS side just sees one filesystem.
final class Vfs {
    static final String PREFIX = "/nas/";
    private static final Map<String, RemoteFs> open = new HashMap<>();

    private Vfs() {}

    static boolean isRemote(String path) {
        return path != null && path.startsWith(PREFIX);
    }

    private static final class Target {
        RemoteFs fs;
        String rel;
    }

    private static Target target(String path) throws IOException {
        String rest = path.substring(PREFIX.length());
        int slash = rest.indexOf('/');
        String id = slash < 0 ? rest : rest.substring(0, slash);
        String rel = slash < 0 ? "" : rest.substring(slash + 1);
        while (rel.endsWith("/")) rel = rel.substring(0, rel.length() - 1);
        Target t = new Target();
        t.fs = fs(id);
        t.rel = rel;
        return t;
    }

    static synchronized RemoteFs fs(String id) throws IOException {
        RemoteFs f = open.get(id);
        if (f != null) return f;
        NasStore.Conn c = NasStore.get(id);
        if (c == null) throw new IOException("NAS 연결을 찾을 수 없습니다 (" + id + ")");
        f = create(c, NasStore.password(id));
        open.put(id, f);
        return f;
    }

    static RemoteFs create(NasStore.Conn c, String password) throws IOException {
        return "smb".equals(c.type) ? new SmbFs(c, password) : new WebDavFs(c, password);
    }

    // Connection edited / removed → drop its open client.
    static synchronized void forget(String id) {
        RemoteFs f = open.remove(id);
        if (f != null) f.close();
    }

    // ---- operations -------------------------------------------------------------

    static RemoteFs.Entry stat(String path) throws IOException {
        if (isRemote(path)) {
            Target t = target(path);
            return t.fs.stat(t.rel);
        }
        File f = new File(path);
        RemoteFs.Entry e = new RemoteFs.Entry();
        e.exists = f.exists();
        e.dir = f.isDirectory();
        e.size = f.length();
        e.mtime = f.lastModified();
        e.name = f.getName();
        return e;
    }

    static List<RemoteFs.Entry> list(String path) throws IOException {
        Target t = target(path);
        return t.fs.list(t.rel);
    }

    static byte[] read(String path) throws IOException {
        if (!isRemote(path)) return Files.readAllBytes(new File(path).toPath());
        try (InputStream in = open(path)) {
            return readAll(in);
        }
    }

    static InputStream open(String path) throws IOException {
        if (!isRemote(path)) return new FileInputStream(path);
        Target t = target(path);
        return t.fs.open(t.rel);
    }

    static void write(String path, byte[] data) throws IOException {
        if (isRemote(path)) {
            Target t = target(path);
            t.fs.write(t.rel, new ByteArrayInputStream(data), data.length);
            return;
        }
        File f = new File(path);
        File parent = f.getParentFile();
        if (parent != null) //noinspection ResultOfMethodCallIgnored
            parent.mkdirs();
        File tmp = new File(f.getPath() + ".tmp");
        try (OutputStream out = new FileOutputStream(tmp)) {
            out.write(data);
        }
        if (f.exists() && !f.delete()) throw new IOException("cannot replace " + f);
        if (!tmp.renameTo(f)) throw new IOException("rename failed: " + f);
    }

    // Upload a finished local temp file to a NAS path (then delete the temp).
    static void upload(File local, String path) throws IOException {
        Target t = target(path);
        try (InputStream in = new FileInputStream(local)) {
            t.fs.write(t.rel, in, local.length());
        } finally {
            //noinspection ResultOfMethodCallIgnored
            local.delete();
        }
    }

    static void mkdirs(String path) throws IOException {
        Target t = target(path);
        t.fs.mkdirs(t.rel);
    }

    static void delete(String path, boolean recursive) throws IOException {
        Target t = target(path);
        t.fs.delete(t.rel, recursive);
    }

    // Both remote on the same connection → server-side move; else copy + delete.
    static void rename(String from, String to) throws IOException {
        if (isRemote(from) && isRemote(to)) {
            Target a = target(from), b = target(to);
            if (a.fs == b.fs) {
                a.fs.rename(a.rel, b.rel);
                return;
            }
        }
        copyTree(from, to);
        if (isRemote(from)) delete(from, true);
        else deleteLocal(new File(from));
    }

    private static void copyTree(String from, String to) throws IOException {
        RemoteFs.Entry e = stat(from);
        if (!e.exists) throw new IOException("ENOENT: " + from);
        if (e.dir) {
            if (isRemote(to)) mkdirs(to);
            else //noinspection ResultOfMethodCallIgnored
                new File(to).mkdirs();
            if (isRemote(from)) {
                for (RemoteFs.Entry k : list(from)) copyTree(from + "/" + k.name, to + "/" + k.name);
            } else {
                File[] kids = new File(from).listFiles();
                if (kids != null) for (File k : kids) copyTree(k.getPath(), to + "/" + k.getName());
            }
        } else {
            write(to, read(from));
        }
    }

    private static void deleteLocal(File f) throws IOException {
        File[] kids = f.isDirectory() ? f.listFiles() : null;
        if (kids != null) for (File k : kids) deleteLocal(k);
        if (f.exists() && !f.delete()) throw new IOException("delete failed: " + f);
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[64 * 1024];
        int r;
        while ((r = in.read(buf)) != -1) bo.write(buf, 0, r);
        return bo.toByteArray();
    }
}
