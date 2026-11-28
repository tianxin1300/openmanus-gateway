# 第二阶段正式验收矩阵（初版）

- 仓库：`tianxin1300/openmanus-gateway`
- 范围：仅本仓库第二阶段；第三阶段另设附录，不计入第二阶段验收成绩。
- 编制日期：2026-11-29
- 本文件状态：**核查初版，不是最终验收通过声明**。
- 基准代码：PR #69 head `4ffdac0baccc4402d06951370c15a2a3a0211868`；叠加 PR #102 head `a7071e68db2d1fc28c7a6c0bf6f67d758038363d`。
- 分支关系：#102 base = #69 head；#69 base = `code/workbench-acceptance-phase1-20261128`。两者均 Draft、未合并。
- 证据运行：
  - #69：[#46159210395](https://github.com/tianxin1300/openmanus-gateway/actions/runs/46159210395)，SHA `4ffdac0...`，Node TAP 258/258；Build、Pages 隔离预览、4 组浏览器项目、GitHub PR 生命周期 E2E、Workbench Merge/CAS GitHub API E2E 的步骤均成功。
  - #102：[#46164842866](https://github.com/tianxin1300/openmanus-gateway/actions/runs/46164842866)，SHA `a7071e6...`，Node TAP 268/268（0 failed、0 skipped）；Build、Pages 隔离预览、4 组浏览器项目、GitHub PR 生命周期 E2E、Workbench Merge/CAS GitHub API E2E 的步骤均成功。
- 重要边界：以上运行证明的是对应提交的测试与临时环境结果；不代表生产 Worker、生产 Durable Object、生产 CODE_REPOS Secret 或生产部署已经验收。

## 1. 判定口径

| 级别 | 证据类型 | 可以证明 | 不能替代 |
|---|---|---|---|
| L0 | 静态代码/文档核查 | 存在代码入口、调用路径或约束 | 运行行为 |
| L1 | Node 单测/隔离模拟 | 被测源码逻辑在模拟环境中的行为 | 真实 GitHub、Cloudflare 网络和生产数据 |
| L2 | Playwright 浏览器 E2E | 指定浏览器/视口下的真实页面交互 | 真实模型服务、生产 Worker |
| L3 | 真实 GitHub API E2E | 临时 refs/PR 上的真实 GitHub API 操作 | 生产合并或部署 |
| L4 | 独立 Pages Preview | 对应提交的隔离 Pages 构建、HTTP 探测和浏览器访问 | Worker Preview / Durable Object 真实部署 |
| L5 | Worker Preview / DO E2E | 隔离 Worker 与真实 DO 部署运行 | 生产健康 |
| L6 | 生产部署与健康检查 | 用户确认后的部署与线上探测 | 不适用于当前 Draft 阶段 |

规则：没有对应级别的证据就标“未验证”；测试未执行不能算通过；模拟测试不能标成真实 E2E；HTTP 200 只证明被探测 URL 可响应，不证明整条交付链完成。

## 2. 七大模块验收矩阵

