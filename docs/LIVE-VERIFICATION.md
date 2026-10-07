# Cloudflare Pages 线上验收

日期：2026-10-07（Asia/Shanghai）。地址：https://online-conversion.pages.dev/。

## 发布与 GitHub 展示

- 第二阶段已推送至 `main`，提交 `c217659`，GitHub Actions 验证成功，Cloudflare 线上页面已出现批量图片与统一结果区。
- 线上修复已推送，提交 `228789f`，Cloudflare Pages 与 GitHub Actions 的 `verify` 检查均成功；已重新打开线上页面确认修复版本生效。
- README 提供直接访问入口、快速使用说明、隐私说明入口及真实 GitHub Actions 状态标识。
- 使用 gh CLI 更新 About 描述、网站地址及 9 个项目标签，方便发现项目的处理范围和部署方式。
- README 界面截图取自修复后的真实线上页面，使用合成演示图片；截图文件为 `docs/images/preview.png`。

## 线上发现与修复

- PNG 输出不使用有损质量设置，但清空质量框后实际线上转换报错。PNG 改为跳过该项校验，并禁用不适用的质量框；处理完成及切换功能后保持正确状态。
- 线上多个格式控件的 `labels` 数量为 0。补齐文件、格式、质量与 PDF 操作的标签关联；标签页增加选中状态、面板关联和方向键 / Home / End 操作。
- 增加页面级文件拖拽导航保护，文件落在选择区域外时提示正确位置，并保留当前结果。
- 增加页面描述和站点图标，并将图标加入静态构建文件清单。

## 验收方法

新增 `playwright.live.config.cjs` 与 `npm run test:live`。测试直接访问部署地址，没有本地静态服务器。

批量处理用例检查 PNG / WebP 尺寸、损坏文件隔离、结果保留、同名 ZIP 解包、PDF 选页、实际合并页颜色、拖拽和桌面 / 手机视口，以及新增的 PNG 校验、表单标签、键盘导航和误拖拽保护。

线上专门用例检查 JPG / PNG / WebP、Excel 五种输出、DOCX / Markdown / TXT 三种输出、PDF 渲染与失败恢复、内容清理，以及 MP3 / WAV / FLAC / M4A 和 MP4 / WebM / MP3 / GIF 的真实输出。

音视频测试直接从 jsDelivr 下载 FFmpeg 核心，检查 JS / WASM 响应与实际输出解码。没有用本地缓存替代 CDN 响应；本地缓存只用于生成一秒合成视频输入。依赖失败恢复用例故意中断一次 Excel 脚本请求后恢复正常网络。

## 验证状态

| 检查 | 结果 |
| --- | --- |
| JavaScript 语法检查 | 通过 |
| 单元测试 | 18 / 18 通过 |
| 本地 Chrome 完整回归 | 49 / 49 通过，针对正式 dist |
| 修复部署后的线上 Chrome 验收 | 15 / 15 通过，直接访问 Cloudflare 地址 |
| 真实 CDN 音视频验收 | JS / WASM 下载成功，8 种公开输出格式生成成功 |
| 静态构建 | 20 个依赖文件校验通过，生成 28 个发布文件，包含 favicon |
| GitHub 与 Cloudflare 检查 | 228789f 的 verify 和 Cloudflare Pages 均成功 |
| Git diff 格式检查 | 通过 |

线上输出已重新解码图片、音频和视频，并解析 PDF、ZIP 或文本内容；GIF 检查文件头与尺寸。批量用例在 1280 与 390 像素视口检查页面没有横向溢出。PNG 的无关质量字段不再阻止转换；表单标签、键盘导航与误拖拽保护均通过线上用例。

GitHub Actions：[修复提交的验证记录](https://github.com/wqnmlgb151/Online-conversion/actions/runs/37635099581)。线上用例报告输出到忽略的 `.test-cache/live-results.json`、`playwright-report/live` 和 `test-results/live`，不提交测试缓存。

## 证据范围

使用 Windows Chrome 和合成样本。图片样本很小、音视频只有一秒，不能代表所有格式、超大文件、复杂 Office 排版或其他地区的 CDN 连通性。移动布局检查为桌面 Chrome 调整视口。所有输入通过浏览器选择后在本地处理，不上传文件；结果刷新后不恢复。
