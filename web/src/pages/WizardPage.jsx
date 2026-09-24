import { useEffect, useState } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { createProject, getSchemas } from '../api/client.js';
import { isValidName, isAbsoluteDir, joinPath, groupExtraRules } from '../validation.js';
import StepBasics from '../components/wizard/StepBasics.jsx';
import StepContext from '../components/wizard/StepContext.jsx';
import StepAdvanced from '../components/wizard/StepAdvanced.jsx';
import StepConfirm from '../components/wizard/StepConfirm.jsx';

const LAST_DIR_KEY = 'spec-platform:lastProjectDir';

/** 放置目录默认值：构建期环境变量 → 上次成功创建的目录（localStorage）→ 空（用户手填） */
function initialDir() {
  return import.meta.env.VITE_DEFAULT_PROJECT_DIR || localStorage.getItem(LAST_DIR_KEY) || '';
}

const EMPTY_FORM = {
  name: '',
  dir: '',
  positioning: '',
  techStack: '',
  conventions: [],
  extraRuleRows: [],
};
const STEP_TITLES = ['基本信息', '项目情况', '高级选项', '确认创建'];

function buildSubmitBody(form, mode) {
  const body = {
    name: form.name,
    path: joinPath(form.dir, form.name),
    mode,
    context: {
      positioning: form.positioning.trim(),
      techStack: form.techStack.trim(),
      ...(form.conventions.length > 0 ? { conventions: form.conventions } : {}),
    },
  };
  const grouped = groupExtraRules(form.extraRuleRows);
  if (Object.keys(grouped).length > 0) body.extraRules = grouped;
  return body;
}

export default function WizardPage() {
  const { mode } = useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(EMPTY_FORM);
  const [modeLabel, setModeLabel] = useState(mode ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    // mode 变化（换卡片/前进后退）时整体重置，防止沿用上一个模式的填写状态
    setStep(0);
    setForm({ ...EMPTY_FORM, dir: initialDir() });
    setModeLabel(mode ?? '');
    setCreated(null);
    setError(null);
    if (!mode) return;
    getSchemas()
      .then((schemas) => {
        const found = schemas.find((schema) => schema.name === mode);
        if (found?.label) setModeLabel(found.label);
      })
      .catch(() => {
        // 标签只是展示用，取不到就显示模式名，不打断建项目
      });
  }, [mode]);

  if (!mode) return <Navigate to="/" replace />;

  if (created) {
    return (
      <div>
        <div className="banner ok">
          🎉 项目「{created.name}」已创建成功（schema v{created.schemaVersion}）
        </div>
        <p>位置：{created.path}</p>
        <button className="btn" onClick={() => navigate('/projects')}>
          去我的项目
        </button>
      </div>
    );
  }

  const stepValid = [
    isValidName(form.name) && isAbsoluteDir(form.dir),
    form.positioning.trim() !== '' && form.techStack.trim() !== '',
    true,
    true,
  ][step];

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const record = await createProject(buildSubmitBody(form, mode));
      localStorage.setItem(LAST_DIR_KEY, form.dir); // 下次建项目预填同一目录
      setCreated(record);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1>新建项目 · {modeLabel}</h1>
      <p className="hint">
        第 {step + 1} / {STEP_TITLES.length} 步：{STEP_TITLES[step]}
      </p>
      {error ? <div className="banner error">{error}</div> : null}
      {step === 0 ? <StepBasics value={form} onChange={setForm} /> : null}
      {step === 1 ? <StepContext value={form} onChange={setForm} /> : null}
      {step === 2 ? <StepAdvanced value={form} onChange={setForm} /> : null}
      {step === 3 ? <StepConfirm value={form} mode={mode} modeLabel={modeLabel} /> : null}
      <div className="row" style={{ marginTop: 16 }}>
        {step > 0 ? (
          <button className="btn secondary" onClick={() => setStep(step - 1)}>
            上一步
          </button>
        ) : null}
        {step < 3 ? (
          <button className="btn" disabled={!stepValid} onClick={() => setStep(step + 1)}>
            下一步
          </button>
        ) : null}
        {step === 3 ? (
          <button className="btn" disabled={submitting} onClick={submit}>
            {submitting ? '创建中…' : '创建项目'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
