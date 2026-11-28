# OpenManus Gateway — 代码自动化验收规程

> 本文件是代码工作台验收索引，区分 Node.js 自动化测试、Playwright UI E2E 和尚未具备专属自动化测试的待验项。当前测试源文件快照：`code-mode-providers.test.cjs` 有 87 个静态 `test(...)` 声明；`workbench-acceptance.test.cjs` 有 49 个静态 `test(...)` 声明。静态声明数不替代运行统计；`npm test` 的实际总数、通过、失败和跳过数量，以本次 Node TAP 输出为准。最近一次已核实的 Run #372 为 133 项通过、0 项失败、0 项跳过。Playwright UI 文件有 10 个场景，分别在 Chromium/iPhone 14 与 WebKit/iPhone 14 项目执行；不计入 Node TAP 项数。

## 1. 唯一执行入口与判定规则

在仓库根目录执行：

```bash
npm test
```

该命令运行 `node --test tests/*.test.cjs`，包括 `tests/code-mode-providers.test.cjs` 与 `tests/workbench-acceptance.test.cjs`。它不运行 `tests/workbench-ui.spec.cjs`；UI E2E 由 PR 工作流分别执行 Chromium 与 WebKit 的 iPhone 14 项目。AUTO-01～04、CHAIN-01～06 均有专属测试。WORKBENCH-01～15 的验收映射见下文。任何已声明专属测试失败、跳过、未执行或测试进程异常退出，对应项均不得判为通过。

- **通过**：该项对应的专属 Node.js 自动化测试本次执行成功。
- **未通过**：该项测试失败、被跳过、未执行，或测试无法完成。
- **未执行**：尚未运行本次 `npm test`。它不是通过。
- 每项测试必须直接验证对应源代码行为/逻辑，不以文档文字、Actions 绿灯或其他项目的测试结果替代。
- Actions 负责自动执行同一条 `npm test` 命令并保存日志；Actions 状态不能把失败测试改成通过。

## 2. 自动验收项目（10 项均有专属测试）

### AUTO-01 — 独立预览从当前编辑器内容生成

**自动化测试：** `ACCEPTANCE AUTO-01: independent preview is built from the current editor source`

**测试覆盖：**
- 开发台脚本可解析。
- 独立预览使用当前编辑器的 `ed.get()` 内容生成 iframe/srcdoc。
- 独立预览通过独立窗口打开。
- 不依赖 WebContainer 或其旧启动逻辑。

**通过条件：** 对应测试通过。

**失败条件：** 任一断言失败，或测试未执行。

### AUTO-02 — 独立预览同步运行结果、状态链和日志

**自动化测试：** `ACCEPTANCE AUTO-02: independent preview synchronizes results, status chain and run logs`

**测试覆盖：**
- 同步函数存在并处理预览 iframe、运行结果、状态链和日志区域。
- 编辑器当前内容同步到预览。
- 运行结果与状态链使用当前页面结果节点的克隆内容。
- 运行日志同步当前终端输出。
- 运行结果按钮操作能转发到原始结果按钮。

**通过条件：** 对应测试通过。

**失败条件：** 任一同步对象或同步逻辑缺失，或测试未执行。

### AUTO-03 — 编辑器长行换行配置完整

**自动化测试：** `ACCEPTANCE AUTO-03: Monaco and textarea fallback both wrap long lines without horizontal overflow`

**测试覆盖：**
- Monaco 启用 `wordWrap: on` 和 advanced wrapping。
- textarea fallback 使用软换行。
- textarea 样式启用 pre-wrap/anywhere，并隐藏横向溢出。
- Monaco 横向滚动条隐藏。

**通过条件：** 对应测试通过。

**失败条件：** 任一编辑器实现缺少换行/横向溢出约束，或测试未执行。

### AUTO-04 — 终端与运行日志标签页互斥切换及视口自适应

**自动化测试：** `ACCEPTANCE AUTO-04: terminal and run-log tabs switch exclusively and follow visual viewport changes`

**测试覆盖：**
- 终端与运行日志使用 `tablist`/`tab` 语义，并核对 `aria-controls`、初始 `aria-selected` 与面板关联。
- 切换标签时只显示选中的面板；进入运行日志标签时加载运行历史。
- 切回终端时恢复终端面板，运行日志面板隐藏。
- `visualViewport` 的 resize/scroll 及 window resize 事件同步工作台高度与顶部偏移量。

**通过条件：** 对应专属测试通过；测试同时验证标签切换状态、ARIA 状态、运行历史触发和视口变量更新。

### CHAIN-01 — 已生成状态与后续阶段隔离

**自动化测试：** `ACCEPTANCE CHAIN-01: generated state exists before any downstream delivery state`

**测试覆盖：** 空任务运行数据只显示“已生成”；已提交、已验证、部署中、已部署、线上健康不得提前点亮。

**通过条件：** 对应渲染逻辑测试通过。

**失败条件：** 任一后续阶段在没有对应事件时显示成功，或测试未执行。

### CHAIN-02 — 已提交状态必须有提交/关联标识

**自动化测试：** `ACCEPTANCE CHAIN-02: submitted state requires a commit or correlated run identifier`

**测试覆盖：** 无 SHA/提交标识/关联 run 时不显示已提交；存在有效关联标识时显示已提交。

**通过条件：** 对应渲染逻辑测试通过。

**失败条件：** 空数据误显示已提交，或有效标识不能点亮该阶段。

### CHAIN-03 — 已验证状态严格服从验证结论

**自动化测试：** `ACCEPTANCE CHAIN-03: verified state follows the verification conclusion only`

**测试覆盖：** 验证运行中不提前成功；success 显示成功；failure 显示失败。

**通过条件：** 对应渲染逻辑测试通过。

**失败条件：** 验证失败/未完成却显示成功，或成功结论没有正确反映。

### CHAIN-04 — 部署中状态只对应活动部署

**自动化测试：** `ACCEPTANCE CHAIN-04: deploying state appears only while deployment runs are active`

**测试覆盖：** queued/running 或关联部署 run 尚未结束时显示进行中；无活动部署时不显示部署中。

**通过条件：** 对应渲染逻辑测试通过。

**失败条件：** 无部署任务却显示部署中，或活动部署未显示进行中。

### CHAIN-05 — 已部署要求 Pages 与 Worker 都成功

**自动化测试：** `ACCEPTANCE CHAIN-05: deployed state requires both Pages and Worker deployment success`

**测试覆盖：** Pages 单独成功、Worker 失败或未完成均不得显示已部署；两者都 success 才显示已部署。

**通过条件：** 对应渲染逻辑测试通过。

**失败条件：** 任一服务失败/未完成仍显示已部署，或双成功未正确显示。

### CHAIN-06 — 线上健康要求当前部署真实 HTTP 200 状态

**自动化测试：** `ACCEPTANCE CHAIN-06: online health requires successful deployment and HTTP 200 for its run`

**测试覆盖：** 健康状态必须关联当前部署 run；checking 显示进行中；HTTP 200 显示健康；非 200 显示失败；其他 run 的旧健康结果不得串入。

**通过条件：** 对应渲染逻辑测试通过。

**失败条件：** 非 200/未探测/错误 run 的结果显示健康，或 HTTP 200 未正确显示。

## 3. 自动验收结果汇总

每次执行以本次 `npm test` 输出为准，不手动填写设备信息或线上证据。

