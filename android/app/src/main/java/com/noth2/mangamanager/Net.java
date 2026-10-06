package com.noth2.mangamanager;

import android.content.Context;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.URLEncoder;
import java.net.UnknownHostException;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import okhttp3.Cookie;
import okhttp3.CookieJar;
import okhttp3.Dns;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

// Network layer shared by the JS bridge (MMPlugin) and the image interceptor
// (MMWebViewClient). Three request "kinds":
//   doujin — DNS resolved over DoH (1.1.1.1 by IP, so ISP DNS blocking can't
//            interfere), browser UA + doujin Referer (the CDN 403s without them)
//   comic   — the comic WebView's cookies (Cloudflare clearance) + UA + site Referer
//   plain  — nothing special
final class Net {
    static final String DOUJIN_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    // Set from JS (settings): the comic site base url (Referer) and an optional proxy.
    static volatile String comicBase = "";
    // UA of the comic WebView, so image requests look like the same browser.
    static volatile String comicUA = DOUJIN_UA;

    private static volatile Proxy proxy = Proxy.NO_PROXY;
    // SNI-bypass tunnel port for the comic client (0 = off; see Tunnel.java).
    private static volatile int tunnelPort = 0;
    private static volatile OkHttpClient doujin, comic, plain;
    private static final OkHttpClient dohClient = new OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .build();

    private static File imgCacheDir;
    // Disk image cache budget (설정 › 관리 › 이미지 캐시). 0 = keep nothing.
    private static volatile long cacheMax = 400L * 1024 * 1024;
    // Bytes added since the last trim; a background trim runs every ~16MB.
    private static long addedSinceTrim = 0;
    private static volatile boolean trimming = false;

    private Net() {}

    static void init(Context ctx) {
        imgCacheDir = new File(ctx.getCacheDir(), "img");
        //noinspection ResultOfMethodCallIgnored
        imgCacheDir.mkdirs();
        new Thread(Net::pruneImgCache).start();
        rebuild();
    }

    // "host:port", "http://host:port" or "socks5://host:port"; '' = direct.
    static void setProxy(String rules) {
        Proxy p = Proxy.NO_PROXY;
        String r = rules == null ? "" : rules.trim();
        if (!r.isEmpty()) {
            Proxy.Type type = r.startsWith("socks") ? Proxy.Type.SOCKS : Proxy.Type.HTTP;
            String hp = r.replaceFirst("^[a-z0-9]+://", "").replaceAll("/.*$", "");
            int colon = hp.lastIndexOf(':');
            try {
                if (colon > 0) p = new Proxy(type, InetSocketAddress.createUnresolved(hp.substring(0, colon), Integer.parseInt(hp.substring(colon + 1))));
            } catch (NumberFormatException ignored) {
                p = Proxy.NO_PROXY;
            }
        }
        proxy = p;
        rebuild();
    }

    static void setTunnelPort(int port) {
        tunnelPort = port;
        rebuild();
    }

    // Drop pooled connections (a stalled socket otherwise keeps being reused).
    static void resetConnections() {
        for (OkHttpClient c : new OkHttpClient[] {doujin, comic, plain}) {
            if (c != null) c.connectionPool().evictAll();
        }
    }

    private static void rebuild() {
        OkHttpClient base = new OkHttpClient.Builder()
            .proxy(proxy)
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build();
        doujin = base.newBuilder()
            .dns(DOH_DNS)
            .addInterceptor(chain -> {
                Request.Builder b = chain.request().newBuilder();
                if (chain.request().header("User-Agent") == null) b.header("User-Agent", DOUJIN_UA);
                String site = doujinSite;
                if (!site.isEmpty()) {
                    if (chain.request().header("Referer") == null) b.header("Referer", site + "/");
                    if (chain.request().header("Origin") == null) b.header("Origin", site);
                }
                return chain.proceed(b.build());
            })
            .build();
        comic = base.newBuilder()
            .proxy(tunnelPort > 0 ? new Proxy(Proxy.Type.HTTP, new InetSocketAddress("127.0.0.1", tunnelPort)) : proxy)
            // Each request gets a deadline: a stalled connection (no reset, no data)
            // would otherwise hang the reader / download forever.
            .callTimeout(60, TimeUnit.SECONDS)
            .cookieJar(WEBVIEW_COOKIES)
            .addInterceptor(chain -> {
                Request.Builder b = chain.request().newBuilder();
                if (chain.request().header("User-Agent") == null) b.header("User-Agent", comicUA);
                if (chain.request().header("Referer") == null && !comicBase.isEmpty())
                    b.header("Referer", comicBase.replaceAll("/+$", "") + "/");
                return chain.proceed(b.build());
            })
            .build();
        plain = base;
    }

