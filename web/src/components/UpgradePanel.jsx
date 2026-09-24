import { useState } from 'react';
import { previewUpgrade, applyUpgrade } from '../api/client.js';

/** 后端文件分类 → 中文标签（与 upgradeService.classifyFile 的 action 一一对应） */
const ACTION_LABELS = {
  add: '平台新增',
  'platform-update': '平台更新',
  delete: '平台删除',
  'user-keep': '保留我的修改',
  'auto-merge': '自动合并',
  conflict: '冲突（需裁决）',
};

/**
 * schema 升级面板：检查 → 预览（版本跨度 + 逐文件分类）→ 冲突二选一 → 执行。
 * 所有冲突裁决完毕才允许执行；成功后回调 onUpgraded 让父级刷新列表版本。
 */
export default function UpgradePanel({ projectPath, onUpgraded }) {
  const [preview, setPreview] = useState(null);
  const [resolutions, setResolutions] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const conflicts = (preview?.files ?? []).filter((file) => file.action === 'conflict');
  const allResolved = conflicts.every((file) => resolutions[file.path]);
  const canApply = Boolean(preview?.upgradable) && allResolved && !isApplying;

  async function handleCheck() {
    setIsChecking(true);
    setError(null);
    setResult(null);
    setPreview(null);
    setResolutions({});
    try {
      setPreview(await previewUpgrade(projectPath));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsChecking(false);
    }
  }

  async function handleApply() {
    setIsApplying(true);
    setError(null);
    try {
      setResult(await applyUpgrade(projectPath, resolutions));
      setPreview(null);
      setResolutions({});
      onUpgraded?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsApplying(false);
    }
  }

  function resolve(path, choice) {
    setResolutions((prev) => ({ ...prev, [path]: choice }));
  }

  return (
    <div className="panel upgrade-panel">
      <button type="button" onClick={handleCheck} disabled={isChecking || isApplying}>
        检查 schema 升级
      </button>
      {error ? <div className="banner error">{error}</div> : null}
      {result ? (
        <div className="banner success">
          升级完成：v{result.fromVersion} → v{result.toVersion}（备份：{result.backupDir}）
        </div>
      ) : null}
      {preview && !preview.upgradable ? (
        <p className="hint">已是最新（v{preview.currentVersion}）</p>
      ) : null}
      {preview?.upgradable ? (
        <>
          <p>
            发现新版本：v{preview.currentVersion} → v{preview.latestVersion}（{preview.mode}）
          </p>
          <p className="hint">
            {Object.entries(preview.summary ?? {})
              .map(([action, count]) => `${ACTION_LABELS[action] ?? action} ${count}`)
              .join(' · ')}
          </p>
          <ul className="upgrade-file-list">
            {preview.files.map((file) => (
              <li key={file.path}>
                <code>{file.path}</code> — {ACTION_LABELS[file.action] ?? file.action}
                {file.action === 'conflict' ? (
                  <ConflictResolution file={file} choice={resolutions[file.path]} onResolve={resolve} />
                ) : null}
              </li>
            ))}
          </ul>
          <button type="button" onClick={handleApply} disabled={!canApply}>
            执行升级
          </button>
          {allResolved ? null : (
            <p className="hint">还有 {conflicts.filter((f) => !resolutions[f.path]).length} 个文件待裁决</p>
          )}
        </>
      ) : null}
    </div>
  );
}

/** 单个冲突文件的裁决 UI：二选一 + 可折叠的两版全文预览 */
function ConflictResolution({ file, choice, onResolve }) {
  return (
    <div className="conflict-resolution">
      <label>
        <input
          type="radio"
          name={`resolution-${file.path}`}
          value="ours"
          checked={choice === 'ours'}
          onChange={() => onResolve(file.path, 'ours')}
        />
        保留我的
      </label>
      <label>
        <input
          type="radio"
          name={`resolution-${file.path}`}
          value="theirs"
          checked={choice === 'theirs'}
          onChange={() => onResolve(file.path, 'theirs')}
        />
        用母本新版
      </label>
      <details>
        <summary>预览全文</summary>
        <h5>我的当前内容</h5>
        <pre>{file.ours}</pre>
        <h5>母本新内容</h5>
        <pre>{file.theirs}</pre>
      </details>
    </div>
  );
}
