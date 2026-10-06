package com.noth2.mangamanager;

import com.hierynomus.msdtyp.AccessMask;
import com.hierynomus.msfscc.FileAttributes;
import com.hierynomus.msfscc.fileinformation.FileAllInformation;
import com.hierynomus.msfscc.fileinformation.FileIdBothDirectoryInformation;
import com.hierynomus.mssmb2.SMB2CreateDisposition;
import com.hierynomus.mssmb2.SMB2CreateOptions;
import com.hierynomus.mssmb2.SMB2ShareAccess;
import com.hierynomus.mssmb2.SMBApiException;
import com.hierynomus.smbj.SMBClient;
import com.hierynomus.smbj.SmbConfig;
import com.hierynomus.smbj.auth.AuthenticationContext;
import com.hierynomus.smbj.connection.Connection;
import com.hierynomus.smbj.session.Session;
import com.hierynomus.smbj.share.DiskShare;
import com.hierynomus.smbj.share.File;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.concurrent.TimeUnit;

// SMB2/3 (smbj). One session + share per connection, reopened when it drops.
final class SmbFs implements RemoteFs {
    private final NasStore.Conn conn;
    private final String password;
    private SMBClient client;
    private Connection connection;
    private DiskShare share;

    SmbFs(NasStore.Conn c, String password) {
        this.conn = c;
        this.password = password == null ? "" : password;
    }

    private synchronized DiskShare share() throws IOException {
        if (share != null && share.isConnected()) return share;
        close();
        if (conn.share == null || conn.share.isEmpty()) throw new IOException("SMB 공유 폴더 이름을 입력하세요.");
        try {
            client = new SMBClient(SmbConfig.builder().withTimeout(30, TimeUnit.SECONDS).withSoTimeout(60, TimeUnit.SECONDS).build());
            connection = conn.port > 0 ? client.connect(conn.host, conn.port) : client.connect(conn.host);
            AuthenticationContext ac = (conn.user == null || conn.user.isEmpty())
                ? AuthenticationContext.anonymous()
                : new AuthenticationContext(conn.user, password.toCharArray(), conn.domain == null ? "" : conn.domain);
            Session s = connection.authenticate(ac);
            share = (DiskShare) s.connectShare(conn.share);
            return share;
        } catch (SMBApiException e) {
            close();
            throw new IOException(e.getStatus() != null && e.getStatus().name().contains("LOGON")
                ? "NAS 로그인 실패 (아이디 / 비밀번호 확인)" : "SMB 오류: " + e.getMessage());
        } catch (IOException e) {
            close();
            throw e;
        } catch (Exception e) {
            close();
            throw new IOException("SMB 연결 실패: " + e.getMessage(), e);
        }
    }

    private static String p(String rel) {
        return rel.replace('/', '\\');
    }

    private interface Op<T> {
        T run(DiskShare s) throws Exception;
    }

    // Run once; on a dropped session reconnect and retry once.
    private <T> T call(Op<T> op) throws IOException {
        for (int attempt = 0; ; attempt++) {
            DiskShare s = share();
            try {
                return op.run(s);
            } catch (SMBApiException e) {
                throw new IOException("SMB 오류: " + e.getStatus() + " " + e.getMessage());
            } catch (Exception e) {
                if (attempt >= 1) throw e instanceof IOException ? (IOException) e : new IOException(e);
                close();
            }
        }
    }

    @Override
    public Entry stat(String rel) throws IOException {
        return call(s -> {
            Entry e = new Entry();
            String path = p(rel);
            boolean isDir = rel.isEmpty() || s.folderExists(path);
            if (!isDir && !s.fileExists(path)) {
                e.exists = false;
                return e;
            }
            e.dir = isDir;
            e.name = rel.substring(rel.lastIndexOf('/') + 1);
            if (!rel.isEmpty()) {
                FileAllInformation info = s.getFileInformation(path);
                e.size = info.getStandardInformation().getEndOfFile();
                e.mtime = info.getBasicInformation().getLastWriteTime().toEpochMillis();
            }
            return e;
        });
    }

