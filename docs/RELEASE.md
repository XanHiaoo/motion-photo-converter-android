# 发布指南

本文档说明 Release APK 的签名配置和 GitHub Actions 自动发布流程。

## 本地 Release 签名

Release 构建需要一个本地 keystore。建议将签名文件放在仓库目录之外，例如：

```text
<signing-dir>/release-key.jks
<signing-dir>/keystore.properties
```

签名文件不应提交到仓库。keystore 应妥善备份；如果丢失，后续版本将无法使用同一个签名身份更新。Gradle 通过 `ANDROID_KEYSTORE_PROPERTIES` 读取仓库外的配置文件。

### 创建 keystore

在项目根目录执行。以下命令会在项目同级目录创建签名文件夹：

```powershell
New-Item -ItemType Directory -Force (Join-Path (Split-Path $PWD -Parent) 'motion-photo-tool-signing') | Out-Null
keytool -genkeypair -v `
  -keystore (Join-Path (Split-Path $PWD -Parent) 'motion-photo-tool-signing\release-key.jks') `
  -alias motion-photo-release `
  -keyalg RSA `
  -keysize 2048 `
  -validity 10000
```

Linux/macOS 使用以下命令：

```bash
signing_dir="../motion-photo-tool-signing"
mkdir -p "$signing_dir"
keytool -genkeypair -v \
  -keystore "$signing_dir/release-key.jks" \
  -alias motion-photo-release \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
export ANDROID_KEYSTORE_PROPERTIES="$signing_dir/keystore.properties"
```

### 配置 keystore.properties

在 `<signing-dir>` 中创建 `keystore.properties`：

```properties
storeFile=release-key.jks
storePassword=你的-keystore-密码
keyAlias=motion-photo-release
keyPassword=你的-key-密码
```

构建前设置配置文件路径：

```powershell
$env:ANDROID_KEYSTORE_PROPERTIES = Join-Path (Split-Path $PWD -Parent) 'motion-photo-tool-signing\keystore.properties'
```

不要将真实密码写入 README、工作流或 Git 提交记录。

### 本地构建

先生成 Android Web 资源，再执行 Release 构建：

```text
npm run build:android
./gradlew :app:assembleRelease --no-daemon
```

Windows 使用 `npm.cmd` 和 `gradlew.bat`。

APK 输出：

```text
app/build/outputs/apk/release/app-release.apk
```

也可以在 VS Code 执行：

```text
Tasks: Run Task → android:build-release
```

## 使用环境变量签名

Gradle 也支持以下环境变量：

```text
ANDROID_RELEASE_KEYSTORE
ANDROID_RELEASE_KEYSTORE_PASSWORD
ANDROID_RELEASE_KEY_ALIAS
ANDROID_RELEASE_KEY_PASSWORD
```

使用环境变量时，不需要提交 `keystore.properties`。本地构建和 GitHub Actions 都可以采用这种方式。

## GitHub Actions Secrets

工作流文件：

```text
.github/workflows/release-apk.yml
```

在 GitHub 仓库的 `Settings` → `Secrets and variables` → `Actions` 中配置：

| Secret | 内容 |
| --- | --- |
| `ANDROID_RELEASE_KEYSTORE_BASE64` | 本地 `release-key.jks` 的 Base64 内容 |
| `ANDROID_RELEASE_KEYSTORE_PASSWORD` | keystore 密码 |
| `ANDROID_RELEASE_KEY_ALIAS` | `motion-photo-release` |
| `ANDROID_RELEASE_KEY_PASSWORD` | key 密码 |

Windows PowerShell 生成 Base64：

```powershell
$base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path (Split-Path $PWD -Parent) 'motion-photo-tool-signing\release-key.jks')))
Set-Clipboard $base64
```

Linux/macOS：

```bash
base64 <signing-dir>/release-key.jks | tr -d '\\n'
```

不要将 Base64 内容提交到仓库；它只是编码，不是加密。

## Tag 发布

先将代码推送到 `main`，然后创建并推送版本 tag：

```bash
git add .
git commit -m "release: prepare v1.0.1"
git push origin main

git tag -a v1.0.1 -m "Release v1.0.1"
git push origin v1.0.1
```

匹配 `v*.*.*` 的 tag 会触发 Release 工作流。工作流将：

1. 构建 Android Web 资源。
2. 使用 GitHub Secrets 解码 keystore。
3. 执行 `assembleRelease`。
4. 生成并上传 `MotionPhotoTool-v1.0.1.apk`。

普通推送到 `main` 只会触发 GitHub Pages 部署，不会创建 APK Release。
