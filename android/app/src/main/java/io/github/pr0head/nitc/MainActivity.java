package io.github.pr0head.nitc;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.telephony.TelephonyManager;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

// The map in a full-screen WebView. Pages of the map (on either mirror) stay
// inside; any other link (Yandex Maps, GitHub, ...) opens in the system browser.
// The page's "my location" request is granted only after the Android location
// permission.
// The map is published on two mirrors; some networks reach only one of them,
// so the app starts on the likelier one and moves on if the map doesn't boot.
public class MainActivity extends Activity {
    // the first serves Russian networks, the second everyone else
    private static final List<String> MIRRORS = Arrays.asList("pr0head.gitverse.site", "pr0head.github.io");
    private static final String PATH = "/nitc/";
    private static final int REQ_LOCATION = 1;
    // the map's boot screen (#boot) is gone once its code runs
    private static final String BOOTED_JS =
        "!!document.getElementById('app') && !document.getElementById('boot')";
    private static final long BOOT_WAIT_MS = 15000, BOOT_POLL_MS = 1000;

    private WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;
    private String country;
    private List<String> tries;   // mirrors in the order to try them
    private int attempt = -1;     // index into tries; -1 once the map booted
    private long deadline;
    private String geoOrigin;
    private GeolocationPermissions.Callback geoCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(0xFF0B0D0D);
        FrameLayout root = new FrameLayout(this);
        root.addView(web);
        setContentView(root);
        keepClearOfSystemBars(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // session token, prefs, favorites, plans
        s.setGeolocationEnabled(true);
        s.setUserAgentString(s.getUserAgentString() + " NITC-Android/" + versionName());

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                // the mirror is unreachable (DNS, refused, reset): don't wait it out.
                // A mirror left behind may report its aborted load: not ours to act on.
                if (req.isForMainFrame() && attempt >= 0
                    && tries.get(attempt).equals(req.getUrl().getHost())) nextMirror();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (isOurs(u)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (ActivityNotFoundException ignored) {
                    // nothing can open it — stay on the map
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                // origin is scheme + host (WebView adds a trailing slash) — no path to check
                Uri o = Uri.parse(origin);
                if (!"https".equals(o.getScheme()) || !MIRRORS.contains(o.getHost())) {
                    cb.invoke(origin, false, false);
                    return;
                }
                if (hasLocation()) { cb.invoke(origin, true, false); return; }
                geoOrigin = origin;
                geoCallback = cb;
                requestPermissions(new String[] {
                    Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION,
                }, REQ_LOCATION);
            }
        });

        // Back: browser history first, then leave the app.
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }

        prefs = getSharedPreferences("mirrors", MODE_PRIVATE);
        if (state != null) web.restoreState(state);
        else startOnMirror();
    }

    // Mirror order: the one that last worked on this country's networks, else
    // the Russian mirror on Russian networks and GitHub elsewhere; then the rest.
    private void startOnMirror() {
        country = networkCountry();
        String first = prefs.getString("good_" + country, "ru".equals(country) ? MIRRORS.get(0) : MIRRORS.get(1));
        tries = new ArrayList<>(MIRRORS);
        if (tries.remove(first)) tries.add(0, first);
        openMirror(0);
    }

    private void openMirror(int i) {
        attempt = i;
        deadline = System.currentTimeMillis() + BOOT_WAIT_MS;
        ui.removeCallbacks(bootCheck);
        web.loadUrl("https://" + tries.get(i) + PATH);
        ui.postDelayed(bootCheck, BOOT_POLL_MS);
    }

    // every mirror tried: stay on the last one, its page says what went wrong
    private void nextMirror() {
        ui.removeCallbacks(bootCheck);
        if (attempt + 1 < tries.size()) openMirror(attempt + 1);
        else attempt = -1;
    }

    private final Runnable bootCheck = new Runnable() {
        @Override
        public void run() {
            if (attempt < 0) return;
            final int checking = attempt;
            web.evaluateJavascript(BOOTED_JS, v -> {
                if (checking != attempt) return; // a switch happened meanwhile
                if ("true".equals(v)) booted();
                else if (System.currentTimeMillis() >= deadline) nextMirror();
                else ui.postDelayed(bootCheck, BOOT_POLL_MS);
            });
        }
    };

    private void booted() {
        prefs.edit().putString("good_" + country, tries.get(attempt)).apply();
        if (attempt > 0) web.clearHistory(); // "back" must not return to the dead mirror
        attempt = -1;
    }

    // ISO country of the mobile network (roaming shows where we are), else of
    // the SIM, else of the device locale; lower case, may be empty
    private String networkCountry() {
        TelephonyManager tm = (TelephonyManager) getSystemService(TELEPHONY_SERVICE);
        String c = tm == null ? null : tm.getNetworkCountryIso();
        if ((c == null || c.isEmpty()) && tm != null) c = tm.getSimCountryIso();
        if (c == null || c.isEmpty()) c = Locale.getDefault().getCountry();
        return c == null ? "" : c.toLowerCase(Locale.ROOT);
    }

    private static boolean isOurs(Uri u) {
        String path = u.getPath() == null ? "" : u.getPath();
        return "https".equals(u.getScheme()) && MIRRORS.contains(u.getHost())
            && (path.startsWith(PATH) || path.equals(PATH.substring(0, PATH.length() - 1)));
    }

    private boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code != REQ_LOCATION || geoCallback == null) return;
        geoCallback.invoke(geoOrigin, hasLocation(), false);
        geoCallback = null;
        geoOrigin = null;
    }

    // Since Android 15 the app draws under the status and navigation bars:
    // pad the WebView's container so the map's top-left and bottom controls
    // stay visible (padding on the WebView itself is ignored by its content).
    private static void keepClearOfSystemBars(View v) {
        if (Build.VERSION.SDK_INT < 30) return;
        v.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                | WindowInsets.Type.ime());
            view.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsets.CONSUMED;
        });
    }

    private void back() {
        if (web.canGoBack()) web.goBack();
        else finish();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() { // Android < 13
        back();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause(); // the page sees itself hidden: polling and location pause
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacks(bootCheck);
        web.destroy();
        super.onDestroy();
    }

    // read from the package: AGP no longer generates BuildConfig by default
    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "?";
        }
    }
}
