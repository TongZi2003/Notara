import { createVaultClient } from './remote-client.js';
import { createDraftStore } from './draft-client.js';
import { PERSONA_TEXT_LIMIT, personaText } from './persona.js';

/**
 * 教学设置: one small entry in the workspace bar, no teacher-identity toolbar.
 *
 * Everything the student can change lives in the native session (the Host owns
 * the write): this panel only reads `teachingSettings`, sends the changed fields
 * as a patch and shows the real result. 剧本/路线绑定 (scriptPath, routePath,
 * nodeId) are Host-bound context, so they are shown as facts and never edited
 * here, and an unwritten setting is never reported as saved.
 */

const MAX_SUBJECTS = 12;
const MAX_SUBJECT_LENGTH = 80;

/** 科目 is a short list; 顿号、逗号与空格 all separate two subjects. */
export function parseSubjects(text) {
  const parts = String(text ?? '').split(/[,，、;；\s]+/);
  const subjects = [];
  for (const part of parts) {
    const value = part.trim();
    if (value && !subjects.includes(value)) subjects.push(value);
  }
  return subjects;
}

/** The editable shape of one lesson's settings. */
export function settingsDraft(settings) {
  const goal = settings?.learningGoal ?? null;
  return {
    teachingRef: settings?.teachingRef ?? '',
    goalTitle: goal?.title ?? '',
    deadline: goal?.deadline ?? '',
    dailyMinutes: goal?.dailyMinutes === undefined || goal?.dailyMinutes === null ? '' : String(goal.dailyMinutes),
    instructions: settings?.temporaryInstructions ?? '',
    persona: settings?.persona ?? '',
    subjects: (settings?.subjects ?? []).join('、'),
  };
}

/**
 * The patch for the *changed* fields only, so saving one field never clears
 * another. An empty patch means there is nothing to write — the caller reports
 * that instead of pretending a save happened. `teachingRef: null` restores the
 * default teaching method, `learningGoal: null` removes the goal, `''` clears the
 * temporary instructions, `''` also returns the teacher persona to the default
 * one, and `[]` clears the subjects.
 */
export function settingsPatch(settings, draft) {
  const base = settings ?? {}, patch = {};
  if (draft.teachingRef && draft.teachingRef !== base.teachingRef) patch.teachingRef = draft.teachingRef;
  const title = String(draft.goalTitle ?? '').trim();
  const deadline = String(draft.deadline ?? '').trim();
  const minutes = String(draft.dailyMinutes ?? '').trim();
  if (!title && (deadline || minutes)) return { patch: null, error: '先填写学习目标，再添加期限或每天时长。' };
  if (minutes && !/^\d+$/.test(minutes)) return { patch: null, error: '每天学习时长请填整数分钟。' };
  if (minutes && Number(minutes) > 1440) return { patch: null, error: '每天学习时长最多 1440 分钟。' };
  const goal = title ? { title, ...(deadline ? { deadline } : {}), ...(minutes ? { dailyMinutes: Number(minutes) } : {}) } : null;
  if (JSON.stringify(goal) !== JSON.stringify(base.learningGoal ?? null)) patch.learningGoal = goal;
  const instructions = String(draft.instructions ?? '').trim();
  if (instructions !== (base.temporaryInstructions ?? '')) patch.temporaryInstructions = instructions;
  // 空白就是默认形象：只有真的和已保存内容不同才发送，避免留下看不见的自定义人格。
  // 升级前保存的草稿没有这一项，按「没改过」处理，保存别的字段不会顺手清掉人格。
  if (draft.persona !== undefined) {
    const persona = personaText(draft.persona);
    if (persona.length > PERSONA_TEXT_LIMIT) return { patch: null, error: `老师人格最多 ${PERSONA_TEXT_LIMIT} 字，留空用默认形象。` };
    if (persona !== personaText(base.persona)) patch.persona = persona;
  }
  const subjects = parseSubjects(draft.subjects);
  if (subjects.some(subject => subject.length > MAX_SUBJECT_LENGTH)) return { patch: null, error: '科目名称太长了。' };
  if (subjects.length > MAX_SUBJECTS) return { patch: null, error: `科目最多 ${MAX_SUBJECTS} 个。` };
  if (subjects.join('\u0000') !== (base.subjects ?? []).join('\u0000')) patch.subjects = subjects;
  return { patch, error: '' };
}

