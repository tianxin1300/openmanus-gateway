# OpenManus Gateway — 代码自动化验收规程

> 本文件是代码工作台验收索引，区分 Node.js 自动化测试、Playwright UI E2E 和尚未具备专属自动化测试的待验项。当前快照：`code-mode-providers.test.cjs` 有 81 个静态 `test(...)` 声明；其中两个声明在两个工作台文件上各执行一次，按当前源码预计 Node TAP 展开为 83 项。`workbench-acceptance.test.cjs` 有 42 个静态测试声明，因此按源码预计 `npm test` 共 125 项；最终数量以本次 TAP 输出为准。Playwright UI 文件另有 7 个场景，分别在 Chromium/iPhone 14 与 WebKit/iPhone 14 项目执行；不计入 Node TAP 项数。

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

**自动化测试：** `ACCEPTANCE PERMISSION-01: unauthorized identities cannot create, review, or merge; authorized actions are attributed`

**测试覆盖：**
- 非授权用户及自动化身份尝试创建临时分支、审核文件、合并推送。
- 三类操作均必须在任何 GitHub 写请求前拒绝。
- 授权创建记录 `created_by`。
- 文件拒绝审核记录 `last_reviewed_by` 与 `review_events.actor`。
- 合并历史记录 `actor`。

**通过条件：** 未授权操作没有 GitHub 写调用；授权操作的创建、审核和合并历史均可追溯到认证用户。

**边界：** 当前权限测试直接调用工作台函数并注入身份，不模拟 `userFromReq` 的真实 token 验证、失效 token 或 HTTP 路由；这些仍需独立 API 集成验收。

### WORKBENCH-07 — 重复执行与幂等性

**自动化测试：** `ACCEPTANCE IDEMPOTENCY-01: repeated create reuses one branch and repeated merge cannot create a second commit`；`ACCEPTANCE IDEMPOTENCY-CONCURRENT-CREATE-01`

**测试覆盖：**
- 同一用户/项目连续创建两次，第二次复用已有活动分支，不再创建新分支。
- 同一项目并发创建两次，第二个请求被锁拦截；首个创建完成后重试，复用同一分支。
- 同一临时分支合并成功后再次提交相同合并请求，不能再次创建提交或重复写入历史。

**通过条件：** 分支创建调用一次、合并调用一次、历史只增加一条。

**边界：** 本项覆盖顺序重复请求；尚不代表并发请求在 KV 竞态下已具备原子去重保证。

### WORKBENCH-08 — 多文件审核及重命名/删除边界

**自动化测试：** `ACCEPTANCE MULTI-REVIEW-01: mixed file review keeps accepted files and rejects rename/delete side effects`；`ACCEPTANCE WORKBENCH-RENAME-DIFF-01`；Playwright `rejecting a renamed file sends the previous filename so the source path can be restored`

**测试覆盖：**
- 一次包含修改、新增、删除、重命名的多文件变更。
- 只接受指定文件，其余文件不得进入最终比较结果。
- 拒绝重命名时同时恢复 `previous_filename` 源路径，并移除目标路径。
- 拒绝删除时恢复基线文件；拒绝新增时删除新增文件。
- 审核人写入审核事件。
- Diff API 必须把 GitHub 的 `previous_filename` 映射为 `previous_path`，前端拒绝重命名时必须把旧路径传回 Worker；Node 与 Playwright 分别验证数据映射和实际按钮请求。

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
- 同一仓库跨授权用户的分支创建、编辑器保存、文件审核、合并、丢弃和历史回滚共用同一把 Durable Object 锁；仓库名大小写变体映射到同一锁身份。
- 创建期间发起合并，第二个操作必须返回 busy，不得进入 GitHub 写操作；编辑器保存、文件审核、丢弃和回滚也必须经过同一把锁。
- 锁只能由持有正确 token 的操作释放。
- 操作结束释放锁，后续操作可重新获取。
- 未绑定 `CODE_CLAIMS` 时，创建、编辑器保存和合并均失败关闭，不得退回 KV/MCP 无锁写入。

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

**自动化测试：** `ACCEPTANCE MERGE-HISTORY-RECOVERY-01`、`MERGE-CLEANUP-01`、`MERGE-RECORD-CLEANUP-01`。

**测试覆盖：**
- GitHub 合并已成功但历史记录写入失败：保留临时分支和可恢复记录；重试先补写历史，不得再次调用合并。
- 历史保存成功但临时分支删除失败：记录 `merged_cleanup_failed`；重试只清理分支，不重复合并。
- 分支删除成功但 KV 记录删除失败：记录 `merged_record_cleanup_failed`；重试只完成状态清理，不重复合并。

**通过条件：** 合并成功后的历史写入、分支删除和 KV 清理分别可恢复；重复请求不得生成第二次合并。


## 12. 仓库锁原子性与租约续期（WORKBENCH-14）

### WORKBENCH-14 — Durable Object 仓库锁必须原子获取并支持续期

**自动化测试：** `ACCEPTANCE WORKBENCH-LOCK-ATOMIC-01`、`WORKBENCH-LOCK-RENEW-01`、`WORKBENCH-LOCK-HEARTBEAT-01`、`WORKBENCH-LOCK-HEARTBEAT-FAIL-01`、`WORKBENCH-SAVE-CAS-01`、`WORKBENCH-ROLLBACK-LOCK-01`。

