export default function StepAdvanced({ value, onChange }) {
  // 每行带稳定 id 作 key：删中间行时输入焦点/内容不会错位
  const addRow = () => {
    onChange({
      ...value,
      extraRuleRows: [
        ...value.extraRuleRows,
        { id: crypto.randomUUID(), artifact: '', rule: '' },
      ],
    });
  };
  const updateRow = (index, patch) => {
    onChange({
      ...value,
      extraRuleRows: value.extraRuleRows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    });
  };
  const removeRow = (index) => {
    onChange({ ...value, extraRuleRows: value.extraRuleRows.filter((_, i) => i !== index) });
  };

  return (
    <div>
      <p className="hint">
        给某个文档追加项目特有的规则（可跳过，之后也能在项目的 openspec/config.yaml 里补）。
      </p>
      {value.extraRuleRows.map((row, index) => (
        <div className="field row" key={row.id}>
          <input
            aria-label={`文档名 ${index + 1}`}
            value={row.artifact}
            placeholder="文档（如 prd）"
            onChange={(e) => updateRow(index, { artifact: e.target.value })}
          />
          <input
            aria-label={`规则内容 ${index + 1}`}
            value={row.rule}
            placeholder="规则内容"
            onChange={(e) => updateRow(index, { rule: e.target.value })}
          />
          <button className="btn secondary" onClick={() => removeRow(index)}>
            删除
          </button>
        </div>
      ))}
      <button className="btn secondary" onClick={addRow}>
        添加一条规则
      </button>
    </div>
  );
}
