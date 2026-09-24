import { useState } from 'react';

export default function StepContext({ value, onChange }) {
  const [conventionDraft, setConventionDraft] = useState('');

  const addConvention = () => {
    const text = conventionDraft.trim();
    if (!text) return;
    // 去重：同文本重复添加会造成 key 冲突与无意义的重复约定；重复时也清空草稿
    if (!value.conventions.includes(text)) {
      onChange({ ...value, conventions: [...value.conventions, text] });
    }
    setConventionDraft('');
  };

  const removeConvention = (index) => {
    onChange({ ...value, conventions: value.conventions.filter((_, i) => i !== index) });
  };

  return (
    <div>
      <div className="field">
        <label htmlFor="positioning">这个项目是做什么的？（项目定位）</label>
        <textarea
          id="positioning"
          rows={3}
          value={value.positioning}
          placeholder="例：个人记账工具，支持按月统计收支"
          onChange={(e) => onChange({ ...value, positioning: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="techStack">技术栈</label>
        <input
          id="techStack"
          value={value.techStack}
          placeholder="例：Java 17 + Spring Boot 3"
          onChange={(e) => onChange({ ...value, techStack: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="convention">项目约定（可选，逐条添加）</label>
        <div className="row">
          <input
            id="convention"
            value={conventionDraft}
            placeholder="例：接口统一返回 Result 包装"
            onChange={(e) => setConventionDraft(e.target.value)}
          />
          <button className="btn secondary" onClick={addConvention}>
            添加约定
          </button>
        </div>
        <ul>
          {value.conventions.map((convention, index) => (
            <li key={convention}>
              {convention}{' '}
              <button className="link-btn" onClick={() => removeConvention(index)}>
                删除
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