    // The doujin site's origin, sent as Referer / Origin (its CDN requires it).
    // Comes from the user-entered address (recognised in JS, MM.setNetwork).
    static volatile String doujinSite = "";

    static OkHttpClient client(String kind) {
        if ("doujin".equals(kind)) return doujin;
        if ("comic".equals(kind)) return comic;
        return plain;
    }

    // ---- DoH ----------------------------------------------------------------

    private static final class Cached {
        final List<InetAddress> addrs;
        final long at;
        Cached(List<InetAddress> a) { addrs = a; at = System.currentTimeMillis(); }
    }
    private static final Map<String, Cached> dohCache = new ConcurrentHashMap<>();
    private static final long DOH_TTL = 10 * 60 * 1000;

    // Raw answers ({type, data}) for name/type from Cloudflare's resolver; [] on failure.
    static JSONArray dohAnswers(String name, String type) {
        try {
            Request req = new Request.Builder()
                .url("https://1.1.1.1/dns-query?name=" + URLEncoder.encode(name, "UTF-8") + "&type=" + type)
                .header("accept", "application/dns-json")
                .build();
            try (Response res = dohClient.newCall(req).execute()) {
                ResponseBody body = res.body();
                if (!res.isSuccessful() || body == null) return new JSONArray();
                JSONArray a = new JSONObject(body.string()).optJSONArray("Answer");
                return a == null ? new JSONArray() : a;
            }
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    // DoH first (A records after any CNAME chain), system DNS as fallback.
    static final Dns DOH_DNS = hostname -> {
        if (hostname.matches("^[0-9.]+$")) return Dns.SYSTEM.lookup(hostname);
        Cached c = dohCache.get(hostname);
        if (c != null && System.currentTimeMillis() - c.at < DOH_TTL) return c.addrs;
        JSONArray ans = dohAnswers(hostname, "A");
        List<InetAddress> out = new ArrayList<>();
        for (int i = 0; i < ans.length(); i++) {
            JSONObject o = ans.optJSONObject(i);
            if (o == null || o.optInt("type") != 1) continue;
            try {
                out.add(InetAddress.getByAddress(hostname, InetAddress.getByName(o.optString("data")).getAddress()));
            } catch (UnknownHostException ignored) {
                // skip a malformed answer
            }
        }
        if (out.isEmpty()) return Dns.SYSTEM.lookup(hostname);
        // Desktop used the last A record of the chain; keep it first.
        Collections.reverse(out);
        dohCache.put(hostname, new Cached(out));
        return out;
    };

    // ---- cookies of the comic WebView ------------------------------------------

    private static final CookieJar WEBVIEW_COOKIES = new CookieJar() {
        @Override
        public void saveFromResponse(HttpUrl url, List<Cookie> cookies) {
            CookieManager cm = CookieManager.getInstance();
            for (Cookie c : cookies) cm.setCookie(url.toString(), c.toString());
        }

        @Override
        public List<Cookie> loadForRequest(HttpUrl url) {
            String raw = CookieManager.getInstance().getCookie(url.toString());
            if (raw == null || raw.isEmpty()) return Collections.emptyList();
            List<Cookie> out = new ArrayList<>();
            for (String part : raw.split(";\\s*")) {
                Cookie c = Cookie.parse(url, part);
                if (c != null) out.add(c);
            }
            return out;
        }
    };

    // ---- requests -----------------------------------------------------------

    static final class Result {
        int status;
        Map<String, String> headers;
        byte[] body;
    }

    static Request.Builder build(String url, Map<String, String> headers) {
        Request.Builder b = new Request.Builder().url(url);
        if (headers != null) for (Map.Entry<String, String> e : headers.entrySet()) b.header(e.getKey(), e.getValue());
        return b;
    }

    static Result get(String kind, String url, Map<String, String> headers) throws IOException {
        try (Response res = client(kind).newCall(build(url, headers).build()).execute()) {
            Result r = new Result();
            r.status = res.code();
            r.headers = new java.util.HashMap<>();
            for (String n : res.headers().names()) r.headers.put(n.toLowerCase(), res.header(n));
            ResponseBody body = res.body();
            r.body = body == null ? new byte[0] : body.bytes();
            return r;
        }
    }

    // Stream url → file (via file.part, renamed when complete). Returns bytes written.
    static long download(String kind, String url, Map<String, String> headers, File dest) throws IOException {
        try (Response res = client(kind).newCall(build(url, headers).build()).execute()) {
            if (!res.isSuccessful()) throw new IOException("GET " + url + " -> " + res.code());
            ResponseBody body = res.body();
            if (body == null) throw new IOException("empty body");
            File parent = dest.getParentFile();
            if (parent != null) //noinspection ResultOfMethodCallIgnored
                parent.mkdirs();
            File part = new File(dest.getPath() + ".part");
            long n = 0;
            try (InputStream in = body.byteStream(); OutputStream out = new FileOutputStream(part)) {
                byte[] buf = new byte[64 * 1024];
                int r;
                while ((r = in.read(buf)) != -1) {
                    out.write(buf, 0, r);
                    n += r;
                }
            }
            if (dest.exists()) //noinspection ResultOfMethodCallIgnored
                dest.delete();
            if (!part.renameTo(dest)) throw new IOException("rename failed: " + dest);
            return n;
        }
    }

    // ---- remote image cache (reader / thumbnails) ------------------------------

    // Bytes of a remote image, served from the disk cache when present. Image urls
    // are content-addressed (doujin hash / comic path), so entries never go stale.
    // A NAS file (reader page / cover), kept in the same disk cache so pages
    // aren't fetched again on every view.
    static byte[] cachedNas(String path) throws IOException {
        File f = new File(imgCacheDir, sha1("nas|" + path));
        if (f.exists() && f.length() > 0) {
            //noinspection ResultOfMethodCallIgnored
            f.setLastModified(System.currentTimeMillis());
            return Files.readAllBytes(f.toPath());
        }
        byte[] bytes = Vfs.read(path);
        store(f, bytes);
        return bytes;
    }

    static byte[] cachedImage(String kind, String url) throws IOException {
        File f = new File(imgCacheDir, sha1(kind + "|" + url));
        if (f.exists() && f.length() > 0) {
            //noinspection ResultOfMethodCallIgnored
            f.setLastModified(System.currentTimeMillis());
            return Files.readAllBytes(f.toPath());
        }
        IOException last = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            try (Response res = client(kind).newCall(new Request.Builder().url(url).build()).execute()) {
                if (!res.isSuccessful()) throw new HttpError(res.code());
                ResponseBody body = res.body();
                byte[] bytes = body == null ? new byte[0] : body.bytes();
                store(f, bytes);
                return bytes;
            } catch (HttpError e) {
                throw e; // 403/404: retrying won't help
            } catch (IOException e) {
                last = e;
                try {
                    Thread.sleep(300L * (attempt + 1));
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
        throw last != null ? last : new IOException("image fetch failed");
    }

    static final class HttpError extends IOException {
        final int code;
        HttpError(int code) { super("HTTP " + code); this.code = code; }
    }

    // Write a cache entry (temp + rename); with a 0 budget nothing is kept.
    // Every ~16MB added, trim in the background.
    private static void store(File f, byte[] bytes) throws IOException {
        if (cacheMax <= 0) return;
        File tmp = new File(f.getPath() + ".tmp");
        try (OutputStream out = new FileOutputStream(tmp)) {
            out.write(bytes);
        }
        //noinspection ResultOfMethodCallIgnored
        tmp.renameTo(f);
        boolean trim;
        synchronized (Net.class) {
            addedSinceTrim += bytes.length;
            trim = addedSinceTrim > 16L * 1024 * 1024 && !trimming;
            if (trim) {
                addedSinceTrim = 0;
                trimming = true;
            }
        }
        if (trim) new Thread(() -> {
            try {
                pruneImgCache();
            } finally {
                trimming = false;
            }
        }).start();
    }

    // LRU: entries are touched (mtime) on every hit, so the least recently
    // viewed go first; trims to 90% of the budget to avoid trimming each write.
    private static void pruneImgCache() {
        File[] files = imgCacheDir.listFiles();
        if (files == null) return;
        long max = cacheMax;
        long total = 0;
        for (File f : files) total += f.length();
        if (total <= max) return;
        Arrays.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        for (File f : files) {
            if (total <= max * 9 / 10) break;
            total -= f.length();
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }

    static void setCacheLimit(long bytes) {
        cacheMax = Math.max(0, bytes);
        new Thread(Net::pruneImgCache).start();
    }

    // { bytes, files } currently in the cache.
    static long[] cacheUsage() {
        File[] files = imgCacheDir.listFiles();
        long total = 0;
        if (files != null) for (File f : files) total += f.length();
        return new long[] {total, files == null ? 0 : files.length};
    }

    static void clearImgCache() {
        File[] files = imgCacheDir.listFiles();
        if (files != null) for (File f : files) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }

    static String sha1(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-1").digest(s.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }
}
