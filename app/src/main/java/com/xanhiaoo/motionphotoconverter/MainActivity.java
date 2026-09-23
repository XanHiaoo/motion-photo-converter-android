package com.xanhiaoo.motionphotoconverter;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.util.Collections;
import java.util.Map;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String APP_URL = "https://" + APP_HOST + "/assets/index.html";
    private static final int FILE_REQUEST = 1001;

    private final Map<String, SaveSession> saveSessions = new ConcurrentHashMap<>();
    private final Map<String, FadeSession> fadeSessions = new ConcurrentHashMap<>();
    private final ExecutorService fadeExecutor = Executors.newSingleThreadExecutor();
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(247, 250, 255));

        FrameLayout content = new FrameLayout(this);
        content.setBackgroundColor(Color.rgb(247, 250, 255));
        if (Build.VERSION.SDK_INT >= 35) {
            content.setOnApplyWindowInsetsListener((view, insets) -> {
                int handledTypes = WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout();
                Insets bars = insets.getInsets(handledTypes);
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return new WindowInsets.Builder(insets)
                        .setInsets(handledTypes, Insets.NONE)
                        .build();
            });
        }
        content.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(content);
        if (Build.VERSION.SDK_INT >= 35) {
            content.post(content::requestApplyInsets);
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.addJavascriptInterface(new SaveBridge(), "AndroidBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!APP_HOST.equals(uri.getHost())) {
                    if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) return null;
                    return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
                            Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                }
                WebResourceResponse response = assetLoader.shouldInterceptRequest(uri);
                if (response != null) return response;
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                        Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !"https".equals(uri.getScheme()) || !APP_HOST.equals(uri.getHost());
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intent, FILE_REQUEST);
                } catch (ActivityNotFoundException error) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                    showMessage("设备上没有可用的文件选择器");
                }
                return true;
            }
        });
        webView.loadUrl(APP_URL);
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_REQUEST && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        for (String token : saveSessions.keySet()) cancelSave(token);
        for (String token : fadeSessions.keySet()) finishFadeTail(token);
        fadeExecutor.shutdown();
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidBridge");
            webView.destroy();
        }
        super.onDestroy();
    }

    private void showMessage(String message) {
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show());
    }

    private void cancelSave(String token) {
        SaveSession session = saveSessions.remove(token);
        if (session == null) return;
        try { session.output.close(); } catch (IOException ignored) { }
        getContentResolver().delete(session.uri, null, null);
    }

    private static final class SaveSession {
        final Uri uri;
        final OutputStream output;

        SaveSession(Uri uri, OutputStream output) {
            this.uri = uri;
            this.output = output;
        }
    }

    private static final class FadeSession {
        final int width, height, durationMs;
        final String mime, encoderName;
        final ByteArrayOutputStream last = new ByteArrayOutputStream();
        final ByteArrayOutputStream cover = new ByteArrayOutputStream();
        volatile String status = "ready";
        volatile boolean cancelled;
        volatile File output;

        FadeSession(int width, int height, int durationMs, String mime, String encoderName) {
            this.width = width;
            this.height = height;
            this.durationMs = durationMs;
            this.mime = mime;
            this.encoderName = encoderName;
        }
    }

    private void finishFadeTail(String token) {
        FadeSession session = fadeSessions.remove(token);
        if (session == null) return;
        session.cancelled = true;
        File output = session.output;
        if (output != null) output.delete();
    }

    private final class SaveBridge {
        @JavascriptInterface
        public String beginSave(String name) {
            String safeName = name.replaceAll("[\\\\/:*?\"<>|]", "_");
            String lowerName = safeName.toLowerCase(Locale.ROOT);
            String mime;
            if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) mime = "image/jpeg";
            else if (lowerName.endsWith(".heic")) mime = "image/heic";
            else if (lowerName.endsWith(".heif")) mime = "image/heif";
            else return "";
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, safeName);
            values.put(MediaStore.Images.Media.MIME_TYPE, mime);
            values.put(MediaStore.Images.Media.RELATIVE_PATH,
                    Environment.DIRECTORY_PICTURES + "/Motion Photo Converter");
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
            Uri uri = null;
            try {
                uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IOException("无法创建图片文件");
                OutputStream output = getContentResolver().openOutputStream(uri, "w");
                if (output == null) throw new IOException("无法写入图片文件");
                String token = UUID.randomUUID().toString();
                saveSessions.put(token, new SaveSession(uri, output));
                return token;
            } catch (Exception error) {
                if (uri != null) getContentResolver().delete(uri, null, null);
                showMessage("无法保存到相册：" + error.getMessage());
                return "";
            }
        }

        @JavascriptInterface
        public boolean appendChunk(String token, String base64) {
            SaveSession session = saveSessions.get(token);
            if (session == null) return false;
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                synchronized (session) { session.output.write(bytes); }
                return true;
            } catch (Exception error) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean finishSave(String token) {
            SaveSession session = saveSessions.remove(token);
            if (session == null) return false;
            try {
                synchronized (session) { session.output.close(); }
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.IS_PENDING, 0);
                getContentResolver().update(session.uri, values, null, null);
                showMessage("已保存到相册 · Pictures/Motion Photo Converter");
                return true;
            } catch (Exception error) {
                getContentResolver().delete(session.uri, null, null);
                showMessage("保存失败：" + error.getMessage());
                return false;
            }
        }

        @JavascriptInterface
        public void cancelSave(String token) {
            MainActivity.this.cancelSave(token);
        }

        @JavascriptInterface
        public String beginFadeTail(int width, int height, int durationMs, String mime) {
            if (!"video/avc".equals(mime) && !"video/hevc".equals(mime)) return "";
            if (durationMs < 100 || durationMs > 3500 || width < 2 || height < 2
                    || width * (long) height > 12_000_000) return "";
            String encoder = FadeTailEncoder.hardwareEncoder(mime, width, height);
            if (encoder == null) return "";
            String token = UUID.randomUUID().toString();
            fadeSessions.put(token, new FadeSession(width, height, durationMs, mime, encoder));
            return token;
        }

        @JavascriptInterface
        public boolean appendFadeTailChunk(String token, String kind, String base64) {
            FadeSession session = fadeSessions.get(token);
            if (session == null || !"ready".equals(session.status)) return false;
            ByteArrayOutputStream target = "last".equals(kind) ? session.last
                    : "cover".equals(kind) ? session.cover : null;
            if (target == null) return false;
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                synchronized (session) {
                    if (target.size() + bytes.length > 25_000_000) return false;
                    target.write(bytes);
                }
                return true;
            } catch (Exception error) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean startFadeTail(String token) {
            FadeSession session = fadeSessions.get(token);
            if (session == null) return false;
            byte[] last, cover;
            synchronized (session) {
                if (!"ready".equals(session.status) || session.last.size() == 0 || session.cover.size() == 0) return false;
                last = session.last.toByteArray();
                cover = session.cover.toByteArray();
                session.status = "working";
            }
            fadeExecutor.execute(() -> {
                File output = new File(getCacheDir(), "fade-tail-" + token + ".mp4");
                session.output = output;
                try {
                    FadeTailEncoder.encode(last, cover, session.width, session.height,
                            session.durationMs, session.mime, session.encoderName, output);
                    session.status = output.length() > 0 ? "done" : "error:硬件编码结果为空";
                } catch (Exception | OutOfMemoryError error) {
                    session.status = "error:" + error.getClass().getSimpleName() + ": " + error.getMessage();
                } finally {
                    if (session.cancelled || !"done".equals(session.status)) output.delete();
                }
            });
            return true;
        }

        @JavascriptInterface
        public String fadeTailStatus(String token) {
            FadeSession session = fadeSessions.get(token);
            return session == null ? "error:编码任务已取消" : session.status;
        }

        @JavascriptInterface
        public int fadeTailSize(String token) {
            FadeSession session = fadeSessions.get(token);
            return session != null && "done".equals(session.status) && session.output != null
                    ? (int) Math.min(Integer.MAX_VALUE, session.output.length()) : 0;
        }

        @JavascriptInterface
        public String readFadeTailChunk(String token, int offset, int length) {
            FadeSession session = fadeSessions.get(token);
            if (session == null || !"done".equals(session.status) || session.output == null
                    || offset < 0 || length < 1 || length > 96 * 1024) return "";
            try (RandomAccessFile input = new RandomAccessFile(session.output, "r")) {
                if ((long) offset + length > input.length()) return "";
                byte[] bytes = new byte[length];
                input.seek(offset);
                input.readFully(bytes);
                return Base64.encodeToString(bytes, Base64.NO_WRAP);
            } catch (IOException error) {
                return "";
            }
        }

        @JavascriptInterface
        public void finishFadeTail(String token) {
            MainActivity.this.finishFadeTail(token);
        }
    }
}
