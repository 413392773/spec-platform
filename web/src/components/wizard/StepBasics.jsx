import { isValidName, isAbsoluteDir, joinPath } from '../../validation.js';

export default function StepBasics({ value, onChange }) {
  const nameOk = isValidName(value.name);
  const dirOk = isAbsoluteDir(value.dir);
  return (
    <div>
      <div className="field">
        <label htmlFor="name">项目名</label>
        <input
          id="name"
          value={value.name}
          placeholder="my-app"
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
        <div className="hint">只能用小写字母、数字、中划线，且不以中划线开头（例：my-app）</div>
        {value.name && !nameOk ? <div className="error-text">格式不对，示例：my-app</div> : null}
      </div>
      <div className="field">
        <label htmlFor="dir">放在哪里（目录）</label>
        <input
          id="dir"
          value={value.dir}
          placeholder="/绝对路径/到/项目们（例：/Users/you/IdeaProjects）"
          onChange={(e) => onChange({ ...value, dir: e.target.value })}
        />
        <div className="hint">
          项目将创建在：{nameOk && dirOk ? joinPath(value.dir, value.name) : '（填写后显示）'}
        </div>
        {value.dir && !dirOk ? (
          <div className="error-text">请输入以 / 开头的绝对路径</div>
        ) : null}
      </div>
    </div>
  );
}
