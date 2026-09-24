# spec-large-self apply 同阶段模块并行子 agent 执行 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 spec-large-self 的 apply 阶段在同阶段多模块时强制用子 agent 并行执行，并放开平台 aiRun 白名单中缺失的 `Agent`/`Skill` 工具。

**Architecture:** 纯提示词层改动（schema 母本 `apply.instruction` 执行纪律重写 + `config.rules.yaml` 追加规则 + 母本升 v3）加一处平台后端白名单扩容（`aiRunService.js` 的 `ALLOWED_TOOLS`）。模块并行发生在一个 claude 进程内部，由 Agent 工具承载，不改平台 job 并发模型。

**Tech Stack:** Node.js（node:test）、YAML schema 母本、既有三方合并升级通道。

**Spec:** `docs/superpowers/specs/2026-09-24-parallel-apply-subagents-design.md`

---

### Task 1: aiRun 白名单加入 Agent 与 Skill（TDD）

**Files:**
- Modify: `test/airun.test.js`（`launch 以 claude -p 斜杠命令启动` 用例内，约 128-158 行）
- Modify: `src/services/aiRunService.js:28-32`（`ALLOWED_TOOLS`）

- [ ] **Step 1: 写失败测试**

在 `test/airun.test.js` 的 `launch 以 claude -p 斜杠命令启动：权限旗标收紧，git 危险子命令被拒` 用例中，`assert.ok(!lastSpawn.args.includes('Bash(git:*)'));` 一行之前插入：

```javascript
  // 白名单必须含 Agent/Skill：schema 的 design-review/tasks-review/apply
  // 指令依赖子 agent 并行与 TDD 技能调用（无头模式下不在白名单即不可用）
  const allowIdx = lastSpawn.args.indexOf('--allowedTools');
  assert.ok(allowIdx > -1);
  const allowed = lastSpawn.args.slice(allowIdx + 1, lastSpawn.args.indexOf('--disallowedTools'));
  assert.ok(allowed.includes('Agent'), '缺少 Agent 工具');
  assert.ok(allowed.includes('Skill'), '缺少 Skill 工具');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/huahua/IdeaProjects/ai_study/spec-platform && node --test test/airun.test.js`
Expected: FAIL，报 `缺少 Agent 工具`

- [ ] **Step 3: 最小实现**

`src/services/aiRunService.js` 中 `ALLOWED_TOOLS` 改为（同步更新其上方注释）：

```javascript
/**
 * 作用域工具白名单：openspec 全量 + git 只读/暂存子命令 + 常规读写编辑
 * + Agent（schema 内置的多子 agent 并行评审与 apply 并行执行）
 * + Skill（apply/子 agent 强制调用 test-driven-development 技能）。
 * git config/push/remote/commit 不在允许面（提示词注入的经典升级路径），
 * 并再显式 --disallowedTools 拒绝一层；Agent 子代理继承同一 allowed/disallowed 面。
 * 不使用 dangerously-skip-permissions。
 */
const ALLOWED_TOOLS = [
  'Bash(openspec:*)', 'Bash(git status:*)', 'Bash(git diff:*)',
  'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git add:*)',
  'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Agent', 'Skill',
];
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/airun.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/aiRunService.js test/airun.test.js
git commit -m "feat: aiRun 白名单加入 Agent/Skill（子 agent 并行与 TDD 技能硬依赖）"
```

---

### Task 2: 核对母本 v2 留档完整性（升版前置，只读）

**Files:**
- Read only: `templates/schemas/spec-large-self/` vs `templates/schemas/versions/spec-large-self/v2/`

- [ ] **Step 1: 核对留档与当前母本一致**

Run: `cd /Users/huahua/IdeaProjects/ai_study/spec-platform && diff -r templates/schemas/spec-large-self templates/schemas/versions/spec-large-self/v2`
Expected: 无输出（完全一致；2026-09-24 已核对过一次，此处复核）。
若有差异：**停止**——留档目录永远不改不删，差异意味着留档后母本又被动过，需人工裁决后再继续。

---

### Task 3: config.rules.yaml 追加并行规则

**Files:**
- Modify: `templates/schemas/spec-large-self/config.rules.yaml`（`rules.tasks` 列表末尾）

- [ ] **Step 1: 追加规则条目**

在 `rules.tasks` 列表最后一条（以 `integration（串行），中间功能模块同编号者互为并行` 结尾的条目）之后追加：

```yaml
    - apply 阶段同阶段编号的多模块必须由独立子 agent 并行执行（Agent 工具
      同一条消息并行启动），模块内任务串行；子 agent 只写本模块代码/测试文件
      与 tasks/<模块>.md，tasks.md 总控勾选与跨模块文档修改由主流程统一执行
```

- [ ] **Step 2: Commit（与 Task 4 的版本号变更分开，便于回溯）**

