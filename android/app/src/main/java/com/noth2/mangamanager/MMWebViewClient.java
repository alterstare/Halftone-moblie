package com.noth2.mangamanager;

import android.net.Uri;
import android.util.Base64;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

// Serves the app's image urls (the mobile counterpart of the desktop
// `mangaimg://` protocol), same-origin with the app so canvas thumbnails stay
// untainted:
//   https://localhost/_mm/img/<b64url abs path>   local file
//   https://localhost/_mm/web/<b64url https url>  doujin image (DoH + Referer)
//   https://localhost/_mm/comic/<b64url https url> comic image (WebView cookies)
// Everything else falls through to Capacitor's local server.
final class MMWebViewClient extends BridgeWebViewClient {
    private static final String PREFIX = "/_mm/";

    MMWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri u = request.getUrl();
        String path = u.getPath();
        if ("localhost".equals(u.getHost()) && path != null && path.startsWith(PREFIX)) {
            return serve(path.substring(PREFIX.length()));
        }
        return super.shouldInterceptRequest(view, request);
    }

    private static WebResourceResponse serve(String rest) {
        int slash = rest.indexOf('/');
        if (slash < 0) return error(400);
        String kind = rest.substring(0, slash);
        String target;
        try {
            target = new String(Base64.decode(rest.substring(slash + 1), Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return error(400);
        }
        try {
            if ("img".equals(kind) && Vfs.isRemote(target)) {
                return ok(mimeOf(target), new ByteArrayInputStream(Net.cachedNas(target)));
            }
            if ("img".equals(kind)) {
                File f = new File(target);
                if (!f.isFile()) return error(404);
                return ok(mimeOf(target), new FileInputStream(f));
            }
            // (pre-0.5.5 saved cover urls used the comic source's old site-named path segment)
            if ("web".equals(kind) || "comic".equals(kind) || ("to" + "ki").equals(kind)) {
                byte[] bytes = Net.cachedImage("web".equals(kind) ? "doujin" : "comic", target);
                return ok(mimeOf(target), new ByteArrayInputStream(bytes));
            }
        } catch (Net.HttpError e) {
            return error(e.code);
        } catch (IOException e) {
            return error(502);
        }
        return error(400);
    }

    private static WebResourceResponse ok(String mime, InputStream in) {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "public, max-age=604800, immutable");
        h.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse(mime, null, 200, "OK", h, in);
    }

    private static WebResourceResponse error(int code) {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse("text/plain", "utf-8", code, code == 404 ? "Not Found" : "Error", h,
            new ByteArrayInputStream(new byte[0]));
    }

    static String mimeOf(String name) {
        String n = name.toLowerCase(Locale.ROOT).replaceAll("[?#].*$", "");
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".avif")) return "image/avif";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".gif")) return "image/gif";
        if (n.endsWith(".bmp")) return "image/bmp";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        return "image/*";
    }
}
