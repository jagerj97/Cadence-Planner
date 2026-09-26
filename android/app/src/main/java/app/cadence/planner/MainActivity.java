package app.cadence.planner;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Handler;
import android.os.Looper;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.SafeBrowsingResponse;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.widget.FrameLayout;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import androidx.annotation.NonNull;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;

public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final int PICK_FILE = 20, SAVE_ICS = 21, PERMISSION_LOCATION = 22, PERMISSION_NOTIFY = 23, SAVE_BACKUP = 24;
    // On-demand notifications get their own ids so they never replace a scheduled reminder (1..128).
    private final AtomicInteger notificationIds = new AtomicInteger(600000);
    private WebView browser;
    private FrameLayout content;
    private View topInset;
    private View bottomInset;
    private ValueCallback<Uri[]> pendingFile;
    private String pendingExport;
    private GeolocationPermissions.Callback pendingLocation;
    private String pendingLocationOrigin;
    private boolean pendingBridgeLocation;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FocusTimer.activity = new java.lang.ref.WeakReference<>(this);
        readLaunchAction(getIntent());
        Window window = getWindow();
        // Android 15 enforces edge-to-edge. Inset the container, not the WebView's
        // document, so fixed headers and bottom navigation stay inside the safe area.
        WindowCompat.setDecorFitsSystemWindows(window, false);
        if (Build.VERSION.SDK_INT >= 29) window.setNavigationBarContrastEnforced(false);
        Notifications.createChannel(this);

        browser = new WebView(this);
        content = new FrameLayout(this);
        content.addView(browser, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        topInset = new View(this);
        bottomInset = new View(this);
        content.addView(topInset, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, android.view.Gravity.TOP));
        content.addView(bottomInset, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, android.view.Gravity.BOTTOM));
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            androidx.core.graphics.Insets safe = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            // Children are inset with the WebView; the inset views paint the exposed
            // bands separately so they match the app bar and bottom navigation.
            FrameLayout.LayoutParams top = (FrameLayout.LayoutParams) topInset.getLayoutParams();
            top.height = safe.top;
            top.topMargin = -safe.top;
            topInset.setLayoutParams(top);
            FrameLayout.LayoutParams bottom = (FrameLayout.LayoutParams) bottomInset.getLayoutParams();
            bottom.height = safe.bottom;
            bottom.bottomMargin = -safe.bottom;
            bottomInset.setLayoutParams(bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        setContentView(content, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        applyAppearance(getSharedPreferences("cadence_appearance", MODE_PRIVATE).getBoolean("dark", true));
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebView.setWebContentsDebuggingEnabled(false);
        browser.addJavascriptInterface(new Bridge(), "CadenceAndroid");
        browser.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"https".equals(uri.getScheme()) || !HOST.equals(uri.getHost())) return null;
                String path = uri.getPath();
                if (path == null || path.equals("/")) path = "/android.html";
                if (path.contains("..") || path.contains("\\") || !path.matches("/[a-zA-Z0-9_./-]+")) return missing();
                String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "text/javascript"
                    : path.endsWith(".css") ? "text/css" : path.endsWith(".svg") ? "image/svg+xml"
                    : path.endsWith(".png") ? "image/png" : path.endsWith(".woff2") ? "font/woff2" : "application/octet-stream";
                try {
                    return new WebResourceResponse(mime, "UTF-8", getAssets().open("web" + path));
                } catch (Exception ignored) {
                    return missing();
                }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && HOST.equals(uri.getHost())) return false;
                if ("https".equals(uri.getScheme()) || "mailto".equals(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                }
                return true;
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
            }
            @Override public void onSafeBrowsingHit(WebView view, WebResourceRequest request,
                                                     int threatType, SafeBrowsingResponse callback) {
                callback.backToSafety(true);
            }
        });
        browser.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFile != null) pendingFile.onReceiveValue(null);
                pendingFile = callback;
                try {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    startActivityForResult(intent, PICK_FILE);
                } catch (Exception e) {
                    pendingFile.onReceiveValue(null);
                    pendingFile = null;
                }
                return true;
            }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!("https://" + HOST).equals(origin)) { callback.invoke(origin, false, false); return; }
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                    checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                } else {
                    pendingLocation = callback;
                    pendingLocationOrigin = origin;
                    requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, PERMISSION_LOCATION);
                }
            }
        });
        browser.loadUrl("https://" + HOST + "/android.html");
    }

    private void applyAppearance(boolean dark) {
        // The status bar strip matches the app bar, which uses the page background (--background).
        int bar = dark ? Color.rgb(31, 27, 25) : Color.rgb(249, 247, 245);
        int bottom = dark ? Color.rgb(44, 40, 38) : Color.WHITE;
        content.setBackgroundColor(bottom);
        browser.setBackgroundColor(bottom);
        topInset.setBackgroundColor(bar);
        bottomInset.setBackgroundColor(bottom);
        Window window = getWindow();
        window.setStatusBarColor(bar);
        window.setNavigationBarColor(bottom);
        WindowCompat.getInsetsController(window, window.getDecorView()).setAppearanceLightStatusBars(!dark);
        WindowCompat.getInsetsController(window, window.getDecorView()).setAppearanceLightNavigationBars(!dark);
    }

    private WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
            java.util.Collections.emptyMap(), new java.io.ByteArrayInputStream(new byte[0]));
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE && pendingFile != null) {
            pendingFile.onReceiveValue(resultCode == RESULT_OK && data != null && data.getData() != null
                ? new Uri[] { data.getData() } : null);
            pendingFile = null;
        }
        if (requestCode == SAVE_ICS || requestCode == SAVE_BACKUP) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingExport != null) {
                try (OutputStream output = getContentResolver().openOutputStream(data.getData())) {
                    if (output != null) output.write(pendingExport.getBytes(StandardCharsets.UTF_8));
                } catch (Exception ignored) {}
            }
            pendingExport = null;
        }
    }

    /** A timer notification button changed the saved timer; have the web app reload it. */
    void focusChanged() {
        dispatchToPage("cadence-focus-changed");
    }

    /** The open activity, if any (for notification and widget buttons that need to tell the page). */
    static MainActivity current() {
        return FocusTimer.activity.get();
    }

    /** Fires a window event in the web app, e.g. so it picks up a widget tap. */
    void dispatchToPage(String event) {
        runOnUiThread(() -> browser.evaluateJavascript("window.dispatchEvent(new Event('" + event + "'))", null));
    }

    /** What a widget's + button asked for ("add-task" / "add-habit"); the page reads it via takeLaunchAction. */
    private volatile String launchAction = "";

    private void readLaunchAction(Intent intent) {
        String add = intent == null ? null : intent.getStringExtra(PanelWidgets.EXTRA_ADD);
        if ("add-task".equals(add) || "add-habit".equals(add)) launchAction = add;
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        readLaunchAction(intent);
        if (!launchAction.isEmpty()) dispatchToPage("cadence-launch-action");
    }

    @Override public void onRequestPermissionsResult(int code, @NonNull String[] permissions, @NonNull int[] grants) {
        super.onRequestPermissionsResult(code, permissions, grants);
        if (code == PERMISSION_LOCATION && pendingLocation != null) {
            pendingLocation.invoke(pendingLocationOrigin, anyGranted(grants), false);
            pendingLocation = null;
        }
        if (code == PERMISSION_LOCATION && pendingBridgeLocation) {
            pendingBridgeLocation = false;
            if (anyGranted(grants)) fetchLocation(); else sendLocationError("denied");
        }
        if (code == PERMISSION_NOTIFY) {
            FocusTimer.update(this);
            browser.evaluateJavascript("window.dispatchEvent(new Event('cadence-notification-permission'))", null);
        }
    }

    private static boolean anyGranted(int[] grants) {
        for (int g : grants) if (g == PackageManager.PERMISSION_GRANTED) return true;
        return false;
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void sendLocationDetail(String json) {
        browser.evaluateJavascript("window.dispatchEvent(new CustomEvent('cadence-location',{detail:" + json + "}))", null);
    }

    private void sendLocationError(String code) {
        sendLocationDetail("{\"error\":\"" + code + "\"}");
    }

    private void sendLocation(Location loc) {
        sendLocationDetail(String.format(Locale.US, "{\"lat\":%.6f,\"lng\":%.6f}", loc.getLatitude(), loc.getLongitude()));
    }

    /** Native one-shot location lookup; the WebView's built-in geolocation is unreliable on many devices. */
    private void fetchLocation() {
        LocationManager lm = getSystemService(LocationManager.class);
        if (lm == null) { sendLocationError("unavailable"); return; }
        boolean network = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        boolean gps = lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
        if (!network && !gps) { sendLocationError("disabled"); return; }
        try {
            // A recent fix is plenty for sunrise/sunset.
            Location best = null;
            for (String provider : lm.getProviders(true)) {
                Location last = lm.getLastKnownLocation(provider);
                if (last != null && (best == null || last.getTime() > best.getTime())) best = last;
            }
            if (best != null && System.currentTimeMillis() - best.getTime() < 30 * 60 * 1000L) { sendLocation(best); return; }
            final Location fallback = best;
            final boolean[] finished = { false };
            final String provider = network ? LocationManager.NETWORK_PROVIDER : LocationManager.GPS_PROVIDER;
            final LocationListener listener = new LocationListener() {
                @Override public void onLocationChanged(@NonNull Location loc) {
                    if (finished[0]) return;
                    finished[0] = true;
                    lm.removeUpdates(this);
                    sendLocation(loc);
                }
                @Override public void onProviderDisabled(@NonNull String p) {}
                @Override public void onProviderEnabled(@NonNull String p) {}
                @Override public void onStatusChanged(String p, int status, Bundle extras) {}
            };
            lm.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper());
            mainHandler.postDelayed(() -> {
                if (finished[0]) return;
                finished[0] = true;
                lm.removeUpdates(listener);
                if (fallback != null) sendLocation(fallback); else sendLocationError("timeout");
            }, 20000);
        } catch (SecurityException e) {
            sendLocationError("denied");
        } catch (Exception e) {
            sendLocationError("unavailable");
        }
    }

    @Override public void onBackPressed() {
        if (browser.canGoBack()) browser.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (FocusTimer.activity.get() == this) FocusTimer.activity = new java.lang.ref.WeakReference<>(null);
        browser.removeJavascriptInterface("CadenceAndroid");
        browser.destroy();
        super.onDestroy();
    }

    private boolean publicHost(String host) throws Exception {
        if (host == null || !host.contains(".") || host.length() > 253 || host.endsWith(".local") ||
            host.endsWith(".internal") || host.equals("localhost") || host.matches("[0-9.]+") || host.contains(":")) return false;
        for (InetAddress ip : InetAddress.getAllByName(host)) {
            byte[] bytes = ip.getAddress();
            int first = bytes[0] & 255, second = bytes.length > 1 ? bytes[1] & 255 : 0;
            if (ip.isAnyLocalAddress() || ip.isLoopbackAddress() || ip.isLinkLocalAddress() ||
                ip.isSiteLocalAddress() || ip.isMulticastAddress() ||
                bytes.length != 4 || first == 0 || first == 10 || first == 127 ||
                first == 169 && second == 254 || first == 172 && second >= 16 && second <= 31 ||
                first == 192 && second == 168 || first >= 224 || first == 100 && second >= 64 && second <= 127) return false;
        }
        return true;
    }

    private String calendarText(String raw) throws Exception {
        if (raw == null || raw.length() > 4096) throw new Exception("Invalid calendar URL");
        String current = raw.trim().replaceFirst("(?i)^webcal://", "https://");
        for (int redirect = 0; redirect < 4; redirect++) {
            URI uri = new URI(current);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getUserInfo() != null || uri.getPort() != -1 ||
                uri.getFragment() != null || !publicHost(uri.getHost())) {
                throw new Exception("Use a public HTTPS calendar URL");
            }
            HttpURLConnection connection = (HttpURLConnection) new URL(current).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(10000);
            connection.setRequestProperty("Accept", "text/calendar, text/plain;q=0.8");
            try {
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) {
                    String destination = connection.getHeaderField("Location");
                    if (destination == null) throw new Exception("Calendar redirect has no destination");
                    current = uri.resolve(destination).toString();
                    continue;
                }
                if (status != 200) throw new Exception("Calendar returned HTTP " + status);
                if (connection.getContentLengthLong() > 2 * 1024 * 1024) throw new Exception("Calendar exceeds 2 MB");
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] chunk = new byte[8192];
                    int length;
                    while ((length = input.read(chunk)) != -1) {
                        if (output.size() + length > 2 * 1024 * 1024) throw new Exception("Calendar exceeds 2 MB");
                        output.write(chunk, 0, length);
                    }
                    return output.toString(StandardCharsets.UTF_8.name());
                }
            } finally {
                connection.disconnect();
            }
        }
        throw new Exception("Too many calendar redirects");
    }

    public class Bridge {
        /**
         * Plays haptics through the vibrator rather than View.performHapticFeedback, which Android skips
         * whenever the system "touch feedback" setting is off. Cadence's own Haptic feedback setting
         * decides (the web app only calls this when it's on).
         */
        @JavascriptInterface public void haptic(String kind) {
            Vibrator vibrator = getSystemService(Vibrator.class);
            if (vibrator == null || !vibrator.hasVibrator()) return;
            VibrationEffect effect;
            if (Build.VERSION.SDK_INT >= 29) {
                int id = "hold".equals(kind) ? VibrationEffect.EFFECT_HEAVY_CLICK
                    : "complete".equals(kind) || "warn".equals(kind) ? VibrationEffect.EFFECT_DOUBLE_CLICK
                    : VibrationEffect.EFFECT_TICK;
                effect = VibrationEffect.createPredefined(id);
            } else {
                long[] timings = "hold".equals(kind) ? new long[] { 0, 25 }
                    : "complete".equals(kind) ? new long[] { 0, 12, 60, 18 }
                    : "warn".equals(kind) ? new long[] { 0, 30, 50, 30 }
                    : new long[] { 0, 8 };
                effect = VibrationEffect.createWaveform(timings, -1);
            }
            vibrator.vibrate(effect);
        }

        @JavascriptInterface public void requestLocation() {
            runOnUiThread(() -> {
                if (hasLocationPermission()) { fetchLocation(); return; }
                pendingBridgeLocation = true;
                requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, PERMISSION_LOCATION);
            });
        }

        @JavascriptInterface public void setAppearance(String mode) {
            if (!"light".equals(mode) && !"dark".equals(mode)) return;
            boolean dark = "dark".equals(mode);
            getSharedPreferences("cadence_appearance", MODE_PRIVATE).edit().putBoolean("dark", dark).apply();
            runOnUiThread(() -> applyAppearance(dark));
        }

        @JavascriptInterface public String fetchCalendar(String url) {
            try {
                return new JSONObject().put("text", calendarText(url)).toString();
            } catch (Exception e) {
                try { return new JSONObject().put("error", e.getMessage()).toString(); }
                catch (Exception ignored) { return "{\"error\":\"Calendar unavailable\"}"; }
            }
        }

        @JavascriptInterface public void saveIcs(String text) {
            if (text == null || text.length() > 4 * 1024 * 1024) return;
            runOnUiThread(() -> {
                pendingExport = text;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("text/calendar");
                intent.putExtra(Intent.EXTRA_TITLE, "cadence.ics");
                try { startActivityForResult(intent, SAVE_ICS); } catch (Exception ignored) { pendingExport = null; }
            });
        }

        @JavascriptInterface public void saveBackup(String text) {
            if (text == null || text.getBytes(StandardCharsets.UTF_8).length > 25 * 1024 * 1024) return;
            runOnUiThread(() -> {
                pendingExport = text;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, "cadence-backup-" + java.time.LocalDate.now() + ".json");
                try { startActivityForResult(intent, SAVE_BACKUP); } catch (Exception ignored) { pendingExport = null; }
            });
        }

        @JavascriptInterface public void requestNotifications() {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                runOnUiThread(() -> requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, PERMISSION_NOTIFY));
            }
        }

        @JavascriptInterface public boolean notificationsAllowed() {
            return Build.VERSION.SDK_INT < 33 ||
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface public void notify(String title, String body) {
            Notifications.show(MainActivity.this,
                title == null ? "Cadence" : title.substring(0, Math.min(100, title.length())),
                body == null ? "" : body.substring(0, Math.min(200, body.length())),
                notificationIds.getAndIncrement());
        }

        @JavascriptInterface public void scheduleReminders(String json) {
            if (json != null && json.length() < 100000) Notifications.scheduleItems(MainActivity.this, json);
        }

        @JavascriptInterface public void scheduleFocus(long at, String title, String body) {
            Notifications.scheduleFocus(MainActivity.this, at, title, body);
        }

        @JavascriptInterface public void cancelFocus() {
            Notifications.cancelFocus(MainActivity.this);
        }

        @JavascriptInterface public void finishFocus(String title, String body) {
            Notifications.finishFocus(MainActivity.this, title, body);
        }

        @JavascriptInterface public String getFocus() {
            return getSharedPreferences("cadence_focus", MODE_PRIVATE).getString("state", "null");
        }

        @JavascriptInterface public void saveFocus(String json) {
            if (json == null || json.length() >= 10000) return;
            getSharedPreferences("cadence_focus", MODE_PRIVATE).edit().putString("state", json).apply();
            FocusTimer.update(MainActivity.this);
        }

        @JavascriptInterface public void updateWidget(String json) {
            if (json != null && json.length() < 1000000) PanelWidgets.saveSnapshot(MainActivity.this, json);
        }

        @JavascriptInterface public String takeWidgetActions() {
            return PanelWidgets.takeActions(MainActivity.this);
        }

        @JavascriptInterface public String takeLaunchAction() {
            String action = launchAction;
            launchAction = "";
            return action;
        }

        @JavascriptInterface public String takeFocusStop() {
            return FocusTimer.takeStopped(MainActivity.this);
        }
    }
}
