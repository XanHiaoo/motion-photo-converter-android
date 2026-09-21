@echo off
setlocal
set "PROJECT=%~dp0"

if not defined JAVA_HOME if exist "%PROJECT%..\.build-tools\jdk17\jdk-17.0.20.1+1\bin\java.exe" set "JAVA_HOME=%PROJECT%..\.build-tools\jdk17\jdk-17.0.20.1+1"
if not defined ANDROID_HOME if exist "%PROJECT%..\.build-tools\android-sdk\platforms\android-35\android.jar" set "ANDROID_HOME=%PROJECT%..\.build-tools\android-sdk"

if not defined JAVA_HOME (
  echo JDK 17 not found. Set JAVA_HOME first.
  exit /b 1
)
if not defined ANDROID_HOME (
  echo Android SDK not found. Set ANDROID_HOME first.
  exit /b 1
)

cd /d "%PROJECT%web"
if not exist "node_modules" (
  call npm.cmd ci
  if errorlevel 1 exit /b 1
)
call npm.cmd test
if errorlevel 1 exit /b 1
call npm.cmd run build:android
if errorlevel 1 exit /b 1

cd /d "%PROJECT%"
if exist "%PROJECT%..\.build-tools\gradle\gradle-8.13\bin\gradle.bat" (
  call "%PROJECT%..\.build-tools\gradle\gradle-8.13\bin\gradle.bat" assembleDebug
) else (
  call gradlew.bat assembleDebug
)
if errorlevel 1 exit /b 1
echo APK: %PROJECT%app\build\outputs\apk\debug\app-debug.apk
exit /b 0