```bash
git add templates/schemas/spec-large-self/config.rules.yaml
git commit -m "feat: config.rules 追加 apply 同阶段模块并行子 agent 纪律"
```

---

### Task 4: schema.yaml apply.instruction 重写执行纪律 + 升 v3

**Files:**
- Modify: `templates/schemas/spec-large-self/schema.yaml`（头部 `version: 2` 与版本注释，第 18-20 行；`apply.instruction` 中"执行纪律"至"遇到阻塞"段，约第 451-467 行）

- [ ] **Step 1: 版本号与版本注释**

```yaml
name: spec-large-self
# v2 (2026-09-24): 新增 config.rules.yaml（schema 默认 rules 模板，自 soft-exam config.yaml 抽取通用化）
# v3 (2026-09-24): apply 执行纪律重写——同阶段多模块强制子 agent 并行（限定写域 + 主流程统一勾选 + 单模块重试2次）；config.rules.yaml tasks 追加并行纪律
version: 3
```

- [ ] **Step 2: 重写 apply.instruction 的执行纪律段**

将 `══ 第 1 步：TDD 编码（强制 superpowers TDD 模式） ══` 小节中，从 `执行纪律（按 tasks.md 总览表的阶段顺序推进）：` 起、到 `遇到阻塞或需求不明确时暂停并向用户确认，不要自行脑补。` 止的整段（原第 1-7 条），替换为：

```
    执行纪律（按 tasks.md 总览表的阶段顺序推进；同阶段多模块强制并行）：
    1. 读 tasks.md，确认当前可执行的阶段（编号更小的阶段全部勾完才算可执行）
    2. 该阶段只有 1 个模块（阶段1 common-core、末阶段 integration 恒为此类）：
       主流程自己打开 tasks/<模块>.md，逐条执行明细任务，完成一条勾一条
    3. 该阶段 ≥2 个模块：**必须**用 Agent 工具在**同一条消息里**为每个模块
       各启动一个子 agent 并行执行，不允许主流程自己逐个串行做完。
       每个子 agent 的提示词必须包含：
       - 本模块 tasks/<模块>.md、design/<模块>.md、specs/<模块>/spec.md 的路径，
         以及总 design.md 的跨模块接口契约与横切规范（只读依据）
       - 强制 TDD：开工前先用 Skill 工具调用 superpowers 的
         test-driven-development 技能，严格 RED → GREEN → REFACTOR；
         测试源头锚定同主流程（以 spec 场景 + design「测试要点」表为准）
       - 完成一条勾一条（只勾自己的 tasks/<模块>.md）
       - 写域硬约束：只允许写本模块的代码/测试文件和本模块的 tasks/<模块>.md；
         禁写 tasks.md、design.md、design/*.md、proposal.md、specs/**
         及其他模块的任何文件；发现文档与现实冲突、文档间冲突、跨模块契约
         需要变更时，一律不自行修改，记录在返回报告中上报主流程裁决
       - 每条任务的验证命令必须实际执行并通过后才算完成
       - 遇阻塞或需求不明确时在报告中说明，不要自行脑补
    4. 全部子 agent 返回后，主流程统一汇总：
       - 逐个核对 tasks/<模块>.md 的 checkbox 是否全部勾完，并抽查验证命令
         对应的测试确实通过（文件事实 > 子 agent 口头汇报）
       - 核对无误后，回 tasks.md 勾掉对应模块项（只有主流程写 tasks.md）
       - 处理各子 agent 上报的问题：涉及跨模块契约/公共文档的修改由主流程
         统一执行，并登记【修改点清单】；若改动涉及跨模块契约或公共数据模型，
         按全量一致纪律重跑 design-review / tasks-review 受影响评审组，
         复审通过后才能进入下一阶段
    5. 失败处理：某模块子 agent 失败（有任务未勾完 / 验证不通过 / 子 agent 报错）
       → 对该模块重新启动一个子 agent，从未完成的 checkbox 续做；重试提示词
       额外携带上一轮失败原因摘要和已完成/未完成清单。最多重试 2 次；
       仍失败 → 暂停整个 apply，向用户输出问题清单等待指示。
       同阶段其他已成功模块不回滚；进入下一阶段的前提是本阶段全部模块成功
    6. 不得跨阶段抢跑；集成联调（integration.md）必须等所有功能模块勾完
    7. 实现时以 design/<模块>.md 为准；主流程自己发现任何文档与现实冲突、
       或文档之间互相冲突，先改文档再改代码，保持文档与代码一致
    8. 全量一致纪律：任何一份文档（proposal/specs/design/
       design-review/tasks/tasks-review，任意方向）一经更新，
       必须同步更新其他所有受影响文档中的相关描述，并在
       【修改点清单】登记，保持全量内容一致——不允许只做
       design→tasks 之类的单向同步；若改动涉及跨模块契约或
       公共数据模型，须重跑 design-review / tasks-review
       受影响评审组复审通过后，才能继续编码
    遇到阻塞或需求不明确时暂停并向用户确认，不要自行脑补。
```