| 编号 | 自动化测试名称 | 自动判定规则 |
|---|---|---|
| AUTO-01 | 独立预览从当前编辑器内容生成 | 对应专属测试通过 = 通过；失败/跳过/未执行 = 未通过 |
| AUTO-02 | 独立预览同步运行结果、状态链和日志 | 对应专属测试通过 = 通过；失败/跳过/未执行 = 未通过 |
| AUTO-03 | 编辑器长行换行配置完整 | 对应专属测试通过 = 通过；失败/跳过/未执行 = 未通过 |
| AUTO-04 | 终端与可展开运行日志互斥且视口自适应 | 对应专属测试通过 = 通过；失败/跳过/未执行 = 未通过 |
| CHAIN-01 | 已生成状态与后续阶段隔离 | 对应专属测试通过 = 通过；失败/跳过/未执行 = 未通过 |
| CHAIN-02 | 已提交状态必须有提交/关联标识 | 对应专属测试通过 = 通过；失败/跳过/未执行 = 未通过 |
| CHAIN-03 | 已验证状态严格服从验证结论 | 对应专属测试通过 = 通过；失败/跳过/未执行 = 未通过 |
| CHAIN-04 | 部署中状态只对应活动部署 | 对应专属测试通过 = 通过；失败/跳过/未执行 = 未通过 |
| CHAIN-05 | 已部署要求 Pages 与 Worker 都成功 | 对应专属测试通过 = 通过；失败/跳过/未执行 = 未通过 |
| CHAIN-06 | 线上健康要求当前部署真实 HTTP 200 状态 | 对应专属测试通过 = 通过；失败/跳过/未执行 = 未通过 |

**本次执行记录：**
- commit SHA：由 Actions 本次运行自动确定。
- 命令：`npm test`
- 总测试数 / 通过 / 失败 / 跳过：以 Node TAP 输出为准。
- Actions run：由对应提交的 test-project 运行记录提供。
- 10 项最终结论：只有 10 个专属测试全部通过才为“通过”；否则为“未通过”。

## 4. 范围边界

本文件只负责代码自动化验收索引。Playwright UI E2E 单独计数；人工设备操作、真实账号权限和生产环境验证不因本文件中的模拟测试通过而自动通过。

## 5. 最终交付结论

- **代码自动验收：** AUTO-01～04、CHAIN-01～06 共 10 项均有专属测试，按本次执行结果逐项判定；WORKBENCH-01～17 按各自列出的专属测试判定。不得将未执行或失败项计为通过。
- **最终交付：** 代码自动验收通过后，仍需按项目流程完成部署。

## 6. 开发工作台行为验收（WORKBENCH-01～05）

新增测试文件：tests/workbench-acceptance.test.cjs。这 5 项调用实际 Worker 函数，并以隔离的 GitHub API/KV 模拟器检查分支指针、请求参数、提交树和最终文件差异；不会写入真实 GitHub 仓库或真实 main。它们是自动化行为测试，不等同于真实 GitHub 账号/权限/网络条件下的端到端验收。

### WORKBENCH-01 — 临时分支隔离

自动化测试：ACCEPTANCE BRANCH-01: temp branch creation and edit leave main unchanged

测试覆盖：临时分支从 main 当前 SHA 创建；对临时分支提交变更后，main ref SHA 保持不变；临时分支 ref 指向新提交，main 仍指向原提交。

通过条件：对应测试通过，且 main SHA 未变化。

### WORKBENCH-02 — 主分支直接写入拦截

自动化测试：ACCEPTANCE MAIN-01: direct main write is rejected by the workbench write guard

测试覆盖：在没有活动临时分支、目标仍为 main 时调用开发台写入函数；写入必须在触发 GitHub 写工具前被拒绝。

通过条件：对应测试通过，并确认抛出“已阻止直接写入 main”。

### WORKBENCH-03 — 失败重试与局部回滚

自动化测试：ACCEPTANCE RETRY-ROLLBACK-01: retry reuses failed run and rollback restores only listed paths

测试覆盖：失败的 Actions run 重试必须调用同一个 run ID 的 rerun-failed-jobs，不能创建新的 run；重试计数增加，记录仍关联原 run ID；回滚创建以当前 SHA 为 parent 的新 commit，不 force 移动历史；回滚 tree 只包含历史记录列出的文件路径，其他当前文件继续由 current tree 保留。

通过条件：对应测试通过，且同一 run ID 被重试、回滚只覆盖指定路径。

### WORKBENCH-04 — 文件级审核

自动化测试：ACCEPTANCE REVIEW-01: rejected file is absent from the final merge diff

测试覆盖：模拟两个文件均有改动，只接受其中一个；合并前重新读取 compare 文件清单；被拒绝文件恢复为基线内容，不进入最终合并文件集合。

通过条件：对应测试通过，最终合并差异不包含被拒绝文件，main 中该文件内容保持基线值。

### WORKBENCH-05 — 并发修改冲突保护

自动化测试：ACCEPTANCE CONFLICT-01: concurrent same-file edit blocks merge and preserves main

测试覆盖：临时分支创建后，main 的基线 SHA 前进，代表另一方已提交变更；合并必须检测旧基线并返回 conflict；不得调用成功合并路径，不得静默覆盖 main 内容。

通过条件：对应测试通过，冲突被拒绝且 main 文件内容保持并发提交版本。

### 新增行为验收结果

| 编号 | 自动化测试 | 通过条件 |
|---|---|---|
| WORKBENCH-01 | 临时分支隔离 | 临时分支变化，main SHA 不变 |
| WORKBENCH-02 | 主分支直接写入拦截 | main 写入在调用 GitHub 前被拒绝 |
| WORKBENCH-03 | 失败重试与局部回滚 | 重试复用原 run；回滚仅恢复清单内路径 |
| WORKBENCH-04 | 文件级审核 | 拒绝文件不进入最终合并差异 |
| WORKBENCH-05 | 并发修改冲突保护 | 旧基线触发冲突，main 不被覆盖 |


## 7. 权限、幂等、多文件审核与失败清理（WORKBENCH-06～09）

新增测试位于 `tests/workbench-acceptance.test.cjs`。这些测试执行 Worker 中的实际工作台函数，GitHub/KV 操作使用隔离模拟，不修改真实仓库。

### WORKBENCH-06 — 权限边界与操作者审计

**自动化测试：** `ACCEPTANCE PERMISSION-01: unauthorized identities cannot create, save, review, merge, discard, preview, or roll back; authorized actions are attributed`；`ACCEPTANCE WORKBENCH-AUTH-ROUTE-01: workbench HTTP routes reject missing, invalid and expired tokens before dispatch`

**测试覆盖：**
- 非授权用户及自动化身份尝试创建临时分支、编辑器保存、审核文件、合并推送、丢弃分支、触发预览和历史回滚。
- 七类受保护写入/部署操作均必须在任何 GitHub 写请求前拒绝。
- 授权创建记录 `created_by`。
- 授权保存记录 `last_saved_by` 与 `save_events.actor`；预览触发记录 `preview_started_by` 与 `preview_events.actor`。
- 历史回滚写入 `actor`；丢弃临时分支写入带操作者的 `workbench_discard` 历史事件，并在工作台历史区显示为不可回滚的操作记录。
- 文件拒绝审核记录 `last_reviewed_by` 与 `review_events.actor`。
- 合并历史记录 `actor`。

