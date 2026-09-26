package com.okysu.mingque;

import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

import java.util.Locale;

/**
 * 命阙: the web game immersive full screen. The WebView covers the whole display, notch included
 * (capacitor.config.json turns Capacitor's inset padding off); the notch size is handed to the game as CSS
 * variables --mq-inset-* (plus a 'mq-insets' event) so only the HUD keeps clear of it, the art does not.
 * System bars stay hidden; a swipe from the edge shows them briefly.
 */
public class MainActivity extends BridgeActivity {
    private final Handler main = new Handler(Looper.getMainLooper());
    private Insets cutout = Insets.NONE;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        hideSystemBars();

        View decor = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decor, (v, insets) -> {
            // only the notch / camera hole: the system bars are hidden and must not push the HUD around
            cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            pushInsets();
            return ViewCompat.onApplyWindowInsets(v, insets);
        });
        // the page may not have loaded yet when the first insets arrive: repeat a few times during boot
        for (int ms : new int[] { 800, 2000, 4000, 8000 }) main.postDelayed(this::pushInsets, ms);
    }

    private void pushInsets() {
        if (bridge == null) return;
        WebView web = bridge.getWebView();
        if (web == null) return;
        float d = getResources().getDisplayMetrics().density;
        String js = String.format(Locale.US,
            "(function(){var s=document.documentElement.style;s.setProperty('--mq-inset-top','%.1fpx');s.setProperty('--mq-inset-right','%.1fpx');s.setProperty('--mq-inset-bottom','%.1fpx');s.setProperty('--mq-inset-left','%.1fpx');window.dispatchEvent(new Event('mq-insets'));})();",
            cutout.top / d, cutout.right / d, cutout.bottom / d, cutout.left / d);
        web.post(() -> web.evaluateJavascript(js, null));
    }

    @Override
    public void onResume() {
        super.onResume();
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
