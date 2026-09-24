import { getSchemas } from '../api/client.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import SchemaCard from '../components/SchemaCard.jsx';

export default function HomePage() {
  const { data: schemas, error, isPending } = useAsyncData(getSchemas);

  return (
    <>
      <h1>选择开发模式</h1>
      {error ? (
        <div className="banner error">{error}</div>
      ) : isPending ? (
        <p className="hint">加载中…</p>
      ) : (
        <>
          <p className="hint">不知道选哪个？选带"推荐"标记的模式即可。</p>
          <div className="card-grid">
            {(schemas ?? []).map((schema) => (
              <SchemaCard key={schema.name} schema={schema} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
