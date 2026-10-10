package com.noth2.mangamanager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.webkit.WebView;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

// Keeps the app process alive while downloads run. The downloads themselves
// are JS in the WebView (src/backend/downloads.ts); without a foreground
// service Android freezes / kills the backgrounded process and they stall.
// Started / updated / stopped by MMPlugin.downloadService; shows one ongoing
// notification with the progress. Holds a partial wake lock + Wi-Fi lock so
// the screen going off doesn't cut the transfer either.
public class DownloadService extends Service {
    static final String CHANNEL = "downloads";
    private static final int NOTE_ID = 1001;

    // True while the service is up — read by the exit path (keep running in
    // the background instead of finishing the activity) and the WebViews.
    static volatile boolean running;

    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;

    static void update(Context ctx, String title, String text, int done, int total) {
        Intent i = new Intent(ctx, DownloadService.class)
            .putExtra("title", title)
            .putExtra("text", text)
            .putExtra("done", done)
            .putExtra("total", total);
        try {
            androidx.core.content.ContextCompat.startForegroundService(ctx, i);
        } catch (Exception ignored) {
            // Background start not allowed (app already invisible) — only the
            // first start needs to happen while the app is in the foreground.
        }
    }

    static void stop(Context ctx) {
        if (!running) return;
        ctx.stopService(new Intent(ctx, DownloadService.class));
    }

    // While downloading, the WebView renderers keep their priority when the
    // app is in the background (by default it's waived once invisible).
    static void applyPriority(WebView w) {
        if (w == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        w.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, !running);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "다운로드", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "halftone:download");
            wake.setReferenceCounted(false);
            wake.acquire(6 * 60 * 60 * 1000L);
        }
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
        if (wm != null) {
            wifi = wm.createWifiLock(
                Build.VERSION.SDK_INT >= 29 ? WifiManager.WIFI_MODE_FULL_HIGH_PERF : WifiManager.WIFI_MODE_FULL,
                "halftone:download");
            wifi.setReferenceCounted(false);
            wifi.acquire();
        }
        MMPlugin.onDownloadService();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null ? intent.getStringExtra("title") : null;
        String text = intent != null ? intent.getStringExtra("text") : null;
        int done = intent != null ? intent.getIntExtra("done", 0) : 0;
        int total = intent != null ? intent.getIntExtra("total", 0) : 0;
        Notification n = build(title, text, done, total);
        int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0;
        try {
            ServiceCompat.startForeground(this, NOTE_ID, n, type);
        } catch (Exception e) {
            // Not allowed now (e.g. the daily dataSync limit used up) — give up
            // quietly; downloads keep going while the app stays visible.
            stopSelf();
        }
        // Process killed anyway → don't come back without the WebView.
        return START_NOT_STICKY;
    }

    private Notification build(String title, String text, int done, int total) {
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = open == null ? null : PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_download)
            .setContentTitle(title == null || title.isEmpty() ? "다운로드 중" : title)
            .setContentText(text == null ? "" : text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS);
        if (pi != null) b.setContentIntent(pi);
        if (total > 0) b.setProgress(total, Math.min(done, total), false);
        else b.setProgress(0, 0, true);
        return b.build();
    }

    // Swiped away from recents: the activity (and the WebView the downloads
    // run in) is gone — nothing left to keep alive. The queue resumes at the
    // next start (renderer store, mm-dl-queue).
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    // Android 15: dataSync services get ~6h a day; the system calls this when
    // it's used up — must stop, or the app is killed.
    @Override
    public void onTimeout(int startId, int fgsType) {
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        if (wake != null && wake.isHeld()) wake.release();
        if (wifi != null && wifi.isHeld()) wifi.release();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        MMPlugin.onDownloadService();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
