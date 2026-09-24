import { describe, it, expect } from 'vitest';
import { isValidName, isAbsoluteDir, joinPath, groupExtraRules } from './validation.js';

describe('表单校验工具', () => {
  it('项目名接受 kebab-case', () => {
    expect(isValidName('my-app')).toBe(true);
    expect(isValidName('app2')).toBe(true);
    expect(isValidName('a')).toBe(true);
  });

  it('项目名拒绝大写/中划线开头/空值', () => {
    expect(isValidName('My-App')).toBe(false);
    expect(isValidName('-app')).toBe(false);
    expect(isValidName('my app')).toBe(false);
    expect(isValidName('')).toBe(false);
    expect(isValidName(undefined)).toBe(false);
  });

  it('目录必须是以 / 开头的绝对路径（根目录本身不算）', () => {
    expect(isAbsoluteDir('/tmp')).toBe(true);
    expect(isAbsoluteDir('/Users/huahua/IdeaProjects')).toBe(true);
    expect(isAbsoluteDir('tmp')).toBe(false);
    expect(isAbsoluteDir('/')).toBe(false);
    expect(isAbsoluteDir('')).toBe(false);
  });

  it('joinPath 去掉目录尾部斜杠再拼接', () => {
    expect(joinPath('/tmp/', 'app')).toBe('/tmp/app');
    expect(joinPath('/tmp', 'app')).toBe('/tmp/app');
  });

  it('groupExtraRules 按文档分组并跳过空行', () => {
    const rows = [
      { artifact: 'prd', rule: '必须包含验收标准' },
      { artifact: ' prd ', rule: '中文书写' },
      { artifact: '', rule: '无主规则' },
      { artifact: 'design', rule: '   ' },
    ];
    expect(groupExtraRules(rows)).toEqual({ prd: ['必须包含验收标准', '中文书写'] });
  });

  it('groupExtraRules 空列表返回空对象', () => {
    expect(groupExtraRules([])).toEqual({});
  });

  it('groupExtraRules 原型属性名（__proto__/toString）不崩溃（H1 回归）', () => {
    const grouped = groupExtraRules([
      { artifact: '__proto__', rule: 'x' },
      { artifact: 'toString', rule: 'y' },
    ]);
    expect(Object.hasOwn(grouped, '__proto__')).toBe(true);
    expect(grouped['__proto__']).toEqual(['x']);
    expect(grouped.toString).toEqual(['y']);
  });
});