**通过条件：** 未授权操作没有 GitHub 写调用；授权操作的创建、审核和合并历史均可追溯到认证用户。

**边界：** HTTP 路由测试执行 Worker 中真实的 `userFromReq` 与工作台路由分支，覆盖缺失、无效、过期和有效 Bearer token；GitHub/KV 仍使用隔离模拟，不代表真实 Cloudflare 网络、真实登录账号或 GitHub 权限的生产端到端验收。

### WORKBENCH-07 — 重复执行与幂等性

**自动化测试：** `ACCEPTANCE IDEMPOTENCY-01: repeated create reuses one branch and repeated merge cannot create a second commit`；`ACCEPTANCE IDEMPOTENCY-CONCURRENT-CREATE-01`

**测试覆盖：**
- 同一用户/项目连续创建两次，第二次复用已有活动分支，不再创建新分支。
- 同一项目并发创建两次，第二个请求被锁拦截；首个创建完成后重试，复用同一分支。
- 同一临时分支合并成功后再次提交相同合并请求，不能再次创建提交或重复写入历史。

**通过条件：** 分支创建调用一次、合并调用一次、历史只增加一条。

**边界：** 本项覆盖顺序重复请求；尚不代表并发请求在 KV 竞态下已具备原子去重保证。

### WORKBENCH-08 — 多文件审核及重命名/删除边界

**自动化测试：** `ACCEPTANCE MULTI-REVIEW-01: mixed file review keeps accepted files and rejects rename/delete side effects`；`ACCEPTANCE WORKBENCH-RENAME-DIFF-01`、`ACCEPTANCE RENAME-REJECT-MERGE-01`；Playwright `rejecting a renamed file sends the previous filename so the source path can be restored`；`failed renamed-file rejection keeps the row retryable after restoring its source path`；`ACCEPTANCE RENAME-REJECT-MERGE-01: real rename rejection restores the source and excludes both paths from merge`；`ACCEPTANCE RENAME-REJECT-RESTORE-FAIL-01: failed source restoration never deletes the renamed destination or records a completed review`

**测试覆盖：**
- 一次包含修改、新增、删除、重命名的多文件变更。
- 只接受指定文件，其余文件不得进入最终比较结果。
- 拒绝重命名时同时恢复 `previous_filename` 源路径，并移除目标路径；集成回归测试将真实拒绝处理函数接入合并协调器，拒绝后重新计算 GitHub 差异，确认最终合并列表只剩接受文件。
- 拒绝删除时恢复基线文件；拒绝新增时删除新增文件。
- 审核人写入审核事件。
- Diff API 必须把 GitHub 的 `previous_filename` 映射为 `previous_path`，前端拒绝重命名时必须把旧路径传回 Worker；Node 与 Playwright 分别验证数据映射和实际按钮请求。
- 重命名拒绝出现部分失败（旧路径已恢复、目标路径删除失败）时，改动行必须保留、拒绝按钮恢复可用；重试仍传递 `previous_path`，成功后才移除改动行。
- 重命名拒绝时若旧路径恢复失败，必须在任何目标路径删除之前返回失败；新路径保持不变，审核事件不得记为成功，恢复成功后允许重试。

**通过条件：** 最终合并差异只包含接受的文件；被拒绝文件的旧路径、新路径及删除/新增副作用均不能漏进合并。

### WORKBENCH-09 — 失败后的状态清理

**自动化测试：** `ACCEPTANCE CLEANUP-01: failed deletion retains recoverable state; successful cancel clears branch and state for the next task`；`ACCEPTANCE LOCK-CLEANUP-01: failed or cancelled claim releases its operation lock and permits the next task`

**测试覆盖：**
- GitHub 删除临时分支失败时，不能假装取消成功或清除 KV 分支记录。
- 重试删除成功后，临时分支记录与审核状态清除。
- 清理完成后，同一项目可以创建新的任务分支。
- Durable Object 审核 claim 在失败完成后释放操作锁；取消清空后旧 claim 不残留，下一任务可重新创建。

**通过条件：** 删除失败保留可恢复状态；成功取消后旧状态清空，下一任务创建成功。

**边界：** 当前自动测试覆盖分支记录与审核状态清理；真实 Durable Object 锁在断网、进程中断和过期告警下的恢复仍需单独端到端验收。


## 8. 工作台写操作并发互斥（WORKBENCH-10）
 
### WORKBENCH-10 — 同一项目写操作互斥与无锁失败关闭

**自动化测试：** `ACCEPTANCE WORKBENCH-CONCURRENCY-01`、`ACCEPTANCE WORKBENCH-LOCK-FAIL-CLOSED-01`、`ACCEPTANCE WORKBENCH-SAVE-CAS-01`、`ACCEPTANCE WORKBENCH-LOCK-SCOPE-01`、`ACCEPTANCE WORKBENCH-LOCK-CASE-01`，并由 `ACCEPTANCE LOCK-CLEANUP-01` 检查 Durable Object 锁释放。

**测试覆盖：**
- 同一仓库跨授权用户的分支创建、编辑器保存、文件审核、合并、丢弃、预览触发和历史回滚共用同一把 Durable Object 锁；仓库名大小写变体映射到同一锁身份。
- 创建期间发起合并，第二个操作必须返回 busy，不得进入 GitHub 写操作；编辑器保存、文件审核、预览触发、丢弃和回滚也必须经过同一把锁。
- 锁只能由持有正确 token 的操作释放。
- 操作结束释放锁，后续操作可重新获取。
- 未绑定 `CODE_CLAIMS` 时，创建、编辑器保存、预览触发和合并均失败关闭，不得退回 KV/MCP 无锁写入。

**通过条件：** 并发写操作最多一个进入临界区；错误 token 不能解锁；缺少 Durable Object 绑定时不执行 GitHub 写操作。

**边界：** 当前自动测试模拟 Durable Object storage 与请求互斥；Cloudflare 生产 Durable Object 在部署配置、真实并发网络请求和进程中断场景仍需部署后 E2E 验收。


## 9. 分支创建记录持久化失败清理（WORKBENCH-11）

### WORKBENCH-11 — 创建分支后记录保存失败的补偿清理

**自动化测试：** `ACCEPTANCE CREATE-CLEANUP-01`

**测试覆盖：**
- GitHub 临时分支创建成功，但 KV 分支记录写入失败。
- 补偿删除 GitHub 临时分支成功时，返回失败但明确报告已清理，不留下无主分支。
- 补偿删除也失败时，返回失败并明确标记 `orphaned: true`，保留分支名供后续人工/自动重试清理。

**通过条件：** 记录持久化失败不能返回创建成功；补偿清理结果必须如实返回，不得隐藏遗留分支。


## 10. 文件审核拒绝路径与失败边界（WORKBENCH-12）

### WORKBENCH-12 — 文件审核的路径、权限、读取和写入失败保护

**自动化测试：** `ACCEPTANCE REVIEW-GUARD-01`、`REVIEW-GUARD-02`、`REVIEW-READ-01`、`REVIEW-READ-02`、`REVIEW-WRITE-01`、`REVIEW-WRITE-02`。

**测试覆盖：**
- 路径非法或命中保护规则时，在任何 GitHub 文件读取/写入前拒绝。
- 基线文件读取失败、临时分支文件读取失败时，不得修改分支。
- 恢复基线文件失败、删除新增文件失败时，不得写入“审核成功”的审计记录。

