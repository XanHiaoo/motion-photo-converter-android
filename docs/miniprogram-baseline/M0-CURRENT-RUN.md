# M0 当前运行基准

采集日期：2026-09-23。所有界面截图来自本仓库 `app/build/outputs/apk/debug/app-debug.apk` 在 Android API 36 模拟器中的实际运行画面，设备分辨率为 1080 × 2400、密度 420 dpi、字体缩放 1.0。截图没有使用 `docs/images/` 中的旧版图。

## 本轮覆盖

| 画面 | 截图 | 状态 |
| --- | --- | --- |
| 首页 | [home](m0-current-run/home-1080x2400.png) | 三个入口和本机处理提示 |
| 视频生成 | [video empty](m0-current-run/video-empty-1080x2400.png) | 初始空态、禁用生成按钮 |
| 视频生成 | [video selected](m0-current-run/video-selected-1080x2400.png) | 选择现有 MP4 后的媒体、预览、时间轴 |
| 视频生成 | [video working](m0-current-run/video-working-1080x2400.png) | 触发生成后的处理中状态 |
| 视频生成 | [video after generate](m0-current-run/video-after-generate-1080x2400.png) | 处理操作后回到编辑画面的截图；没有确认输出文件 |
| 视频生成 | [video editor lower section](m0-current-run/video-result-bottom-1080x2400.png) | 编辑器时间轴、渐变和裁剪方式下半部 |
| 批量转换 | [batch](m0-current-run/batch-empty-1080x2400.png) | 未导入文件的初始页和转换选项 |
| 照片 + 视频 | [manual](m0-current-run/manual-empty-1080x2400.png) | 照片、视频两个空选择区 |
| 系统视频选择器 | [Android picker](m0-current-run/android-video-picker.png) | 记录系统/应用选择器外观，不作为小程序 UI 基准 |

## 后续仍需采集

本轮 M1 只实现首页和视频页空态。批量与照片加视频的已选、处理中、成功和错误状态，视频生成的真实成功/错误状态，以及更窄/更宽屏幕与 iPhone 微信安全区，都留待对应功能开发和真机阶段采集。当前运行基准截图不代表已验证 Motion Photo 输出兼容性。

首页最终样式以 `web/src/App.tsx` 中 `Home` 结构及 `web/src/styles.css` 文件末尾的 `home-layout-d` 规则为准。视频空态以 `VideoOnlyMode` 当前结构及样式最终覆盖规则为准。

## 首页与视频空态样式清单

下表记录当前生效的关键值，来源为 JSX 结构、最终 CSS 覆盖规则和上方运行截图。小程序以 411.4 CSS px 的 Android 参考宽度换算 `rpx`，因此初始目标设备可直接按截图布局对照。

| 项目 | 当前 App 生效值 |
| --- | --- |
| 首页背景 / 视频页背景 | `#f3f5f8` / `#f7f8fa` |
| 主要文字 / 次要文字 | `#182b45` / `#6b7688` |
| 主卡片 | `#4e7fcf`，圆角 17 px，高 142 px |
| 两张次级卡片 | 白色，圆角 17 px，高 126 px，间距 10 px |
| 页面左右留白 | 22 px；内容最大宽度 430 px |
| 首页品牌图标 / 品牌字 | 40 px / 18 px |
| 首页标题 / 副标题 | 31 px / 12 px |
| 视频页顶部返回按钮 / 标题 | 38 px / 14 px |
| 视频页隐私提示 | 图标 16 px，文字 10 px，顶部间距 16 px |
| 空视频选择区 | 顶部间距 22 px，高 178 px，圆角 22 px，虚线 `#cbd9eb` |
| 底部生成按钮 | 高 54 px，圆角 15 px，水平留白 20 px；空态禁用并半透明 |

CSS 文件含多个设计方案和后续覆盖组。上表及小程序实现只按最终生效的 Scheme C / `home-layout-d` 规则取值，没有使用文件开头的旧变量作为页面基准。
