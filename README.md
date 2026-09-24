# spec-platform — 小白开发平台后端（MVP）

OpenSpec 工作流的展示层包装平台后端：**脚手架 + cliRun 命令代理 + schema 母本管理**。
不重新实现任何 openspec 逻辑，openspec CLI 是唯一事实来源。

设计文档：[`../docs/openspec-scaffold-flow.md`](../docs/openspec-scaffold-flow.md)（五步脚手架，已实测验证）

## 快速开始

```bash
npm install
npm start          # 默认 http://localhost:3000
npm test           # node:test 全量测试
```

## HTTP API（MVP）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 存活检查 + openspec CLI 版本 |
| GET | `/schemas` | 模式注册表（供前端模式选择页） |
| POST | `/projects` | 创建项目（五步脚手架，fail-fast + 回滚） |
| GET | `/projects` | 已创建项目记录（含 schema 版本） |
| POST | `/projects/run` | cliRun：代理执行 openspec 只读/管理命令（白名单） |

### POST /projects 请求体

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

### POST /projects/run 请求体

```json
{ "path": "/absolute/path/to/my-app", "args": ["list"] }
```

白名单：`list / view / doctor / context / archive / change / spec / schema`。
AI 工作流（propose/apply 等 `/opsx:*`）属 aiRun 通道，MVP 不实现。

## 目录

```
templates/schemas/     schema 母本（核心资产）+ registry.yaml
src/services/          registryService / projectService / openspecService
src/lib/               spawn、文件记录等小工具
src/routes/            HTTP 路由
data/projects.json     项目创建记录（运行时生成，git 忽略）
test/                  node:test 测试
```
