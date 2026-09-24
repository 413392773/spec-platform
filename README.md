# spec-platform — 小白开发平台

OpenSpec 工作流的展示层包装平台：**Web 前端（React）+ 后端（Node 零框架 HTTP）**。
能力 = 五步脚手架建项目 + cliRun 命令代理 + schema 母本管理。
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
npm test                 # 后端 node:test（33 用例）
npm run test:web         # 前端 vitest（38 用例）
npm run test:coverage    # 后端覆盖率（86% 行）
cd web && npm run test:coverage  # 前端覆盖率（96% 行）
```

## HTTP API（一律 `/api` 前缀）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 存活检查 + openspec CLI 版本 |
| GET | `/api/schemas` | 模式注册表（供前端模式选择页） |
| POST | `/api/projects` | 创建项目（五步脚手架，fail-fast + 回滚） |
| GET | `/api/projects` | 已创建项目记录（含 schema 版本） |
| POST | `/api/projects/run` | cliRun：代理执行 openspec 只读/管理命令（白名单） |

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

白名单：`list / view / doctor / context / archive / change / spec / schema`。
AI 工作流（propose/apply 等 `/opsx:*`）属 aiRun 通道，尚未实现。

## 目录

```
templates/schemas/     schema 母本（核心资产）+ registry.yaml
src/services/          registry / project / openspec / static 四个服务
src/lib/               spawn、路径、文件记录等小工具
src/routes/            HTTP 路由（/api 分流 + 静态托管）
web/                   React + Vite 前端（模式卡片 / 建项目向导 / 项目面板）
web/src/api/           API 客户端（信封解包 + 小白话术错误翻译）
data/projects.json     项目创建记录（运行时生成，git 忽略）
test/                  后端 node:test；web/src 内为 vitest 测试
```

## 环境变量

| 变量 | 默认 | 用途 |
|---|---|---|
| `PORT` | 3000 | 后端监听端口 |
| `HOST` | `127.0.0.1` | 监听地址；设 `0.0.0.0` 开放局域网（无鉴权，风险自负） |
| `SPEC_PLATFORM_DATA_DIR` | `data/` | 项目记录目录（测试隔离用） |
| `SPEC_PLATFORM_WEB_DIR` | `web/dist` | 前端静态资源目录（测试隔离用） |
| `API_TARGET`（仅 web dev） | `http://localhost:3000` | Vite 代理目标 |
| `VITE_DEFAULT_PROJECT_DIR`（仅 web） | 空 | 向导"放在哪里"预填目录；本机建议写在 `web/.env.local`（已 git 忽略），未设置时回退上次成功创建的目录 |