    @Override
    public List<Entry> list(String rel) throws IOException {
        return call(s -> {
            List<Entry> out = new ArrayList<>();
            for (FileIdBothDirectoryInformation f : s.list(p(rel))) {
                String n = f.getFileName();
                if (".".equals(n) || "..".equals(n)) continue;
                Entry e = new Entry();
                e.name = n;
                e.dir = (f.getFileAttributes() & FileAttributes.FILE_ATTRIBUTE_DIRECTORY.getValue()) != 0;
                e.size = f.getEndOfFile();
                e.mtime = f.getLastWriteTime().toEpochMillis();
                out.add(e);
            }
            return out;
        });
    }

    @Override
    public InputStream open(String rel) throws IOException {
        return call(s -> {
            File f = s.openFile(p(rel), EnumSet.of(AccessMask.GENERIC_READ), null,
                EnumSet.of(SMB2ShareAccess.FILE_SHARE_READ), SMB2CreateDisposition.FILE_OPEN, null);
            InputStream in = f.getInputStream();
            return new java.io.FilterInputStream(in) {
                @Override public void close() throws IOException {
                    try { super.close(); } finally { f.close(); }
                }
            };
        });
    }

    @Override
    public void write(String rel, InputStream data, long length) throws IOException {
        int slash = rel.lastIndexOf('/');
        if (slash > 0) mkdirs(rel.substring(0, slash));
        call(s -> {
            try (File f = s.openFile(p(rel), EnumSet.of(AccessMask.GENERIC_WRITE), null,
                EnumSet.noneOf(SMB2ShareAccess.class), SMB2CreateDisposition.FILE_OVERWRITE_IF, null);
                 OutputStream out = f.getOutputStream()) {
                byte[] buf = new byte[64 * 1024];
                int r;
                while ((r = data.read(buf)) != -1) out.write(buf, 0, r);
            }
            return null;
        });
    }

    @Override
    public void mkdirs(String rel) throws IOException {
        call(s -> {
            StringBuilder acc = new StringBuilder();
            for (String seg : rel.split("/")) {
                if (seg.isEmpty()) continue;
                if (acc.length() > 0) acc.append('\\');
                acc.append(seg);
                if (!s.folderExists(acc.toString())) s.mkdir(acc.toString());
            }
            return null;
        });
    }

    @Override
    public void delete(String rel, boolean recursive) throws IOException {
        call(s -> {
            String path = p(rel);
            if (s.folderExists(path)) s.rmdir(path, recursive);
            else if (s.fileExists(path)) s.rm(path);
            return null;
        });
    }

    @Override
    public void rename(String from, String to) throws IOException {
        int slash = to.lastIndexOf('/');
        if (slash > 0) mkdirs(to.substring(0, slash));
        call(s -> {
            boolean dir = s.folderExists(p(from));
            HashSet<SMB2CreateOptions> opts = new HashSet<>();
            opts.add(dir ? SMB2CreateOptions.FILE_DIRECTORY_FILE : SMB2CreateOptions.FILE_NON_DIRECTORY_FILE);
            try (com.hierynomus.smbj.share.DiskEntry e = s.open(p(from), EnumSet.of(AccessMask.DELETE, AccessMask.GENERIC_READ), null,
                EnumSet.of(SMB2ShareAccess.FILE_SHARE_DELETE, SMB2ShareAccess.FILE_SHARE_READ, SMB2ShareAccess.FILE_SHARE_WRITE),
                SMB2CreateDisposition.FILE_OPEN, opts)) {
                e.rename(p(to), false);
            }
            return null;
        });
    }

    @Override
    public synchronized void close() {
        try { if (share != null) share.close(); } catch (Exception ignored) {}
        try { if (connection != null) connection.close(); } catch (Exception ignored) {}
        try { if (client != null) client.close(); } catch (Exception ignored) {}
        share = null;
        connection = null;
        client = null;
    }
}
