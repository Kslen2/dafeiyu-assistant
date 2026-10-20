package com.dafeiyu.assistant;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + APP_HOST + "/index.html";
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int SAVE_DOCUMENT_REQUEST = 1002;

    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private String pendingFileContent;
    private int bottomInsetPx;
    private int keyboardInsetPx;

    @Override
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.rgb(248, 246, 241));
        getWindow().setNavigationBarColor(Color.rgb(248, 246, 241));
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        );

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(248, 246, 241));
        configureInsets(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);

        webView.addJavascriptInterface(new BackupBridge(), "AndroidBackup");
        webView.setWebViewClient(new LocalAssetWebViewClient());
        webView.setWebChromeClient(new AppWebChromeClient());
        WebView.setWebContentsDebuggingEnabled(false);

        setContentView(webView);
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(START_URL);
        }
    }

    private void configureInsets(View view) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            view.setOnApplyWindowInsetsListener((target, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                target.setPadding(bars.left, bars.top, bars.right, 0);
                bottomInsetPx = bars.bottom;
                keyboardInsetPx = Math.max(0, keyboard.bottom - bars.bottom);
                applySafeAreaToPage();
                return insets;
            });
        }
    }

    private void applySafeAreaToPage() {
        if (webView == null) return;
        float density = getResources().getDisplayMetrics().density;
        float bottomInsetCssPx = density > 0 ? bottomInsetPx / density : bottomInsetPx;
        float keyboardInsetCssPx = density > 0 ? keyboardInsetPx / density : keyboardInsetPx;
        String bottomValue = String.format(Locale.US, "%.2fpx", bottomInsetCssPx);
        String keyboardValue = String.format(Locale.US, "%.2fpx", keyboardInsetCssPx);
        String script = "document.documentElement.style.setProperty('--native-safe-bottom','" + bottomValue + "');"
            + "document.documentElement.style.setProperty('--native-keyboard-height','" + keyboardValue + "');"
            + "if(window.syncAppViewport){window.syncAppViewport();}";
        webView.evaluateJavascript(script, null);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidBackup");
            webView.destroy();
        }
        super.onDestroy();
    }

    private class LocalAssetWebViewClient extends WebViewClient {
        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            applySafeAreaToPage();
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!APP_HOST.equalsIgnoreCase(uri.getHost())) return super.shouldInterceptRequest(view, request);

            String path = uri.getPath();
            if (path == null || path.equals("/")) path = "/index.html";
            String assetPath = path.startsWith("/") ? path.substring(1) : path;
            if (assetPath.contains("..")) return null;

            try {
                InputStream stream = getAssets().open(assetPath);
                WebResourceResponse response = new WebResourceResponse(mimeType(assetPath), "UTF-8", stream);
                response.setResponseHeaders(Collections.singletonMap("Cache-Control", "no-store"));
                return response;
            } catch (IOException error) {
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), null);
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (APP_HOST.equalsIgnoreCase(uri.getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException error) {
                Toast.makeText(MainActivity.this, "无法打开这个链接", Toast.LENGTH_SHORT).show();
            }
            return true;
        }
    }

    private class AppWebChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = callback;
            try {
                startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                return true;
            } catch (ActivityNotFoundException error) {
                fileChooserCallback = null;
                Toast.makeText(MainActivity.this, "没有可用的文件选择器", Toast.LENGTH_SHORT).show();
                return false;
            }
        }
    }

    private class BackupBridge {
        @JavascriptInterface
        public void saveTextFile(String filename, String content, String mimeType) {
            runOnUiThread(() -> {
                pendingFileContent = content == null ? "" : content;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(mimeType == null || mimeType.isBlank() ? "application/octet-stream" : mimeType);
                intent.putExtra(Intent.EXTRA_TITLE, safeFilename(filename));
                try {
                    startActivityForResult(intent, SAVE_DOCUMENT_REQUEST);
                } catch (ActivityNotFoundException error) {
                    pendingFileContent = null;
                    Toast.makeText(MainActivity.this, "没有可用的文件保存器", Toast.LENGTH_SHORT).show();
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (fileChooserCallback != null) {
                Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                fileChooserCallback.onReceiveValue(result);
                fileChooserCallback = null;
            }
            return;
        }

        if (requestCode == SAVE_DOCUMENT_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingFileContent != null) {
                try (OutputStream output = getContentResolver().openOutputStream(data.getData())) {
                    if (output == null) throw new IOException("No output stream");
                    output.write(pendingFileContent.getBytes(StandardCharsets.UTF_8));
                    output.flush();
                    Toast.makeText(this, "备份文件已保存", Toast.LENGTH_SHORT).show();
                } catch (IOException error) {
                    Toast.makeText(this, "保存失败，请重试", Toast.LENGTH_LONG).show();
                }
            }
            pendingFileContent = null;
        }
    }

    private String mimeType(String path) {
        String extension = MimeTypeMap.getFileExtensionFromUrl(path);
        String detected = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        if (detected != null) return detected;
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    private String safeFilename(String value) {
        String fallback = "大肥鱼助手备份.json";
        if (value == null || value.isBlank()) return fallback;
        String cleaned = value.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        return cleaned.isEmpty() ? fallback : cleaned;
    }
}
