let es = null;

const $ = (id) => document.getElementById(id);

function fmt(n) {
  if (typeof n !== "number") return "-";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "G";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return String(Math.floor(n));
}

function setStatus(text, kind) {
  const el = $("status");
  el.textContent = text;
  el.classList.remove("ok", "bad");
  if (kind) el.classList.add(kind);
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function post(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {})
  }).then((r) => r.json());
}

function drawChart(history) {
  const canvas = $("chart");
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const pad = 24;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  // 背景网格
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad + (innerH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
    ctx.stroke();
  }
  ctx.restore();

  const inArr = history.map((x) => x.bytesIn || 0);
  const outArr = history.map((x) => x.bytesOut || 0);
  const maxVal = Math.max(10, ...inArr, ...outArr);

  const toX = (i) => pad + (innerW * i) / (history.length - 1);
  const toY = (v) => pad + innerH - (innerH * v) / maxVal;

  function line(arr, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < arr.length; i++) {
      const x = toX(i);
      const y = toY(arr[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  line(inArr, "#4ade80");
  line(outArr, "#60a5fa");

  // 右上角最大值标注
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = "12px ui-sans-serif, system-ui";
  ctx.fillText(`max ${fmt(maxVal)} B/s`, pad, pad - 6);
  ctx.restore();
}

function applySnapshot(snap) {
  $("activeUsers").textContent = fmt(snap.activeUsers);
  $("inBps").textContent = fmt(snap.current?.bytesInPerSec ?? 0);
  $("outBps").textContent = fmt(snap.current?.bytesOutPerSec ?? 0);
  $("totalIn").textContent = fmt(snap.totals?.bytesIn ?? 0);
  $("totalOut").textContent = fmt(snap.totals?.bytesOut ?? 0);

  if (Array.isArray(snap.history)) drawChart(snap.history);

  $("raw").textContent = JSON.stringify(
    {
      appId: snap.appId,
      ts: snap.ts,
      activeUsers: snap.activeUsers,
      current: snap.current,
      totals: snap.totals
    },
    null,
    2
  );
}

function disconnect() {
  if (es) {
    es.close();
    es = null;
  }
}

function connect() {
  const appId = $("appId").value.trim();
  if (!appId) {
    setStatus("请先输入 appId", "bad");
    return;
  }

  disconnect();
  setStatus("连接中…");

  es = new EventSource(`/api/sse?appId=${encodeURIComponent(appId)}`);

  es.addEventListener("open", () => setStatus("已连接", "ok"));
  es.addEventListener("error", () => setStatus("连接异常（请确认服务在运行）", "bad"));

  es.addEventListener("snapshot", (ev) => {
    const data = safeJsonParse(ev.data);
    if (data?.ok) applySnapshot(data);
  });

  es.addEventListener("update", (ev) => {
    const data = safeJsonParse(ev.data);
    if (data?.ok) applySnapshot(data);
  });
}

$("connectBtn").addEventListener("click", connect);

$("mockStartBtn").addEventListener("click", async () => {
  const appId = $("appId").value.trim();
  const users = Number($("mockUsers").value || 80);
  const r = await post("/api/mock/start", { appId, users });
  if (r?.ok) setStatus("模拟数据已启动", "ok");
  else setStatus(`启动失败：${r?.error || "unknown"}`, "bad");
});

$("mockStopBtn").addEventListener("click", async () => {
  const appId = $("appId").value.trim();
  const r = await post("/api/mock/stop", { appId });
  if (r?.ok) setStatus("模拟数据已停止", "ok");
  else setStatus(`停止失败：${r?.error || "unknown"}`, "bad");
});

// APK列表相关
async function loadAPKList() {
  try {
    const res = await fetch("/api/apk/list");
    const data = await res.json();
    const listEl = document.getElementById("apkList");
    
    if (!data.ok || !data.apks || data.apks.length === 0) {
      listEl.innerHTML = '<div style="color: var(--muted); padding: 20px; text-align: center;">暂无已注册的APK</div>';
      return;
    }
    
    listEl.innerHTML = data.apks.map((apk) => {
      const info = apk.apkInfo || {};
      const date = new Date(apk.registeredAt).toLocaleString("zh-CN");
      return `
        <div class="apkItem">
          <div class="apkHeader">
            <strong>${apk.appId}</strong>
            <button class="btn small" onclick="selectAppId('${apk.appId}')">使用此APP</button>
          </div>
          <div class="apkDetails">
            ${info.packageName ? `<div><span class="label">包名:</span> ${info.packageName}</div>` : ""}
            ${info.versionName ? `<div><span class="label">版本:</span> ${info.versionName} (${info.versionCode || "N/A"})</div>` : ""}
            ${info.appName ? `<div><span class="label">应用名:</span> ${info.appName}</div>` : ""}
            ${info.fileSizeMB ? `<div><span class="label">大小:</span> ${info.fileSizeMB} MB</div>` : ""}
            <div><span class="label">文件:</span> ${apk.apkPath.split("/").pop()}</div>
            <div><span class="label">注册时间:</span> ${date}</div>
            ${info.note ? `<div style="color: var(--muted); font-size: 11px; margin-top: 8px;">${info.note}</div>` : ""}
          </div>
        </div>
      `;
    }).join("");
  } catch (e) {
    document.getElementById("apkList").innerHTML = `<div style="color: rgba(248, 113, 113, 0.95);">加载失败: ${e.message}</div>`;
  }
}

function selectAppId(appId) {
  document.getElementById("appId").value = appId;
  connect();
}

document.getElementById("refreshApkBtn").addEventListener("click", loadAPKList);

// 进入页面自动连 demo-app 并加载APK列表
loadAPKList();
connect();

