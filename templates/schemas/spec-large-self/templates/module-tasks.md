# <模块名> 明细任务清单

<!-- 路径：tasks/<模块名>.md；集成联调用 tasks/integration.md。
     执行顺序编号唯一来源：总 design.md「执行顺序编号」= tasks.md 总览阶段号，
     同编号的并行模块各自独立成文件，任务编号只需本文件内不重复。
     任务以 design/<模块>.md 为依据，覆盖 spec.md 的全部 Requirement。 -->

> 执行顺序：N / 共 M（= tasks.md 阶段号）｜ 方式：串行 / 可与 <同阶段模块> 并行 ｜ 依赖：顺序 N-1（<模块>）

## N.1 <任务分组名>

<!-- 每条任务：checkbox 格式（apply 阶段靠它追踪）、≤2 小时、
     附验证命令、接口和实现放同一任务避免编译中断 -->

- [ ] N.1 <任务描述>
  - 验证：`./mvnw test -Dtest=XxxTest`
- [ ] N.2 <任务描述>
  - 验证：`./mvnw test -Dtest=YyyTest`

## N.2 <任务分组名>

- [ ] N.3 <任务描述>
  - 验证：<命令>

<!-- 本文件全部勾完后，回 tasks.md 勾掉对应模块项 -->
