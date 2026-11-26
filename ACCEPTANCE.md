# OpenManus Gateway — 代码自动化验收规程

> 本文件只定义可由仓库代码自动执行的 10 项验收。所有项目均由 `npm test` 执行；不包含人工设备操作或人工证据收集步骤。

## 1. 唯一执行入口与判定规则

在仓库根目录执行：

```bash
npm test
```

该命令运行 `node --test tests/code-mode-providers.test.cjs`。测试进程退出码为 0 且 10 项专属测试全部通过，10 项自动验收才全部通过；任一专属测试失败、跳过、未执行或测试进程异常退出，对应项即未通过。禁止使用“基本通过”等中间结论。

- **通过**：该项对应的专属 Node.js 自动化测试本次执行成功。
- **未通过**：该项测试失败、被跳过、未执行，或测试无法完成。
- **未执行**：尚未运行本次 `npm test`。它不是通过。
- 每项测试必须直接验证对应源代码行为/逻辑，不以文档文字、Actions 绿灯或其他项目的测试结果替代。
- Actions 负责自动执行同一条 `npm test` 命令并保存日志；Actions 状态不能把失败测试改成通过。
- 这 10 项是代码自动验收，不是设备/浏览器视觉验收。用户最后单独进行的 4 项 iPad 线上视觉确认不属于本文件，也不计入本文件的 10 项。

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

| 编号 | 自动化测试名称 | 本次结果 |
|---|---|---|
| AUTO-01 | 独立预览从当前编辑器内容生成 | 未执行 |
| AUTO-02 | 独立预览同步运行结果、状态链和日志 | 未执行 |
| AUTO-03 | 编辑器长行换行配置完整 | 未执行 |
| AUTO-04 | 终端与可展开运行日志互斥且视口自适应 | 未执行 |
| CHAIN-01 | 已生成状态与后续阶段隔离 | 未执行 |
| CHAIN-02 | 已提交状态必须有提交/关联标识 | 未执行 |
| CHAIN-03 | 已验证状态严格服从验证结论 | 未执行 |
| CHAIN-04 | 部署中状态只对应活动部署 | 未执行 |
| CHAIN-05 | 已部署要求 Pages 与 Worker 都成功 | 未执行 |
| CHAIN-06 | 线上健康要求当前部署真实 HTTP 200 状态 | 未执行 |

**本次执行记录：**
- commit SHA：由 Actions 本次运行自动确定。
- 命令：`npm test`
- 总测试数 / 通过 / 失败 / 跳过：以 Node TAP 输出为准。
- Actions run：由对应提交的 test-project 运行记录提供。
- 10 项最终结论：只有 10 个专属测试全部通过才为“通过”；否则为“未通过”。

## 4. 范围边界

本文件只负责代码自动化验收。其他独立的人工确认流程不属于本文件，也不参与这 10 项的计数和判定。

## 5. 最终结论

- **代码自动验收：** 10 项专属测试全部通过 = 通过；任一失败/跳过/未执行 = 未通过。
- **最终交付：** 代码自动验收通过后，仍需按项目流程完成部署。