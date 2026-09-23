# 微信小程序

## 在微信开发者工具中打开

1. 导入本仓库根目录（此处有 `project.config.json`）。
2. 项目会从 `miniprogram/` 读取小程序代码；`appid` 使用开发者工具的测试号。
3. 编译后首页可进入视频生成页，返回按钮回到首页。

## 当前实现

已完成 M0/M1 界面基线、首页和视频页空态，以及 M2 的视频导入、画面预览、封面时刻选择和 JPEG 临时文件导出代码。开发者工具已验证导入、元信息读取和预览；逐帧解码时提示需使用真机，因此 M2 尚未验收，也未在 Android/iOS 微信真机验证。当前不会生成或保存 Samsung Motion Photo。

开发记录和真机验证步骤见 [M2 实现记录](../docs/miniprogram-baseline/M2-IMPLEMENTATION.md)。视频封面使用 `VideoDecoder` 和 2D Canvas；初始样本目标为微信可解码的 H.264 MP4。片段裁剪、缩略图时间轴、渐变留在 M4，Motion Photo 封装和相册保存留在 M3。