| 模块 | 必须达到的能力 | 当前实现与证据 | 当前判定 | 未闭环事项 |
|---|---|---|---|---|
| M1 AI 对话与任务入口 | 自然语言需求进入代码模式；识别目标项目；分析文件；形成可执行修改计划；模型实际执行修改；失败上下文可恢复 | 代码模式、模型供应商/调用逻辑及工作台入口已有代码；相关 Node 测试纳入 #69/#102 的 npm test。当前两个完整运行没有证明本轮真实调用外部模型并完成一项端到端开发任务 | **部分实现** | 需要隔离测试任务证明真实模型调用、文件读取、修改产物与任务 ID 的绑定；验证失败/超时后上下文可恢复。不能用 mock 模型测试代替 |
| M2 多项目管理 | 项目列表唯一来自 Worker `CODE_REPOS`；未授权项目失败关闭；项目/分支/待处理修改/历史/记忆/运行记录互相隔离 | P2-PROJECT-001～009、P2-READ-001～004、P2-PEND-001～007、P2-HISTORY-001～006、P2-MEM-001～007；#102 增加运行索引/日志仓库隔离。共 33 项项目隔离专属测试 + 10 项运行记录隔离测试，均包含在 #102 的 268 项通过中 | **代码级已覆盖；部署级部分实现** | 生产 CODE_REPOS 值未核验；真实 Cloudflare DO 多项目隔离/并发尚未由 Worker Preview 证明；运行记录跨项目隔离尚未做真实部署环境验证 |
| M3 代码编辑审核 | 文件树/读取、差异、逐文件接受/拒绝；重命名/删除/新增正确恢复；失败后保留可重试状态 | WORKBENCH-04、08、12、16；Playwright 覆盖重命名拒绝、拒绝失败重试、合并冲突保留差异、文件拒绝失败恢复等场景；#102 前端增加按 repo 查询运行历史/日志 | **隔离逻辑与浏览器交互已覆盖；真实多项目页面联调部分验证** | 需在真实隔离 Worker Preview 验证认证、CODE_REPOS、文件读取、DO claim 和审核写入共同工作；逐文件审核结果与 task_id 的全链路关联尚未证明 |
| M4 Git 版本管理 | 临时分支隔离 main；禁止直接写 main；幂等创建/合并；冲突保护；失败重试、回滚、合并后恢复 | WORKBENCH-01～05、07、09、11、13～15；#69/#102 的 GitHub API E2E 使用临时 refs/PR，验证分支/PR 生命周期和 merge/CAS；运行后清理临时 refs，检查 main SHA 未变 | **隔离模拟 + 真实 GitHub API E2E 已覆盖；生产合并未执行** | 真实账号权限/仓库规则的生产条件仍未验收；不得因 E2E 通过而合并任何 Draft PR |
| M5 自动化验证 | 测试、构建、浏览器验证；失败可定位；修复后重新验证；验证结果绑定提交 | #102 run 执行 `npm test` 268/268、`npm run build` 成功；Playwright 4 个项目成功；Actions run 记录 SHA。失败定位后由 AI 自动修复并重跑的完整闭环尚未由该运行证明 | **验证执行已实现；AI 自动修复闭环部分实现/未验收** | 需用隔离故障注入证明真实日志进入模型、模型改临时分支、再次运行测试并以新 SHA 关联结果；不得把 mock repair 测试算作真实模型闭环 |
| M6 任务追踪 | 任务 ID 贯穿需求、项目、分支、AI 修改、审核、提交、Actions Run、日志、预览和交付；状态由真实事件驱动 | 现有状态链测试覆盖 generated/submitted/verified/deploying/deployed/online-health；#102 的 RUN-ISOLATION-01～10 验证 repo/user 隔离、项目/分支/commit/task/Actions 元数据、旧记录不猜项目归属 | **部分实现** | 当前证据未证明同一个 task_id 从自然语言入口贯穿到审核、commit、Actions、预览和最终交付；现有六阶段状态链不等于用户定义的十二状态完整状态机 |
| M7 独立预览与交付 | 每个项目/分支有独立预览；预览对应同一提交；用户验收后才允许合并部署；部署后真实健康检查 | #69/#102 test-project 执行隔离 Pages Preview，日志含 curl HTTP 200 探测；Playwright 在预览地址执行。工作台预览范围测试存在。当前 run 未包含隔离 Worker Preview/真实 DO 部署；生产部署保持禁用/未触发 | **Pages Preview 已验证；Worker Preview 与完整交付未验证** | 必须逐项目验证 Pages/Worker 预览配置与提交对应关系；验证预览与 task/branch/SHA 绑定；生产部署、线上健康和用户确认流程均待后续授权阶段 |

## 3. 第二阶段专属测试清单

### 3.1 项目与数据隔离（33 项）

| 范围 | 编号 | 数量 | 主要验证点 | 测试级别 |
|---|---|---:|---|---|
| 动态项目注册表 | P2-PROJECT-001～009 | 9 | CODE_REPOS 唯一准入、无默认授权、动态项目选择器、代码助手项目选择 | L1 |
| 文件读取 | P2-READ-001～004 | 4 | 未授权先拒绝、按指定 ref 读取、返回 SHA、通过登录 Worker API | L1 |
| 待处理修改/审核 claim | P2-PEND-001～007 | 7 | 用户+仓库 DO 身份、跨项目 claim 拒绝、项目切换与清理隔离 | L1 |
| 历史与回滚 | P2-HISTORY-001～006 | 6 | 历史键、迁移、读取、保存、回滚按用户+仓库隔离 | L1 |
| 项目聊天记忆 | P2-MEM-001～007 | 7 | 提示词记忆按用户+仓库隔离、白名单、最近 20 条 | L1 |

### 3.2 工作台行为验收（WORKBENCH-01～17）

