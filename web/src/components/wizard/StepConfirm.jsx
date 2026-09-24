import { joinPath, groupExtraRules } from '../../validation.js';

export default function StepConfirm({ value, mode, modeLabel }) {
  const grouped = groupExtraRules(value.extraRuleRows);
  const ruleCount = Object.values(grouped).reduce((sum, rules) => sum + rules.length, 0);
  return (
    <div>
      <h3>请确认</h3>
      <ul>
        <li>模式：{modeLabel}（{mode}）</li>
        <li>项目名：{value.name}</li>
        <li>创建位置：{joinPath(value.dir, value.name)}</li>
        <li>项目定位：{value.positioning}</li>
        <li>技术栈：{value.techStack}</li>
        <li>项目约定：{value.conventions.length > 0 ? value.conventions.join('；') : '无'}</li>
        <li>附加规则：{ruleCount > 0 ? `${ruleCount} 条` : '无'}</li>
      </ul>
      <p className="hint">创建过程约需十几秒：git 初始化 → openspec init → 复制 schema → 生成配置 → 校验。</p>
    </div>
  );
}
