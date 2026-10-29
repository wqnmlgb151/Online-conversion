# 项目维护

## 目录与文件职责

| 路径 | 用途 |
| --- | --- |
| 根目录的 HTML、CSS、JS、图标与 manifest | 静态应用源码 |
| `vendor/` | 固定版本依赖、许可证及校验清单，构建必需 |
| `examples/` | 随网站发布的公开合成示例 |
| `scripts/` | 构建、发布检查、本地服务器和测试资源生成 |
| `tests/` | 单元、Chrome 回归及真实线上验收 |
| `.github/workflows/` | GitHub Actions 验证配置 |
| `docs/ROADMAP.md` | 当前验收与发布状态、下一步 |
| `docs/history/` | 历史阶段验收、线上记录与未解决部署排查证据 |
| `docs/images/` | 文档实际引用的长期预览图 |
| `dist/` | 自动生成的正式静态发布目录，不提交 |
| `node_modules/` | 开发测试依赖，由 `npm ci` 安装，不发布 |
| `.test-cache/` | FFmpeg 校验缓存与合成视频输入，不提交、不发布 |
| `test-results/`、`playwright-report/` | 可重新生成的截图、trace 与测试报告 |
| `.playwright-mcp/` | 浏览器自动化产生的临时日志与快照 |

只部署 `dist`。构建有明确文件清单，不会复制开发依赖、文档、测试缓存、报告或用户文件。

## 常用命令

在项目根目录使用 Node.js 24 与已安装的 Chrome：

```sh
npm ci
npm run check
npm test
npm run build
node scripts/cache-core.cjs
npm run test:e2e
```

`npm run test:e2e` 会重新构建并生成 `.test-cache/video.webm`，随后执行 Chrome 回归。FFmpeg 缓存由 `scripts/cache-core.cjs` 校验；缓存缺失时需联网重新下载。

专项验证：

```sh
npm run build
node node_modules/@playwright/test/cli.js test tests/e2e/theme.spec.cjs --output=test-results/theme --reporter=list
npm run test:pressure
npm run test:offline-live
```

主题专项只使用合成文件和本站资源。线上专项访问实际部署地址，真实 CDN 可达性需独立验证。

## 产物清理规则

停止相关测试和本地服务器后，可删除 `test-results/`、`playwright-report/`、`.playwright-mcp/` 与不用的临时浏览器配置目录。历史测试结论保留在 `docs/history/`；这些目录不作为唯一验收依据，也不长期保留旧失败报告。

`dist/` 可以移除后执行 `npm run build` 重建。构建检查会拒绝多余发布文件；不要手工向发布目录添加测试文件。

日常清理保留 `.test-cache/ffmpeg-core.js`、`.test-cache/ffmpeg-core.wasm` 和 `.test-cache/video.webm`，避免重新下载核心。需要彻底清空缓存时，再运行 `node scripts/cache-core.cjs` 与 `node scripts/generate-media.cjs` 恢复。正式测试截图使用 Playwright 的输出目录，不写入核心缓存。

一次性探测脚本、旧 JSON 报告与旧样本在对应结论记录后删除；可复用验证应进入 `tests/` 或正式脚本。仍未解决的问题，其诊断记录应归档保留。

## 2026-10-12 整理记录

- 阶段 1–5 和历史线上验收集中到 `docs/history/`，更新所有文档入口。
- 保留 2026-10-10 的部署诊断，账户限制未获明确确认，恢复部署状态尚待复查。
- 保留实际引用的预览图，将主题截图移入 `docs/images/`。
- 清理 19 个目标、317 个旧文件（约 27.6 MiB），包括旧测试报告、浏览器日志、临时 PWA 配置、旧样本及一次性探测脚本；随后重新生成有效的 `dist`，不是释放同等大小的最终磁盘空间。
- 批量布局测试截图改用测试输出目录，避免再次产生阶段名称的核心缓存文件。
- 主题阶段已有 29 项单元与 77 项 Chrome 回归通过。本轮仅调整目录、文档与截图输出路径，针对相关用例复验，不将历史全量结果冒充本轮重新运行。
- 本轮验证通过：10 份 Markdown 的 39 个本地链接有效；34 个发布文件构建与校验通过；两份 FFmpeg 核心缓存 SHA-256 通过；修改截图路径的 Chrome 布局用例通过，截图只写入 `test-results/local`。未自动提交或推送。


## 2026-10-29 整理记录

- 体验改进已提交并推送为 `6bec06e`；本轮 29 项单元、81 项 Chrome 回归和 34 个发布文件校验通过。实际命令及本机包装调用限制见 [阶段 6 记录](history/STAGE-6.md)。
- 推送后清理 `test-results/`、`playwright-report/`、`.playwright-mcp/`，共 16 个文件、1,574,295 字节（约 1.50 MiB）。清理前验证绝对路径位于本项目内且不包含重解析点。
- 保留有效 `dist/`、三份 FFmpeg 核心／合成媒体缓存、开发依赖，以及 README 和阶段记录引用的预览图。没有清理源码、历史诊断或用户文件。
- 更新 README、当前规划、阶段记录和维护说明。清理后工作区无未提交变更；本记录以单独文档提交保存。未把 GitHub 推送结果视为生产部署验收。
