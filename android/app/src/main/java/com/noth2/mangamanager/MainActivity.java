package com.noth2.mangamanager;

import android.app.PictureInPictureParams;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MMPlugin.class);
        super.onCreate(savedInstanceState);
        // Serve /_mm/… image urls (local files, doujin/comic images).
        bridge.setWebViewClient(new MMWebViewClient(bridge));
        // No page zoom: the only pinch zoom is the reader's own (on the pages).
        bridge.getWebView().getSettings().setSupportZoom(false);
        bridge.getWebView().getSettings().setBuiltInZoomControls(false);
        // Last theme (MMPlugin.setTheme) as the page background before it loads.
        boolean dark = getSharedPreferences("halftone", MODE_PRIVATE).getBoolean("dark", false);
        int bg = dark ? 0xFF0B0D13 : 0xFFF4F5F8;
        bridge.getWebView().setBackgroundColor(bg);
        getWindow().getDecorView().setBackgroundColor(bg);
        // Back: comic overlay first, then the app's own navigation (JS decides
        // whether to step back or exit).
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                MMPlugin p = MMPlugin.instance;
                if (p != null && p.handleBack()) return;
                MMPlugin.exit(MainActivity.this);
            }
        });
    }

    @Override
    public void onDestroy() {
        // Closed for good (not a configuration change): downloads die with the
        // WebView unless they're meant to outlive the activity — drop the
        // service + notification. The queue resumes at the next start.
        if (isFinishing()) {
            MMPlugin.closing = true;
            DownloadService.stop(this);
        }
        super.onDestroy();
    }

    // Notification permission (asked by MMPlugin.downloadService at the first
    // download) denied → say once where the progress went.
    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == MMPlugin.NOTIFY_REQ && grantResults.length > 0
            && grantResults[0] != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            android.widget.Toast.makeText(this,
                "알림 권한이 꺼져 있어 다운로드 진행 알림이 보이지 않습니다. 다운로드는 계속되며, 휴대폰 설정 › 앱 › Halftone › 알림에서 켤 수 있습니다.",
                android.widget.Toast.LENGTH_LONG).show();
        }
    }

    // ---- picture-in-picture while 일반 만화 downloads run ---------------------------

    private PictureInPictureParams pipParams() {
        PictureInPictureParams.Builder b = new PictureInPictureParams.Builder().setAspectRatio(new Rational(16, 9));
        if (Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(MMPlugin.pipWanted).setSeamlessResizeEnabled(false);
        return b.build();
    }

    // MMPlugin.pipWanted changed. Android 12+ enters PIP by itself on home
    // (auto-enter); older versions go through onUserLeaveHint.
    void updatePip() {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            setPictureInPictureParams(pipParams());
        } catch (Exception ignored) {
            // PIP turned off for the app in system settings.
        }
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT >= 26 && Build.VERSION.SDK_INT < 31 && MMPlugin.pipWanted) {
            try {
                enterPictureInPictureMode(pipParams());
            } catch (Exception ignored) {
                // PIP not allowed — the service still keeps the process alive.
            }
        }
    }

    // In PIP the app UI is unreadable at that size: a native card with the
    // download progress covers it. The scraper page keeps its full size.
    private LinearLayout pipCard;
    private TextView pipTitle, pipText;
    private ProgressBar pipBar;

    @Override
    public void onPictureInPictureModeChanged(boolean inPip, Configuration cfg) {
        super.onPictureInPictureModeChanged(inPip, cfg);
        MMPlugin p = MMPlugin.instance;
        if (p != null) p.comicFreeze(inPip);
        if (inPip) showPipCard();
        else if (pipCard != null) pipCard.setVisibility(android.view.View.GONE);
    }

    private void showPipCard() {
        if (pipCard == null) {
            pipCard = new LinearLayout(this);
            pipCard.setOrientation(LinearLayout.VERTICAL);
            pipCard.setGravity(Gravity.CENTER_VERTICAL);
            pipCard.setBackgroundColor(Color.parseColor("#0B0D13"));
            int pad = dp(10);
            pipCard.setPadding(pad, pad, pad, pad);
            pipTitle = new TextView(this);
            pipTitle.setTextColor(Color.WHITE);
            pipTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            pipTitle.setMaxLines(2);
            pipTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
            pipText = new TextView(this);
            pipText.setTextColor(Color.parseColor("#B8BCC8"));
            pipText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            pipBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
            pipBar.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.parseColor("#8B5CF6")));
            pipCard.addView(pipTitle);
            pipCard.addView(pipText);
            LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(6));
            bl.topMargin = dp(6);
            pipCard.addView(pipBar, bl);
            pipCard.setClickable(true);
            ((ViewGroup) getWindow().getDecorView()).addView(pipCard,
                new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        pipCard.setVisibility(android.view.View.VISIBLE);
        pipCard.bringToFront();
        applyPip();
    }

    // Latest progress (UI thread, every update). active false = all finished.
    private String lastTitle = "", lastText = "";
    private int lastDone, lastTotal;

    void pipProgress(boolean active, String title, String text, int done, int total) {
        lastTitle = active ? title : "다운로드 완료";
        lastText = active ? text : "";
        lastDone = active ? done : 1;
        lastTotal = active ? total : 1;
        if (pipCard != null && pipCard.getVisibility() == android.view.View.VISIBLE) applyPip();
    }

    private void applyPip() {
        pipTitle.setText(lastTitle == null || lastTitle.isEmpty() ? "다운로드 중" : lastTitle);
        pipText.setText(lastText == null ? "" : lastText);
        if (lastTotal > 0) {
            pipBar.setIndeterminate(false);
            pipBar.setMax(lastTotal);
            pipBar.setProgress(Math.min(lastDone, lastTotal));
        } else {
            pipBar.setIndeterminate(true);
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
