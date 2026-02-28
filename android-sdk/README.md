# Android SDK 集成指南

这个SDK可以让你的Android APP自动上报流量数据到后台监控系统。

## 快速开始

### 1. 添加依赖

在你的 `app/build.gradle` 中添加：

```gradle
dependencies {
    implementation 'com.squareup.okhttp3:okhttp:4.12.0'
}
```

### 2. 复制SDK文件

将 `TrafficReporter.java` 复制到你的项目：
```
app/src/main/java/com/yourpackage/sdk/TrafficReporter.java
```

### 3. 初始化SDK

在你的 `Application` 类中初始化：

```java
public class MyApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        
        // 初始化流量上报SDK
        TrafficReporter.init(
            this,
            "your-app-id",  // 你的APP ID，用于在后台区分
            "http://192.168.1.100:8787"  // 后台服务地址
        );
        
        // 启用自动上报（每10秒上报一次）
        TrafficReporter.startAutoReport();
    }
}
```

### 4. 添加网络权限

在 `AndroidManifest.xml` 中添加：

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

## 使用方式

### 方式1: 自动上报（推荐）

SDK会自动使用 `TrafficStats` API 统计流量并上报：

```java
TrafficReporter.startAutoReport();  // 开始自动上报
TrafficReporter.stopAutoReport();   // 停止自动上报
```

### 方式2: 手动上报

如果你有自己的流量统计逻辑，可以手动上报：

```java
TrafficReporter.report(
    "user_123",  // 用户ID
    1200,        // 入流量（bytes）
    800          // 出流量（bytes）
);
```

## 注意事项

1. **后台地址**: 确保APP能访问到后台服务地址（开发时可以用电脑IP，生产环境需要配置域名）
2. **用户ID**: 默认使用设备ANDROID_ID，你可以传入自己的用户ID
3. **流量统计**: 自动上报基于系统 `TrafficStats`，可能不包含所有网络流量（如VPN流量）
4. **性能**: 上报是异步的，不会阻塞主线程

## 测试

1. 启动后台服务：`npm run dev`
2. 在APP中初始化SDK
3. 打开后台页面：`http://localhost:8787`
4. 输入你的 `appId`，点击"连接"
5. 在APP中进行网络操作，观察后台实时流量