| 编号 | 验收主题 | 当前证据 | 级别/边界 |
|---|---|---|---|
| 01 | 临时分支隔离 | 隔离 GitHub/KV 模拟；真实 GitHub merge E2E 另有覆盖 | L1 + L3 |
| 02 | 拦截直接写 main | Worker 写保护测试 | L1 |
| 03 | 失败重试与局部回滚 | run ID 重试、指定路径回滚测试 | L1 |
| 04 | 文件级审核 | 拒绝文件不进入最终合并差异 | L1 |
| 05 | 并发修改冲突 | base SHA 漂移时拒绝合并 | L1 + L3 CAS |
| 06 | 权限边界与操作者审计 | 未授权写入拒绝、授权操作记录 actor；token 路由测试 | L1 |
| 07 | 重复执行与幂等 | 重复创建/合并、并发创建模拟 | L1 |
| 08 | 多文件审核及重命名/删除 | 重命名拒绝、恢复失败保护、最终合并差异重算；Playwright 交互 | L1 + L2 |
| 09 | 失败后的状态清理 | 删除失败保留状态、DO claim 锁清理模拟 | L1；真实 DO 中断恢复未验证 |
| 10 | 写操作并发互斥 | DO 锁并发/失败关闭/锁作用域模拟 | L1；生产 DO 未验证 |
| 11 | 分支创建记录失败补偿 | KV 失败后的分支清理/孤儿标记 | L1 |
| 12 | 审核路径与读写失败保护 | 非法路径、受保护路径、读写失败不记成功 | L1 |
| 13 | 合并后历史与清理恢复 | 合并成功后记录/清理失败可恢复且不重复合并；UI reload 场景 | L1 + L2 |
| 14 | 仓库锁原子性与租约续期 | DO 事务原子获取、续租、心跳及续租失败测试 | L1；生产 DO 未验证 |
| 15 | main 合并 CAS | 审核 base/head SHA、scratch ref 清理、非快进冲突 | L1 + L3 |
| 16 | UI 失败恢复 | 文件审核、合并冲突、丢弃失败保留可恢复状态；Playwright 场景 | L1 + L2 |
| 17 | 项目切换与未保存编辑保护 | 脏项目切换取消保留当前编辑；切换后清空旧分支状态并加载新项目 | L1 + L2 |

说明：WORKBENCH 测试位于 `tests/workbench-acceptance.test.cjs` 和 `tests/workbench-ui.spec.cjs`。Node 模拟与浏览器 E2E 分开计数；不能把它们合并成一个“真实端到端”数字。

### 3.3 运行记录隔离增量（PR #102）

| 编号 | 验收点 | 结论依据 | 级别 |
|---|---|---|---|
| RUN-ISOLATION-01 | 同一用户不同授权仓库的索引隔离 | 专属测试通过 | L1 |
| RUN-ISOLATION-02 | 摘要保留项目、分支、提交、任务、Actions 关联字段 | 专属测试通过 | L1 |
| RUN-ISOLATION-03 | 同一 Actions Run ID 在不同仓库的日志键不冲突 | 专属测试通过 | L1 |
| RUN-ISOLATION-04 | 跨仓库日志读取拒绝 | 专属测试通过 | L1 |
| RUN-ISOLATION-05 | 未授权仓库不能列出/读取日志 | 专属测试通过 | L1 |
| RUN-ISOLATION-06 | 旧用户级索引和无 repo 日志不猜测归属 | 专属测试通过 | L1 |
| RUN-ISOLATION-07 | 无 repo 记录不写入猜测项目作用域 | 专属测试通过 | L1 |
| RUN-ISOLATION-08 | DO watcher 使用同一 repo-scoped index writer | 专属测试通过 | L1 |
| RUN-ISOLATION-09 | 同仓库同 Actions Run ID 不同用户不冲突 | 专属测试通过 | L1 |
| RUN-ISOLATION-10 | 短 SHA 不误标为分支或完整 head SHA | 专属测试通过 | L1 |

## 4. 十二状态交付链核对

用户定义的十二状态是目标状态机，不可直接等同于旧版六阶段交付条。当前测试明确覆盖的旧阶段为：已生成、已提交、已验证、部署中、已部署、线上健康。项目识别、临时分支、AI 修改、审核、验收等待、独立预览、合并确认等能力有分散实现和测试，但**尚未证明由同一个 task_id 驱动的十二状态状态机**。

| 用户目标状态 | 当前核查结论 |
|---|---|
| 1 任务已创建 | 任务入口存在；统一 task_id 生命周期未证明 |
| 2 项目已识别 | 动态 CODE_REPOS 项目列表和项目解析有专属测试 |
| 3 临时分支已创建 | 分支创建与 main 隔离有专属测试 |
| 4 AI 已完成修改 | AI 代码入口存在；真实模型修改闭环未验收 |
| 5 等待代码审核 | 待处理修改和逐文件审核逻辑存在；与 task_id 关联未证明 |
| 6 已接受并提交 | 接受/合并逻辑和 Git 历史测试存在；同一任务链关联未证明 |
| 7 自动化验证中 | Actions 运行状态可追踪；任务链关联需补强 |
| 8 验证通过 | 测试与构建结果可由 Actions 得出 |
| 9 独立预览可用 | Pages Preview 已在 test-project 中验证；Worker Preview 未验证 |
| 10 等待合并确认 | Draft/人工确认流程存在；统一状态事件未证明 |
| 11 部署中 | 旧交付链测试覆盖活动部署状态；当前生产部署未执行 |
| 12 线上健康 | 旧链测试覆盖 HTTP 200 逻辑；当前 PR 测试没有生产健康证据 |