**通过条件：** 失败路径均返回失败；不得在信息不完整或写入失败时误报审核成功。


## 11. 合并成功后的历史与清理恢复（WORKBENCH-13）

### WORKBENCH-13 — 合并后部分失败的可恢复状态

**自动化测试：** `ACCEPTANCE MERGE-HISTORY-RECOVERY-01`、`MERGE-CLEANUP-01`、`MERGE-RECORD-CLEANUP-01`；Playwright `merged history recovery remains retryable after reload without a second GitHub merge`。

**测试覆盖：**
- GitHub 合并已成功但历史记录写入失败：保留临时分支和可恢复记录；重试先补写历史，不得再次调用合并。
- 历史保存成功但临时分支删除失败：记录 `merged_cleanup_failed`；重试只清理分支，不重复合并。
- 分支删除成功但 KV 记录删除失败：记录 `merged_record_cleanup_failed`；重试只完成状态清理，不重复合并。
- UI 必须把 `merged: true` 的部分失败识别为“已合并、待恢复”，不能显示普通推送失败；刷新后仍允许对 `merged_history_failed` / `merged_cleanup_failed` 状态执行恢复重试。

**通过条件：** 合并成功后的历史写入、分支删除和 KV 清理分别可恢复；重复请求不得生成第二次合并。


## 12. 仓库锁原子性与租约续期（WORKBENCH-14）

### WORKBENCH-14 — Durable Object 仓库锁必须原子获取并支持续期

**自动化测试：** `ACCEPTANCE WORKBENCH-LOCK-ATOMIC-01`、`WORKBENCH-LOCK-RENEW-01`、`WORKBENCH-LOCK-HEARTBEAT-01`、`WORKBENCH-LOCK-HEARTBEAT-FAIL-01`、`WORKBENCH-SAVE-CAS-01`、`WORKBENCH-PREVIEW-AUDIT-01`、`WORKBENCH-ROLLBACK-LOCK-01`。

**测试覆盖：**
- 两个并发请求同时获取同一仓库锁，事务竞争后只能有一个成功。
- 锁持有者可续期；错误 token 不得续期或延长其他操作的租约。
- 工作台长操作每 60 秒续租，结束时清除心跳并释放锁。
- 续租失败时立即中止该仓库后续 GitHub 请求（包括在途请求的 AbortSignal），返回不确定状态与 GitHub 核验提示；释放锁未确认时也不得误报操作完全成功。
- 编辑器保存必须经 Worker 锁入口执行，并以当前文件 SHA 做 compare-before-write；旧 SHA 返回冲突，不得覆盖新内容。
- 历史回滚和预览部署触发属于项目状态写操作，必须与创建、保存、审核、合并、丢弃共用同一仓库锁，避免回滚与其他写入同时推进目标分支。

**通过条件：** 锁获取/续期/释放全部在 Durable Object storage transaction 中完成；不能再用分离的 get/put 作为互斥依据。

## 13. main 合并基线的 compare-and-swap（WORKBENCH-15）

### WORKBENCH-15 — 合并必须绑定审核时的 base SHA 与 head SHA

**自动化测试：** `ACCEPTANCE MERGE-CAS-01`、`MERGE-CAS-02`、`MERGE-CAS-03`、`MERGE-CAS-04`、`MERGE-CAS-05`、`MERGE-CAS-06`、`MERGE-CAS-07`。

**实现约束：**
- 合并前固定并核验 base SHA 与已审核 head SHA；任一发生变化，停止合并。
- 在以固定 base SHA 创建的隔离临时分支上计算三方合并树。
- 创建父提交固定为 `[expectedBaseSha, expectedHeadSha]` 的 merge commit。
- 最终只用 GitHub ref `PATCH force:false` 更新目标分支；若 main 在计算期间前进，非 fast-forward 更新必须失败，不得覆盖新提交。
- 隔离合并分支清理失败（包括请求抛异常）时，不得更新目标分支，并返回可追踪的遗留分支名。
- base/head SHA 格式非法时，任何 GitHub 写操作前拒绝。
- 隔离分支创建失败时，不执行后续 merge commit 创建或目标分支更新。

**通过条件：** main 在合并计算期间推进时，最终 ref 更新失败；只有目标分支仍处于预期基线时才可提交合并。


## 14. 实际测试文件与用例清单（核对基准）

以下清单按当前分支测试源文件逐项核对。测试名称是验收映射依据；如代码中的测试名称变化，必须同步更新本文件。

### 14.1 Node.js 工作台行为测试（49 个静态 test 声明）

文件：`tests/workbench-acceptance.test.cjs`

| 分组 | 专属测试名称 |
|---|---|
| 分支隔离与写入保护 | `ACCEPTANCE BRANCH-01`、`ACCEPTANCE MAIN-01`、`ACCEPTANCE CONFLICT-01` |
| 文件审核与重试回滚 | `ACCEPTANCE REVIEW-01`、`ACCEPTANCE RETRY-ROLLBACK-01`、`ACCEPTANCE MULTI-REVIEW-01`、`ACCEPTANCE MULTI-REVIEW-RECOVERY-01`、`ACCEPTANCE WORKBENCH-RENAME-DIFF-01` |
| 权限与幂等 | `ACCEPTANCE PERMISSION-01`、`ACCEPTANCE IDEMPOTENCY-01`、`ACCEPTANCE IDEMPOTENCY-CONCURRENT-CREATE-01` |
| 丢弃、失败清理与创建补偿 | `ACCEPTANCE CLEANUP-01`、`ACCEPTANCE DISCARD-AUDIT-RECOVERY-01`、`ACCEPTANCE LOCK-CLEANUP-01`、`ACCEPTANCE CREATE-CLEANUP-01` |
| 仓库写锁与租约 | `ACCEPTANCE WORKBENCH-CONCURRENCY-01`、`ACCEPTANCE WORKBENCH-LOCK-FAIL-CLOSED-01`、`ACCEPTANCE WORKBENCH-LOCK-SCOPE-01`、`ACCEPTANCE WORKBENCH-LOCK-CASE-01`、`ACCEPTANCE WORKBENCH-LOCK-ATOMIC-01`、`ACCEPTANCE WORKBENCH-LOCK-RENEW-01`、`ACCEPTANCE WORKBENCH-LOCK-HEARTBEAT-01`、`ACCEPTANCE WORKBENCH-LOCK-HEARTBEAT-FAIL-01`、`ACCEPTANCE WORKBENCH-SAVE-CAS-01`、`ACCEPTANCE WORKBENCH-PREVIEW-AUDIT-01`、`ACCEPTANCE WORKBENCH-ROLLBACK-LOCK-01` |
| 审核拒绝路径与失败保护 | `ACCEPTANCE REVIEW-GUARD-01`、`ACCEPTANCE REVIEW-GUARD-02`、`ACCEPTANCE REVIEW-READ-01`、`ACCEPTANCE REVIEW-READ-02`、`ACCEPTANCE REVIEW-WRITE-01`、`ACCEPTANCE REVIEW-WRITE-02` |
| 合并后恢复与清理 | `ACCEPTANCE MERGE-HISTORY-RECOVERY-01`、`ACCEPTANCE MERGE-CLEANUP-01`、`ACCEPTANCE MERGE-RECORD-CLEANUP-01` |
| 合并 CAS 与 Git ref 边界 | `ACCEPTANCE MERGE-CAS-01`～`MERGE-CAS-07`、`ACCEPTANCE GIT-REF-WRITE-01`、`ACCEPTANCE WORKBENCH-CAS-CONFLICT-01` |
| 多项目切换 | `ACCEPTANCE WORKBENCH-PROJECT-01`、`ACCEPTANCE WORKBENCH-PROJECT-02` |

