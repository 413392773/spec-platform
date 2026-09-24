import { useState } from 'react';
import { runCommand } from '../api/client.js';

const PRESETS = [
  { label: '查看变更列表', args: ['list'] },
  { label: '体检', args: ['doctor'] },
  { label: 'Schema 来源', args: ['schema', 'which'] },
];

/** 按钮式 cliRun：点一下跑一条白名单命令，输出格式化展示 */
export default function RunPanel({ projectPath }) {
  const [output, setOutput] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const run = async (args) => {
    setRunning(true);
    setError(null);
    setOutput(null);
    try {
      setOutput(await runCommand(projectPath, args));
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <div className="row">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            className="btn secondary"
            disabled={running}
            onClick={() => run(preset.args)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      {error ? <div className="banner error">{error}</div> : null}
      {output ? (
        <div>
          <pre className="output">{output.stdout || '（无输出）'}</pre>
          {output.exitCode !== 0 ? (
            <div className="banner error">
              命令退出码 {output.exitCode}
              {output.stderr ? `：${output.stderr}` : ''}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
