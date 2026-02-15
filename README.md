# 纯前端全格式文件转换工具
纯前端、零后端、全本地处理的文件格式转换网站，所有文件仅在用户浏览器内处理，不上传任何服务器，极致保护隐私。

## 功能特性
- 🖼️ 图片转换：支持 JPG/PNG/WebP/AVIF/GIF 互转，自定义压缩质量
- 🎥 视频转换：基于FFmpeg WASM，支持 MP4/MOV/MKV/WebM/AVI 互转，提取音频、转GIF
- 📄 文档转换：支持 Excel/Word/Markdown/TXT 互转，导出PDF
- 📑 PDF处理：支持 PDF转图片、PDF转文本、图片合并为PDF
- 🔒 极致隐私：所有文件仅在本地处理，绝不会上传到服务器
- 🌐 离线可用：支持PWA，可离线使用
- 🚀 零成本：纯静态网站，可免费部署到Cloudflare Pages、GitHub Pages等平台

## 本地运行
1. 下载所有文件到本地文件夹
2. 不要直接双击打开`index.html`（file协议会有跨域限制）
3. 推荐使用以下方式运行：
   - VS Code安装Live Server插件，右键`index.html`选择「Open with Live Server」
   - Python环境：在文件夹内执行 `python -m http.server 8080`，然后浏览器访问 `http://localhost:8080`
4. 推荐使用Chrome/Edge最新浏览器获得最佳体验

## 部署方法
详细部署教程见项目文档，支持一键部署到Cloudflare Pages，完全免费。

## 开源协议
基于MIT协议开源，个人非商用完全免费，商用请遵守相关开源协议和专利规则。