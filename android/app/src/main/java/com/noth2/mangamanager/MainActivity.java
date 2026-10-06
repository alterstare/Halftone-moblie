package com.noth2.mangamanager;

import android.os.Bundle;

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
        // Back: comic overlay first, then the app's own navigation (JS decides
        // whether to step back or exit).
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                MMPlugin p = MMPlugin.instance;
                if (p != null && p.handleBack()) return;
                finish();
            }
        });
    }
}
