/** 建项目表单的纯函数校验与转换（与后端 projectService.validateForm 规则一致） */

// 与 src/services/projectService.js 的 NAME_RE 保持一致：这里管即时提示，后端是权威校验
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function isValidName(name) {
  return typeof name === 'string' && NAME_RE.test(name);
}

/** 目录必须是绝对路径；根目录 "/" 本身不接受（避免误建到根） */
export function isAbsoluteDir(dir) {
  return typeof dir === 'string' && dir.startsWith('/') && dir.length > 1;
}

export function joinPath(dir, name) {
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

/** [{artifact, rule}] → { artifact: [rule, ...] }，跳过空行，自动 trim */
export function groupExtraRules(rows) {
  // 无原型对象：用户把文档名写成 __proto__/toString 时不会读到原型属性导致崩溃
  const grouped = Object.create(null);
  for (const { artifact, rule } of rows) {
    const artifactKey = artifact?.trim();
    const ruleText = rule?.trim();
    if (!artifactKey || !ruleText) continue;
    grouped[artifactKey] = [...(grouped[artifactKey] ?? []), ruleText];
  }
  return grouped;
}