**计数说明：** 上述分组对应文件内 49 个静态 `test(...)` 声明。实际运行数以 `npm test` 的 TAP 汇总为准；最近一次 Run #372 输出 133 项通过、0 项失败、0 项跳过。编号范围表达的是测试名称前缀，不代表每个数字只对应一个测试。特别是 WORKBENCH-15 的 CAS 验收由 7 个用例覆盖，另外还有 Git ref 写入端点和 422 冲突映射两个补充边界用例。

### 14.2 Playwright UI E2E（10 个场景 × 2 个浏览器项目）

文件：`tests/workbench-ui.spec.cjs`

| 场景 | Chromium · iPhone 14 | WebKit · iPhone 14 |
|---|---|---|
| 文件审核：拒绝一个文件、接受另一个文件，只推送接受路径 | 独立执行 | 独立执行 |
| 文件重命名审核：拒绝时提交 previous_path，确保旧路径可恢复 | 独立执行 | 独立执行 |
| 重命名拒绝中途失败：源路径已恢复时保留行并允许重试删除目标路径 | 独立执行 | 独立执行 |
| 重命名拒绝部分失败：旧路径恢复后目标删除失败，保留行并可重试 | 独立执行 | 独立执行 |
| 丢弃保持 main 不变；历史回滚创建新的活动分支 | 独立执行 | 独立执行 |
| 终端/运行日志标签页互斥切换；检查移动视口尺寸变化后的布局变量 | 独立执行 | 独立执行 |
| 文件拒绝接口首次失败后，改动仍保留并允许重试 | 独立执行 | 独立执行 |
| 合并遇到 409 冲突时保留临时分支和已接受差异 | 独立执行 | 独立执行 |
| 合并已成功但历史记录失败：刷新后可重试恢复，且不重复 GitHub 合并 | 独立执行 | 独立执行 |
| 丢弃接口失败时保留活动分支并允许再次操作 | 独立执行 | 独立执行 |
| 分支已删除但审计/状态清理失败：界面保留重试入口 | 独立执行 | 独立执行 |

工作流命令：
- `npx playwright test --project=chromium-iphone`
- `npx playwright test --project=webkit-iphone`

这些场景使用 Playwright API fixtures 模拟后端响应，验证前端交互与请求载荷；它们不是对真实 GitHub 仓库执行分支创建、合并或回滚的生产端到端测试。浏览器项目成功只代表该项目下的 UI 用例通过。

### 14.3 当前自动化覆盖边界

- `npm test` 不包含 Playwright UI E2E。
- Node.js Worker 行为测试使用隔离 GitHub API/KV/ Durable Object 模拟器，不会修改真实 main。
- UI E2E 使用浏览器路由 fixtures 模拟 API，不会真实调用后端写操作。
- 真实 GitHub 权限、真实 Durable Object 部署配置、真实网络故障恢复和生产 Pages/Worker 健康仍需独立环境验收。
- AUTO-04 已有专属测试；是否通过仍以本次 `npm test` 实际结果为准。

## 15. 工作台 UI 失败恢复验收（WORKBENCH-16）

### WORKBENCH-16 — 文件审核、合并冲突与丢弃失败必须保留可恢复状态

**自动化测试：**
- `failed file rejection keeps the diff visible and allows a successful retry`
- `merge conflict keeps the temporary branch and accepted diff available`
- `failed discard keeps the active branch and permits another attempt`

**测试覆盖：**
- 文件拒绝接口首次返回 HTTP 500：该文件仍留在改动列表，拒绝按钮恢复可用；再次操作成功后，文件才从列表移除。
- 合并接口返回 HTTP 409：显示冲突提示，保留活动临时分支、已接受文件和再次推送能力。
- 丢弃接口返回 HTTP 503：不能清除活动分支状态；丢弃按钮恢复可用，用户可以重试。
- 三个场景分别在 Chromium 与 WebKit 的 iPhone 14 项目执行。

**通过条件：** 任一失败响应均不能让前端误显示操作成功或丢失可恢复分支状态；重试入口必须恢复。

**边界：** 这三项 Playwright 测试使用浏览器 API fixtures 注入 500/409/503 响应，验证前端错误处理与状态保留；不代表真实 GitHub API 在生产网络中的端到端故障演练。
## 16. 多项目切换与未保存编辑保护（WORKBENCH-17）

### WORKBENCH-17 — 项目切换必须隔离临时分支并保护未保存修改

**自动化测试：**
- `ACCEPTANCE WORKBENCH-PROJECT-01: cancelling a dirty project switch preserves the current branch and edits`
- `ACCEPTANCE WORKBENCH-PROJECT-02: switching projects clears old branch state and loads the new project branch`

**测试覆盖：**
- 当前文件有未保存修改时，用户取消项目切换：项目选择器恢复原项目，当前临时分支、文件路径和审核决策保持不变，不触发新分支创建。
- 用户确认切换且当前无未保存修改时：更新目标项目 owner/repo，清除旧项目活动分支与文件审核决策，将文件路径重置到入口文件，重新创建/读取目标项目独立临时分支。
- 新项目分支建立后，重新加载编辑文件、文件树、改动差异与历史记录。

**通过条件：** 取消切换不污染当前项目状态；确认切换不沿用旧项目分支、SHA 或审核决策，且后续读取全部针对新项目。

**边界：** 测试在 VM 中执行真实前端切换函数并替换 API/DOM 依赖；不代表真实第二仓库的 GitHub 授权、网络访问或生产分支创建已完成验证。


## 17. 第一阶段扩展验收（P1-001～P1-087）

**目标：** 在现有实际 `npm test` 基线 133 项上新增 87 项，目标约 220 项。每项必须给出输入、操作、预期结果和失败判据。新增测试只修改验收测试与本文件，不修改 `worker.js`、前端业务代码、工作流或部署配置。

**测试类型边界：** P1-001～P1-078 调用从当前 `worker.js` 提取的真实函数，但 GitHub API、KV、Durable Object 均使用隔离模拟依赖；P1-079～P1-087 是对当前工作台前端源码入口/请求契约的静态存在性检查。它们属于 Node 自动化测试，不是实际 GitHub 分支/PR 操作，也不是真实 Durable Object 部署验收。真实 GitHub 与真实 DO 仍需单独环境验证，不计入本阶段模拟测试通过数。

### 权限边界与操作者审计（10）

