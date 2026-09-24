# <模块名> 细化设计方案

> 执行顺序：N / 共 M ｜ 依赖：顺序 N-1（<模块>）｜ 并行：<同顺序模块，无则写"无">

<!-- 路径：design/<模块名>.md，与 specs/<模块名>/spec.md 一一对应。
     输入：proposal + 本模块 spec.md + design.md（总）。
     头部顺序编号唯一来源：总 design.md「模块划分与依赖图 + 执行顺序编号」，
     不得自行另编；阅读方案时按编号从小到大依次阅读。
     遵守总 design.md 的横切规范，不得自创错误码/命名风格。 -->

## 模块职责

<!-- 一句话职责 + 边界：做什么、不做什么 -->

## 依赖的跨模块接口

<!-- 开头声明本模块用到总 design.md 中的哪些契约，只引用不重复定义。
     如需新增跨模块接口：先回总 design.md 补充，再在这里引用 -->

- 引用契约：<模块A> → 本模块: <契约名称>（见 design.md「跨模块接口契约」）

## 内部结构

<!-- 包/类/文件组织，各自职责 -->

```
cn.gov.zcy.<module>/
├── controller/   ←
├── service/      ←
├── repository/   ←
└── domain/       ←
```

## 数据模型

<!-- 本模块私有的表结构（DDL 级）；引用公共实体时注明出处（design.md 公共数据模型）。
     【强制】凡涉及表：必须带表备注 + 每一列的列备注（简体中文，说清业务含义，
     枚举取值/单位/取值范围也要写明），不得留空或只重复列名 -->

MySQL 示例：

```sql
CREATE TABLE <table_name> (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  <col> VARCHAR(64) NOT NULL COMMENT '<列业务含义，如：题目难度：EASY/MEDIUM/HARD>',
  -- ...
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='<表业务含义，如：题库表>';
```

PostgreSQL/pgvector 示例：

```sql
CREATE TABLE <table_name> (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  <col> VARCHAR(64) NOT NULL
  -- ...
);

COMMENT ON TABLE <table_name> IS '<表业务含义>';
COMMENT ON COLUMN <table_name>.id IS '主键ID';
COMMENT ON COLUMN <table_name>.<col> IS '<列业务含义>';
```

## API 明细

<!-- 本模块对外暴露的接口；跨模块接口必须与总 design.md 契约一致 -->

### <接口名称>

- `POST /api/<module>/...`
- 入参：
- 出参：
- 错误码：

## 关键流程 / 算法

<!-- 核心逻辑的时序图或伪代码 -->

## 测试要点

<!-- 对应 spec.md 的场景：测试策略、关键用例、测试数据准备 -->

| spec 场景 | 测试类/方法 | 类型 |
|-----------|------------|------|
| <Scenario 名> | <XxxTest#testYyy> | 单元/集成 |
