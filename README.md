# spec-platform — 小白开发平台

OpenSpec 工作流的展示层包装平台：**Web 前端（React）+ 后端（Node 零框架 HTTP）**。
能力 = 五步脚手架建项目 + cliRun 命令代理 + aiRun AI 工作流 + schema 母本管理与三方合并升级。
不重新实现任何 openspec 逻辑，openspec CLI 是唯一事实来源。

设计文档：[`../docs/openspec-scaffold-flow.md`](../docs/openspec-scaffold-flow.md)（五步脚手架，已实测验证）

## 快速开始

```bash
npm install              # 后端依赖
cd web && npm install && cd ..   # 前端依赖

# 方式一：生产形态（推荐）——一个端口全搞定
npm run build:web        # 前端构建到 web/dist
npm start                # http://localhost:3000 同时提供页面 + API

# 方式二：开发形态（前端热更新）
npm start                # 终端 1：后端 :3000
cd web && npm run dev    # 终端 2：Vite :5173，/api 自动代理到 :3000
```

## 测试

```bash
npm test                 # 后端 node:test（76 用例）
npm run test:web         # 前端 vitest（62 用例）
npm run test:coverage    # 后端覆盖率（91% 行）
cd web && npm run test:coverage  # 前端覆盖率（96% 行）
```

## HTTP API（一律 `/api` 前缀）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 存活检查 + openspec CLI 版本 |
| GET | `/api/schemas` | 模式注册表（供前端模式选择页） |
| POST | `/api/projects` | 创建项目（五步脚手架，fail-fast + 回滚） |
| GET | `/api/projects` | 已创建项目记录（含 schema 版本） |
| POST | `/api/projects/run` | cliRun：代理执行 openspec 命令（白名单，同步） |
| POST | `/api/projects/airun` | aiRun：启动 AI 工作流（`/opsx:*`，异步 job），202 返回 job |
| GET | `/api/airun/<id>?offset=n` | job 快照 + offset 之后的增量输出（前端轮询） |
| GET | `/api/projects/airun?path=` | 某项目的 job 列表（刷新页面后恢复运行中任务） |
| GET | `/api/projects/upgrade?path=` | schema 升级预览（版本跨度 + 逐文件三方合并分类） |
| POST | `/api/projects/upgrade` | 执行 schema 升级（冲突裁决必传，先备份再落盘） |

非 `/api` 的 GET/HEAD 请求由后端托管 `web/dist` 静态资源；无扩展名路径未命中文件时回退
`index.html`（SPA 前端路由），带扩展名的资源未命中直接 404；
含路径穿越/NUL/非法编码的路径返回 400。

## 安全边界（本机工具定位）

- **默认只绑回环**（127.0.0.1）：无鉴权 API 不暴露到局域网。
  确需局域网访问时设置 `HOST=0.0.0.0` —— 平台没有任何鉴权，开放即风险自负。
- **Host 白名单**：非回环 Host 头一律 421（防 DNS rebinding）；设置非回环 `HOST` 时此校验自动放开。
- **POST 必须 `Content-Type: application/json`**（防跨站简单请求 CSRF）。
- 命令代理走 `execFile`（无 shell 注入面）+ 白名单；`init/store/config/update` 等危险命令被禁止。

### POST /api/projects 请求体

```json
{
  "name": "my-app",
  "path": "/absolute/path/to/my-app",
  "mode": "spec-large-self",
  "context": {
    "positioning": "项目定位一句话",
    "techStack": "Spring Boot 4.1.1 + Java 25 + Maven",
    "packageRoot": "cn.gov.zcy.myapp",
    "conventions": ["所有接口必须分页"]
  },
  "extraRules": { "proposal": ["项目特有规则"] }
}
```

### POST /api/projects/run 请求体

```json
{ "path": "/absolute/path/to/my-app", "args": ["list"] }
```

cliRun 白名单：`list / view / doctor / context / archive / change / spec / schema`。
`init/store/config/update` 等改变平台或全局状态的命令一律禁止。

### aiRun 通道（AI 工作流）

`/opsx:*` 不是可执行命令，而是 openspec init 生成的 11 个提示词文件，需由 AI agent
解释执行。平台在项目目录 spawn `claude -p "/opsx:<命令> <需求>"` 无头跑完整个工作流：

- **白名单**：propose / apply / archive / bulk-archive / continue / explore / ff /
  new / onboard / sync / verify（全部 11 个）
- **项目准入**：只有通过平台创建（登记表内）且含 `openspec/config.yaml` 的项目可用；
  路径经 realpath 归一，家目录及其祖先一律拒绝
- **job 模型**：内存态（服务重启即失），同项目同时只允许一个运行中任务（冲突 409），
  全局并发上限 2；输出按字符计数上限 100 万（超限保尾部一半，落后客户端会收到
  `gapChars` 截断提示）；完成态 job 只保留最近 50 个；30 分钟超时按进程组 SIGKILL
