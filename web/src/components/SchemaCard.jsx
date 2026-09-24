import { useNavigate } from 'react-router-dom';

export default function SchemaCard({ schema }) {
  const navigate = useNavigate();
  return (
    <div className="card">
      <h3>
        {schema.label ?? schema.name}
        {schema.default ? <span className="badge">推荐</span> : null}
      </h3>
      <p>{schema.hint}</p>
      <p className="hint">schema v{schema.version}</p>
      <button className="btn" onClick={() => navigate(`/wizard/${schema.name}`)}>
        选这个模式
      </button>
    </div>
  );
}
