package io.github.pr0head.nitc;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;

// The map in a full-screen WebView. Pages of the map stay inside; any other
// link (Yandex Maps, GitHub, ...) opens in the system browser. The page's
// "my location" request is granted only after the Android location permission.
public class MainActivity extends Activity {
    private static final String HOST = "pr0head.github.io";
    private static final String PATH = "/nitc/";
    private static final String START = "https://" + HOST + PATH;
    private static final int REQ_LOCATION = 1;

    private WebView web;
    private String geoOrigin;
    private GeolocationPermissions.Callback geoCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(0xFF0B0D0D);
        setContentView(web);
        keepClearOfSystemBars(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // session token, prefs, favorites, plans
        s.setGeolocationEnabled(true);
        s.setUserAgentString(s.getUserAgentString() + " NITC-Android/" + versionName());

        web.setWebViewClient(new WebViewClient() {
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
                if (!"https".equals(o.getScheme()) || !HOST.equals(o.getHost())) {
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

        if (state != null) web.restoreState(state);
        else web.loadUrl(START);
    }

    private static boolean isOurs(Uri u) {
        String path = u.getPath() == null ? "" : u.getPath();
        return "https".equals(u.getScheme()) && HOST.equals(u.getHost())
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
    // pad the WebView so the map's top-left and bottom controls stay visible.
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
