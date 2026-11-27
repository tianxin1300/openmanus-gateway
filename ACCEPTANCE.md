# OpenManus Gateway — 代码自动化验收规程

> 本文件定义原有 10 项交付状态/界面自动验收，以及新增 5 项开发工作台行为验收。所有项目均由 npm test 执行；不包含人工设备操作或人工证据收集步骤。

## 1. 唯一执行入口与判定规则

在仓库根目录执行：

```bash
npm test
```

该命令运行 node --test tests/*.test.cjs，包括原有 code-mode-providers.test.cjs 与新增 workbench-acceptance.test.cjs。原有 10 项和新增 5 项分别判定；任一专属测试失败、跳过、未执行或测试进程异常退出，对应项即未通过。禁止使用“基本通过”等中间结论。

- **通过**：该项对应的专属 Node.js 自动化测试本次执行成功。
- **未通过**：该项测试失败、被跳过、未执行，或测试无法完成。
- **未执行**：尚未运行本次 `npm test`。它不是通过。
- 每项测试必须直接验证对应源代码行为/逻辑，不以文档文字、Actions 绿灯或其他项目的测试结果替代。
- Actions 负责自动执行同一条 `npm test` 命令并保存日志；Actions 状态不能把失败测试改成通过。

## 2. 自动验收项目（10 项）

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

### AUTO-04 — 终端与可展开运行日志互斥且视口自适应

**自动化测试：** `ACCEPTANCE AUTO-04: terminal and expandable run logs are mutually exclusive and viewport-aware`

**测试覆盖：**
- 终端与运行日志使用独立标签页及正确的 ARIA 关联。
- 切换标签时只显示选中面板；运行日志 details 可展开/收起。
- 收起/切回终端时终端面板恢复，不存在旧的日志扩高覆盖逻辑。
- 视口 resize/scroll 监听同步布局高度与偏移量。

**通过条件：** 对应测试通过。

**失败条件：** 面板可能同时叠加、标签关联错误、收起不能恢复终端，或视口同步代码缺失。

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

本文件只负责代码自动化验收。其他独立的人工确认流程不属于本文件，也不参与这 10 项的计数和判定。

## 5. 最终交付结论

- **代码自动验收：** 10 项专属测试全部通过 = 通过；任一失败/跳过/未执行 = 未通过。
- **最终交付：** 代码自动验收通过后，仍需按项目流程完成部署。

## 6. 开发工作台行为验收（新增 5 项）

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


## 7. 权限、幂等、多文件审核与失败清理（新增 4 项）

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

### WORKBENCH-07 — 重复执行与幂等性

**自动化测试：** `ACCEPTANCE IDEMPOTENCY-01: repeated create reuses one branch and repeated merge cannot create a second commit`

**测试覆盖：**
- 同一用户/项目连续创建两次，第二次复用已有活动分支，不再创建新分支。
- 同一临时分支合并成功后再次提交相同合并请求，不能再次创建提交或重复写入历史。

**通过条件：** 分支创建调用一次、合并调用一次、历史只增加一条。

**边界：** 本项覆盖顺序重复请求；尚不代表并发请求在 KV 竞态下已具备原子去重保证。

### WORKBENCH-08 — 多文件审核及重命名/删除边界

**自动化测试：** `ACCEPTANCE MULTI-REVIEW-01: mixed file review keeps accepted files and rejects rename/delete side effects`

**测试覆盖：**
- 一次包含修改、新增、删除、重命名的多文件变更。
- 只接受指定文件，其余文件不得进入最终比较结果。
- 拒绝重命名时同时恢复 `previous_filename` 源路径，并移除目标路径。
- 拒绝删除时恢复基线文件；拒绝新增时删除新增文件。
- 审核人写入审核事件。

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


## 8. 工作台写操作并发互斥（新增）
 
### WORKBENCH-10 — 同一项目写操作互斥与无锁失败关闭

**自动化测试：** `ACCEPTANCE WORKBENCH-CONCURRENCY-01`、`ACCEPTANCE WORKBENCH-LOCK-FAIL-CLOSED-01`，并由 `ACCEPTANCE LOCK-CLEANUP-01` 检查 Durable Object 锁释放。

**测试覆盖：**
- 同一用户、同一仓库的分支创建和合并共用同一把 Durable Object 锁。
- 创建期间发起合并，第二个操作必须返回 busy，不得进入 GitHub 写操作。
- 锁只能由持有正确 token 的操作释放。
- 操作结束释放锁，后续操作可重新获取。
- 未绑定 `CODE_CLAIMS` 时，创建和合并均失败关闭，不得退回 KV 无锁执行。

**通过条件：** 并发写操作最多一个进入临界区；错误 token 不能解锁；缺少 Durable Object 绑定时不执行 GitHub 写操作。

**边界：** 当前自动测试模拟 Durable Object storage 与请求互斥；Cloudflare 生产 Durable Object 在部署配置、真实并发网络请求和进程中断场景仍需部署后 E2E 验收。
