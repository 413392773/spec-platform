import { Link } from 'react-router-dom';
import { listProjects } from '../api/client.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import RunPanel from '../components/RunPanel.jsx';
import AiPanel from '../components/AiPanel.jsx';

export default function ProjectsPage() {
  const { data: projects, error, isPending } = useAsyncData(listProjects);

  return (
    <>
      <h1>我的项目</h1>
      {error ? <div className="banner error">{error}</div> : null}
      {isPending ? <p className="hint">加载中…</p> : null}
      {projects?.length === 0 ? (
        <p>
          还没有项目。<Link to="/">去创建一个</Link>
        </p>
      ) : null}
      <div className="card-grid">
        {(projects ?? []).map((project) => (
          <div className="card" key={project.path}>
            <h3>{project.name}</h3>
            <p className="hint">
              模式 {project.mode} · schema v{project.schemaVersion} ·{' '}
              {new Date(project.createdAt).toLocaleString('zh-CN')}
            </p>
            <p className="hint">{project.path}</p>
            <RunPanel projectPath={project.path} />
            <AiPanel projectPath={project.path} />
          </div>
        ))}
      </div>
    </>
  );
}
