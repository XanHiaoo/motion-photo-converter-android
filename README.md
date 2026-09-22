# Motion Photo Converter · Android

这是网页工具的独立 Android 工程。界面、动态图解析和三星格式封装来自 `web/`；Android 壳使用系统 WebView 离线加载打包资源，调用系统文件选择器，并把生成结果保存到 `Pictures/Motion Photo Converter/`，不需要照片存储权限。

## 功能

- 批量导入单文件动态图并逐个转换。
- 只导入视频，可选择起止时间截取片段；默认用片段第一帧作封面，也可拖动时间轴选帧。默认快速裁剪会直接复制原视频和声音，起点可能提前到附近关键帧；需要更准确的边界可选择精确裁剪，在本机重新编码为 H.264 MP4。完整视频不裁剪时沿用直接封装路径。
- 手动导入照片和视频生成动态图。
- JPEG/HEIC 处理和 MOV 无损转封装组件均打包在 APK 内；转换过程无需联网。

## 构建

需要 Node.js 22、JDK 17、Android SDK Platform 35 与 Build Tools 35.0.0。在 PowerShell 或 VS Code 终端中执行：

```powershell
.\build-debug.cmd
```

脚本会执行网页测试、重新构建 Android 网页资源，然后使用 Gradle 构建调试版 APK。输出位置为 `app/build/outputs/apk/debug/app-debug.apk`。本机下载的便携工具链若位于相邻的 `E:\code\andriod\.build-tools`，脚本会自动发现，不会修改全局环境变量；在其他机器上则使用项目自带的 Gradle Wrapper。若工具链位于其他位置，请先设置 `JAVA_HOME` 和 `ANDROID_HOME`。

也可以分步运行：

```powershell
cd web
npm.cmd ci
npm.cmd run build:android
cd ..
.\gradlew.bat assembleDebug
```

`web/` 是可独立维护的源码副本。网页改动后须重新运行 `build:android`，它会把产物写入 `app/src/main/assets/`，再构建 APK。不要直接编辑编译后的 `assets/` 文件。

## GitHub Pages 预览

仓库已配置 GitHub Actions 自动部署网页预览。每次推送到 `main` 后，Actions 会安装 `web/` 依赖、运行 `npm run build`，并将 `web/dist/` 发布到 GitHub Pages。

首次使用时，在 GitHub 仓库中打开 `Settings` → `Pages`，将 `Build and deployment` 的 `Source` 设置为 `GitHub Actions`。之后可在 Actions 页面手动运行 `Deploy web preview to GitHub Pages`，或直接推送代码触发部署。

预览地址：`https://xanhiaoo.github.io/motion-photo-converter-android/`

## 使用与限制

最低支持 Android 10（API 29）。导入文件由系统文件选择器授权；保存结果通过 MediaStore 进入相册目录。需要较新的 Android System WebView 来运行 Web Worker、WebAssembly 及本地视频画面提取。部分视频编码仍可能无法由设备解码或被三星相册播放；最终兼容性请在目标三星机型上验证。

本工程使用 [Android WebViewAssetLoader](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content) 加载 APK 内资源，避免 `file://` 的同源限制。Android Gradle Plugin 版本与构建要求见[官方发行说明](https://developer.android.com/build/releases/agp-8-13-0-release-notes)。
