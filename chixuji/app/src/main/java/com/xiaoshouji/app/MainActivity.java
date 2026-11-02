package com.xiaoshouji.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.graphics.Color;
import android.view.View;
import android.view.WindowManager;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import androidx.core.app.NotificationCompat;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * 迟叙机的安卓外壳：用系统 WebView 打开打包在 App 里的网页。
 * 网页通过 https://appassets.androidplatform.net/ 这个“虚拟网址”加载，
 * 这样浏览器的安全功能（本机数据库、定位、加密验签）都能正常用。
 * 另外补上 WebView 默认没有的几样：选图片、定位授权、系统通知、保存备份文件、返回键。
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/index.html";
    private static final int REQ_FILE = 11;
    private static final int REQ_LOCATION = 12;
    private static final int REQ_NOTIFY = 13;
    private static final String CHANNEL = "xsj-messages";

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    private int notifyId = 100;
    // 系统栏（状态栏、底部导航/横条、打孔屏）占的高度，单位是网页里的 px
    private float safeTop, safeRight, safeBottom, safeLeft;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        // 迟叙机的背景一直铺到屏幕最边上（状态栏、底部横条下面也是），内容再按系统栏高度自己留空
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#24263a"));
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        edgeToEdge(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pushInsets();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost())) return false;
                // 外部链接交给系统浏览器
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                String[] types = params.getAcceptTypes();
                String type = (types != null && types.length > 0 && types[0] != null && !types[0].isEmpty()) ? types[0] : "*/*";
                if (type.startsWith(".")) type = "*/*"; // 例如 .json：系统选择器不认扩展名
                pick.setType(type);
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(pick, "选择文件"), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                } else {
                    geoOrigin = origin;
                    geoCallback = callback;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                }
            }
        });

        web.addJavascriptInterface(new Bridge(), "XSJNative");
        createChannel();
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START);
    }

    /** 网页里可以调用的原生功能（window.XSJNative.xxx） */
    private class Bridge {
        @JavascriptInterface
        public String notifyPermission() {
            if (Build.VERSION.SDK_INT < 33) return NotificationManagerCompat.from(MainActivity.this).areNotificationsEnabled() ? "granted" : "denied";
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return "granted";
            return shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS) ? "default" : "default";
        }

        @JavascriptInterface
        public void requestNotifyPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
                else sendPermissionResult();
            });
        }

        @JavascriptInterface
        public boolean notify(String title, String body) {
            try {
                Intent open = new Intent(MainActivity.this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent pi = PendingIntent.getActivity(MainActivity.this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                NotificationCompat.Builder b = new NotificationCompat.Builder(MainActivity.this, CHANNEL)
                        .setSmallIcon(R.drawable.ic_stat)
                        .setContentTitle(title)
                        .setContentText(body)
                        .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                        .setAutoCancel(true)
                        .setContentIntent(pi)
                        .setPriority(NotificationCompat.PRIORITY_DEFAULT);
                NotificationManagerCompat.from(MainActivity.this).notify(notifyId++, b.build());
                return true;
            } catch (SecurityException e) {
                return false;
            }
        }

        /** 把备份文件存到“下载”文件夹，返回给用户看的位置 */
        @JavascriptInterface
        public String saveText(String name, String text) {
            String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
            byte[] data = text.getBytes(StandardCharsets.UTF_8);
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    v.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/迟叙机");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) return "";
                    try (OutputStream out = getContentResolver().openOutputStream(uri)) { out.write(data); }
                    return "下载/迟叙机/" + safe;
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    File f = new File(dir, safe);
                    try (FileOutputStream out = new FileOutputStream(f)) { out.write(data); }
                    return f.getAbsolutePath();
                }
            } catch (Exception e) {
                return "";
            }
        }

        /** 把图片（PNG 的 dataUrl）存进相册的“迟叙机”文件夹 */
        @JavascriptInterface
        public String saveImage(String name, String dataUrl) {
            String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
            try {
                byte[] data = Base64.decode(dataUrl.substring(dataUrl.indexOf(',') + 1), Base64.DEFAULT);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Images.Media.DISPLAY_NAME, safe);
                    v.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                    v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/迟叙机");
                    Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) return "";
                    try (OutputStream out = getContentResolver().openOutputStream(uri)) { out.write(data); }
                    return "相册/迟叙机/" + safe;
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
                    File f = new File(dir, safe);
                    try (FileOutputStream out = new FileOutputStream(f)) { out.write(data); }
                    return f.getAbsolutePath();
                }
            } catch (Exception e) {
                return "";
            }
        }

        /** 用玩家自己选的图片和名字，在手机桌面上建一个打开迟叙机的快捷方式 */
        @JavascriptInterface
        public boolean canPinShortcut() {
            return ShortcutManagerCompat.isRequestPinShortcutSupported(MainActivity.this);
        }

        @JavascriptInterface
        public boolean pinShortcut(String name, String dataUrl) {
            try {
                if (!ShortcutManagerCompat.isRequestPinShortcutSupported(MainActivity.this)) return false;
                String b64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (bmp == null) return false;
                Intent open = new Intent(MainActivity.this, MainActivity.class).setAction(Intent.ACTION_VIEW)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                String label = (name == null || name.trim().isEmpty()) ? "迟叙机" : name.trim();
                ShortcutInfoCompat info = new ShortcutInfoCompat.Builder(MainActivity.this, "xsj-" + System.currentTimeMillis())
                        .setShortLabel(label)
                        .setIcon(IconCompat.createWithBitmap(bmp))
                        .setIntent(open)
                        .build();
                return ShortcutManagerCompat.requestPinShortcut(MainActivity.this, info, null);
            } catch (Exception e) {
                return false;
            }
        }

        /** 网页启动时取一次系统栏高度：上、右、下、左 */
        @JavascriptInterface
        public String insets() {
            return "[" + safeTop + "," + safeRight + "," + safeBottom + "," + safeLeft + "]";
        }

        /** 顶部 / 底部背景是浅色时，系统栏的图标用深色；深色背景用白色图标 */
        @JavascriptInterface
        public void setBarStyle(boolean lightTop, boolean lightBottom) {
            runOnUiThread(() -> {
                WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
                c.setAppearanceLightStatusBars(lightTop);
                c.setAppearanceLightNavigationBars(lightBottom);
            });
        }

        @JavascriptInterface
        public void toast(String text) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, text, Toast.LENGTH_SHORT).show());
        }
    }

    private void edgeToEdge(View root) {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            // 键盘弹出时把网页往上让出键盘的位置（铺满屏幕后系统不会再自动帮忙）
            boolean keyboard = ime.bottom > bars.bottom;
            v.setPadding(0, 0, 0, keyboard ? ime.bottom : 0);
            float d = getResources().getDisplayMetrics().density;
            safeTop = bars.top / d;
            safeRight = bars.right / d;
            safeBottom = keyboard ? 0 : bars.bottom / d;
            safeLeft = bars.left / d;
            pushInsets();
            return WindowInsetsCompat.CONSUMED;
        });
    }

    /** 把系统栏高度告诉网页（写进 CSS 变量 --safe-t 等） */
    private void pushInsets() {
        if (web == null) return;
        String js = "(function(s){s.setProperty('--safe-t','" + safeTop + "px');s.setProperty('--safe-r','" + safeRight
                + "px');s.setProperty('--safe-b','" + safeBottom + "px');s.setProperty('--safe-l','" + safeLeft
                + "px');})(document.documentElement.style)";
        web.evaluateJavascript(js, null);
    }

    private void sendPermissionResult() {
        String p = new Bridge().notifyPermission();
        web.evaluateJavascript("window.__xsjNotifyPermission && window.__xsjNotifyPermission('" + p + "')", null);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "TA 的消息", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("私聊、朋友圈互动、日记等提醒");
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                result = new Uri[n];
                for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        boolean ok = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == REQ_LOCATION && geoCallback != null) {
            geoCallback.invoke(geoOrigin, ok, false);
            geoCallback = null;
        }
        if (requestCode == REQ_NOTIFY) sendPermissionResult();
    }

    @Override
    public void onBackPressed() {
        // 先让网页处理（关弹窗、回桌面）；网页说处理不了，才退到后台
        web.evaluateJavascript("(window.__xsjBack && window.__xsjBack()) ? 'yes' : 'no'", (v) -> {
            if (v == null || !v.contains("yes")) moveTaskToBack(true);
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        // 告诉网页：App 到后台了（这时新消息用系统通知提醒），并把数据存好
        web.evaluateJavascript("window.__xsjAppHidden = true; window.dispatchEvent(new Event('pagehide'))", null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.evaluateJavascript("window.__xsjAppHidden = false; window.dispatchEvent(new Event('xsj:resume'))", null);
    }
}
