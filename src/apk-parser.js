import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execAsync = promisify(exec);

/**
 * 解析APK文件，提取基本信息
 * 注意：需要系统有 aapt 或 aapt2 工具，或者使用其他APK解析库
 */
export async function parseAPK(apkPath) {
  try {
    // 方法1: 尝试使用 aapt (Android Asset Packaging Tool)
    // 如果系统没有 aapt，可以安装 Android SDK 或使用其他方法
    try {
      const { stdout } = await execAsync(`aapt dump badging "${apkPath}"`);
      const info = {};
      
      // 解析包名
      const packageMatch = stdout.match(/package: name='([^']+)'/);
      if (packageMatch) info.packageName = packageMatch[1];
      
      // 解析版本
      const versionMatch = stdout.match(/versionCode='([^']+)' versionName='([^']+)'/);
      if (versionMatch) {
        info.versionCode = versionMatch[1];
        info.versionName = versionMatch[2];
      }
      
      // 解析应用名
      const labelMatch = stdout.match(/application-label:'([^']+)'/);
      if (labelMatch) info.appName = labelMatch[1];
      
      // 解析最小SDK
      const sdkMatch = stdout.match(/sdkVersion:'([^']+)'/);
      if (sdkMatch) info.minSdkVersion = sdkMatch[1];
      
      // 解析目标SDK
      const targetSdkMatch = stdout.match(/targetSdkVersion:'([^']+)'/);
      if (targetSdkMatch) info.targetSdkVersion = targetSdkMatch[1];
      
      info.parsed = true;
      info.method = "aapt";
      return info;
    } catch (aaptError) {
      // aapt 不可用，尝试其他方法
    }
    
    // 方法2: 从文件名和文件大小推断基本信息
    const fileName = path.basename(apkPath);
    const fs = await import("node:fs/promises");
    const stats = await fs.stat(apkPath);
    
    return {
      parsed: false,
      method: "fallback",
      fileName,
      fileSize: stats.size,
      fileSizeMB: (stats.size / (1024 * 1024)).toFixed(2),
      note: "需要安装 Android SDK 的 aapt 工具来解析完整信息，或使用在线APK分析工具"
    };
  } catch (error) {
    return {
      parsed: false,
      error: error.message
    };
  }
}

/**
 * 将APK文件信息注册到系统中
 */
export async function registerAPK(apkPath, appId) {
  const info = await parseAPK(apkPath);
  return {
    appId: appId || info.packageName || path.basename(apkPath, path.extname(apkPath)),
    apkPath,
    apkInfo: info,
    registeredAt: Date.now()
  };
}
