package com.pgmzchat.app;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Looper;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.ValueCallback;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;
import android.content.pm.PackageManager;
import android.Manifest;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.util.Log;
import android.view.ViewGroup;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends Activity {
    private WebView webView;
    private ValueCallback<Uri[]> uploadCallback;
    private static final int FILE_PICKER = 42;
    private static final int MEDIA_PERMISSION_REQUEST = 43;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 44;
    private static final String NOTIFICATION_CHANNEL_ID = "pgmz_messages";
    private PermissionRequest pendingMediaPermissionRequest;
    private static final String ORIGIN = "https://pgmz.local/";
    private static final String TAG = "PgmzMedia";
    private AudioManager mediaAudioManager;
    private int previousAudioMode = AudioManager.MODE_NORMAL;
    private Object mediaAudioFocusRequest;
    private boolean nativeMediaAudioActive = false;
    private volatile boolean localAppPageLoaded = false;
    private final AudioManager.OnAudioFocusChangeListener mediaAudioFocusListener = focusChange -> {
        Log.d(TAG, "Audio focus changed: " + focusChange);
    };

    /** Called by the bundled app before getUserMedia: Android WebView requires audio focus too. */
    private synchronized boolean beginNativeMediaAudio() {
        try {
            if (nativeMediaAudioActive) return true;
            AudioManager manager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (manager == null) return false;
            int focusResult;
            int oldMode = manager.getMode();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes attributes = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build();
                AudioFocusRequest request = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                        .setAudioAttributes(attributes)
                        .setOnAudioFocusChangeListener(mediaAudioFocusListener)
                        .setAcceptsDelayedFocusGain(false)
                        .setWillPauseWhenDucked(true)
                        .build();
                focusResult = manager.requestAudioFocus(request);
                if (focusResult == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) mediaAudioFocusRequest = request;
            } else {
                focusResult = manager.requestAudioFocus(mediaAudioFocusListener, AudioManager.STREAM_VOICE_CALL,
                        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
            }
            if (focusResult != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                Log.w(TAG, "Could not acquire audio focus, result=" + focusResult);
                return false;
            }
            previousAudioMode = oldMode;
            mediaAudioManager = manager;
            nativeMediaAudioActive = true;
            manager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            Log.i(TAG, "Native media audio session enabled; previous mode=" + previousAudioMode);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Failed to prepare native audio focus/mode", e);
            endNativeMediaAudio();
            return false;
        }
    }

    private synchronized void endNativeMediaAudio() {
        if (!nativeMediaAudioActive) return;
        AudioManager manager = mediaAudioManager;
        try {
            if (manager != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && mediaAudioFocusRequest instanceof AudioFocusRequest) {
                    manager.abandonAudioFocusRequest((AudioFocusRequest) mediaAudioFocusRequest);
                } else {
                    manager.abandonAudioFocus(mediaAudioFocusListener);
                }
                if (manager.getMode() == AudioManager.MODE_IN_COMMUNICATION) manager.setMode(previousAudioMode);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to restore audio focus/mode", e);
        } finally {
            nativeMediaAudioActive = false;
            mediaAudioManager = null;
            mediaAudioFocusRequest = null;
            Log.i(TAG, "Native media audio session released");
        }
    }

    private boolean runAudioActionOnUiThread(boolean begin) {
        if (Looper.myLooper() == Looper.getMainLooper()) return begin ? beginNativeMediaAudio() : releaseNativeMediaAudioResult();
        CountDownLatch latch = new CountDownLatch(1);
        AtomicBoolean result = new AtomicBoolean(false);
        runOnUiThread(() -> {
            try { result.set(begin ? beginNativeMediaAudio() : releaseNativeMediaAudioResult()); }
            finally { latch.countDown(); }
        });
        try { return latch.await(2, TimeUnit.SECONDS) && result.get(); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); return false; }
    }

    private boolean releaseNativeMediaAudioResult() { endNativeMediaAudio(); return true; }

    private boolean isLocalAppPage() {
        // Read only this volatile flag from the JS bridge thread; WebView methods
        // themselves must remain on Android's UI thread.
        return localAppPageLoaded;
    }

    private String stableDeviceCodeValue() {
        try {
            String androidId = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
            if (androidId == null || androidId.trim().isEmpty()) return "";
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(("pgmzchat-device-v1:" + getPackageName() + ":" + androidId).getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder("and-");
            for (byte value : digest) out.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
            return out.toString();
        } catch (Exception e) { Log.w(TAG, "Unable to derive stable device code", e); return ""; }
    }

    private final class NativeMediaBridge {
        @JavascriptInterface public boolean isDebugBuild() {
            if (!isLocalAppPage()) { Log.w(TAG, "Ignored debug-build check outside local app origin"); return false; }
            return BuildConfig.DEBUG;
        }
        @JavascriptInterface public String getDeviceCode() {
            if (!isLocalAppPage()) { Log.w(TAG, "Ignored device-code request outside local app origin"); return ""; }
            return stableDeviceCodeValue();
        }
        @JavascriptInterface public boolean beginMediaCapture() {
            if (!isLocalAppPage()) { Log.w(TAG, "Ignored media bridge call outside local app origin"); return false; }
            return runAudioActionOnUiThread(true);
        }
        @JavascriptInterface public void endMediaCapture() { runAudioActionOnUiThread(false); }

        @JavascriptInterface public void requestNotifications() {
            if (!isLocalAppPage()) { Log.w(TAG, "Ignored notification permission request outside local app origin"); return; }
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
                } else {
                    notifyJsNotificationPermission(true);
                }
            });
        }

        @JavascriptInterface public void showNotification(String title, String body, String tag) {
            if (!isLocalAppPage()) { Log.w(TAG, "Ignored notification request outside local app origin"); return; }
            runOnUiThread(() -> postNativeNotification(title, body, tag));
        }
    }

    private void notifyJsNotificationPermission(boolean granted) {
        if (webView == null) return;
        final String script = "window.PgmzNativeNotificationPermission && window.PgmzNativeNotificationPermission(" + (granted ? "true" : "false") + ");";
        webView.evaluateJavascript(script, null);
    }

    private void postNativeNotification(String title, String body, String tag) {
        try {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(NOTIFICATION_CHANNEL_ID, "Сообщения PgmzChat", NotificationManager.IMPORTANCE_DEFAULT);
                channel.setDescription("Уведомления о новых сообщениях PgmzChat");
                manager.createNotificationChannel(channel);
            }
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            PendingIntent pending = null;
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
                pending = PendingIntent.getActivity(this, 0, launch, flags);
            }
            Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(this, NOTIFICATION_CHANNEL_ID) : new Notification.Builder(this);
            builder.setSmallIcon(com.pgmzchat.app.R.mipmap.ic_launcher)
                    .setContentTitle((title == null || title.trim().isEmpty()) ? "PgmzChat" : title.trim().substring(0, Math.min(80, title.trim().length())))
                    .setContentText((body == null || body.trim().isEmpty()) ? "Новое сообщение" : body.trim().substring(0, Math.min(180, body.trim().length())))
                    .setAutoCancel(true).setCategory(Notification.CATEGORY_MESSAGE).setShowWhen(true);
            if (pending != null) builder.setContentIntent(pending);
            manager.notify(tag == null ? (int) System.currentTimeMillis() : (tag.hashCode() & 0x7fffffff), builder.build());
        } catch (Exception e) { Log.e(TAG, "Failed to post message notification", e); }
    }


    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView, new ViewGroup.LayoutParams(-1, -1));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true); // IndexedDB history needs DOM storage
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        // Temporary LAN HTTP API support. Use HTTPS outside a trusted test network.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        webView.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        webView.addJavascriptInterface(new NativeMediaBridge(), "PgmzNative");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    try {
                        String origin = request.getOrigin() == null ? "" : request.getOrigin().toString();
                        Log.i(TAG, "WebView media permission request: origin=" + origin + ", resources=" + java.util.Arrays.toString(request.getResources()));
                        if (!(origin.equals("https://pgmz.local") || origin.equals(ORIGIN))) {
                            Log.w(TAG, "Denied media permission for unexpected origin: " + origin);
                            request.deny();
                            return;
                        }
                        boolean needAudio = false, needVideo = false;
                        for (String resource : request.getResources()) {
                            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) needAudio = true;
                            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) needVideo = true;
                        }
                        boolean audioGranted = !needAudio || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
                        boolean videoGranted = !needVideo || checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
                        if (audioGranted && videoGranted) {
                            Log.i(TAG, "Granting WebView media capture permission");
                            request.grant(request.getResources());
                            return;
                        }
                        pendingMediaPermissionRequest = request;
                        java.util.ArrayList<String> permissions = new java.util.ArrayList<>();
                        if (needAudio && !audioGranted) permissions.add(Manifest.permission.RECORD_AUDIO);
                        if (needVideo && !videoGranted) permissions.add(Manifest.permission.CAMERA);
                        if (permissions.isEmpty()) { request.deny(); pendingMediaPermissionRequest = null; return; }
                        requestPermissions(permissions.toArray(new String[0]), MEDIA_PERMISSION_REQUEST);
                    } catch (Exception ex) {
                        Log.e(TAG, "Unable to process WebView media permission request", ex);
                        try { request.deny(); } catch (Exception ignored) {}
                    }
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingMediaPermissionRequest == request) pendingMediaPermissionRequest = null;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (uploadCallback != null) uploadCallback.onReceiveValue(null);
                uploadCallback = callback;
                Intent intent = params.createIntent();
                try { startActivityForResult(intent, FILE_PICKER); }
                catch (Exception e) { uploadCallback = null; callback.onReceiveValue(null); return false; }
                return true;
            }
        });
        webView.setWebViewClient(new AssetsClient());
        webView.loadUrl(ORIGIN + "index.html");
    }

    private class AssetsClient extends WebViewClient {
        private final Map<String,String> mime = new HashMap<>();
        @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            localAppPageLoaded = url != null && (url.equals("https://pgmz.local") || url.startsWith(ORIGIN));
            super.onPageStarted(view, url, favicon);
        }
        @Override public void onPageFinished(WebView view, String url) {
            localAppPageLoaded = url != null && (url.equals("https://pgmz.local") || url.startsWith(ORIGIN));
            super.onPageFinished(view, url);
        }
        AssetsClient() {
            mime.put("html", "text/html"); mime.put("js", "text/javascript");
            mime.put("css", "text/css"); mime.put("webmanifest", "application/manifest+json");
            mime.put("json", "application/json"); mime.put("png", "image/png");
            mime.put("jpg", "image/jpeg"); mime.put("jpeg", "image/jpeg"); mime.put("svg", "image/svg+xml");
            mime.put("webp", "image/webp"); mime.put("gif", "image/gif"); mime.put("ico", "image/x-icon");
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !request.getUrl().toString().startsWith(ORIGIN);
        }
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (!url.startsWith(ORIGIN)) return super.shouldInterceptRequest(view, request);
            String path = url.substring(ORIGIN.length());
            if (path.isEmpty()) path = "index.html";
            if (path.contains("..") || path.startsWith("/")) return notFound();
            try {
                InputStream in = getAssets().open("client/" + path);
                String ext = "";
                int dot = path.lastIndexOf('.');
                if (dot >= 0) ext = path.substring(dot + 1).toLowerCase();
                String type = mime.getOrDefault(ext, "application/octet-stream");
                String encoding = (type.startsWith("text/") || type.contains("javascript") || type.contains("json")) ? "UTF-8" : null;
                Map<String,String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-store");
                headers.put("X-Content-Type-Options", "nosniff");
                return new WebResourceResponse(type, encoding, 200, "OK", headers, in);
            } catch (IOException e) { return notFound(); }
        }
        private WebResourceResponse notFound() {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null,
                    new ByteArrayInputStream("Not Found".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST) {
            boolean granted = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
            notifyJsNotificationPermission(granted);
            return;
        }
        if (requestCode == MEDIA_PERMISSION_REQUEST && pendingMediaPermissionRequest != null) {
            PermissionRequest pending = pendingMediaPermissionRequest;
            pendingMediaPermissionRequest = null;
            boolean granted = grantResults.length > 0;
            for (int result : grantResults) if (result != PackageManager.PERMISSION_GRANTED) granted = false;
            try {
                if (granted) {
                    boolean audioGranted = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
                    boolean videoGranted = checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
                    boolean resourcesGranted = true;
                    for (String resource : pending.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) && !audioGranted) resourcesGranted = false;
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource) && !videoGranted) resourcesGranted = false;
                    }
                    if (resourcesGranted) pending.grant(pending.getResources()); else pending.deny();
                } else pending.deny();
            } catch (Exception ex) { Log.e(TAG, "Unable to complete WebView media permission request", ex); }
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_PICKER && uploadCallback != null) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            uploadCallback.onReceiveValue(result);
            uploadCallback = null;
        }
    }

    @Override protected void onDestroy() {
        endNativeMediaAudio();
        if (pendingMediaPermissionRequest != null) {
            try { pendingMediaPermissionRequest.deny(); } catch (Exception ignored) {}
            pendingMediaPermissionRequest = null;
        }
        if (webView != null) {
            try { webView.removeJavascriptInterface("PgmzNative"); webView.destroy(); } catch (Exception ignored) {}
            webView = null;
        }
        super.onDestroy();
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }
}
