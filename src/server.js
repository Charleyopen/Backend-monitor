import http from "node:http";
import { URL } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseAPK, registerAPK } from "./apk-parser.js";

const PORT = Number(process.env.PORT || 8787);
// 在某些受限环境里绑定 0.0.0.0 会被禁止，这里默认只监听本机
const HOST = process.env.HOST || "127.0.0.1";

/**
 * 内存态：每个 appId 一份数据（示例用；生产建议落库/接入监控系统）
 */
const apps = new Map(); // appId -> state
const sseClients = new Map(); // appId -> Set<res>
const mockTimers = new Map(); // appId -> NodeJS.Timeout
const registeredAPKs = new Map(); // appId -> apkInfo

const WINDOW_SECONDS = 60;
const ACTIVE_USER_TTL_MS = 60_000;

function nowMs() {
  return Date.now();
}

function getAppState(appId) {
  let st = apps.get(appId);
  if (st) return st;

  st = {
    appId,
    usersLastSeen: new Map(), // userId -> lastSeenMs
    totals: { bytesIn: 0, bytesOut: 0 },
    lastSec: Math.floor(nowMs() / 1000),
    // buckets[0] 最旧，buckets[WINDOW_SECONDS-1] 最新
    buckets: Array.from({ length: WINDOW_SECONDS }, () => ({ in: 0, out: 0, sec: null }))
  };
  // 初始化 sec
  const curSec = Math.floor(nowMs() / 1000);
  for (let i = 0; i < WINDOW_SECONDS; i++) {
    const sec = curSec - (WINDOW_SECONDS - 1 - i);
    st.buckets[i].sec = sec;
  }

  apps.set(appId, st);
  return st;
}

function rotateBucketsTo(st, targetSec) {
  if (targetSec <= st.lastSec) return;
  const diff = targetSec - st.lastSec;
  // 如果跳太多秒，直接重置窗口
  if (diff >= WINDOW_SECONDS) {
    st.lastSec = targetSec;
    for (let i = 0; i < WINDOW_SECONDS; i++) {
      const sec = targetSec - (WINDOW_SECONDS - 1 - i);
      st.buckets[i] = { in: 0, out: 0, sec };
    }
    return;
  }

  for (let i = 0; i < diff; i++) {
    st.buckets.shift();
    const sec = st.lastSec + i + 1;
    st.buckets.push({ in: 0, out: 0, sec });
  }
  st.lastSec = targetSec;
}

function ingest({ appId, userId, bytesIn = 0, bytesOut = 0, ts }) {
  if (!appId || !userId) {
    return { ok: false, error: "`appId` 和 `userId` 必填" };
  }

  const t = typeof ts === "number" ? ts : nowMs();
  const sec = Math.floor(t / 1000);

  const st = getAppState(appId);
  rotateBucketsTo(st, sec);

  const lastBucket = st.buckets[st.buckets.length - 1];
  // 只要 rotate 到当前 sec，最后一个 bucket 一定是当前 sec
  if (lastBucket.sec !== sec) {
    // 极小概率的时间漂移保护
    rotateBucketsTo(st, sec);
  }

  lastBucket.in += Math.max(0, Number(bytesIn) || 0);
  lastBucket.out += Math.max(0, Number(bytesOut) || 0);
  st.totals.bytesIn += Math.max(0, Number(bytesIn) || 0);
  st.totals.bytesOut += Math.max(0, Number(bytesOut) || 0);
  st.usersLastSeen.set(String(userId), t);

  return { ok: true };
}

function computeSnapshot(appId) {
  const st = getAppState(appId);
  const t = nowMs();
  const curSec = Math.floor(t / 1000);
  rotateBucketsTo(st, curSec);

  // 清理过期用户 & 统计活跃
  let activeUsers = 0;
  for (const [uid, last] of st.usersLastSeen) {
    if (t - last <= ACTIVE_USER_TTL_MS) {
      activeUsers++;
    } else {
      st.usersLastSeen.delete(uid);
    }
  }

  // “当前秒”的 bucket 仍在累积中；给前端展示时用最近 60 秒序列即可
  const history = st.buckets.map((b) => ({
    sec: b.sec,
    bytesIn: b.in,
    bytesOut: b.out
  }));

  const last = st.buckets[st.buckets.length - 1];
  const inBps = last.in; // bytes/sec（更直观；需要 bit/s 可在前端 *8）
  const outBps = last.out;

  return {
    ok: true,
    appId,
    ts: t,
    activeUsers,
    current: { bytesInPerSec: inBps, bytesOutPerSec: outBps },
    totals: st.totals,
    history
  };
}

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data)
  });
  res.end(data);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

