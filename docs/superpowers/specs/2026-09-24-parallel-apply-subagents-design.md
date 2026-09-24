# spec-large-self apply 阶段：同阶段模块并行子 agent 执行

日期：2026-09-24
状态：已与用户确认

## 背景

spec-platform 的 `spec-large-self` schema 已有"同编号模块互为并行"的任务编排设计
（tasks.md 阶段号 1-2-2-3 形态），但 `apply.instruction` 的执行纪律只允许主流程
"按任意顺序或穿插执行"——实际仍是单 agent 串行做完。

用户要求：apply 执行 tasks 时，相互之间并列、无依赖无影响的 task 应起不同的子 agent
并行执行。

## 已确认的决策

| 决策点 | 结论 |
|---|---|
| 并行粒度 | **同阶段模块级**：同一阶段编号的多个 `tasks/<模块>.md` 各起一个子 agent；模块内部任务仍串行逐条执行 |
| 默认行为 | **默认强制并行**：同阶段 ≥2 个模块时必须并行，不允许主流程自己串行做完；同阶段只有 1 个模块时主流程自己执行 |
| 失败处理 | **单模块重试 + 超限暂停**：失败模块重启子 agent 续做未完成 checkbox，最多重试 2 次；仍失败则暂停整个 apply，输出问题清单等用户指示；同阶段已成功模块不回滚，下一阶段必须等本阶段全部成功 |
| 写权限 | **子 agent 限定写域 + 主流程统一勾选**：子 agent 只能写本模块代码/测试文件 + 自己的 `tasks/<模块>.md`；`tasks.md` 总控、design*、proposal、specs 一律禁写，发现问题只上报 |

## 关键事实（探索发现）

平台 aiRun 通过 `claude -p` 无头执行，`--allowedTools` 白名单
（`src/services/aiRunService.js`）**不含 `Agent` 工具**。schema 中 design-review、
tasks-review 已写有"用 Agent 工具并行启动子 agent"的指令，在当前白名单下实际无法
生效。本次改动必须把 `Agent` 加入白名单，同时修复该存量问题。

## 改动范围

### 1. schema 母本（核心）

**`templates/schemas/spec-large-self/schema.yaml`**：`version: 2 → 3`。
v2 留档已存在于 `templates/schemas/versions/spec-large-self/v2/`，符合留档纪律，
无需补档；实现时只需核对留档完整性，不得修改已留档目录。

只改 `apply.instruction` 的"第 1 步：TDD 编码"执行纪律，第 0 步（一致性校验）与
第 2 步（OCR 质量闭环）不动。新执行纪律：

1. 读 `tasks.md`，确定当前可执行阶段（编号更小的阶段全部勾完才算可执行）。
2. **该阶段只有 1 个模块**（阶段 1 common-core、末阶段 integration 恒为此类）→
   主流程自己按 TDD 串行执行该模块的 `tasks/<模块>.md`。
3. **该阶段 ≥2 个模块** → 必须用 Agent 工具在**同一条消息里**为每个模块各启动一个
   子 agent 并行执行。每个子 agent 的输入：
   - 本模块 `tasks/<模块>.md`、`design/<模块>.md`、`specs/<模块>/spec.md` 的路径
   - 总 `design.md` 的跨模块接口契约与横切规范（只读依据）
   - 执行纪律摘录：强制 TDD（先调用 superpowers `test-driven-development` 技能，
     RED → GREEN → REFACTOR）、测试源头锚定（以 spec 场景 + design「测试要点」表
     为准）、完成一条勾一条、写域限制、遇阻塞或文档冲突时**上报而非自行改跨模块文档**
4. **子 agent 写域**（硬性约束，写入每个子 agent 的提示词）：
   - 可写：本模块的代码/测试文件、本模块的 `tasks/<模块>.md`
   - 禁写：`tasks.md`、`design.md`、`design/*.md`（本模块文件除外）、
     `proposal.md`、`specs/**`、其他模块的任何文件
   - 发现文档与现实冲突、文档间冲突：记录在返回报告中，由主流程裁决