## 5. 当前证据汇总

| 项目 | 证据 | 结论 |
|---|---|---|
| PR #69 完整 Node 测试 | Run #46159210395，258 passed / 0 failed / 0 skipped | 通过 |
| PR #102 完整 Node 测试 | Run #46164842866，268 passed / 0 failed / 0 skipped | 通过 |
| 仓库内构建检查 | 两次基线 run 的 `npm run build`（Worker/前端 JS 语法检查）成功 | 通过 |
| Cloudflare Workers Builds 外部检查 | #69 head、#102 head 与本矩阵 head 的 `Workers Builds: openmanus-gateway` 状态均为 failure；#69 PR 记录该失败在其 base `466aa18...` 上也存在 | **失败（外部 Cloudflare 检查）**；不得与仓库内 `npm run build` 混为一谈 |
| Pages Preview | 两次 run 的隔离 Pages 部署与 HTTP 探测步骤成功 | 通过（仅 Pages） |
| 浏览器 E2E | Chromium iPhone 14、WebKit iPhone 14、WebKit iPhone 13 Pro、WebKit iPad 9th generation 四个项目步骤成功；测试文件定义 10 个场景 | 通过（指定模拟设备/浏览器） |
| 真实 GitHub PR 生命周期 E2E | Actions job 步骤成功，使用临时 PR/ref 并清理 | 通过（临时资源） |
| Workbench Merge/CAS GitHub API E2E | Actions job 步骤成功，真实 GitHub API 临时 refs 验证合并与冲突 | 通过（临时资源） |
| Cloudflare Worker Preview / 真实 Durable Object | 上述 run 的 job steps 未包含 Worker Preview/DO 部署验证 | 未验证 |
| 真实模型开发闭环 | 上述 run 未证明真实模型服务完成端到端修改 | 未验证 |
| 生产合并/部署/健康 | PR 均 Draft；未执行生产操作 | 未执行 |

## 6. 已发现的文档与验收风险

1. PR #69 描述中将项目列表接口写为 `GET /api/code/repos`，而当前前端代码与 ACCEPTANCE.md 的 P2-PROJECT 部分使用 `GET /api/code/projects`。以当前分支代码和专属测试为准，后续应统一 PR 描述/验收文档，避免接口契约文档漂移。
2. ACCEPTANCE.md 的 WORKBENCH-01～17 与 P2-PROJECT/READ/PEND/HISTORY/MEM、PR #102 RUN-ISOLATION 是不同维度；不得把全部编号当作同一测试总数重复相加。
3. #69/#102 的 test-project 成功包含 Pages Preview 和 GitHub API E2E，但不包含 Worker Preview/生产 DO E2E。另：Cloudflare Workers Builds 外部检查在 #69、#102 和本矩阵 head 上均显示 failure；仓库内 `npm run build` 成功并不能覆盖或解释该外部失败。#69 PR 描述记录该外部失败在其 base commit 上也存在。
4. #102 修改 `worker.js` 的范围仅限运行记录索引、日志键和查询隔离；后续发现其他 Worker 缺口，必须另行确认授权，不能借此扩大修改范围。
5. 真实模型调用、AI 自动修复后重验、任务 ID 贯穿十二状态仍是第二阶段关键未闭环项。对当前 PR #102 前端 `frontend/index.html` 的静态核查：全文没有 `task_id` 或 `taskId` 字段；临时分支创建请求只提交 `repo`、`project`、`base`。因此当前 UI 尚未把任务 ID 作为贯穿分支、审核和运行记录的统一关联键，这不是推测，而是本次代码检索结果。

## 7. 下一步按单缺口闭环

优先顺序：
1. **任务 ID 全链路关联**：先静态追踪需求入口、分支创建、pending/review、commit、Actions run、日志、Pages Preview 的 ID 字段；列出断点和最小测试，不先改 Worker。
2. **真实 Worker Preview / DO**：在用户已授权的隔离预览流程内核验项目授权、文件读取、pending claim、历史/运行记录隔离；不接触生产。
3. **真实模型调用与失败修复闭环**：用隔离任务和可控测试输入证明模型被真实调用、产物写入临时分支、失败日志回流、修复后重新验证。
4. **修正文档契约漂移**：接口路径和验收文档统一；不改变功能行为。
5. 每个缺口独立补测试、更新矩阵、执行 test-project 并核对原始 Actions 日志，再进入下一项。

当前不合并 main、不部署生产、不处理真实 Issue、不触碰 PR #32，也不把第三阶段 Cron Agent 计入第二阶段验收。