function sseSend(res, event, data) {
  // event 可省略，默认 message
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function getClients(appId) {
  let set = sseClients.get(appId);
  if (!set) {
    set = new Set();
    sseClients.set(appId, set);
  }
  return set;
}

function broadcast(appId, payload) {
  const set = sseClients.get(appId);
  if (!set || set.size === 0) return;
  for (const res of set) {
    try {
      sseSend(res, "update", payload);
    } catch {
      // 忽略写失败
    }
  }
}

function startMock(appId, users = 50) {
  stopMock(appId);
  const userCount = Math.max(1, Math.min(5000, Number(users) || 50));

  const timer = setInterval(() => {
    const batch = 10; // 每秒 10 个事件
    for (let i = 0; i < batch; i++) {
      const uid = `mock_u_${Math.floor(Math.random() * userCount)}`;
      const bytesIn = Math.floor(200 + Math.random() * 5000);
      const bytesOut = Math.floor(100 + Math.random() * 3000);
      ingest({ appId, userId: uid, bytesIn, bytesOut });
    }
  }, 1000);

  mockTimers.set(appId, timer);
}

function stopMock(appId) {
  const timer = mockTimers.get(appId);
  if (timer) clearInterval(timer);
  mockTimers.delete(appId);
}

async function serveStatic(req, res, pathname) {
  const publicDir = path.join(process.cwd(), "public");
  const filePath = path.join(publicDir, pathname === "/" ? "index.html" : pathname);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const buf = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".js"
          ? "text/javascript; charset=utf-8"
          : ext === ".css"
            ? "text/css; charset=utf-8"
            : "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = u.pathname;

    // API
    if (pathname === "/api/ingest" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = ingest(body || {});
      return json(res, result.ok ? 200 : 400, result);
    }

    if (pathname === "/api/apps" && req.method === "GET") {
      return json(res, 200, { ok: true, apps: Array.from(apps.keys()).sort() });
    }

    if (pathname === "/api/snapshot" && req.method === "GET") {
      const appId = u.searchParams.get("appId") || "";
      if (!appId) return json(res, 400, { ok: false, error: "缺少 appId" });
      return json(res, 200, computeSnapshot(appId));
    }

    if (pathname === "/api/sse" && req.method === "GET") {
      const appId = u.searchParams.get("appId") || "";
      if (!appId) return json(res, 400, { ok: false, error: "缺少 appId" });

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive"
      });
      res.write("\n");

      const set = getClients(appId);
      set.add(res);

      // 先推一次快照
      sseSend(res, "snapshot", computeSnapshot(appId));

      req.on("close", () => {
        set.delete(res);
      });
      return;
    }

    if (pathname === "/api/mock/start" && req.method === "POST") {
      const body = (await readJsonBody(req)) || {};
      const appId = body.appId || "";
      if (!appId) return json(res, 400, { ok: false, error: "缺少 appId" });
      startMock(appId, body.users);
      return json(res, 200, { ok: true });
    }

    if (pathname === "/api/mock/stop" && req.method === "POST") {
      const body = (await readJsonBody(req)) || {};
      const appId = body.appId || "";
      if (!appId) return json(res, 400, { ok: false, error: "缺少 appId" });
      stopMock(appId);
      return json(res, 200, { ok: true });
    }

    // APK 管理接口
    if (pathname === "/api/apk/register" && req.method === "POST") {
      const body = (await readJsonBody(req)) || {};
      const apkPath = body.apkPath || "";
      const appId = body.appId || "";
      if (!apkPath) return json(res, 400, { ok: false, error: "缺少 apkPath" });
      
      try {
        const info = await registerAPK(apkPath, appId);
        registeredAPKs.set(info.appId, info);
        return json(res, 200, { ok: true, apk: info });
      } catch (e) {
        return json(res, 500, { ok: false, error: e?.message || String(e) });
      }
    }

    if (pathname === "/api/apk/list" && req.method === "GET") {
      const list = Array.from(registeredAPKs.values()).map((info) => ({
        appId: info.appId,
        apkPath: info.apkPath,
        apkInfo: info.apkInfo,
        registeredAt: info.registeredAt
      }));
      return json(res, 200, { ok: true, apks: list });
    }

    if (pathname === "/api/apk/info" && req.method === "GET") {
      const appId = u.searchParams.get("appId") || "";
      if (!appId) return json(res, 400, { ok: false, error: "缺少 appId" });
      const info = registeredAPKs.get(appId);
      if (!info) return json(res, 404, { ok: false, error: "APK未注册" });
      return json(res, 200, { ok: true, apk: info });
    }

    // 静态页面
    return serveStatic(req, res, pathname);
  } catch (e) {
    return json(res, 500, { ok: false, error: e?.message || String(e) });
  }
});

// 每秒广播一次（只对有 SSE 订阅的 appId 广播）
setInterval(() => {
  for (const [appId, set] of sseClients) {
    if (!set || set.size === 0) continue;
    broadcast(appId, computeSnapshot(appId));
  }
}, 1000);

// 启动时自动注册Backend_test目录下的APK文件
async function autoRegisterAPKs() {
  try {
    const fs = await import("node:fs/promises");
    const backendTestDir = path.join(process.cwd(), "..");
    const files = await fs.readdir(backendTestDir);
    
    for (const file of files) {
      if (file.endsWith(".apk") || file.includes(".apk.")) {
        const apkPath = path.join(backendTestDir, file);
        try {
          const info = await registerAPK(apkPath);
          registeredAPKs.set(info.appId, info);
          // eslint-disable-next-line no-console
          console.log(`[app-traffic-admin] 自动注册APK: ${info.appId} (${file})`);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(`[app-traffic-admin] 注册APK失败 ${file}:`, e.message);
        }
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[app-traffic-admin] 自动注册APK时出错:", e.message);
  }
}

server.listen(PORT, HOST, async () => {
  // eslint-disable-next-line no-console
  console.log(`[app-traffic-admin] http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  
  // 自动注册APK
  await autoRegisterAPKs();
  
  if (process.env.MOCK === "true") {
    startMock("demo-app", 80);
    // eslint-disable-next-line no-console
    console.log("[app-traffic-admin] MOCK=true 已启动 demo-app 模拟数据");
  }
});

