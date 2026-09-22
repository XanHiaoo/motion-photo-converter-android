# 开发指南

本文档面向项目开发者，说明本地环境、项目结构、Web 开发和 Android 构建流程。

## 环境要求

- Node.js `>= 22.13.0`
- JDK 17
- Android SDK Platform 35
- Android SDK Build Tools 36.0.0
- Gradle Wrapper 8.13（项目已提供）

Android 模块最低支持 Android 10（API 29），`compileSdk` 为 36，`targetSdk` 为 35。

Windows 需要配置：

```text
JAVA_HOME
ANDROID_HOME
```

Linux/macOS 首次使用 Gradle Wrapper 时执行：

```bash
chmod +x gradlew
```

## 项目结构

```text
web/src/                       React 界面和媒体处理逻辑
web/tests/                     Web 测试
app/src/main/java/             Android WebView 壳和原生桥接
app/src/main/assets/           Android 使用的 Web 构建产物
.vscode/                       VS Code 任务和调试配置
.github/workflows/             Pages 部署和 APK 发布工作流
```

Web 页面通过 `npm run build:android` 构建到 `app/src/main/assets/`，Android 的 `MainActivity` 使用 WebView 加载这些本地资源。不要直接编辑 `app/src/main/assets/`。

## Web 开发

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

访问：<http://127.0.0.1:5173/samsung-motion-photo-converter/>。

常用命令：

```text
npm test                 运行测试
npm run build            构建 Web 生产文件
npm run build:android    生成 Android Web 资源
npm run preview          预览 Web 生产文件
```

Windows 终端将上面的 `npm` 替换为 `npm.cmd`。

## VS Code 任务

通过 `Tasks: Run Task` 可使用：

- `web:install-deps`：安装 Web 依赖。
- `web:dev`：启动 Web 开发服务器。
- `web:test`：运行 Web 测试。
- `web:build`：构建 Web 生产文件。
- `web:build-android-assets`：生成 Android Web 资源。
- `web:preview`：构建并预览 Web 生产文件。
- `android:build-debug`：生成 Web 资源并构建 Debug APK。
- `android:build-release`：生成 Web 资源并构建 Release APK。

Run and Debug 中的 Chrome 配置会自动调用 `web:dev`，用于调试 Web 页面，不启动 Android 模拟器。

## Android Debug APK

Debug APK 用于本地测试，不需要 Release keystore。

Windows PowerShell：

```powershell
cd web
npm.cmd ci
npm.cmd test
npm.cmd run build:android
cd ..
.\gradlew.bat :app:assembleDebug --no-daemon
```

Linux/macOS：

```bash
cd web
npm ci
npm test
npm run build:android
cd ..
./gradlew :app:assembleDebug --no-daemon
```

输出：

```text
app/build/outputs/apk/debug/app-debug.apk
```

## Android Release APK

Release APK 需要签名配置。具体 keystore、环境变量和 GitHub 发布流程见：[发布指南](RELEASE.md)。

Windows PowerShell：

```powershell
cd web
npm.cmd ci
npm.cmd test
npm.cmd run build:android
cd ..
.\gradlew.bat :app:assembleRelease --no-daemon
```

Linux/macOS：

```bash
cd web
npm ci
npm test
npm run build:android
cd ..
./gradlew :app:assembleRelease --no-daemon
```

输出：

```text
app/build/outputs/apk/release/app-release.apk
```

本地 `assembleRelease` 只生成 APK，不会自动创建 GitHub Release。

## 开发检查

提交 Web 修改前建议执行：

```text
npm test
npm run build
```

提交 Android 相关修改前建议执行：

```text
npm run build:android
./gradlew :app:assembleDebug --no-daemon
```

Windows 使用 `npm.cmd` 和 `gradlew.bat`。