- **权限**：`--permission-mode acceptEdits` + 收紧的 `--allowedTools`
  （`Bash(openspec:*)`、git 只读/暂存子命令 status/diff/log/show/add，
  Read/Edit/Write/Glob/Grep，以及 Agent/Skill——schema 内置的多子 agent
  并行评审、apply 同阶段模块并行执行与 TDD 技能调用依赖这两项；
  子代理继承同一工具面，不扩大文件写入范围），并显式 `--disallowedTools` 拒绝
  `git config/push/remote/commit`；**不使用** `--dangerously-skip-permissions`
- **风险须知**：AI 会读写项目文件。acceptEdits + Write 意味着项目内不可信内容
  （如恶意 README）理论上可诱导 AI 写入 `.claude/settings.json` 等提权文件，
  再被后续会话加载——**不要对包含不可信第三方内容的项目使用 aiRun**（前端也有同样提示）。
  平台进程退出（SIGINT/SIGTERM）时会杀掉全部运行中的 claude 进程组，不留孤儿。
- **前置条件**：本机已安装并登录 Claude Code CLI（`claude`）
- 前端在项目卡片提供命令下拉 + 需求输入 + 增量输出轮询（1.5s，链式请求不并发在飞）

### schema 同步/升级（三方合并）

母本升版后，老项目不必推倒重建——平台按 **base（母本旧版留档）/ ours（项目当前）/
theirs（母本新版）** 做逐文件三方合并（引擎 `git merge-file`）：

- **文件分类**：`platform-update` 平台单边更新 / `add` 平台新增 / `delete` 平台删除 /
  `user-keep` 用户单边修改（保留）/ `auto-merge` 两边改动不重叠（自动合并）/
  `conflict` 撞车（用户二选一：保留我的 ours / 用母本新版 theirs）
- **config.yaml rules 重建**：新母本默认 rules + 反推的用户附加项（追加式合并可精确
  反推；被整体改写过则按集合差兜底）；`context` 块原样保留
- **安全网**：执行前所有受影响文件 + config.yaml 备份到 `data/backups/<项目名>-<时间戳>/`；
  冲突未全部裁决 → 409，不落任何盘；仅平台登记过的项目可用
- **留档纪律（重要）**：`templates/schemas/versions/<mode>/v<N>/` 是三方合并的 base。
  **每次升级母本版本前，必须先把当前母本完整复制进 versions/ 留档**，否则老项目
  无法升级（服务端会报"缺少母本留档"）。已留档的旧版本目录永远不要修改或删除。
  母本与留档只放文本文件（升级通道按 UTF-8 读写，单文件上限 5MB；项目 schema
  目录内禁止符号链接，检测到即拒绝升级）。
- 前端在项目卡片提供"检查 schema 升级"：版本跨度 + 逐文件分类清单 + 冲突全文预览二选一

### POST /api/projects/upgrade 请求体

```json
{
  "path": "/absolute/path/to/my-app",
  "resolutions": { "templates/proposal.md": "ours" }
}
```

`resolutions` 只需包含冲突文件（`action: "conflict"`），取值 `ours` / `theirs`；
有冲突未裁决时返回 409 且不做任何修改。

## 目录

```
templates/schemas/     schema 母本（核心资产）+ registry.yaml
templates/schemas/versions/  母本旧版留档（三方合并 base，只增不改）
src/services/          registry / project / openspec / aiRun / upgrade / static 六个服务
src/lib/               spawn、路径、文件记录、项目准入查找等小工具
src/routes/            HTTP 路由（/api 分流 + 静态托管）
web/                   React + Vite 前端（模式卡片 / 建项目向导 / 项目面板）
web/src/api/           API 客户端（信封解包 + 小白话术错误翻译）
data/projects.json     项目创建记录（运行时生成，git 忽略）
data/backups/          schema 升级前的自动备份（运行时生成，git 忽略）
test/                  后端 node:test；web/src 内为 vitest 测试
```

## 环境变量

| 变量 | 默认 | 用途 |
|---|---|---|
| `PORT` | 3000 | 后端监听端口 |
| `HOST` | `127.0.0.1` | 监听地址；设 `0.0.0.0` 开放局域网（无鉴权，风险自负） |
| `SPEC_PLATFORM_DATA_DIR` | `data/` | 项目记录 + 升级备份目录（测试隔离用） |
| `SPEC_PLATFORM_TEMPLATES_DIR` | `templates/schemas` | schema 母本目录（测试隔离用） |
| `SPEC_PLATFORM_WEB_DIR` | `web/dist` | 前端静态资源目录（测试隔离用） |
| `API_TARGET`（仅 web dev） | `http://localhost:3000` | Vite 代理目标 |
| `VITE_DEFAULT_PROJECT_DIR`（仅 web） | 空 | 向导"放在哪里"预填目录；本机建议写在 `web/.env.local`（已 git 忽略），未设置时回退上次成功创建的目录 |