/** The defaults the Host restores with `teachingRef: null`. */
export function clearedPatch() {
  return { teachingRef: null, learningGoal: null, temporaryInstructions: '', subjects: [], persona: '' };
}

export function createTeachingPanel(React, { STYLE, IconButton, Dialog }) {
  const h = React.createElement;
  const { useState, useMemo, useEffect } = React;
  // Unsaved edits stay per session: switching panes or sessions never drops them.
  const drafts = createDraftStore('teaching-draft');

  function TeachingEntry({ ctx, sessionId, ensureSession, onSaved }) {
    const vault = useMemo(() => createVaultClient(ctx, sessionId), [ctx, sessionId]);
    const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
    // The session this panel is really writing to: a fresh classroom created for
    // this click is used immediately, before the slot receives its own sessionId.
    const [target, setTarget] = useState(sessionId);
    const [settings, setSettings] = useState(null), [form, setForm] = useState(null);
    const [error, setError] = useState(''), [notice, setNotice] = useState('');

    const load = async id => {
      const result = await vault.teachingSettings({ sessionId: id });
      if (!result?.ok) return null;
      setSettings(result.value);
      setForm(drafts.get(id) ?? settingsDraft(result.value));
      return { id, value: result.value };
    };
    const start = async () => {
      if (busy) return;
      setBusy(true); setError(''); setNotice('');
      try {
        const id = sessionId ?? await ensureSession();
        if (!id) { setError('现在还不能设置：请先在输入框发送一条消息。'); return; }
        setTarget(id);
        const loaded = await load(id);
        if (!loaded) { setError('教学设置暂时读不出来，请稍后重试。'); return; }
        setOpen(true);
      } catch { setError('现在还不能设置：这节课暂时打不开，请稍后重试。'); }
      finally { setBusy(false); }
    };
    const edit = next => { setForm(next); if (target) drafts.set(target, next); setNotice(''); setError(''); };
    const write = async patch => {
      if (!form || !settings) return;
      setBusy(true); setError(''); setNotice('');
      try {
        const result = await vault.updateTeachingSettings({ sessionId: target ?? sessionId, expectedRevision: settings.revision, patch });
        if (result?.ok) {
          drafts.delete(target ?? sessionId);
          setSettings(result.value); setForm(settingsDraft(result.value)); setNotice('已保存，下一次提问就会用上新设置。');
          onSaved?.(result.value);
          return;
        }
        // A conflict is a real state: re-read the newest settings but keep the draft.
        const latest = await vault.teachingSettings({ sessionId: target ?? sessionId });
        if (latest?.ok) setSettings(latest.value);
        setError('这节课的设置已经在别处更新，已读到最新内容；你的修改仍然保留。');
      } catch { setError('保存失败，你的修改仍然保留在窗口里。'); }
      finally { setBusy(false); }
    };
    const save = () => { const { patch, error: invalid } = settingsPatch(settings, form ?? {}); if (invalid) { setError(invalid); return; } if (!Object.keys(patch).length) { setNotice('没有需要保存的修改。'); return; } void write(patch); };
    const clear = () => { void write(clearedPatch()); };

    const choices = settings?.choices ?? [];
    return h(React.Fragment, null,
      h(IconButton, { icon: 'sliders', label: '教学设置', 'aria-pressed': open, disabled: busy, onClick: () => { void start(); } }),
      error && h('span', { role: 'alert', style: STYLE.notice }, error),
      !error && notice && h('span', { role: 'status', style: STYLE.notice }, notice),
      open && form && h(Dialog, { title: '教学设置', onClose: () => setOpen(false) },
        h('form', { onSubmit: event => { event.preventDefault(); save(); } },
          h('fieldset', { style: { border: 0, margin: '10px 0 0', padding: 0 } },
            h('legend', { style: { ...STYLE.notice, padding: 0 } }, '教法'),
            choices.length
              ? choices.map(choice => h('label', { key: choice.id, style: { display: 'block', margin: '8px 0' } },
                  h('input', { type: 'radio', name: 'teaching-ref', value: choice.id, checked: form.teachingRef === choice.id, onChange: () => edit({ ...form, teachingRef: choice.id }) }), ' ',
                  choice.title,
                  choice.description && h('span', { style: { ...STYLE.notice, display: 'block', marginLeft: 22 } }, choice.description)))
              : h('p', { style: STYLE.notice }, '教法列表暂时读不出来。')),
          h('label', { style: { display: 'block', marginTop: 16 } }, '学习目标',
            h('input', { 'aria-label': '学习目标', style: STYLE.templateInput, value: form.goalTitle, placeholder: '这节课想学会什么', onChange: event => edit({ ...form, goalTitle: event.target.value }) })),
          h('label', { style: { display: 'block', marginTop: 10 } }, '期限（可选）',
            h('input', { 'aria-label': '期限', type: 'date', style: STYLE.templateInput, value: form.deadline, onChange: event => edit({ ...form, deadline: event.target.value }) })),
          h('label', { style: { display: 'block', marginTop: 10 } }, '每天学习时长（可选）',
            h('input', { 'aria-label': '每天学习时长', type: 'number', min: 1, max: 1440, style: STYLE.templateInput, value: form.dailyMinutes, onChange: event => edit({ ...form, dailyMinutes: event.target.value }) })),
          h('label', { style: { display: 'block', marginTop: 16 } }, '本课临时要求',
            h('textarea', { 'aria-label': '本课临时要求', style: { ...STYLE.templateInput, minHeight: 80 }, value: form.instructions, placeholder: '只影响这一节课，例如：先让我自己试', onChange: event => edit({ ...form, instructions: event.target.value }) })),
          h('label', { style: { display: 'block', marginTop: 10 } }, '老师人格（可选）',
            h('textarea', { 'aria-label': '老师人格', maxLength: PERSONA_TEXT_LIMIT, style: { ...STYLE.templateInput, minHeight: 80 }, value: form.persona ?? '', placeholder: '留空用默认形象；填写后只改称呼与语气，不改教学职责与权限', onChange: event => edit({ ...form, persona: event.target.value }) })),
          h('label', { style: { display: 'block', marginTop: 10 } }, '科目（可选）',
            h('input', { 'aria-label': '科目', style: STYLE.templateInput, value: form.subjects, placeholder: '如：数学、物理', onChange: event => edit({ ...form, subjects: event.target.value }) })),
          (settings.scriptPath || settings.routePath || settings.continuation) && h('p', { style: { ...STYLE.notice, marginTop: 16 } }, '本课由课堂安排带入：', [settings.routePath ? `路线 ${settings.routePath}` : '', settings.scriptPath ? `剧本 ${settings.scriptPath}` : ''].filter(Boolean).join(' · '), settings.continuation ? '（接着上次的小结）' : ''),
          h('div', { style: { display: 'flex', gap: 8, marginTop: 20 } },
            h('button', { type: 'submit', style: STYLE.quiet, disabled: busy }, busy ? '正在保存…' : '保存设置'),
            h('button', { type: 'button', style: STYLE.quiet, disabled: busy, onClick: clear }, '清空设置')))));
  }

  /** 总结本课: a lesson-level summary, not the native archive entry — the class
   * stays in the session list, so the student can keep talking in it. */
  function SummaryEntry({ ctx, sessionId }) {
    const vault = useMemo(() => createVaultClient(ctx, sessionId), [ctx, sessionId]);
    const [status, setStatus] = useState('');
    useEffect(() => { if (!status) return undefined; const timer = setTimeout(() => setStatus(''), 8000); return () => clearTimeout(timer); }, [status]);
    const run = async () => {
      setStatus('正在交给本课…');
      try {
        const result = await vault.requestLessonSummary({ sessionId });
        setStatus(result?.ok ? '已请老师在本课收尾并总结' : '现在还不能总结，请稍后重试。');
      } catch { setStatus('现在还不能总结，请稍后重试。'); }
    };
    return h(React.Fragment, null,
      h(IconButton, { icon: 'log', label: '总结本课', disabled: !sessionId, onClick: () => { void run(); } }),
      status && h('span', { role: 'status', style: STYLE.notice }, status));
  }

  return { TeachingEntry, SummaryEntry };
}