| 编号 | 输入 | 操作 | 预期结果 | 失败判据 |
|---|---|---|---|---|
| P1-001 | 缺少 GH_PAT；调用 codePushGuard | 推送授权检查 | 拒绝并提示未配置令牌 | 未拒绝或提示可继续写入 |
| P1-002 | CODE_OWNER 为空；调用 codePushGuard | 推送授权检查 | 拒绝并提示未配置所有者 | 空所有者仍可推送 |
| P1-003 | 操作者为 intruder；目标 owner/repo | 检查操作者权限 | 拒绝非授权身份 | 越权身份获得空拒绝原因 |
| P1-004 | 目标仓库 other/repo 不在白名单 | 检查仓库白名单 | 拒绝仓库 | 非白名单仓库通过 |
| P1-005 | 绝对路径 /etc/passwd | 检查路径 | 拒绝非法路径 | 绝对路径通过 |
| P1-006 | 路径 src/../secret | 检查路径穿越 | 拒绝路径 | 路径穿越通过 |
| P1-007 | 路径 .git/config | 敏感路径检查 | 拒绝修改 Git 元数据 | 敏感文件通过 |
| P1-008 | 路径 config/.env.local | 敏感路径检查 | 拒绝环境文件 | 环境文件通过 |
| P1-009 | 路径 private_.key | 敏感路径检查 | 拒绝密钥文件 | 密钥文件通过 |
| P1-010 | 路径 deploy_token_prod | 敏感路径检查 | 拒绝令牌文件 | 令牌文件通过 |

### 幂等性与并发重复（12）

| 编号 | 输入 | 操作 | 预期结果 | 失败判据 |
|---|---|---|---|---|
| P1-011 | owner/repo 与 Owner/Repo | 检查仓库锁标识 | 大小写变体映射同一锁 ID | 同仓库绕过互斥 |
| P1-012 | CODE_REPOS=Owner/Repo，查询 owner/repo | 检查白名单 | 仓库白名单大小写不敏感 | 大小写导致合法仓库被拒 |
| P1-013 | CODE_CLAIMS 缺失 | 执行锁包装器 | 拒绝执行回调 | 无锁执行写操作 |
| P1-014 | DO claim 返回 busy=true | 执行锁包装器 | 返回 busy 且回调不运行 | 锁竞争仍执行写操作 |
| P1-015 | DO claim 成功，业务回调返回成功 | 执行锁包装器 | 回调一次并释放锁 | 锁未释放或重复执行回调 |
| P1-016 | 业务回调抛出 operation-failed | 执行锁包装器 | 释放锁后传播原异常 | 异常吞掉或锁泄漏 |
| P1-017 | DO unlock 失败 | 执行锁包装器 | 返回 lock_release_failed | 释放未确认仍报告成功 |
| P1-018 | 请求仓库 OWNER/REPO | 生成锁 ID | 规范化为 workbench:owner/repo | 大小写不同产生不同锁 |
| P1-019 | CODE_CLAIMS 未绑定 | 调用 codeWorkbenchLockCall | 返回 configured=false | 未配置 DO 被当作成功 |
| P1-020 | DO 响应 JSON 解析抛错 | 调用 codeWorkbenchLockCall | 返回无效响应失败对象 | 无效响应被当作获锁 |
| P1-021 | save/review/discard 作用于同仓库 | 逐项获取锁 | 三次都使用同一仓库锁 ID | 不同写操作使用不同锁域 |
| P1-022 | 业务回调返回 {ok:false,reason:stale} | 执行锁包装器 | 原样返回失败结果 | 业务失败被包装成成功 |

### 多文件审核（10）

| 编号 | 输入 | 操作 | 预期结果 | 失败判据 |
|---|---|---|---|---|
| P1-023 | src/app.js | 校验普通文件路径 | 通过 | 合法路径被拒 |
| P1-024 | frontend/studio.js | 校验嵌套路径 | 通过 | 嵌套路径被拒 |
| P1-025 | src/my-file.test.js | 校验连字符文件名 | 通过 | 连字符路径被拒 |
| P1-026 | src/my_file.js | 校验下划线文件名 | 通过 | 下划线路径被拒 |
| P1-027 | v2/2026/file.js | 校验多级目录 | 通过 | 正常多级目录被拒 |
| P1-028 | 空字符串 | 校验路径 | 拒绝 | 空路径通过 |
| P1-029 | /src/a.js | 校验前导斜杠 | 拒绝 | 绝对路径通过 |
| P1-030 | src//a.js | 校验重复分隔符 | 拒绝 | 空路径段通过 |
| P1-031 | src/./a.js | 校验当前目录段 | 拒绝 | 点路径段通过 |
| P1-032 | src/../a.js | 校验父目录段 | 拒绝 | 路径穿越通过 |

### 失败清理（12）

| 编号 | 输入 | 操作 | 预期结果 | 失败判据 |
|---|---|---|---|---|
| P1-033 | KV 中无活动分支记录 | 执行丢弃 | 幂等返回 already_absent，不删分支 | 误删其他分支 |
| P1-034 | 请求分支与 KV 分支不同 | 执行丢弃 | 拒绝且不调用 GitHub 删除 | 可删除其他活动分支 |
| P1-035 | GitHub 删除返回 503 | 执行丢弃 | 保留 KV，不写审计成功 | 删除失败仍清理记录 |
| P1-036 | 分支删除成功但审计写入抛错 | 执行丢弃 | 保存 discard_history_failed 恢复状态 | 审计失败后无恢复记录 |
| P1-037 | 审计成功但 KV delete 抛错 | 执行丢弃 | 保存 discard_record_cleanup_failed | 状态清理失败仍报告完成 |
| P1-038 | KV 无分支记录 | 读取当前分支 | 返回 active=false | 空记录误报活动分支 |
| P1-039 | GitHub ref 返回 404 | 读取当前分支 | 清理陈旧 KV 并标记 stale_branch_record | 404 后保留失效活动记录 |
| P1-040 | GitHub ref 返回 503 | 读取当前分支 | 返回失败并保留 KV | 网络错误导致恢复记录被删 |
| P1-041 | discard_history_failed 记录且 GitHub 404 | 读取当前分支 | 保留 discard_recovery 活动恢复入口 | 恢复入口丢失 |
| P1-042 | 尝试删除 main | 调用 codeDeleteBranch | 拒绝且不请求 GitHub | main 可被删除 |
| P1-043 | 删除 code/task-1 | 调用 codeDeleteBranch | DELETE 请求指向 git/refs/heads/code/task-1 | 使用错误的 refs API 路径 |
| P1-044 | 删除 code/../main | 调用 codeDeleteBranch | 拒绝且不请求 GitHub | 路径穿越删除被允许 |

### 分支隔离（8）

| 编号 | 输入 | 操作 | 预期结果 | 失败判据 |
|---|---|---|---|---|
| P1-045 | 读取 main ref 返回 404 | 创建临时分支 | 失败且不创建 ref | 无基线仍创建分支 |
| P1-046 | main 返回 SHA a…a | 创建 code/p-1 | 新分支 ref 指向该 SHA | 分支指向错误 commit |
| P1-047 | base=main;delete | 创建临时分支 | 在 GitHub 请求前拒绝 | 注入 ref 被请求 |
| P1-048 | 创建 ref 返回 422 | 创建临时分支 | 返回创建失败 | 创建失败仍报告成功 |
| P1-049 | 项目名 My Project | 生成临时分支名 | 规范化为 code/my-project-* | 分支名不安全 |
| P1-050 | 项目名 ../bad project | 生成临时分支名 | 去除路径穿越并规范化 | 生成可穿越分支名 |
| P1-051 | 项目名为空 | 生成临时分支名 | 使用 project 默认名 | 生成空项目分支名 |
| P1-052 | 项目名 UPPER_CASE | 生成临时分支名 | 规范化为小写且保留安全字符 | 大小写或字符清理错误 |

