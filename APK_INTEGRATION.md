# APK 接入指南

## 已完成的接入功能

✅ **自动APK注册**：服务启动时会自动扫描 `Backend_test` 目录下的 `.apk` 文件并注册  
✅ **APK信息解析**：提取包名、版本、应用名等信息（需要系统有 `aapt` 工具）  
✅ **后台展示**：在网页后台可以看到已注册的APK列表  
✅ **Android SDK**：提供完整的Java SDK代码，让APK可以上报流量

## 当前状态

你的APK文件 `app-release.apk.1.1` 已经在 `Backend_test` 目录下，服务启动时会自动注册。

## 使用步骤

### 1. 重启服务器（加载新代码）

如果服务器正在运行，需要重启：

```bash
# 停止当前服务器（Ctrl+C 或 kill进程）
# 然后重新启动
cd "/Users/tc/Desktop/02_Learn/Backend_test/app_traffic_admin"
npm run dev
```

### 2. 查看已注册的APK

打开后台页面：`http://127.0.0.1:8787`

在页面下方会显示"已注册的APK"列表，你可以：
- 看到APK的基本信息（包名、版本等）
- 点击"使用此APP"按钮快速切换到该APK的appId

### 3. 在Android项目中集成SDK

#### 步骤1：复制SDK文件

将 `android-sdk/TrafficReporter.java` 复制到你的Android项目：
```
app/src/main/java/com/yourpackage/sdk/TrafficReporter.java
```

#### 步骤2：添加依赖

在 `app/build.gradle` 中添加：
```gradle
dependencies {
    implementation 'com.squareup.okhttp3:okhttp:4.12.0'
}
```

#### 步骤3：初始化SDK

在你的 `Application` 类中：
```java
public class MyApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        
        // 初始化流量上报SDK
        TrafficReporter.init(
            this,
            "your-app-id",  // 使用APK的包名或自定义ID
            "http://192.168.1.100:8787"  // 后台服务地址（开发时用电脑IP）
        );
        
        // 启用自动上报（每10秒上报一次）
        TrafficReporter.startAutoReport();
    }
}
```

#### 步骤4：添加权限

在 `AndroidManifest.xml` 中添加：
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

### 4. 测试流量上报

1. 在手机上安装集成了SDK的APP
2. 确保手机和电脑在同一网络
3. 打开后台页面，输入你的 `appId`
4. 在APP中进行网络操作（浏览网页、加载数据等）
5. 观察后台实时流量变化

## API 接口

### 注册APK
```bash
POST /api/apk/register
{
  "apkPath": "/path/to/app.apk",
  "appId": "your-app-id"  # 可选，不传则使用包名
}
```

### 列出所有APK
```bash
GET /api/apk/list
```

### 获取APK详情
```bash
GET /api/apk/info?appId=your-app-id
```

## 注意事项

1. **aapt工具**：APK信息解析需要系统有 `aapt` 工具（Android SDK的一部分）。如果没有，APK仍会注册，但只能显示文件名和大小等基本信息。

2. **网络地址**：开发时，Android APP需要访问你的电脑IP地址，确保：
   - 手机和电脑在同一WiFi网络
   - 使用电脑的局域网IP（如 `192.168.1.100`），不是 `127.0.0.1` 或 `localhost`

3. **流量统计**：SDK使用系统 `TrafficStats` API，可能不包含所有网络流量（如VPN流量）。

4. **生产环境**：生产环境建议：
   - 使用域名而非IP地址
   - 添加HTTPS支持
   - 添加认证机制

## 下一步

- [ ] 测试APK自动注册是否成功
- [ ] 在Android项目中集成SDK
- [ ] 测试流量上报功能
- [ ] 根据需要调整流量统计口径
