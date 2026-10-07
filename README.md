# 本地文件转换工具

纯静态网站，文件在浏览器内转换，无后端、无文件上传。界面样式本地提供；Office、PDF 和音视频引擎按需从 CDN 加载，需要联网。当前没有 PWA 或完整离线支持。

## 支持范围

| 功能 | 输入 | 输出与限制 |
| --- | --- | --- |
| 图片 | 浏览器可解码的图片 | JPG、PNG、WebP；JPG 使用白色背景；动画只取首帧 |
| 视频 | FFmpeg 可解码的视频 | MP4 / WebM、提取 MP3、前 10 秒 GIF |
| 音频 | FFmpeg 可解码的音频 | MP3、WAV、FLAC、M4A |
| Excel | XLSX | 首个工作表转 JSON、CSV、TXT、HTML、PDF |
| 文档 | DOCX、Markdown、TXT | TXT、HTML、PDF；不生成 Word 文件 |
| PDF | 单个 PDF | 文本提取、各页 PNG 打包 ZIP（最多 50 页） |
| 图片合并 | 多张浏览器可解码的图片 | 按选择顺序合并为 A4 PDF |

单个图片/文档/PDF 最多 30 MB，音视频最多 200 MB，总选择大小最多 200 MB；图片最多 4000 万像素。转换后的大小与速度取决于浏览器和设备。

文档 PDF 使用图片分页以显示中文，文字不可搜索或复制；复杂 Office 排版不保证还原，分页可能切断行。超长文档建议导出 HTML 后使用浏览器打印为 PDF。扫描版 PDF 提取文字不包含 OCR。输入损坏、加密或编码不支持时会显示错误。

## 本地运行

在项目目录执行：

```sh
python -m http.server 8080
```

访问 `http://localhost:8080`，推荐 Chrome / Edge。不要直接通过 `file://` 打开：FFmpeg Worker 需要 HTTP(S) 同源脚本。

## 部署

将整个目录（包含 `vendor/ffmpeg`）上传到 GitHub Pages、Cloudflare Pages 或其他静态托管平台，无构建步骤。FFmpeg 使用单线程核心，不要求 COOP/COEP 响应头。首次转换需下载约 30 MB 核心。

### Cloudflare Pages 连接 GitHub

选择仓库 `wqnmlgb151/Online-conversion`，填写以下设置：

| 设置 | 值 |
| --- | --- |
| 生产分支 | `main` |
| 框架预设 | `None` |
| 构建命令 | `exit 0` |
| 构建输出目录 | `.` |
| 根目录 | 留空（仓库根目录） |

无需环境变量或服务端。部署后检查图片转换、文档转换以及音视频引擎加载；CDN 无法访问时，对应功能会提示错误。关联 GitHub 后，推送到生产分支会触发自动部署。

参考：[Cloudflare 静态 HTML 部署文档](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)。

`vendor/ffmpeg` 中的两个脚本来自 `@ffmpeg/ffmpeg@0.12.10`，必须保留在同一目录。包装库采用 MIT 许可证，见随附 LICENSE；FFmpeg 核心及编解码器有各自的许可证，发行时需自行核对。

## 验证

```sh
node --check app.js
node --test tests/app.test.cjs
```

自动测试覆盖文件校验、HTML 转义、下载命名和 FFmpeg 失败清理。CDN 可用性和实际编解码需在浏览器中验证。