注意：只替换"执行纪律"这一段。第 0 步（一致性校验）、第 1 步开头的 TDD 技能调用与"测试源头锚定"段、第 2 步（OCR 质量闭环）及其后所有内容保持原样。YAML 块标量（`instruction: |`）内缩进保持 4 空格，与原文一致。

- [ ] **Step 3: YAML 可解析自检**

Run: `cd /Users/huahua/IdeaProjects/ai_study/spec-platform && node -e "const s=require('fs').readFileSync('templates/schemas/spec-large-self/schema.yaml','utf8'); if(!/^version: 3$/m.test(s)) throw new Error('version not 3'); console.log('v3 ok')"`
Expected: 输出 `v3 ok`（完整 YAML 解析验证由 Task 5 的 registryService 测试覆盖——它会真实 parse schema.yaml）

- [ ] **Step 4: Commit**

```bash
git add templates/schemas/spec-large-self/schema.yaml
git commit -m "feat: schema v3 —— apply 同阶段多模块强制子 agent 并行执行纪律"
```

---

### Task 5: registry.yaml 版本同步 + 版本断言测试更新（TDD）

**Files:**
- Modify: `templates/schemas/registry.yaml`（`spec-large-self` 的 `version: 2` → `3`）
- Modify: `test/registryService.test.js:22`
- Modify: `test/projectService.test.js:75,78`

- [ ] **Step 1: 改测试断言（先红）**

`test/registryService.test.js` 的 `getMasterVersion` 用例改为：

```javascript
test('getMasterVersion 读取母本 schema.yaml 版本并与注册表一致', () => {
  const info = getMasterVersion('spec-large-self');
  assert.equal(info.version, 3);
  assert.equal(info.matchesRegistry, true);
});
```

`test/projectService.test.js` 第 75、78 行附近（用例 `// 版本钩子：记录 schemaVersion`）两处断言改为：

```javascript
  assert.equal(record.schemaVersion, 3);
```

```javascript
  assert.ok(projects.some((p) => p.path === dir && p.schemaVersion === 3));
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/huahua/IdeaProjects/ai_study/spec-platform && node --test test/registryService.test.js test/projectService.test.js`
Expected: registryService FAIL（version 3 ≠ 注册表 2 → `matchesRegistry` false 或版本不符）；projectService FAIL（`record.schemaVersion` 期望 3 实际……取决于 registry 校验是否 fail-fast，两者任一红即符合预期）

- [ ] **Step 3: registry.yaml 同步版本**

```yaml
  - name: spec-large-self
    label: 大项目模式
    hint: 我要做一个完整的产品——多模块、总设计+模块细化、含设计/任务双评审门禁
    version: 3
    default: true
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/registryService.test.js test/projectService.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add templates/schemas/registry.yaml test/registryService.test.js test/projectService.test.js
git commit -m "chore: registry 与版本断言同步 schema v3"
```

---

### Task 6: README 白名单说明更新

**Files:**
- Modify: `README.md`（aiRun 章节"**权限**"条目，约第 98-101 行）

- [ ] **Step 1: 更新权限说明**

将原"**权限**"条目整段替换为：

```markdown
- **权限**：`--permission-mode acceptEdits` + 收紧的 `--allowedTools`
  （`Bash(openspec:*)`、git 只读/暂存子命令 status/diff/log/show/add，
  Read/Edit/Write/Glob/Grep，以及 Agent/Skill——schema 内置的多子 agent
  并行评审、apply 同阶段模块并行执行与 TDD 技能调用依赖这两项；
  子代理继承同一工具面，不扩大文件写入范围），并显式 `--disallowedTools` 拒绝
  `git config/push/remote/commit`；**不使用** `--dangerously-skip-permissions`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README aiRun 白名单说明补充 Agent/Skill"
```

---

### Task 7: 全量回归

- [ ] **Step 1: 后端全量测试**

Run: `cd /Users/huahua/IdeaProjects/ai_study/spec-platform && npm test`
Expected: 全部 PASS（原 76 用例，无删减）

- [ ] **Step 2: 后端覆盖率不回退**

Run: `npm run test:coverage`
Expected: 行覆盖率 ≥ 91%（不低于改动前）

- [ ] **Step 3: 前端测试（本次未改前端，确认无连带破坏）**

Run: `npm run test:web`
Expected: 全部 PASS（62 用例）

- [ ] **Step 4: 若有失败**

按 superpowers:systematic-debugging 定位修复后重跑；不允许跳过或删测试。
