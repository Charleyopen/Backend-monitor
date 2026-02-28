package com.traffic.admin.sdk;

import android.content.Context;
import android.net.TrafficStats;
import android.os.Handler;
import android.os.Looper;
import java.io.IOException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONObject;

/**
 * 流量上报SDK - 用于Android APP集成
 * 
 * 使用方法：
 * 1. 在 Application.onCreate() 中初始化：
 *    TrafficReporter.init(this, "your-app-id", "http://your-backend:8787");
 * 
 * 2. 在需要上报的地方调用：
 *    TrafficReporter.report(userId, bytesIn, bytesOut);
 * 
 * 3. 或者启用自动上报（每10秒上报一次）：
 *    TrafficReporter.startAutoReport();
 */
public class TrafficReporter {
    private static final String TAG = "TrafficReporter";
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    
    private static Context sContext;
    private static String sAppId;
    private static String sBaseUrl;
    private static OkHttpClient sHttpClient;
    private static Handler sMainHandler;
    private static ScheduledExecutorService sExecutor;
    private static long sLastUidRxBytes = 0;
    private static long sLastUidTxBytes = 0;
    private static boolean sAutoReportEnabled = false;
    
    /**
     * 初始化SDK
     * @param context Application context
     * @param appId 应用ID（用于区分不同APP）
     * @param baseUrl 后端服务地址，如 "http://192.168.1.100:8787"
     */
    public static void init(Context context, String appId, String baseUrl) {
        sContext = context.getApplicationContext();
        sAppId = appId;
        sBaseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        sHttpClient = new OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.SECONDS)
            .build();
        sMainHandler = new Handler(Looper.getMainLooper());
        
        // 初始化流量统计基准值
        int uid = android.os.Process.myUid();
        sLastUidRxBytes = TrafficStats.getUidRxBytes(uid);
        sLastUidTxBytes = TrafficStats.getUidTxBytes(uid);
    }
    
    /**
     * 手动上报流量数据
     * @param userId 用户ID
     * @param bytesIn 入流量（bytes）
     * @param bytesOut 出流量（bytes）
     */
    public static void report(String userId, long bytesIn, long bytesOut) {
        if (sAppId == null || sBaseUrl == null) {
            android.util.Log.w(TAG, "TrafficReporter not initialized");
            return;
        }
        
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                JSONObject json = new JSONObject();
                json.put("appId", sAppId);
                json.put("userId", userId != null ? userId : getDefaultUserId());
                json.put("bytesIn", bytesIn);
                json.put("bytesOut", bytesOut);
                json.put("ts", System.currentTimeMillis());
                
                RequestBody body = RequestBody.create(json.toString(), JSON);
                Request request = new Request.Builder()
                    .url(sBaseUrl + "/api/ingest")
                    .post(body)
                    .build();
                
                try (Response response = sHttpClient.newCall(request).execute()) {
                    if (response.isSuccessful()) {
                        android.util.Log.d(TAG, "Traffic reported: " + bytesIn + "/" + bytesOut);
                    } else {
                        android.util.Log.w(TAG, "Report failed: " + response.code());
                    }
                }
            } catch (Exception e) {
                android.util.Log.e(TAG, "Report error", e);
            }
        });
    }
    
    /**
     * 启用自动上报（每10秒上报一次）
     */
    public static void startAutoReport() {
        if (sAutoReportEnabled) return;
        sAutoReportEnabled = true;
        
        sExecutor = Executors.newSingleThreadScheduledExecutor();
        sExecutor.scheduleAtFixedRate(() -> {
            int uid = android.os.Process.myUid();
            long currentRx = TrafficStats.getUidRxBytes(uid);
            long currentTx = TrafficStats.getUidTxBytes(uid);
            
            // 计算增量
            long deltaRx = currentRx - sLastUidRxBytes;
            long deltaTx = currentTx - sLastUidTxBytes;
            
            if (deltaRx > 0 || deltaTx > 0) {
                report(getDefaultUserId(), deltaRx, deltaTx);
                sLastUidRxBytes = currentRx;
                sLastUidTxBytes = currentTx;
            }
        }, 10, 10, TimeUnit.SECONDS);
    }
    
    /**
     * 停止自动上报
     */
    public static void stopAutoReport() {
        sAutoReportEnabled = false;
        if (sExecutor != null) {
            sExecutor.shutdown();
            sExecutor = null;
        }
    }
    
    private static String getDefaultUserId() {
        // 可以使用设备ID或其他唯一标识
        return android.provider.Settings.Secure.getString(
            sContext.getContentResolver(),
            android.provider.Settings.Secure.ANDROID_ID
        );
    }
}
