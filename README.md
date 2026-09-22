# Motion Photo Converter · Android

一个面向三星 Motion Photo 的本地转换工具，同时提供 Web 预览版和 Android WebView 封装版。

项目采用 React + Vite 实现转换界面和核心处理逻辑，Android 端使用 WebView 离线加载打包后的 Web 资源。所有媒体处理均在本机完成，不上传用户文件。

[在线预览](https://xanhiaoo.github.io/motion-photo-converter-android/) · [Actions](https://github.com/XanHiaoo/motion-photo-converter-android/actions)

## 项目能力

- 视频生成 Samsung Motion Photo：截取视频片段并选择封面帧。
- 批量导入多个动态图片文件并逐个转换。
- 照片和视频合成动态图，并提供图片自适应视频尺寸选项。
- 支持 JPEG、HEIC、MOV 等常见输入处理路径。
- 在本机完成 JPEG/HEIC 处理、视频截取和封装，不依赖服务端。
- Android 端通过系统文件选择器导入文件，并将结果保存到相册。

## 技术栈

- Web：React、TypeScript、Vite
- 媒体处理：Web Worker、WebAssembly、FFmpeg
- Android：Java、Android WebView、WebViewAssetLoader
- 构建：Gradle Wrapper、Android Gradle Plugin
- 自动化：GitHub Actions、GitHub Pages、GitHub Releases

## 目录结构

```text
.
├─ app/                         Android WebView 壳和打包后的 Web 资源
├─ web/                         Web 源码、媒体处理逻辑和测试
├─ docs/                        用户文档和设计参考
├─ .github/workflows/           GitHub Pages 和 APK 发布工作流
├─ .vscode/                     VS Code 任务与调试配置
├─ gradle/                      Gradle Wrapper 配置
├─ build-debug.cmd              Windows 一键构建脚本
├─ build-debug.ps1              PowerShell 一键构建脚本
├─ build.gradle                 根 Gradle 配置
└─ settings.gradle              Gradle 模块配置
```

`app/src/main/assets/` 是 Android 构建使用的 Web 资源目录，由 `web` 的 `build:android` 脚本生成。修改网页源码后不要直接编辑该目录，应重新生成资源。

## 开发环境

建议使用以下版本：

- Node.js `>= 22.13.0`
- JDK 17
- Android SDK Platform 35
- Android SDK Build Tools 36.0.0
- Gradle Wrapper 8.13（项目已提供）

Android 模块最低支持 Android 10（API 29），compileSdk 为 36，targetSdk 为 35。

## Web 开发

安装依赖：

```powershell
cd web
npm.cmd ci
```

启动开发服务器：

```powershell
npm.cmd run dev -- --host 127.0.0.1 --strictPort
```

访问：<http://127.0.0.1:5173/motion-photo-converter-android/>

也可以在 VS Code 中运行 `Tasks: Run Task` → `web:dev`，或使用 Run and Debug 配置启动 Web 调试。

常用命令：

```powershell
npm.cmd test                 # 运行测试
npm.cmd run build            # 构建 Web 预览
npm.cmd run build:android    # 生成 Android 所需的 Web 资源
npm.cmd run preview          # 预览已构建的 Web 文件
```

## Android Debug APK

推荐使用一键脚本。脚本会执行 Web 测试、生成 Android Web 资源，然后使用 Gradle 构建 Debug APK：

```powershell
.\build-debug.ps1
```

也可以执行：

```cmd
build-debug.cmd
```

分步构建：

```powershell
cd web
npm.cmd ci
npm.cmd test
npm.cmd run build:android
cd ..
.\gradlew.bat :app:assembleDebug --no-daemon
```

APK 输出位置：

```text
app/build/outputs/apk/debug/app-debug.apk
```

如果本机没有配置 `JAVA_HOME` 或 `ANDROID_HOME`，请先配置 JDK 和 Android SDK。构建脚本也会尝试发现工作区上级目录的 `.build-tools` 便携工具链。

## GitHub Actions

### GitHub Pages

`.github/workflows/deploy-pages.yml` 会在每次推送到 `main` 后安装 Web 依赖、构建 `web/dist/`，并发布到 GitHub Pages。

首次启用时，在仓库的 `Settings` → `Pages` 中将 `Build and deployment` → `Source` 设置为 `GitHub Actions`。

预览地址：<https://xanhiaoo.github.io/motion-photo-converter-android/>

### Tag 发布 APK

`.github/workflows/release-apk.yml` 会匹配 `v1.0.0` 形式的版本 tag，在云端构建 Android Web 资源和 APK，创建 GitHub Release 并上传 APK。

```powershell
git add .
git commit -m "release: prepare v1.0.0"
git push origin main

git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

当前工作流发布的是 Debug APK，适合测试和直接分享。项目尚未配置 Release keystore，正式发布前需要增加签名证书、Gradle signingConfig 和 GitHub Actions Secrets。

## 文档

- [用户使用指南](docs/USER_GUIDE.md)
- [用户使用手册 PDF](docs/motion-photo-converter-user-guide.pdf)
- [首页设计参考](docs/design/home-style-references.html)

## 兼容性与限制

- 不同 Android System WebView、视频编码器和三星相册对 Motion Photo 的兼容性可能不同。
- 精确裁剪会在本机重新编码视频，处理时间和输出文件大小可能增加。
- 部分 HEIC、MOV 或视频编码格式可能无法在目标设备上解码或播放。
- 需要在实际目标三星机型上验证导入、保存和相册播放效果。

## 开发约定

- Web 功能修改放在 `web/src/`，不要直接修改 `app/src/main/assets/` 中的编译产物。
- 提交 Web 修改前运行 `npm.cmd test` 和 `npm.cmd run build`。
- 提交 Android 构建相关修改前运行 `npm.cmd run build:android` 和 `:app:assembleDebug`。
- 不要提交 `web/node_modules/`、`web/dist/`、Gradle 构建目录、`tmp/` 和 `output/` 临时产物。
