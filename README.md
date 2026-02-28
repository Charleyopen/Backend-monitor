# APP 实时流量后台（示例项目）

这个项目放在 `Backend_test/app_traffic_admin` 下，提供：

- 一个简单后台页面：实时查看某个 `appId` 的活跃用户数、入/出流量、最近 60 秒趋势
- 一个数据上报接口：APP/服务端把“用户流量事件”打到这里
- SSE（Server-Sent Events）推送：页面无需轮询即可实时刷新
- 内置模拟数据：方便先跑起来看效果

## 运行

```bash
cd "/Users/tc/Desktop/02_Learn/Backend_test/app_traffic_admin"
npm run dev
```

默认监听：`http://localhost:8787`

## 打开后台

浏览器访问：

```
http://localhost:8787
```

页面里可以输入 `appId`，并点击“启动模拟数据”先看实时效果。

## 数据上报（给你的 APP/服务端调用）

### 1) 上报一条流量事件

`POST /api/ingest`

```json
{
  "appId": "demo-app",
  "userId": "u_123",
  "bytesIn": 1200,
  "bytesOut": 800,
  "ts": 1700000000000
}
```

- `ts` 可选，不传则以服务端收到时间为准
- `bytesIn/bytesOut` 代表“这一小段时间内的流量增量”（由你在 APP 端统计后上报）

### 2) 列出已出现的 app

`GET /api/apps`

### 3) 获取一次快照

`GET /api/snapshot?appId=demo-app`

## 模拟数据

页面按钮会调用：

- `POST /api/mock/start` 传 `{ appId, users }`
- `POST /api/mock/stop` 传 `{ appId }`

## APK 接入

### 自动注册

启动服务时，会自动扫描 `Backend_test` 目录下的 `.apk` 文件并注册。你可以在后台页面看到已注册的APK信息。

### 手动注册APK

```bash
curl -X POST http://localhost:8787/api/apk/register \
  -H "Content-Type: application/json" \
  -d '{
    "apkPath": "/path/to/your/app.apk",
    "appId": "your-app-id"
  }'
```

### Android SDK 集成

1. **查看SDK代码**：`android-sdk/TrafficReporter.java`
2. **集成指南**：`android-sdk/README.md`

快速集成步骤：
- 复制 `TrafficReporter.java` 到你的Android项目
- 添加 OkHttp 依赖
- 在 `Application.onCreate()` 中初始化SDK
- 启用自动上报或手动上报流量

### APK 管理接口

- `GET /api/apk/list` - 列出所有已注册的APK
- `GET /api/apk/info?appId=xxx` - 获取指定APK的详细信息
- `POST /api/apk/register` - 注册新的APK文件