### 冲突保护（10）

| 编号 | 输入 | 操作 | 预期结果 | 失败判据 |
|---|---|---|---|---|
| P1-053 | 当前 base SHA 与审核 base 不同 | 执行 codeMergeTempBranch | 409 conflict，停止写入 | base 漂移仍合并 |
| P1-054 | 当前 head SHA 与审核 head 不同 | 执行 codeMergeTempBranch | 409 conflict，停止写入 | head 漂移仍合并 |
| P1-055 | expectedBaseSha 为空 | 执行合并 | 拒绝且不请求 GitHub | 空 SHA 进入合并 |
| P1-056 | expectedBaseSha 仅 3 位 | 执行合并 | 拒绝且不请求 GitHub | 短 SHA 进入合并 |
| P1-057 | expectedHeadSha 为空 | 执行合并 | 拒绝且不请求 GitHub | 空 head SHA 进入合并 |
| P1-058 | base ref 校验失败 | 执行合并 | 拒绝且不请求 GitHub | 非法 base ref 进入合并 |
| P1-059 | 合并源分支为 main | 执行合并 | 拒绝且不请求 GitHub | main 被当作临时源分支 |
| P1-060 | 检查最终 ref 更新实现 | 静态契约核验 | 必须 force=false 且绑定 expectedBaseSha | 允许 force push 覆盖基线 |
| P1-061 | 隔离 merge preview 返回 HTTP 409 | 核对合并冲突映射 | 返回 conflict=true | 冲突被误报成功 |
| P1-062 | scratch 临时分支删除失败 | 核对清理保护 | 返回 scratch_cleanup_failed，目标分支不更新 | 临时引用泄漏后仍更新目标 |

### 历史与回滚（8）

| 编号 | 输入 | 操作 | 预期结果 | 失败判据 |
|---|---|---|---|---|
| P1-063 | 历史列表为空 | 执行回滚 | 拒绝无历史回滚 | 空历史触发写操作 |
| P1-064 | 历史记录无 previous_sha | 执行回滚 | 拒绝 | 缺失版本指针仍回滚 |
| P1-065 | 历史仓库不在白名单 | 执行回滚 | 拒绝 | 非白名单仓库回滚 |
| P1-066 | codePushGuard 返回 denied | 执行回滚 | 拒绝 | 无权限身份可回滚 |
| P1-067 | 历史记录 files=[] | 执行回滚 | 拒绝整仓回滚，仅允许有文件清单的局部回滚 | 缺失文件清单导致整仓回滚 |
| P1-068 | Git tree 返回 truncated=true | 执行回滚 | 拒绝创建回滚 commit | 不完整文件树仍提交 |
| P1-069 | 历史回滚创建新 commit | 核对 commit parents | 新 commit 以当前 SHA 为 parent | 回滚重写历史指针 |
| P1-070 | 历史文件路径包含非法项 | 构建回滚文件树 | 路径先经过 codePathOk 过滤 | 非法路径进入回滚树 |

### 预览与环境隔离（8）

| 编号 | 输入 | 操作 | 预期结果 | 失败判据 |
|---|---|---|---|---|
| P1-071 | CODE_PREVIEW_URL=https://preview.example/run/{run_id} | 生成预览 URL | run_id 空格编码为 %20 | URL 参数未编码 |
| P1-072 | PREVIEW_URL=http://preview.example/{run_id} | 生成预览 URL | 使用合法配置并编码 run_id | 配置回退或编码错误 |
| P1-073 | 预览仓库为 other/repo | 请求预览 | 拒绝未配置仓库 | 其他仓库触发 Pages 工作流 |
| P1-074 | GitHub workflow dispatch 返回 500 | 请求预览 | 返回失败 | 部署启动失败被报成功 |
| P1-075 | 预览发起用户为 user | 保存预览记录 | 记录 preview_started_by 和 actor | 预览操作无操作者审计 |
| P1-076 | 预览事件超过 100 条 | 追加预览审计 | 仅保留最近 100 条 | 审计事件无上限增长 |
| P1-077 | 目标仓库为 openmanus-gateway | 生成分支预览 URL | 只生成 branch- 前缀隔离 URL | 错误生成生产预览 URL |
| P1-078 | 活动分支为 code/project-1 | dispatch 预览 | workflow ref 使用 current.branch | 预览错误引用 main |

### 文件树、搜索、逐文件审核与提交一致性（9）

| 编号 | 输入 | 操作 | 预期结果 | 失败判据 |
|---|---|---|---|---|
| P1-079 | 加载活动项目文件树 | 调用 loadWorkbenchTree | 存在活动仓库/分支读取入口 | 文件树读取入口缺失 |
| P1-080 | 渲染文件树节点 | 调用 renderWorkbenchTree | 存在路径渲染入口 | 文件树渲染入口缺失 |
| P1-081 | 选中一个文件路径 | 调用 openWorkbenchFile | 按所选路径打开文件 | 逐文件打开入口缺失 |
| P1-082 | 输入搜索 query | 执行文件搜索 | 存在 searchQuery 过滤入口 | 搜索入口缺失 |
| P1-083 | 分支有文件差异 | 加载工作台树/差异 | 差异数据用于审核列表 | 审核列表未使用差异 |
| P1-084 | 重命名文件 old.js → new.js | 拒绝重命名 | 请求载荷携带 previous_path=old.js | 拒绝时旧路径无法恢复 |
| P1-085 | 当前活动分支 code/task | 执行合并 | 请求绑定 branch 身份 | 合并请求未绑定活动分支 |
| P1-086 | 用户明确点击丢弃 | 执行 discardWorkbenchBranch | 存在明确丢弃操作入口 | 丢弃入口缺失 |
| P1-087 | 从项目 A 切换到项目 B | 执行 switchWorkbenchProject | 清理旧活动分支上下文 | 旧项目分支状态泄漏 |

**通过判定：** 87 个新增 `node:test` 用例全部执行并通过；`npm test` 总数以 Actions TAP 实际输出为准；`npm run build` 必须通过。若测试失败，保留真实失败日志，先修复测试夹具/断言，不通过弱化预期或删除用例来变绿。模拟测试结果不得标记为真实 GitHub/DO 验收通过。

**本阶段安全边界：** 独立分支 `code/workbench-acceptance-phase1-20261128`；只允许改 `ACCEPTANCE.md` 与 `tests/workbench-acceptance-phase1.test.cjs`。PR #32、PR #60 不修改；不合并、不部署生产。

## 18. 第二阶段：动态项目注册表与 CODE_REPOS 唯一准入（P2-PROJECT-001～009）

**目标：** 工作台与代码模式项目选择器只能展示 Worker 环境变量 `CODE_REPOS` 明确授权的仓库；未授权仓库不得读取文件、创建分支或执行任何写操作。

**实现范围：**
- 新增登录保护的 `GET /api/code/projects`，只返回 Worker 的 `CODE_REPOS` 解析结果。
- `CODE_REPOS` 未配置或为空时，授权仓库列表为空；不再使用代码内置仓库作为默认授权。
- 工作台和代码模式选择器均从该 API 动态加载，不再把两个固定仓库写死为项目注册表。
- 工作台文件读取统一经 Worker 的 `/api/code/file`，并返回文件 SHA；不再通过独立 MCP 文件读取通道绕过 Worker 仓库白名单。
- 分支创建、保存、文件树、审核、合并、丢弃和代码助手项目解析继续由 `codeRepoOk` 执行白名单校验。

