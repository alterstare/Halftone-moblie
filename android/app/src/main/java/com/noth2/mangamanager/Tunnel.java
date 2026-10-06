package com.noth2.mangamanager;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// SNI-bypass tunnel — the mobile counterpart of the desktop's green-tunnel.
// Some ISPs reset TLS connections by the domain in the ClientHello (SNI). This
// is a local HTTP CONNECT proxy on 127.0.0.1 that resolves hosts over DoH and
// splits the client's first TLS record (the ClientHello) into small TLS records
// sent as separate TCP segments, which the filter can't reassemble. Only the
// manga-site traffic (comic WebView + comic OkHttp client) is pointed at it.
final class Tunnel {
    private static final int FRAGMENT = 40; // payload bytes per TLS record
    private static final int TIMEOUT_MS = 30000;

    private static ServerSocket server;
    private static ExecutorService pool;

    private Tunnel() {}

    // Start (idempotent); returns the listening port.
    static synchronized int start() throws IOException {
        if (server != null && !server.isClosed()) return server.getLocalPort();
        server = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        pool = Executors.newCachedThreadPool();
        final ServerSocket s = server;
        final ExecutorService p = pool;
        Thread t = new Thread(() -> {
            while (!s.isClosed()) {
                try {
                    Socket c = s.accept();
                    p.execute(() -> handle(c));
                } catch (IOException e) {
                    if (s.isClosed()) return;
                }
            }
        }, "mm-tunnel");
        t.setDaemon(true);
        t.start();
        return server.getLocalPort();
    }

    static synchronized void stop() {
        try {
            if (server != null) server.close();
        } catch (IOException ignored) {
            // already closed
        }
        server = null;
        if (pool != null) pool.shutdownNow();
        pool = null;
    }

    static synchronized boolean running() {
        return server != null && !server.isClosed();
    }

    static synchronized int port() {
        return running() ? server.getLocalPort() : 0;
    }

    private static void handle(Socket client) {
        Socket upstream = null;
        try {
            client.setSoTimeout(TIMEOUT_MS);
            InputStream cin = client.getInputStream();
            OutputStream cout = client.getOutputStream();
            byte[] head = readHead(cin);
            if (head == null) return;
            String headStr = new String(head, StandardCharsets.ISO_8859_1);
            String first = headStr.substring(0, Math.max(0, headStr.indexOf("\r\n")));
            String[] parts = first.split(" ");
            if (parts.length < 3) return;

            if (parts[0].equalsIgnoreCase("CONNECT")) {
                String hp = parts[1];
                int colon = hp.lastIndexOf(':');
                String host = colon > 0 ? hp.substring(0, colon) : hp;
                int port = colon > 0 ? Integer.parseInt(hp.substring(colon + 1)) : 443;
                upstream = connect(host, port);
                cout.write("HTTP/1.1 200 Connection Established\r\n\r\n".getBytes(StandardCharsets.ISO_8859_1));
                cout.flush();
                OutputStream uout = upstream.getOutputStream();
                forwardClientHello(cin, uout);
                pipe(client, upstream);
            } else {
                // Plain http:// request through the proxy: absolute-form → origin-form.
                java.net.URL u = new java.net.URL(parts[1]);
                int port = u.getPort() > 0 ? u.getPort() : 80;
                upstream = connect(u.getHost(), port);
                String path = u.getFile().isEmpty() ? "/" : u.getFile();
                String rewritten = parts[0] + " " + path + " " + parts[2] + headStr.substring(first.length());
                OutputStream uout = upstream.getOutputStream();
                uout.write(rewritten.getBytes(StandardCharsets.ISO_8859_1));
                uout.flush();
                pipe(client, upstream);
            }
        } catch (Exception ignored) {
            // connection failed — the browser shows its own error
        } finally {
            closeQuietly(client);
            closeQuietly(upstream);
        }
    }

    private static Socket connect(String host, int port) throws IOException {
        List<InetAddress> addrs = Net.DOH_DNS.lookup(host);
        IOException last = null;
        for (InetAddress a : addrs) {
            Socket s = new Socket();
            try {
                s.setTcpNoDelay(true);
                s.connect(new InetSocketAddress(a, port), 15000);
                s.setSoTimeout(0);
                return s;
            } catch (IOException e) {
                last = e;
                closeQuietly(s);
            }
        }
        throw last != null ? last : new IOException("no address for " + host);
    }

    // Request head up to and including the blank line (max 16KB).
    private static byte[] readHead(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        int state = 0;
        while (bo.size() < 16384) {
            int b = in.read();
            if (b < 0) return null;
            bo.write(b);
            // \r\n\r\n
            if ((state == 0 || state == 2) && b == '\r') state++;
            else if ((state == 1 || state == 3) && b == '\n') state++;
            else state = b == '\r' ? 1 : 0;
            if (state == 4) return bo.toByteArray();
        }
        return null;
    }

    // Read the client's first TLS record and resend it as many small records,
    // each flushed on its own (TCP_NODELAY → separate segments).
    private static void forwardClientHello(InputStream in, OutputStream out) throws IOException {
        byte[] hdr = readN(in, 5);
        if (hdr == null) return;
        int type = hdr[0] & 0xff;
        int len = ((hdr[3] & 0xff) << 8) | (hdr[4] & 0xff);
        if (type != 0x16 || len <= 0 || len > 1 << 15) {
            // Not a TLS handshake — pass through untouched.
            out.write(hdr);
            out.flush();
            return;
        }
        byte[] body = readN(in, len);
        if (body == null) return;
        for (int off = 0; off < body.length; off += FRAGMENT) {
            int n = Math.min(FRAGMENT, body.length - off);
            byte[] rec = new byte[5 + n];
            rec[0] = hdr[0];
            rec[1] = hdr[1];
            rec[2] = hdr[2];
            rec[3] = (byte) (n >> 8);
            rec[4] = (byte) n;
            System.arraycopy(body, off, rec, 5, n);
            out.write(rec);
            out.flush();
        }
    }

    private static byte[] readN(InputStream in, int n) throws IOException {
        byte[] b = new byte[n];
        int got = 0;
        while (got < n) {
            int r = in.read(b, got, n - got);
            if (r < 0) return null;
            got += r;
        }
        return b;
    }

    // Copy both directions until either side closes.
    private static void pipe(Socket a, Socket b) throws IOException {
        a.setSoTimeout(0);
        Thread t = new Thread(() -> copy(b, a), "mm-tunnel-down");
        t.setDaemon(true);
        t.start();
        copy(a, b);
        try {
            t.join(TIMEOUT_MS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static void copy(Socket from, Socket to) {
        try {
            InputStream in = from.getInputStream();
            OutputStream out = to.getOutputStream();
            byte[] buf = new byte[32 * 1024];
            int r;
            while ((r = in.read(buf)) != -1) {
                out.write(buf, 0, r);
                out.flush();
            }
        } catch (IOException ignored) {
            // one side closed
        } finally {
            try {
                to.shutdownOutput();
            } catch (IOException ignored) {
                // already closed
            }
        }
    }

    private static void closeQuietly(Socket s) {
        if (s == null) return;
        try {
            s.close();
        } catch (IOException ignored) {
            // nothing to do
        }
    }
}
