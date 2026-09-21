$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$toolRoot = Join-Path (Split-Path -Parent $projectRoot) '.build-tools'

if (-not $env:JAVA_HOME) {
    $portableJdk = Join-Path $toolRoot 'jdk17\jdk-17.0.20.1+1'
    if (Test-Path -LiteralPath $portableJdk) { $env:JAVA_HOME = $portableJdk }
}
if (-not $env:ANDROID_HOME) {
    $portableSdk = Join-Path $toolRoot 'android-sdk'
    if (Test-Path -LiteralPath $portableSdk) { $env:ANDROID_HOME = $portableSdk }
}

if (-not $env:JAVA_HOME -or -not $env:ANDROID_HOME) {
    throw '需要 JDK 17 和 Android SDK。请设置 JAVA_HOME 与 ANDROID_HOME。'
}

Push-Location (Join-Path $projectRoot 'web')
try {
    if (-not (Test-Path -LiteralPath 'node_modules')) {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci 失败' }
    }
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw '网页测试失败' }
    & npm.cmd run build:android
    if ($LASTEXITCODE -ne 0) { throw '网页资源构建失败' }
} finally {
    Pop-Location
}

Push-Location $projectRoot
try {
    & .\gradlew.bat assembleDebug
    if ($LASTEXITCODE -ne 0) { throw 'Android APK 构建失败' }
    Write-Output (Join-Path $projectRoot 'app\build\outputs\apk\debug\app-debug.apk')
} finally {
    Pop-Location
}

