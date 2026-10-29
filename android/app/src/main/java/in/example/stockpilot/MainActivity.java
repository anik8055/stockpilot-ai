package in.example.stockpilot;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

/**
 * StockPilot loads the deployed web app. WebViews ignore file downloads by default, so PDF/CSV/Excel exports
 * are handed to Android's DownloadManager together with the signed-in session cookie. Only same-host URLs
 * are downloaded this way.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                Uri uri = Uri.parse(url);
                String appHost = Uri.parse(getBridge().getServerUrl()).getHost();
                if (appHost == null || !appHost.equalsIgnoreCase(uri.getHost()) || !"https".equalsIgnoreCase(uri.getScheme())) {
                    Toast.makeText(this, "Download blocked: not from StockPilot", Toast.LENGTH_SHORT).show();
                    return;
                }
                String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                DownloadManager.Request request = new DownloadManager.Request(uri)
                    .setMimeType(mimeType)
                    .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url))
                    .addRequestHeader("User-Agent", userAgent)
                    .setTitle(fileName)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                dm.enqueue(request);
                Toast.makeText(this, "Downloading " + fileName, Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "Could not download the file", Toast.LENGTH_SHORT).show();
            }
        });
    }
}
