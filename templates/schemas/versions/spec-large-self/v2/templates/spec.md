# <模块名> 需求规格

<!-- 全量写法：直接写"这个模块最终要是什么样"，不用 ADDED/MODIFIED/REMOVED 标记。
     只写 WHAT 不写 HOW（技术选型、表结构、类名属于 design/<模块>.md）。
     场景必须覆盖正常、边界、异常三类中至少两类；每个场景可直接转化为测试用例。 -->

### Requirement: <需求名称>

<!-- 描述用 SHALL/MUST，避免 should/may -->
系统 SHALL <可验证的行为描述>。

#### Scenario: <场景名称>

<!-- 关键：Scenario 必须恰好 4 个井号（####），否则解析静默失败 -->
- **WHEN** <触发条件>
- **THEN** <预期结果>

#### Scenario: <边界或异常场景>

- **WHEN** <边界/异常条件>
- **THEN** <预期行为>

### Requirement: <下一条需求>

系统 SHALL ...

#### Scenario: <场景名称>

- **WHEN** ...
- **THEN** ...
