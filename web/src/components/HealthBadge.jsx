import { getHealth } from '../api/client.js';
import { useAsyncData } from '../hooks/useAsyncData.js';

/** 顶栏环境角标：绿色=openspec 可用（带版本），红色=后端/CLI 异常 */
export default function HealthBadge() {
  const { data, error, isPending } = useAsyncData(getHealth);

  if (!isPending && !error) {
    return <span className="badge">openspec {data.openspecVersion}</span>;
  }
  if (error) {
    return (
      <span className="badge danger" title="无法连接后端或 openspec CLI 未安装">
        环境异常
      </span>
    );
  }
  return <span className="badge">检查中…</span>;
}
