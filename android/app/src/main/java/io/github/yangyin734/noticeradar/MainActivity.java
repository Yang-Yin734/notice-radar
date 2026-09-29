package io.github.yangyin734.noticeradar;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

/**
 * 独立应用入口：界面（HTML/CSS/JS + 数据）全部打包在 APK 内，用 WebView 加载。
 *
 * 和之前的 TWA 版本的区别（用户反馈的两个问题）：
 *   1. 不再是"套壳浏览器"：没有地址栏、没有浏览器痕迹，图标点开就是应用界面
 *   2. 打开过程不依赖任何网络：资源来自 APK 内部，断网/连不上 GitHub 也能进
 *      —— 数据先读内置，再静默尝试镜像刷新（见网页里的 refreshFromNetwork）
 */
public class MainActivity extends Activity {

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 把 assets/www 用 https 安全来源暴露出来，fetch/本地存储才能正常工作
        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);   // 收藏、已读、设置、数据缓存都存在这里
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    // 应用自身的页面留在 WebView 里；外部链接（学校官网、GitHub 等）交给系统浏览器
                    if ("appassets.androidplatform.net".equals(uri.getHost())) {
                        return false;
                    }
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    return true;
                }
                return false;
            }
        });

        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html?app=1");
        setContentView(webView);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
