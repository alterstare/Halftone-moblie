package com.noth2.mangamanager;

import android.util.Xml;

import org.xmlpull.v1.XmlPullParser;

import java.io.IOException;
import java.io.InputStream;
import java.io.StringReader;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import okhttp3.Credentials;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.BufferedSink;
import okio.Okio;
import okio.Source;

// WebDAV (RFC 4918) over OkHttp: PROPFIND / GET / PUT / MKCOL / DELETE / MOVE,
// Basic auth. `insecure` trusts any certificate (self-signed NAS https).
final class WebDavFs implements RemoteFs {
    private final HttpUrl base;
    private final OkHttpClient http;

    WebDavFs(NasStore.Conn c, String password) throws IOException {
        String u = c.url == null ? "" : c.url.trim();
        if (!u.contains("://")) u = "http://" + u;
        if (!u.endsWith("/")) u += "/";
        HttpUrl b = HttpUrl.parse(u);
        if (b == null) throw new IOException("WebDAV 주소가 올바르지 않습니다: " + c.url);
        base = b;
        final String auth = (c.user == null || c.user.isEmpty()) ? null : Credentials.basic(c.user, password == null ? "" : password, StandardCharsets.UTF_8);
        OkHttpClient.Builder bld = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS)
            .followRedirects(false)
            .addInterceptor(chain -> {
                Request.Builder r = chain.request().newBuilder();
                if (auth != null) r.header("Authorization", auth);
                return chain.proceed(r.build());
            });
        if (c.insecure) {
            try {
                X509TrustManager tm = new X509TrustManager() {
                    public void checkClientTrusted(X509Certificate[] ch, String a) {}
                    public void checkServerTrusted(X509Certificate[] ch, String a) {}
                    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                };
                SSLContext ssl = SSLContext.getInstance("TLS");
                ssl.init(null, new TrustManager[] {tm}, new SecureRandom());
                bld.sslSocketFactory(ssl.getSocketFactory(), tm).hostnameVerifier((h, s) -> true);
            } catch (Exception e) {
                throw new IOException(e);
            }
        }
        http = bld.build();
    }

    private HttpUrl url(String rel, boolean dir) {
        HttpUrl.Builder b = base.newBuilder();
        if (!rel.isEmpty()) for (String seg : rel.split("/")) if (!seg.isEmpty()) b.addPathSegment(seg);
        if (dir) b.addPathSegment(""); // trailing slash for collections
        return b.build();
    }

    private static IOException fail(String what, Response r) {
        if (r.code() == 401) return new IOException("NAS 로그인 실패 (아이디 / 비밀번호 확인)");
        return new IOException(what + " → HTTP " + r.code());
    }

    private static final MediaType XML = MediaType.parse("application/xml; charset=utf-8");
    private static final String PROPFIND_BODY =
        "<?xml version=\"1.0\" encoding=\"utf-8\"?><d:propfind xmlns:d=\"DAV:\"><d:prop>"
            + "<d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>";

    private List<Entry> propfind(String rel, int depth) throws IOException {
        Request req = new Request.Builder().url(url(rel, depth > 0))
            .method("PROPFIND", RequestBody.create(PROPFIND_BODY, XML))
            .header("Depth", String.valueOf(depth)).build();
        try (Response r = http.newCall(req).execute()) {
            if (r.code() == 404) return null;
            if (r.code() != 207 && !r.isSuccessful()) throw fail("PROPFIND " + rel, r);
            ResponseBody body = r.body();
            return parse(body == null ? "" : body.string());
        }
    }

    private static final ThreadLocal<SimpleDateFormat> RFC1123 = ThreadLocal.withInitial(() -> {
        SimpleDateFormat f = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US);
        f.setTimeZone(java.util.TimeZone.getTimeZone("GMT"));
        return f;
    });

    // <multistatus><response><href/><propstat><prop>… → entries (first = the target itself)
    private static List<Entry> parse(String xml) throws IOException {
        List<Entry> out = new ArrayList<>();
        try {
            XmlPullParser p = Xml.newPullParser();
            p.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true);
            p.setInput(new StringReader(xml));
            Entry cur = null;
            String text = null;
            for (int ev = p.getEventType(); ev != XmlPullParser.END_DOCUMENT; ev = p.next()) {
                String n = p.getName();
                if (ev == XmlPullParser.START_TAG) {
                    if ("response".equals(n)) cur = new Entry();
                    else if ("collection".equals(n) && cur != null) cur.dir = true;
                    text = null;
                } else if (ev == XmlPullParser.TEXT) {
                    text = p.getText();
                } else if (ev == XmlPullParser.END_TAG && cur != null) {
                    if ("href".equals(n) && text != null) {
                        String h = text.trim();
                        while (h.endsWith("/") && h.length() > 1) h = h.substring(0, h.length() - 1);
                        String last = h.substring(h.lastIndexOf('/') + 1);
                        cur.name = URLDecoder.decode(last.replace("+", "%2B"), "UTF-8");
                    } else if ("getcontentlength".equals(n) && text != null) {
                        try { cur.size = Long.parseLong(text.trim()); } catch (NumberFormatException ignored) {}
                    } else if ("getlastmodified".equals(n) && text != null) {
                        try {
                            Date d = RFC1123.get().parse(text.trim());
                            if (d != null) cur.mtime = d.getTime();
                        } catch (Exception ignored) {}
                    } else if ("response".equals(n)) {
                        out.add(cur);
                        cur = null;
                    }
                    text = null;
                }
            }
        } catch (Exception e) {
            throw new IOException("WebDAV 응답을 읽지 못했습니다: " + e.getMessage());
        }
        return out;
    }

    @Override
    public Entry stat(String rel) throws IOException {
        List<Entry> l = propfind(rel, 0);
        if (l == null || l.isEmpty()) {
            Entry e = new Entry();
            e.exists = false;
            return e;
        }
        return l.get(0);
    }

    @Override
    public List<Entry> list(String rel) throws IOException {
        List<Entry> l = propfind(rel, 1);
        if (l == null) throw new IOException("ENOENT: " + rel);
        return l.isEmpty() ? l : l.subList(1, l.size()); // drop the folder itself
    }

    @Override
    public InputStream open(String rel) throws IOException {
        Response r = http.newCall(new Request.Builder().url(url(rel, false)).build()).execute();
        if (!r.isSuccessful()) {
            r.close();
            throw r.code() == 404 ? new IOException("ENOENT: " + rel) : fail("GET " + rel, r);
        }
        ResponseBody b = r.body();
        if (b == null) throw new IOException("empty body");
        return b.byteStream();
    }

    @Override
    public void write(String rel, InputStream data, long length) throws IOException {
        int slash = rel.lastIndexOf('/');
        if (slash > 0) mkdirs(rel.substring(0, slash));
        RequestBody body = new RequestBody() {
            @Override public MediaType contentType() { return MediaType.parse("application/octet-stream"); }
            @Override public long contentLength() { return length; }
            @Override public void writeTo(BufferedSink sink) throws IOException {
                try (Source s = Okio.source(data)) { sink.writeAll(s); }
            }
        };
        try (Response r = http.newCall(new Request.Builder().url(url(rel, false)).put(body).build()).execute()) {
            if (!r.isSuccessful()) throw fail("PUT " + rel, r);
        }
    }

    @Override
    public void mkdirs(String rel) throws IOException {
        StringBuilder acc = new StringBuilder();
        for (String seg : rel.split("/")) {
            if (seg.isEmpty()) continue;
            if (acc.length() > 0) acc.append('/');
            acc.append(seg);
            Entry e = stat(acc.toString());
            if (e.exists) continue;
            try (Response r = http.newCall(new Request.Builder().url(url(acc.toString(), true)).method("MKCOL", null).build()).execute()) {
                if (!r.isSuccessful() && r.code() != 405) throw fail("MKCOL " + acc, r);
            }
        }
    }

    @Override
    public void delete(String rel, boolean recursive) throws IOException {
        Entry e = stat(rel);
        if (!e.exists) return;
        try (Response r = http.newCall(new Request.Builder().url(url(rel, e.dir)).delete().build()).execute()) {
            if (!r.isSuccessful() && r.code() != 404) throw fail("DELETE " + rel, r);
        }
    }

    @Override
    public void rename(String from, String to) throws IOException {
        Entry e = stat(from);
        if (!e.exists) throw new IOException("ENOENT: " + from);
        int slash = to.lastIndexOf('/');
        if (slash > 0) mkdirs(to.substring(0, slash));
        Request req = new Request.Builder().url(url(from, e.dir)).method("MOVE", null)
            .header("Destination", url(to, e.dir).toString()).header("Overwrite", "F").build();
        try (Response r = http.newCall(req).execute()) {
            if (!r.isSuccessful()) throw fail("MOVE " + from, r);
        }
    }

    @Override
    public void close() {
        http.connectionPool().evictAll();
    }
}
