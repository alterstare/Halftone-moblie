package com.noth2.mangamanager;

import android.content.Context;
import android.util.AttributeSet;

import com.getcapacitor.CapacitorWebView;

// The app WebView (res/layout/capacitor_bridge_layout_main.xml overrides
// Capacitor's). Downloads run as JS in it; once the app is in the background
// the page counts as hidden and Chromium throttles its timers (250ms → 1s,
// then tens of seconds), which stalls the download pacer. While the download
// service runs, the page is told its window is still visible — nothing is
// drawn (the activity is stopped), the timers just keep their pace.
public class MMWebView extends CapacitorWebView {
    private int windowVis = VISIBLE;

    public MMWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        windowVis = visibility;
        super.onWindowVisibilityChanged(DownloadService.running ? VISIBLE : visibility);
    }

    // Download service started / stopped: re-apply (stopped in the background
    // → the page becomes hidden again).
    void refreshVisibility() {
        super.onWindowVisibilityChanged(DownloadService.running ? VISIBLE : windowVis);
    }
}