**测试：** `tests/workbench-project-registry.test.cjs`：
- `P2-PROJECT-001`：未配置 `CODE_REPOS` 时，授权列表为空。
- `P2-PROJECT-002`：只接受合法 owner/repo 项，大小写重复项去重。
- `P2-PROJECT-003`：项目注册表严格对应白名单输入。
- `P2-PROJECT-004`：未授权仓库不能进入代码助手项目注册表。
- `P2-PROJECT-005`：登录保护的 `GET /api/code/projects` 只返回白名单项目。
- `P2-PROJECT-006`：工作台项目选择器读取 `GET /api/code/projects`，不使用固定项目选项。
- `P2-PROJECT-007`：工作台文件读取使用 Worker 文件 API，并携带返回的 SHA。
- `P2-PROJECT-008`：代码模式项目选择器读取 `GET /api/code/projects`；空列表或读取失败时禁用代码模式。
- `P2-PROJECT-009`：Worker 仓库授权逻辑不包含默认仓库回退清单。

既有项目切换测试已更新为使用完整 `owner/repo` 标识。

**测试类型边界：** 这些测试验证真实源码函数与前端请求契约，但项目列表使用隔离环境变量，不读取线上 Worker Secret；不代表已核验生产环境实际配置了哪些仓库，也不代表对任意仓库执行过真实 GitHub 写操作。

**预览边界：** 本次仅完成动态授权仓库列表和读写准入收口。独立 Pages 预览仍需逐仓库确认部署工作流、Cloudflare Pages 项目和预览 URL 契约；不得因仓库进入 `CODE_REPOS` 就假定它已具备可部署预览。

## 19. 第二阶段：工作台文件读取白名单闭环（P2-READ-001～004）

**目标：** 工作台读取文件必须经过已登录的 Worker API，并由 Worker 的 `CODE_REPOS` 唯一准入规则授权；不允许前端通过独立 MCP 文件读取通道绕过仓库白名单。

**自动化测试：**
- `P2-READ-001`：`CODE_REPOS` 未配置时，文件读取在任何 GitHub 请求前被拒绝。
- `P2-READ-002`：目标仓库不在 `CODE_REPOS` 时，文件读取在任何 GitHub 请求前被拒绝。
- `P2-READ-003`：白名单内文件读取使用指定临时分支 ref，并返回文件 SHA 与内容。
- `P2-READ-004`：工作台 `mcpGet` 通过已登录的 `/api/code/file` 读取；路由先验证登录身份，再调用受 `codeRepoOk` 保护的 `codeGetFile`。

**通过条件：** 四项全部执行并通过；未授权仓库不得触发 GitHub 文件读取；合法读取必须返回 SHA，供后续保存时进行版本一致性校验。

**测试边界：** `P2-READ-001～003` 使用隔离 fetch 模拟验证 Worker 实际读取函数；`P2-READ-004` 核对前端读取入口与 Worker 路由契约。它们不代表线上 Worker Secret、真实 GitHub 令牌或生产环境配置已验收。


## 20. 第二阶段：多项目待处理修改与审核 claim 隔离（P2-PEND-001～007）

**目标：** 同一登录用户在多个 CODE_REPOS 授权仓库中同时存在待处理修改时，待处理记录、Durable Object claim、确认、拒绝、丢弃和清理必须严格按仓库隔离；切换项目不得读取或操作另一个项目的待处理内容。

**实现约束：**
- Durable Object 身份由规范化后的用户 ID 与 owner/repo 共同组成，不允许仅按用户 ID 共用一个待处理记录。
- 每次加载、创建、claim、finish、discard、clear 均必须携带并核验同一个白名单仓库作用域。
- Worker 必须验证待处理记录内的 repo 与当前仓库作用域一致；Durable Object 对跨仓库 claim/finish/discard/clear 请求失败关闭。
- 工作台项目切换时清除旧项目的待处理预览，并重新按新项目加载；确认/丢弃请求必须携带所选项目仓库。
- 不允许通过 KV 旧键或缺少 repo 的请求回退到跨项目共享状态。

**自动化测试：** `tests/code-pending-isolation.test.cjs`：
- `P2-PEND-001`：DO 身份按用户与规范化仓库隔离；不同用户或不同仓库使用不同 DO ID，非白名单仓库无 DO。
- `P2-PEND-002`：同一用户在两个授权项目分别创建待处理记录，读取结果互不覆盖。
- `P2-PEND-003`：对一个仓库创建的待处理记录，不能通过另一个仓库作用域 claim。
- `P2-PEND-004`：项目创建、替换清理和确认流程统一传递仓库作用域。
- `P2-PEND-005`：pending 查询与 force-clear API 必须提供明确仓库作用域。
- `P2-PEND-006`：工作台 UI 发送当前选择仓库，切换项目时刷新待处理预览。
- `P2-PEND-007`：丢弃清理只删除当前用户与当前仓库的 KV 待处理键，不触碰其他项目记录。

**通过条件：** 七项专属测试全部通过，且 `npm test` 与 `npm run build` 成功。任何缺少仓库作用域或仓库不匹配的操作必须拒绝，不得跨项目读取、覆盖或清理。

**测试边界：** Node 测试直接提取 Worker Durable Object 类与辅助函数，使用隔离 storage/fetch 模拟；它证明代码路径的仓库隔离逻辑，不等同于 Cloudflare 已部署 Durable Object 的真实网络并发验收。真实多项目部署仍需在隔离 Worker Preview 上验证，生产配置与生产数据不参与。


## 21. 第二阶段：工作台历史版本与回滚的多项目隔离（P2-HISTORY-001～005）

**目标：** 同一用户在多个 CODE_REPOS 授权仓库中的提交历史、丢弃审计和回滚入口必须按用户与仓库隔离；项目 A 的历史不能显示在项目 B，也不能通过 B 的回滚请求操作 A 的提交。

**实现约束：**
- 历史 KV key 由用户与规范化 owner/repo 共同组成。
- 读取、写入历史必须先验证仓库在 CODE_REPOS 白名单内，并过滤记录 repo。
- 旧版用户级历史迁移时，只把 repo 与当前项目匹配的记录复制到项目级 key；不把其他项目记录带入。
- 历史查询 API 必须要求 repo；回滚请求必须同时提交 repo 与历史记录 ID，并在同一项目作用域内解析记录。
- 工作台历史列表和回滚请求使用当前选中的项目仓库。

**自动化测试：** `tests/code-history-isolation.test.cjs`：
- `P2-HISTORY-001`：历史 key 按用户和规范化仓库隔离。
- `P2-HISTORY-002`：保存一个项目历史时，不写入另一个项目的记录。
- `P2-HISTORY-003`：旧版用户级历史迁移时，仅按当前仓库过滤。
- `P2-HISTORY-004`：非白名单仓库不能读取或保存历史。
- `P2-HISTORY-005`：前端历史查询与回滚请求均携带当前仓库。

**通过条件：** 五项专属测试全部通过；`npm test` 与 `npm run build` 成功。

**测试边界：** 历史 KV 使用隔离模拟；不读取或修改生产用户历史。迁移逻辑只复制匹配当前仓库的记录，旧 key 保留供其他授权仓库后续迁移，不会由某一项目的清理操作删除。
