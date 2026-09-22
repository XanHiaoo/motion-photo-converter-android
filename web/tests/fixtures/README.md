# 测试素材

运行 `npm run fixtures:download` 下载本地集成测试素材：

- `samsung_motion_photo.heic`：来自 `g0ddest/sm_motion_photo` 的 Samsung Galaxy S22 Ultra 测试文件。
- `apple_live_photo.jpg` 与 `apple_live_photo.mov`：来自 `LimitPoint/LivePhoto` 的公开示例素材；MOV 含 Apple QuickTime content identifier，示例 JPG 本身不含对应 MakerNote，因此本项目以同名规则完成这组素材的配对。

这些公开测试素材不随仓库提交。运行上面的命令后，脚本会下载素材并生成含来源、大小和 SHA-256 的 `provenance.json`，便于确认测试输入。自动化单元测试使用仓库内合成的小型二进制数据，不依赖外部下载。
