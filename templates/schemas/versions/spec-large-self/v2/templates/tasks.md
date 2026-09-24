# 任务总控：<变更名称>

<!-- 本文件是 openspec 进度追踪的唯一入口（apply.tracks）。
     只放总览表 + 模块级 checkbox；明细任务在 tasks/<模块>.md。 -->

## 执行顺序总览

<!-- 阶段号直接采用总 design.md「执行顺序编号」：串行递增、并行共用同一编号，
     形如 1-2-2-3；阶段1 = common-core 串行，末阶段 = integration 串行 -->

| 阶段 | 内容 | 方式 | 依赖 |
|------|------|------|------|
| 1 | common-core 通用基础 | 串行 | - |
| 2 | <模块A> | 与 <模块B> 并行（同阶段2） | 阶段1 |
| 2 | <模块B> | 与 <模块A> 并行（同阶段2） | 阶段1 |
| 3 | integration 集成联调 | 串行 | 阶段2 |

## 模块进度

<!-- 每项一个 checkbox，指向对应明细文件；勾选时机 = 明细文件内所有任务完成。
     按阶段号从小到大排列。openspec 的进度统计读取的就是下面这些 checkbox。 -->

- [ ] common-core（tasks/common-core.md）—— 阶段1，串行
- [ ] <模块A>（tasks/<模块A>.md）—— 阶段2，可与<模块B>并行
- [ ] <模块B>（tasks/<模块B>.md）—— 阶段2，可与<模块A>并行
- [ ] integration（tasks/integration.md）—— 阶段3（末），串行
