package com.noth2.mangamanager;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSObject;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

// The comic scraper: a second WebView that lives BEHIND the app's WebView (so it
// lays out and runs scripts like a real, visible page), brought to the front
// when the user has to clear a Cloudflare check or browse a backup site by
// hand. Mobile counterpart of the desktop hidden BrowserWindow (lib/comic.ts).
//
// JS (backend/comic.ts) drives it: load(url) → poll eval(probe) → eval(scrape).
final class ComicWeb {
    interface Listener {
        void onVisible(boolean visible);
    }

    // (No document-start overrides: patching navigator.webdriver / stubbing
    // RTCPeerConnection is exactly what Cloudflare's checks look for — a plain
    // WebView passes them; an altered one gets blocked.)

    private final Activity act;
    private final ViewGroup root;
    private final Listener listener;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private LinearLayout container;
    private WebView web;
    private TextView titleView;
    private boolean visible;

    // Navigation state, read by JS through state().
    private volatile int navSeq;
    private volatile boolean committed;
    private volatile int errorCode;
    private volatile String errorDesc = "";
    private volatile String currentUrl = "";

    private final Map<String, Callback> pending = new ConcurrentHashMap<>();

    interface Callback {
        void done(String json);
    }

    WebView webView() {
        return web;
    }

    // Picture-in-picture: the scraper page keeps its full-screen size (the
    // site's virtual page list renders by viewport) instead of shrinking to
    // the tiny window. fullW/H = the last size seen outside PIP.
    private int fullW, fullH;
    private boolean frozen;

    void freezeSize(boolean on) {
        ui.post(() -> {
            if (container == null) return;
            frozen = on;
            ViewGroup.LayoutParams lp = container.getLayoutParams();
            if (lp == null) return;
            if (on && fullW > 0 && fullH > 0) {
                lp.width = fullW;
                lp.height = fullH;
            } else {
                lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
                lp.height = ViewGroup.LayoutParams.MATCH_PARENT;
            }
            container.setLayoutParams(lp);
        });
    }

    ComicWeb(Activity act, ViewGroup root, Listener listener) {
        this.act = act;
        this.root = root;
        this.listener = listener;
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void ensure() {
        if (web != null) return;
        container = new LinearLayout(act);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setBackgroundColor(Color.WHITE);

        LinearLayout bar = new LinearLayout(act);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#1e222c"));
        int pad = dp(8);
        bar.setPadding(dp(14), pad, pad, pad);
        titleView = new TextView(act);
        titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        titleView.setSingleLine(true);
        bar.addView(titleView, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        // Borderless × (app-wide close control: no outline, no text label).
        TextView close = new TextView(act);
        close.setText("✕");
        close.setTextColor(Color.WHITE);
        close.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        close.setGravity(Gravity.CENTER);
        close.setMinWidth(dp(44));
        close.setMinHeight(dp(40));
        close.setContentDescription("닫기");
        close.setOnClickListener(v -> hide());
        bar.addView(close, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        container.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        web = new WebView(act);
        DownloadService.applyPriority(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        // Keep the WebView's own UA: Cloudflare compares it with the client hints
        // (Sec-CH-UA / navigator.userAgentData say "Android WebView"); a UA posing
        // as Chrome while the hints say WebView fails its check (the verify box
        // never loads / "blocked"). OkHttp image requests reuse the same UA so the
        // cf_clearance cookie stays valid for them.
        String ua = s.getUserAgentString();
        Net.comicUA = ua;
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new Bridge(), "MMComic");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                currentUrl = url;
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                committed = true;
                currentUrl = url;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                committed = true;
                currentUrl = url;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (!req.isForMainFrame()) return;
                int code = err.getErrorCode();
                // Direct connection reset / refused (SNI block) → retry through the tunnel.
                if ((code == ERROR_CONNECT || code == ERROR_UNKNOWN || code == ERROR_TIMEOUT)
                        && MMPlugin.webTunnelFallback(act, () -> view.loadUrl(req.getUrl().toString()))) return;
                errorCode = code;
                errorDesc = String.valueOf(err.getDescription());
                committed = true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                String scheme = req.getUrl().getScheme();
                // Keep http(s) navigation inside; drop intent:/market: etc. (ads).
                return scheme == null || !(scheme.equals("http") || scheme.equals("https"));
            }
        });
        // Behind the app's WebView: index 0 = drawn first = covered.
        // Edge-to-edge: keep the bar and page clear of the status / navigation bars.
        ViewCompat.setOnApplyWindowInsetsListener(container, (v, insets) -> {
            Insets b = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            v.setPadding(b.left, b.top, b.right, b.bottom);
            return insets;
        });
        root.addView(container, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        container.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
            if (frozen || (android.os.Build.VERSION.SDK_INT >= 24 && act.isInPictureInPictureMode())) return;
            fullW = r - l;
            fullH = b - t;
        });
        container.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        applyImageBlock();
    }

    // Hidden: skip images (the scraper only reads attributes); visible: normal page.
    private void applyImageBlock() {
        if (web != null) web.getSettings().setBlockNetworkImage(!visible);
    }

    private int dp(int v) {
        return Math.round(v * act.getResources().getDisplayMetrics().density);
    }

    // ---- API (any thread) ----------------------------------------------------

    // Start navigating; returns the navigation id. Progress is read via state().
    int load(String url) {
        final int seq = ++navSeq;
        committed = false;
        errorCode = 0;
        errorDesc = "";
        ui.post(() -> {
            ensure();
            web.loadUrl(url);
        });
        return seq;
    }

    JSObject state() {
        JSObject o = new JSObject();
        o.put("nav", navSeq);
        o.put("committed", committed);
        o.put("errorCode", errorCode);
        o.put("errorDesc", errorDesc);
        o.put("url", currentUrl);
        o.put("visible", visible);
        return o;
    }

    // Evaluate an expression (may be a Promise) in the page; cb gets the JSON
    // {ok, v} / {ok:false, e}. The caller enforces its own timeout.
    void eval(String expr, Callback cb) {
        String id = UUID.randomUUID().toString();
        pending.put(id, cb);
        String js = "(async()=>{let r;try{r={ok:true,v:await (" + expr + ")}}catch(e){r={ok:false,e:String(e)}}" +
            "try{MMComic.done('" + id + "',JSON.stringify(r===undefined?null:r))}catch(e){}})();void 0";
        ui.post(() -> {
            ensure();
            web.evaluateJavascript(js, null);
        });
    }

    void cancel(String id) {
        pending.remove(id);
    }

    String currentUrl() {
        return currentUrl;
    }

    void show(String title) {
        ui.post(() -> {
            ensure();
            titleView.setText(title == null || title.isEmpty() ? "일반 만화 온라인" : title);
            if (!visible) {
                visible = true;
                applyImageBlock();
                container.bringToFront();
                listener.onVisible(true);
            }
        });
    }

    void hide() {
        ui.post(() -> {
            if (!visible || container == null) return;
            visible = false;
            applyImageBlock();
            root.removeView(container);
            root.addView(container, 0);
            listener.onVisible(false);
        });
    }

    boolean isVisible() {
        return visible;
    }

    // Back button while visible: page history first, then close the overlay.
    boolean back() {
        if (!visible) return false;
        if (web != null && web.canGoBack()) web.goBack();
        else hide();
        return true;
    }

    private final class Bridge {
        @JavascriptInterface
        public void done(String id, String json) {
            Callback cb = pending.remove(id);
            if (cb != null) cb.done(json);
        }
    }
}