5. **主流程汇总**（全部子 agent 返回后）：
   - 核对各 `tasks/<模块>.md` 的 checkbox 全部勾完
   - 统一勾掉 `tasks.md` 中对应模块项（只有主流程写 tasks.md）
   - 处理各子 agent 上报的问题：涉及跨模块契约/公共文档的修改由主流程执行，
     登记【修改点清单】；触发评审复审条件的（跨模块契约或公共数据模型变更）
     按现有全量一致纪律重跑 design-review / tasks-review 受影响评审组
6. **失败处理**：某模块子 agent 失败（有任务未勾完 / 验证命令不过 / 子 agent 报错）→
   对该模块重新启动一个子 agent，从未完成的 checkbox 续做，最多重试 2 次；
   仍失败 → 暂停整个 apply，向用户输出问题清单等待指示。
   同阶段其他已成功模块不回滚；进入下一阶段的前提是本阶段全部模块成功。
7. 其余纪律不变：不得跨阶段抢跑；integration 必须等所有功能模块勾完；
   遇阻塞或需求不明确时暂停向用户确认。

**`templates/schemas/spec-large-self/config.rules.yaml`**：`rules.tasks` 追加一条：

> apply 阶段同阶段编号的多模块必须由独立子 agent 并行执行，模块内任务串行；
> 子 agent 只写本模块文件，tasks.md 总控勾选由主流程统一执行

（config.rules.yaml 属母本文件，修改即随 schema.yaml 一同升 v3。）

### 2. 平台后端

**`src/services/aiRunService.js`**：`ALLOWED_TOOLS` 数组增加 `'Agent'`。
`DISALLOWED_TOOLS` 不变（Agent 子代理继承会话的 allowed/disallowed 面，
`git config/push/remote/commit` 依旧被拒）。不新增其他工具。

### 3. 测试与文档

- `test/airun.test.js`：断言 spawn 参数的 `--allowedTools` 含 `Agent`。
- 涉及母本版本/内容的既有测试（如 upgrade、registryService 相关）按 v3 更新断言。
- `README.md` aiRun 章节：白名单说明补充 `Agent`（用于 schema 内置的多子 agent
  并行评审与 apply 并行执行）；"风险须知"段落不变（Agent 不扩大文件写入面，
  子代理受同一 allowed/disallowed 约束）。

## 明确不做（YAGNI）

- 不做模块内单条任务级并行（模块内串行是用户确认的决策）。
- 不加平台级"并行/串行"开关（默认强制并行）。
- 不改 aiRun 并发模型：平台全局 2 个 job、同项目 1 个运行中 job 的限制不动——
  模块并行发生在**一个** claude 进程内部，由 Agent 工具承载，不占平台 job 名额。
- 不改 design-review / tasks-review 的既有子 agent 指令（它们随 Agent 白名单
  放开自然恢复可用，无需改动文本）。

## 错误处理与边界

- 子 agent 返回报告格式不强制 JSON，主流程按 checkbox 实际状态判定成败
  （文件事实 > 子 agent 口头汇报）。
- 重试的子 agent 提示词中额外携带：上一轮失败原因摘要 + 已完成/未完成 checkbox 清单。
- 若同阶段模块数超过 4，仍全部并行启动（Agent 工具同消息多启动即为并行），
  不引入平台侧分批逻辑——上下文与额度消耗在提示词中提醒主流程即可。

## 升级路径

老项目通过平台既有的 schema 升级通道（三方合并）升到 v3：
`apply.instruction` 属 schema.yaml（不进项目目录，项目侧生效的是 config.yaml rules），
`config.rules.yaml` 新增条目经 rules 重建合并进项目 `openspec/config.yaml`，
用户个性化 rules 保留。
