# 自动部署排查记录

> 历史验收／排查记录，结论仅代表文中日期与版本。当前状态见[发展规划](../ROADMAP.md)，临时产物的保留与重建见[维护说明](../MAINTENANCE.md)。

日期：2026-10-10（Asia/Shanghai）。只读排查，未改变仓库、Actions 或 Cloudflare 配置。

## gh CLI 已确认的事实

- 当前登录账户为 `wqnmlgb151`，凭据可读取账户自身信息，并拥有 `wqnmlgb151/Online-conversion` 的管理员权限。
- 仓库元数据：`public`、未归档、`disabled: false`，默认分支 `main`，地址未变。
- 远程 `main` 为 `56f5a2c9e2a960b271b3c37234182bf37738086d`。
- Actions 已启用，允许所有 Actions；工作流 `Verify static converter`（ID `377443296`）状态为 `active`。
- `a0fe879` 的 GitHub Actions 检查组 `103018253278`：2026-10-10 03:18:55 UTC 创建，03:18:59 UTC 标记 `completed / failure`。
- 该组中的 `verify` 检查及作业 `114119055268` 仍为 `queued`，`steps: []`，没有运行器，没有失败步骤日志或 annotations。
- 运行 `38020120972` 的 API 返回 404；仓库及工作流运行列表均返回零条。这与仍可读取的作业记录不一致。
- `56f5a2c` 已创建 Cloudflare 检查组 `103021475660`（03:39:51 UTC，`queued`），说明后续提交的推送事件已被 Cloudflare 集成接收。
- `gh api user` 能读取自身账户；`gh api users/wqnmlgb151` 返回 404，`gh api search/users -f q=wqnmlgb151 -X GET` 返回零结果。
- `gh api user/repos` 和公开仓库列表接口仍可在当前认证下返回仓库；不能据此认定所有 GitHub 接口均失效。
- 仓库 Webhook 列表为空。GitHub App 有独立的事件机制，空列表不能证明 Cloudflare 未安装。

## 其他证据

用户提供的 Cloudflare 构建日志（03:39:53 UTC）在克隆仓库时报告 `Repository not found`，随后失败；尚未执行构建命令。

此前不带登录凭据的 HTTP 检查：账户主页及仓库网页返回 404，仓库 Git 协议入口返回 401；同样请求 `microsoft/playwright` 的 Git 入口返回 200。匿名 GitHub REST 请求曾命中 IP 速率限制，该 403 不作为账户限制的证据。

Cloudflare 配置截图显示 `npm run build`、输出目录 `dist`、根目录留空、生产分支 `main`、自动部署启用。用户确认 GitHub App 已允许所有仓库。

## 判断与限制

已确认 GitHub 账户公开资料访问异常，以及 Actions 总体结果与作业状态不一致。高度怀疑账户或平台访问状态异常；gh CLI 没有提供账户限制的明确原因，因此不能直接认定账户被封禁。

Cloudflare 已接收后续推送事件，但克隆阶段无法访问仓库。此次失败发生在代码构建之前，不应通过改构建命令或回滚离线功能来处理。

没有修改授权、卸载集成、取消运行、重跑任务或继续推送。下一步应让 GitHub 支持核查公开可见性与 Actions 状态；恢复仓库访问后再重试 Cloudflare 部署。

## 可复查的 CLI 命令

```powershell
gh api user --jq '{login,type,public_repos}'
gh api users/wqnmlgb151 --jq '{login,type,public_repos}'
gh api search/users -f q=wqnmlgb151 -X GET --jq '{total_count}'
gh api repos/wqnmlgb151/Online-conversion/actions/permissions
gh api repos/wqnmlgb151/Online-conversion/actions/workflows
gh api repos/wqnmlgb151/Online-conversion/actions/runs
gh api repos/wqnmlgb151/Online-conversion/actions/jobs/114119055268
gh api repos/wqnmlgb151/Online-conversion/check-suites/103018253278
gh api repos/wqnmlgb151/Online-conversion/check-suites/103018253278/check-runs
gh api repos/wqnmlgb151/Online-conversion/commits/56f5a2c/check-suites
```

## GitHub 支持工单草稿（尚未发送）

Subject: Public profile/repository access and Actions status inconsistency

My account is wqnmlgb151. I can authenticate with gh CLI and administer my public repository wqnmlgb151/Online-conversion. However, my profile and repository pages return 404 without authentication, and the repository's Git endpoint returns 401. Even with my authenticated CLI, GET /users/wqnmlgb151 returns 404 while GET /user succeeds.

Actions check suite 103018253278 reports failure, but job 114119055268 remains queued with no steps or runner. Run 38020120972 returns 404 via the API, and the runs list is empty. Cloudflare received later push events but cannot clone the repository, reporting "Repository not found" at 2026-10-10 03:39:53 UTC.

Please investigate whether my account has any visibility or service restrictions, and clarify the inconsistent Actions state. I have not seen any restriction notice.