**测试覆盖：**
- 两个并发请求同时获取同一仓库锁，事务竞争后只能有一个成功。
- 锁持有者可续期；错误 token 不得续期或延长其他操作的租约。
- 工作台长操作每 60 秒续租，结束时清除心跳并释放锁。
- 续租失败时不误报成功，而是返回不确定状态与 GitHub 核验提示。
- 编辑器保存必须经 Worker 锁入口执行，并以当前文件 SHA 做 compare-before-write；旧 SHA 返回冲突，不得覆盖新内容。
- 历史回滚属于写操作，必须与创建、保存、审核、合并、丢弃共用同一仓库锁，避免回滚与其他写入同时推进目标分支。

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

### 14.1 Node.js 工作台行为测试（42 项）

文件：`tests/workbench-acceptance.test.cjs`

| 分组 | 专属测试名称 |
|---|---|
| 分支隔离与写入保护 | `ACCEPTANCE BRANCH-01`、`ACCEPTANCE MAIN-01`、`ACCEPTANCE CONFLICT-01` |
| 文件审核与重试回滚 | `ACCEPTANCE REVIEW-01`、`ACCEPTANCE RETRY-ROLLBACK-01`、`ACCEPTANCE MULTI-REVIEW-01`、`ACCEPTANCE MULTI-REVIEW-RECOVERY-01`、`ACCEPTANCE WORKBENCH-RENAME-DIFF-01` |
| 权限与幂等 | `ACCEPTANCE PERMISSION-01`、`ACCEPTANCE IDEMPOTENCY-01`、`ACCEPTANCE IDEMPOTENCY-CONCURRENT-CREATE-01` |
| 丢弃、失败清理与创建补偿 | `ACCEPTANCE CLEANUP-01`、`ACCEPTANCE LOCK-CLEANUP-01`、`ACCEPTANCE CREATE-CLEANUP-01` |
| 仓库写锁与租约 | `ACCEPTANCE WORKBENCH-CONCURRENCY-01`、`ACCEPTANCE WORKBENCH-LOCK-FAIL-CLOSED-01`、`ACCEPTANCE WORKBENCH-LOCK-SCOPE-01`、`ACCEPTANCE WORKBENCH-LOCK-CASE-01`、`ACCEPTANCE WORKBENCH-LOCK-ATOMIC-01`、`ACCEPTANCE WORKBENCH-LOCK-RENEW-01`、`ACCEPTANCE WORKBENCH-LOCK-HEARTBEAT-01`、`ACCEPTANCE WORKBENCH-LOCK-HEARTBEAT-FAIL-01`、`ACCEPTANCE WORKBENCH-SAVE-CAS-01`、`ACCEPTANCE WORKBENCH-ROLLBACK-LOCK-01` |
| 审核拒绝路径与失败保护 | `ACCEPTANCE REVIEW-GUARD-01`、`ACCEPTANCE REVIEW-GUARD-02`、`ACCEPTANCE REVIEW-READ-01`、`ACCEPTANCE REVIEW-READ-02`、`ACCEPTANCE REVIEW-WRITE-01`、`ACCEPTANCE REVIEW-WRITE-02` |
| 合并后恢复与清理 | `ACCEPTANCE MERGE-HISTORY-RECOVERY-01`、`ACCEPTANCE MERGE-CLEANUP-01`、`ACCEPTANCE MERGE-RECORD-CLEANUP-01` |
| 合并 CAS 与 Git ref 边界 | `ACCEPTANCE MERGE-CAS-01`～`MERGE-CAS-07`、`ACCEPTANCE GIT-REF-WRITE-01`、`ACCEPTANCE WORKBENCH-CAS-CONFLICT-01` |

**计数说明：** 上述分组对应文件内 39 个 `test(...)` 用例。编号范围表达的是测试名称前缀，不代表每个数字只对应一个测试。特别是 WORKBENCH-15 的 CAS 验收由 7 个用例覆盖，另外还有 Git ref 写入端点和 422 冲突映射两个补充边界用例。

### 14.2 Playwright UI E2E（7 个场景 × 2 个浏览器项目）

文件：`tests/workbench-ui.spec.cjs`

| 场景 | Chromium · iPhone 14 | WebKit · iPhone 14 |
|---|---|---|
| 文件审核：拒绝一个文件、接受另一个文件，只推送接受路径 | 独立执行 | 独立执行 |
| 文件重命名审核：拒绝时提交 previous_path，确保旧路径可恢复 | 独立执行 | 独立执行 |
| 丢弃保持 main 不变；历史回滚创建新的活动分支 | 独立执行 | 独立执行 |
| 终端/运行日志标签页互斥切换；检查移动视口尺寸变化后的布局变量 | 独立执行 | 独立执行 |
| 文件拒绝接口首次失败后，改动仍保留并允许重试 | 独立执行 | 独立执行 |
| 合并遇到 409 冲突时保留临时分支和已接受差异 | 独立执行 | 独立执行 |
| 丢弃接口失败时保留活动分支并允许再次操作 | 独立执行 | 独立执行 |

工作流命令：
- `npx playwright test --project=chromium-iphone`
- `npx playwright test --project=webkit-iphone`

这 2 个场景使用 Playwright API fixtures 模拟后端响应，验证前端交互与请求载荷；它们不是对真实 GitHub 仓库执行分支创建、合并或回滚的生产端到端测试。浏览器项目成功只代表该项目下的 UI 用例通过。

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
