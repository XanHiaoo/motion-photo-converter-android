# Motion Photo Tool

一个面向三星 Motion Photo 的本地制作与转换工具，提供 Web 版和 Android 应用。视频、照片与动态照片都在当前设备上处理，不会上传到服务器。

[在线使用](https://xanhiaoo.github.io/samsung-motion-photo-tool/) · [GitHub Actions](https://github.com/XanHiaoo/samsung-motion-photo-tool/actions)

## 可以做什么

- 从 MP4 / MOV 视频截取片段、选择封面，生成 Samsung Motion Photo。
- 批量导入内嵌视频的 JPG / JPEG / HEIC 动态照片，识别、转换并保存。
- 选择一张照片和一段视频，合成为一张 Motion Photo。
- 调整片段起止点、横向移动选区，并使用快速或精确裁剪。
- 默认在视频结束时渐变回封面，渐变时长初始为 0.5 秒，可按需调整或关闭。

## 界面预览

<div align="center">
  <img src="docs/images/home-preview.png" alt="Motion Photo Tool 首页与三种创建方式" width="220" />
  <img src="docs/images/video-preview.png" alt="视频模式的时间轴、封面与渐变控制" width="220" />
  <br />
  <img src="docs/images/batch-preview.png" alt="批量导入动态照片及转换队列" width="220" />
  <img src="docs/images/manual-preview.png" alt="照片和视频合成模式的选段控件" width="220" />
</div>

## 技术栈

- Web：React、TypeScript、Vite
- 媒体处理：Web Worker、WebAssembly、FFmpeg
- Android：Java、WebView、WebViewAssetLoader
- 构建与发布：Gradle、GitHub Actions、GitHub Pages

## 快速开始

### Web 开发预览

Windows PowerShell：

```powershell
cd web
npm.cmd ci
npm.cmd run dev -- --host 127.0.0.1 --strictPort
```

Linux/macOS：

```bash
cd web
npm ci
npm run dev -- --host 127.0.0.1 --strictPort
```

访问 <http://127.0.0.1:5173/samsung-motion-photo-tool/>。也可在 VS Code 中运行 `web:dev` 任务。

### Android APK

Android 构建前先生成 Web 资源：

```text
npm run build:android
```

Debug 和 Release 的完整构建方式、VS Code 任务及环境配置见[开发指南](docs/DEVELOPMENT.md)。

## 构建类型

| 类型 | 用途 | 输出或发布方式 |
| --- | --- | --- |
| Web Development | 本地开发和热更新 | `npm run dev` |
| Web Production | Web 发布预览 | `npm run build` → `npm run preview` |
| Android Debug | 本地安装和测试 | `app/build/outputs/apk/debug/app-debug.apk` |
| Android Release | 正式分发 | `app/build/outputs/apk/release/app-release.apk` |
| GitHub Release | Tag 自动发布 | 推送 `v*.*.*` tag |

Release 签名、GitHub Secrets 和 Tag 发布流程见[发布指南](docs/RELEASE.md)。

修改 Web 源码后不要直接编辑 `app/src/main/assets/`；运行 `npm run build:android` 重新生成资源。

## 文档

- [用户使用指南（HTML）](https://xanhiaoo.github.io/samsung-motion-photo-tool/docs/USER_GUIDE.html)
- [用户使用手册 PDF](docs/motion-photo-tool-user-guide.pdf)
- [开发指南](docs/DEVELOPMENT.md)
- [发布指南](docs/RELEASE.md)

## 在线部署

推送到 `main` 会触发 GitHub Pages 部署；推送版本 tag 会触发 Release APK 构建。具体工作流位于 `.github/workflows/`。
