import { Routes, Route, Link } from 'react-router-dom';
import HomePage from './pages/HomePage.jsx';
import WizardPage from './pages/WizardPage.jsx';
import ProjectsPage from './pages/ProjectsPage.jsx';
import HealthBadge from './components/HealthBadge.jsx';

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">🧭 小白开发平台</Link>
        <nav>
          <Link to="/">新建项目</Link>
          <Link to="/projects">我的项目</Link>
          <HealthBadge />
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/wizard" element={<WizardPage />} />
          <Route path="/wizard/:mode" element={<WizardPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

function NotFound() {
  return (
    <div>
      <h1>页面不存在</h1>
      <p>
        <Link to="/">回首页</Link>
      </p>
    </div>
  );
}
