/**
 * 像素教室 — 可运行演示（Notara 课堂演示）。
 *
 * 分工：本文件只负责课堂这一层（外框、演示工作流、人物详情、布置教室的入口），
 * 画布里的像素教室全部交给上游 Pixel Agents 的原版实现：
 *
 *   · `OfficeState`      — 教室状态机（座位、寻路、角色 FSM、家具自动开关）
 *   · `OfficeCanvas`     — 真正的绘制与交互（rAF 循环、缩放、拖动）
 *   · `useEditorActions` — 原版编辑功能（放置/旋转/删除/撤销/保存）
 *   · 素材              — `main.tsx` 里 `await loadClassroomAssets()` 已把原版 sprite、
 *                        地面/墙件、家具 catalog 装进上游模块缓存，这里直接用。
 *
 * DSH 插件模式只接收现有教室的状态与操作；独立页面仍保留离线演示脚本。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ZOOM_MAX, ZOOM_MIN } from '../upstream/webview-ui/src/constants';
import { useEditorActions } from '../upstream/webview-ui/src/hooks/useEditorActions';
import { useEditorKeyboard } from '../upstream/webview-ui/src/hooks/useEditorKeyboard';
import { OfficeCanvas } from '../upstream/webview-ui/src/office/components/OfficeCanvas';
import { EditorState } from '../upstream/webview-ui/src/office/editor/editorState';
import { OfficeState } from '../upstream/webview-ui/src/office/engine/officeState';
import {
  getActiveCategories,
  getCatalogByCategory,
  getCatalogEntry,
  isRotatable,
} from '../upstream/webview-ui/src/office/layout/furnitureCatalog';
import { getLoadedCharacterCount } from '../upstream/webview-ui/src/office/sprites/spriteData';
import { setProviderCapabilities } from '../upstream/webview-ui/src/office/toolUtils';
import { EditTool } from '../upstream/webview-ui/src/office/types';
import { liveMode, useLiveClassroom, classroomAction, LiveInspector } from './live-classroom';
import { CHARACTER_SKINS, characterSkin, readSkinChoices, saveSkinChoices, skinSheetUrl, type SkinId } from './character-skins';

import {
  CLASSROOM_FLOOR_COLOR,
  CLASSROOM_WALL_COLOR,
  DEMO_ROLES,
  DEMO_STEPS,
  createClassroomLayout,
  liveRoleId,
  liveRoleSeat,
  loadInitialClassroomLayout,
  type DemoRoleKey,
  type DisplayRole,
} from './classroom-layout';

/**
 * 画布状态活在 React 之外，和上游 `App.tsx` 的做法一致：绘制循环每帧直接读它，
 * React 重渲染不会重建教室，也不会打断正在走的角色。
 */
const officeStateRef: { current: OfficeState | null } = { current: null };
const editorState = new EditorState();

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    officeStateRef.current = new OfficeState(createClassroomLayout());
  }
  return officeStateRef.current;
}

/** 家具目录里的英文名只是素材名，分类名给中文，避免整份工具栏都看不懂。 */
const CATEGORY_LABELS: Record<string, string> = {
  desks: '课桌',
  chairs: '座椅',
  storage: '收纳',
  electronics: '电子设备',
  decor: '绿植装饰',
  wall: '墙面装饰',
  misc: '其他',
};

type BootState = 'loading' | 'ready' | 'error';

export default function ClassroomApp() {
  const live = useLiveClassroom();
  // Real classroom: one teacher post plus one post per Host worker. Sprite ids
  // continue DEMO_ROLES' numbering, so the first two posts reuse the demo helper
  // ids and the rest extend the same pool. Demo mode keeps the scripted roles.
  const workers = useMemo(() => live.state?.workers ?? [], [live.state?.workers]);
  const roles = useMemo<DisplayRole[]>(() => {
    if (!liveMode) return DEMO_ROLES;
    const teacher: DisplayRole = { ...DEMO_ROLES[0], name: live.state?.teacher?.name || '老师', title: '主教师' };
    const posts = workers.map((worker, index) => ({
      id: liveRoleId(index),
      key: worker.id,
      name: worker.name || `工作员 ${index + 1}`,
      title: worker.description || '后台工作员',
      seatId: liveRoleSeat(index),
      preset: worker.id,
    }));
    return [teacher, ...posts];
  }, [live.state?.teacher?.name, workers]);
  const [boot, setBoot] = useState<BootState>('loading');
  const [bootError, setBootError] = useState('');
  const [layoutSource, setLayoutSource] = useState<'stored' | 'default'>('default');
  const [steps, setSteps] = useState(() => DEMO_STEPS.map((step) => ({ ...step })));
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string>('teacher');
  const [skinChoices, setSkinChoices] = useState(readSkinChoices);
  const [rewriteIndex, setRewriteIndex] = useState<number | null>(null);
  const [goalDraft, setGoalDraft] = useState('');
  const [editTick, setEditTick] = useState(0);
  const stageRef = useRef<HTMLDivElement | null>(null);

  // 上游编辑器：缩放、拖动、放置、撤销、保存都走它，本文件不重写这些规则。
  const editor = useEditorActions(getOfficeState, editorState);
  const officeState = getOfficeState();

  // 家具目录只在「放置家具」时读，来源仍是上游 buildDynamicCatalog 建好的原版 catalog。
  const [catalogTick, setCatalogTick] = useState(0);
  const categories = useMemo(() => {
    void catalogTick;
    return getActiveCategories();
  }, [catalogTick]);
  const visibleFurnitureTypes = useMemo(
    () => new Set(categories.flatMap((category) => getCatalogByCategory(category.id).map((item) => item.type))),
    [categories],
  );

  // ── 启动：教室布局 + 演示角色 ────────────────────────────────────────────
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    try {
      // 素材由 main.tsx 在渲染前装好；这里只做一次诚实的前置断言，缺了就报错。
      if (getLoadedCharacterCount() === 0) throw new Error('角色素材未加载');
      if (!getCatalogEntry('WOODEN_CHAIR_BACK') || !getCatalogEntry('DESK_FRONT')) {
        throw new Error('家具素材未加载');
      }

      const initial = loadInitialClassroomLayout();
      const os = getOfficeState();
      os.rebuildFromLayout(initial.layout, undefined);
      // 上游按 providerCapabilities 区分“阅读/书写”动画；演示脚本用的是同一套工具名。
      setProviderCapabilities({ readingTools: ['Read'], subagentToolNames: [] });

      for (const role of roles) {
        if (!os.characters.has(role.id)) {
          os.addAgent(role.id, characterSkin(role.key, skinChoices).palette, 0, role.seatId);
        }
      }

      // 让「还原」回到进入布置前的教室，而不是上游的出厂办公室。
      editor.setLastSavedLayout(os.getLayout());

      // 初始缩放：把整间教室放进画布，别让像素教室缩在角落里。
      const rect = stageRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        const dpr = window.devicePixelRatio || 1;
        const layout = os.getLayout();
        const roomW = layout.cols * 16;
        const roomH = layout.rows * 16;
        const fit = Math.floor(Math.min((rect.width * dpr) / roomW, (rect.height * dpr) / roomH) * 0.92);
        editor.handleZoomChange(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fit)));
      }
      editorState.floorColor = { ...CLASSROOM_FLOOR_COLOR };
      editorState.wallColor = { ...CLASSROOM_WALL_COLOR };
      setLayoutSource(initial.source);
      setBoot('ready');
    } catch (error) {
      setBootError(error instanceof Error ? error.message : '未知错误');
      setBoot('error');
    }
    // 只在挂载时跑一次；editor 每次渲染都是新对象，不能进依赖。
  }, [editor]);

  // Appearance belongs to the browser presentation, never the worker's model
  // or task. Updating a palette preserves the live character, seat and motion.
  useEffect(() => {
    if (boot !== 'ready') return;
    for (const role of roles) {
      const skin = characterSkin(role.key, skinChoices);
      const character = officeState.characters.get(role.id);
      if (character) { character.palette = skin.palette; character.hueShift = 0; }
      else officeState.addAgent(role.id, skin.palette, 0, role.seatId);
    }
  }, [boot, roles, skinChoices, officeState]);

  // ── 演示工作流：每一步都是声明式状态，重放同一步不会漂移 ─────────────────
  const currentStep = steps[stepIndex];

  const applyStep = useCallback((index: number) => {
    const os = officeStateRef.current;
    const step = steps[index];
    if (!os || !step) return;
    for (const role of DEMO_ROLES) {
      const ch = os.characters.get(role.id);
      if (!ch) continue;
      const assignment = step.assignment[role.key];
      // 换座位 = 走动：上游会自己寻路，走完坐下并面向椅子方向。
      if (ch.seatId !== assignment.seatId && os.seats.has(assignment.seatId)) {
        os.reassignSeat(role.id, assignment.seatId);
      }
      os.setAgentActive(role.id, assignment.active);
      os.setAgentTool(role.id, assignment.tool);
      // 上下文量只是演示数据；上限沿用上游默认值，越界由它自己夹住。
      os.setAgentContext(role.id, Math.round((ch.maxContextTokens * assignment.contextPercent) / 100), ch.maxContextTokens);
      if (assignment.waiting) os.showWaitingBubble(role.id, true);
      else if (ch.bubbleType === 'waiting') os.dismissBubble(role.id);
    }
  }, [steps]);

  useEffect(() => {
    if (boot !== 'ready' || liveMode) return;
    applyStep(stepIndex);
  }, [applyStep, stepIndex, boot]);

  // Same renderer, real classroom snapshot. Never convert a stopped/failed
  // task into success and never animate stale or hidden state as running.
  useEffect(() => {
    if (!liveMode || boot !== 'ready') return;
    const available = live.connected && !live.state?.error && live.state?.visible;
    const os = officeStateRef.current;
    // The snapshot arrives after the first paint, so a worker post joins the
    // classroom the moment the Host reports it — never by re-running the demo.
    if (os) for (const role of roles) if (!os.characters.has(role.id)) os.addAgent(role.id, characterSkin(role.key, skinChoices).palette, 0, role.seatId);
    for (const role of roles) {
      const active = !!available && (role.key === 'teacher'
        ? live.state?.teacher?.active === true
        : workers.some(worker => worker.id === role.preset && worker.active));
      officeState.setAgentActive(role.id, active);
      officeState.setAgentTool(role.id, active ? 'Write' : null);
    }
  }, [boot, roles, workers, live.state, live.connected, officeState, skinChoices]);

  // 播放：每步按脚本时长推进，播到最后一步自动停下。
  useEffect(() => {
    if (boot !== 'ready' || !playing) return;
    const seconds = steps[stepIndex]?.seconds ?? 5;
    const timer = window.setTimeout(() => {
      if (stepIndex + 1 < steps.length) setStepIndex(stepIndex + 1);
      else setPlaying(false);
    }, seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [boot, playing, stepIndex, steps]);

  // 上游等待气泡只有 2 秒；停在“等待作答”那一步时按节拍续上。
  useEffect(() => {
    if (boot !== 'ready' || liveMode) return;
    const waiting = DEMO_ROLES.filter((role) => steps[stepIndex]?.assignment[role.key]?.waiting);
    if (waiting.length === 0) return;
    const timer = window.setInterval(() => {
      const os = officeStateRef.current;
      if (!os) return;
      for (const role of waiting) os.showWaitingBubble(role.id, true);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [boot, steps, stepIndex]);

  // 宿主页面想联动时用：window.dispatchEvent(new CustomEvent('pixel-classroom:focus', { detail: { id } }))
  useEffect(() => {
    const onFocus = (event: Event) => {
      const id = (event as CustomEvent<{ id?: number }>).detail?.id;
      if (typeof id !== 'number') return;
      const role = roles.find((item) => item.id === id);
      if (!role) return;
      const os = officeStateRef.current;
      if (os) {
        os.selectedAgentId = role.id;
        os.cameraFollowId = role.id;
      }
      setSelectedRole(role.key);
    };
    window.addEventListener('pixel-classroom:focus', onFocus);
    return () => window.removeEventListener('pixel-classroom:focus', onFocus);
  }, [roles]);

  // ── 交互 ─────────────────────────────────────────────────────────────────
  const focusRole = useCallback((role: DisplayRole) => {
    const os = officeStateRef.current;
    if (os) {
      os.selectedAgentId = role.id;
      os.cameraFollowId = role.id;
    }
    setSelectedRole(role.key);
  }, []);

  // 点画布上的人物：上游 OfficeCanvas 已经处理了高亮，这里再把镜头和右侧详情对上。
  const handleCanvasClick = useCallback((agentId: number) => {
    const role = roles.find((item) => item.id === agentId);
    if (!role) return;
    const os = officeStateRef.current;
    if (os) {
      os.selectedAgentId = role.id;
      os.cameraFollowId = role.id;
    }
    setSelectedRole(role.key);
  }, [roles]);

  const bumpEditTick = useCallback(() => setEditTick((n) => n + 1), []);
  useEditorKeyboard(
    editor.isEditMode,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    bumpEditTick,
    editor.handleToggleEditMode,
  );

  const toggleEditMode = useCallback(() => {
    if (!editor.isEditMode) {
      // 进布置模式先停止镜头跟随，并把画笔颜色对齐本教室，刷出来的地板/墙不会跳色。
      const os = officeStateRef.current;
      if (os) {
        os.cameraFollowId = null;
        os.selectedAgentId = null;
      }
      editorState.floorColor = { ...CLASSROOM_FLOOR_COLOR };
      editorState.wallColor = { ...CLASSROOM_WALL_COLOR };
      setCatalogTick((n) => n + 1);
    }
    editor.handleToggleEditMode();
  }, [editor]);

  const restoreClassroom = useCallback(() => {
    const os = officeStateRef.current;
    if (!os) return;
    os.rebuildFromLayout(createClassroomLayout(), undefined);
    editor.setLastSavedLayout(os.getLayout());
    editor.markClean();
    editor.handleSave(); // 立即把出厂教室写回本地
    setLayoutSource('default');
  }, [editor]);

  const selectTool = useCallback(
    (tool: EditTool) => {
      editor.handleToolChange(tool);
      bumpEditTick();
    },
    [editor, bumpEditTick],
  );

  const pickFurniture = useCallback(
    (type: string) => {
      // handleFurnitureTypeChange 只切类型，不进放置模式；进模式不能走 handleToolChange
      // （同一个工具会 toggle 掉），所以直接改 editorState，再由它自己触发重渲染。
      if (editorState.activeTool !== EditTool.FURNITURE_PLACE) {
        editorState.activeTool = EditTool.FURNITURE_PLACE;
      }
      editor.handleFurnitureTypeChange(type);
      bumpEditTick();
    },
    [editor, bumpEditTick],
  );

  // ── 演示播放控制 ─────────────────────────────────────────────────────────
  const atLastStep = stepIndex >= steps.length - 1;
  const togglePlay = useCallback(() => {
    setPlaying((prev) => {
      if (prev) return false;
      if (atLastStep && stepIndex > 0) setStepIndex(0);
      return true;
    });
  }, [atLastStep, stepIndex]);

  const stepOnce = useCallback(() => {
    setPlaying(false);
    setStepIndex((index) => Math.min(index + 1, steps.length - 1));
  }, [steps.length]);

  const resetDemo = useCallback(() => {
    setPlaying(false);
    setRewriteIndex(null);
    setStepIndex(0);
  }, []);

  const rewindTo = useCallback(
    (index: number) => {
      setPlaying(false);
      setStepIndex(index);
      setRewriteIndex(index);
      setGoalDraft(steps[index]?.goal ?? '');
    },
    [steps],
  );

  const commitRewrite = useCallback(() => {
    const index = rewriteIndex;
    const goal = goalDraft.trim();
    setRewriteIndex(null);
    if (index === null || goal.length === 0) return;
    setSteps((prev) => prev.map((step, i) => {
      if (i !== index) return step;
      if (step.id !== 'revise') return { ...step, goal };
      return { ...step, goal, assignment: { ...step.assignment,
        teacher: { ...step.assignment.teacher, detail: `给原解题者追加要求：${goal}` },
        helperA: { ...step.assignment.helperA, detail: `按老师的新要求修订：${goal}`,
          knowledge: ['原研究与草稿', `老师追加：${goal}`] },
      } };
    }));
  }, [goalDraft, rewriteIndex]);

  const replayFromRewrite = useCallback(() => {
    commitRewrite();
    setPlaying(true);
  }, [commitRewrite]);

  const zoomOut = useCallback(() => editor.handleZoomChange(editor.zoom - 1), [editor]);
  const zoomIn = useCallback(() => editor.handleZoomChange(editor.zoom + 1), [editor]);
  const zoomReset = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dpr = window.devicePixelRatio || 1, layout = officeState.getLayout();
    const fit = Math.floor(Math.min(rect.width * dpr / (layout.cols * 16), rect.height * dpr / (layout.rows * 16)) * .92);
    editor.panRef.current = { x: 0, y: 0 };
    officeState.cameraFollowId = null;
    editor.handleZoomChange(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fit)));
  }, [editor]);

  // ── 面板数据（全部来自演示脚本，按当前步推导）────────────────────────────
  const role = roles.find((item) => item.key === selectedRole) ?? roles[0];
  const selectedSkin = characterSkin(role.key, skinChoices);
  const changeSkin = (id: SkinId) => {
    const next = { ...skinChoices, [role.key]: id };
    setSkinChoices(next); saveSkinChoices(next);
  };
  const roleState = liveMode ? undefined : currentStep?.assignment[role.key as DemoRoleKey];
  const outputs = useMemo(() => {
    const collected: Array<{ stepTitle: string; text: string }> = [];
    steps.slice(0, stepIndex + 1).forEach((step) => {
      step.outputs
        .filter((output) => output.role === role.key)
        .forEach((output) => collected.push({ stepTitle: step.title, text: output.text }));
    });
    return collected;
  }, [role.key, stepIndex, steps]);
  const process = useMemo(
    () =>
      liveMode ? [] : steps.slice(0, stepIndex + 1).map((step, index) => ({
        index,
        title: step.title,
        activity: step.assignment[role.key as DemoRoleKey].activity,
        status: index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'pending',
      })),
    [liveMode, role.key, stepIndex, steps],
  );

  const busy = boot === 'loading';
  const selectedFurnitureType = editorState.selectedFurnitureType;

  return (
    <div
      className="pc-root"
      data-nc-mode={liveMode ? 'live' : 'demo'}
      data-nc-boot={boot}
      data-nc-step={stepIndex}
      data-nc-playing={playing ? 'true' : 'false'}
      data-nc-role={role.key}
      data-nc-skin={selectedSkin.id}
      data-nc-edit-mode={editor.isEditMode ? 'true' : 'false'}
      data-nc-layout-source={layoutSource}
    >
      <header className="pc-header">
        <div className="pc-brand">
          <span className="pc-brand-title">{liveMode ? '像素视图' : '像素教室'}</span>
          <span className="pc-brand-sub">{liveMode ? '当前课堂' : '子代理编排 · 演示'}</span>
        </div>
        <div className="pc-badges">
          {liveMode ? <span className="pc-badge" role="status">{!live.connected ? '连接中' : live.state?.error ? '连接异常' : '已连接 DSH'}</span> : <>
            <span className="pc-badge pc-badge-demo">演示数据 · 不消耗模型</span>
            <span className="pc-badge">本地演示运行 · 未连接真实服务</span>
          </>}
          {layoutSource === 'stored' && <span className="pc-badge">已载入上次布置</span>}
        </div>
        <div className="pc-header-actions">
          <button
            type="button"
            className={editor.isEditMode ? 'pc-btn pc-btn-primary' : 'pc-btn'}
            onClick={toggleEditMode}
            data-nc-action="toggle-edit"
          >
            {editor.isEditMode ? '完成布置' : '布置教室'}
          </button>
        </div>
      </header>

      <div className="pc-main">
        <section className="pc-stage-col">
          <div className="pc-stage" ref={stageRef}>
            {boot === 'error' ? (
              <div className="pc-stage-message" role="alert">
                <p className="pc-empty-title">教室素材没有准备好</p>
                <p className="pc-empty-text">{bootError}。刷新页面会重新加载素材。</p>
              </div>
            ) : busy ? (
              <div className="pc-stage-message">
                <p className="pc-empty-title">正在准备教室…</p>
                <p className="pc-empty-text">加载人物、家具与教室布局。</p>
              </div>
            ) : (
              <div className="pc-canvas-host">
                <OfficeCanvas
                  officeState={officeState}
                  onClick={handleCanvasClick}
                  isEditMode={editor.isEditMode}
                  editorState={editorState}
                  onEditorTileAction={editor.handleEditorTileAction}
                  onEditorEraseAction={editor.handleEditorEraseAction}
                  onEditorSelectionChange={editor.handleEditorSelectionChange}
                  onDeleteSelected={editor.handleDeleteSelected}
                  onRotateSelected={editor.handleRotateSelected}
                  onDragMove={editor.handleDragMove}
                  editorTick={editor.editorTick}
                  zoom={editor.zoom}
                  onZoomChange={editor.handleZoomChange}
                  panRef={editor.panRef}
                  showAreas={false}
                  activeAreaLabel={null}
                />
              </div>
            )}

            {boot === 'ready' && (
              <>
                <div className="pc-stage-caption">
                  <span className="pc-stage-step">
                    {liveMode ? '课堂实时状态' : `第 ${stepIndex + 1}/${steps.length} 步 · ${currentStep?.title}`}
                  </span>
                  <span className="pc-stage-goal">{liveMode ? (!live.connected || live.state?.error ? '等待同步课堂状态' : live.state?.tasks.some(task => task.status === 'running') ? '后台工作正在进行' : '等待课堂中的下一项任务') : `目标：${currentStep?.goal}`}</span>
                </div>
                <p className="pc-stage-hint">
                  点击人物查看任务 · Ctrl/⌘ + 滚轮缩放 · 中键拖动画布
                </p>
                <div className="pc-zoom">
                  <button
                    type="button"
                    className="pc-zoom-btn"
                    onClick={zoomOut}
                    disabled={editor.zoom <= ZOOM_MIN}
                    aria-label="缩小"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="pc-zoom-value"
                    onClick={zoomReset}
                    title="适应教室大小"
                  >
                    {editor.zoom}×
                  </button>
                  <button
                    type="button"
                    className="pc-zoom-btn"
                    onClick={zoomIn}
                    disabled={editor.zoom >= ZOOM_MAX}
                    aria-label="放大"
                  >
                    +
                  </button>
                </div>
              </>
            )}
          </div>

          {editor.isEditMode && boot === 'ready' && (
            // editTick 只为让键盘操作（Esc / T / R）后的工具栏状态跟着刷新。
            <div className="pc-editor" data-nc-editor-tick={editTick}>
              <div className="pc-editor-row">
                <span className="pc-editor-label">布置</span>
                <div className="pc-chip-row">
                  <button
                    type="button"
                    className={editorState.activeTool === EditTool.SELECT ? 'pc-chip is-on' : 'pc-chip'}
                    onClick={() => selectTool(EditTool.SELECT)}
                  >
                    选择 / 拖动
                  </button>
                  <button
                    type="button"
                    className={
                      editorState.activeTool === EditTool.FURNITURE_PLACE ? 'pc-chip is-on' : 'pc-chip'
                    }
                    onClick={() => selectTool(EditTool.FURNITURE_PLACE)}
                  >
                    放置家具
                  </button>
                  <select
                    className="pc-select"
                    value={editorState.selectedFurnitureType}
                    onChange={(event) => {
                      const type = event.target.value;
                      if (type) pickFurniture(type);
                    }}
                    aria-label="选择要摆放的家具"
                  >
                    <option value="">选择家具…</option>
                    {editorState.selectedFurnitureType &&
                      !visibleFurnitureTypes.has(editorState.selectedFurnitureType) && (
                        <option value={editorState.selectedFurnitureType}>
                          {getCatalogEntry(editorState.selectedFurnitureType)?.label ?? '当前家具'} · 已旋转
                        </option>
                      )}
                    {categories.map((category) => (
                      <optgroup key={category.id} label={CATEGORY_LABELS[category.id] ?? category.label}>
                        {getCatalogByCategory(category.id).map((item) => (
                          <option key={item.type} value={item.type}>
                            {item.label} · {item.footprintW}×{item.footprintH}
                            {isRotatable(item.type) ? ' · 可旋转' : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="pc-chip-row">
                  <button
                    type="button"
                    className="pc-chip"
                    onClick={editor.handleRotateSelected}
                    disabled={!editorState.selectedFurnitureType && !editorState.selectedFurnitureUid}
                  >
                    旋转 (R)
                  </button>
                  <button
                    type="button"
                    className="pc-chip"
                    onClick={editor.handleToggleState}
                    disabled={!editorState.selectedFurnitureType && !editorState.selectedFurnitureUid}
                  >
                    开关 (T)
                  </button>
                  <button
                    type="button"
                    className="pc-chip"
                    onClick={editor.handleDeleteSelected}
                    disabled={!editorState.selectedFurnitureUid}
                  >
                    删除
                  </button>
                  <button type="button" className="pc-chip" onClick={editor.handleUndo}>
                    撤销
                  </button>
                  <button type="button" className="pc-chip" onClick={editor.handleRedo}>
                    重做
                  </button>
                  <button
                    type="button"
                    className={editor.isDirty ? 'pc-chip is-accent' : 'pc-chip'}
                    onClick={editor.handleSave}
                    data-nc-action="save-layout"
                  >
                    保存布置
                  </button>
                  <button type="button" className="pc-chip" onClick={editor.handleReset}>
                    还原
                  </button>
                  <button
                    type="button"
                    className="pc-chip"
                    onClick={restoreClassroom}
                    data-nc-action="restore-classroom"
                  >
                    恢复出厂教室
                  </button>
                </div>
                <span className="pc-muted">
                  拖动物件即可挪位；放置模式里点空白处摆新家具，Esc 退出。
                </span>
              </div>
            </div>
          )}

          {liveMode ? <footer className="pc-timeline"><div className="pc-controls">
            <button className="pc-btn" disabled={!live.connected} onClick={() => classroomAction('refresh')}>刷新状态</button>
            <button className="pc-btn" disabled={!live.connected || !workers.length} onClick={() => classroomAction('configure')}>教室设置</button>
            <span className="pc-controls-note">任务来自当前课堂，自动同步</span>
          </div></footer> : <footer className="pc-timeline">
            <div className="pc-controls">
              <button
                type="button"
                className="pc-btn pc-btn-primary"
                onClick={togglePlay}
                data-nc-action="toggle-play"
              >
                {playing ? '暂停' : atLastStep && stepIndex > 0 ? '从头播放' : '播放'}
              </button>
              <button
                type="button"
                className="pc-btn"
                onClick={stepOnce}
                disabled={atLastStep}
                data-nc-action="step-once"
              >
                单步
              </button>
              <button
                type="button"
                className="pc-btn"
                onClick={resetDemo}
                disabled={stepIndex === 0 && !playing}
                data-nc-action="reset"
              >
                归零
              </button>
              <span className="pc-controls-note">
                演示工作流 · {steps[stepIndex]?.seconds} 秒/步 · 点任意一步可退回修改
              </span>
            </div>

            <ol className="pc-steps">
              {steps.map((step, index) => (
                <li key={step.id}>
                  <button
                    type="button"
                    className={
                      index === stepIndex ? 'pc-step is-current' : index < stepIndex ? 'pc-step is-done' : 'pc-step'
                    }
                    onClick={() => rewindTo(index)}
                  >
                    <span className="pc-step-index">{index + 1}</span>
                    {step.title}
                  </button>
                </li>
              ))}
            </ol>

            {rewriteIndex !== null && (
              <div className="pc-rewrite">
                <label className="pc-rewrite-label" htmlFor="pc-goal">
                  第 {rewriteIndex + 1} 步「{steps[rewriteIndex]?.title}」的目标
                </label>
                <textarea
                  id="pc-goal"
                  className="pc-rewrite-input"
                  rows={2}
                  value={goalDraft}
                  onChange={(event) => setGoalDraft(event.target.value)}
                />
                <div className="pc-chip-row">
                  <button type="button" className="pc-chip" onClick={commitRewrite}>
                    保存修改
                  </button>
                  <button type="button" className="pc-chip is-accent" onClick={replayFromRewrite}>
                    改完从这一步重放
                  </button>
                  <button type="button" className="pc-chip pc-chip-quiet" onClick={() => setRewriteIndex(null)}>
                    取消
                  </button>
                </div>
              </div>
            )}
          </footer>}
        </section>

        <aside className="pc-side">
          <div className="pc-side-head">
            <span className="pc-skin-portrait" aria-hidden="true" style={{ backgroundImage: `url(${skinSheetUrl(selectedSkin.id)})` }} />
            <div className="pc-role-heading">
              <div className="pc-role-name">{role.name}</div>
              <div className="pc-role-title">{role.title}</div>
            </div>
          </div>
          <details className="pc-skin-picker">
            <summary aria-label="更换外观" title="更换人物外观">外观 <span aria-hidden="true">⌄</span></summary>
            <div className="pc-skin-options" aria-label="人物外观">
              {CHARACTER_SKINS.map(skin => <button key={skin.id} type="button" className="pc-skin-option"
                aria-label={`使用${skin.label}外观`} aria-pressed={selectedSkin.id === skin.id}
                onClick={() => changeSkin(skin.id)}>
                <span className="pc-skin-thumb" aria-hidden="true" style={{ backgroundImage: `url(${skinSheetUrl(skin.id)})` }} />
                <span>{skin.label}</span>
              </button>)}
            </div>
            <p className="pc-muted">只换外观，模型与课堂分工保持不变。</p>
          </details>
          <div className="pc-chip-row pc-role-tabs">
            {roles.map((item) => (
              <button
                key={item.key}
                type="button"
                className={item.key === role.key ? 'pc-chip is-on' : 'pc-chip pc-chip-quiet'}
                onClick={() => focusRole(item)}
                data-nc-action={`focus-${item.key}`}
              >
                {item.name}
              </button>
            ))}
          </div>

          {liveMode ? <LiveInspector state={live.state} connected={live.connected} roleId={role.key} /> : roleState && (
            <>
              <section className="pc-block">
                <h3 className="pc-block-title">当前活动</h3>
                <p className="pc-activity">{roleState.activity}</p>
                <p className="pc-detail">{roleState.detail}</p>
                {roleState.waiting && <span className="pc-tag">等待老师反馈</span>}
              </section>

              <section className="pc-block">
                <h3 className="pc-block-title">上下文</h3>
                <div className="pc-gauge" role="img" aria-label={`模拟上下文占用 ${roleState.contextPercent}%`}>
                  <span className="pc-gauge-fill" style={{ width: `${roleState.contextPercent}%` }} />
                </div>
                <div className="pc-gauge-label">模拟占用 {roleState.contextPercent}%</div>
                <ul className="pc-list">
                  {roleState.knowledge.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>

              <section className="pc-block">
                <h3 className="pc-block-title">结果</h3>
                {outputs.length === 0 ? (
                  <p className="pc-muted">这一步还没有产出。</p>
                ) : (
                  <ul className="pc-outputs">
                    {outputs.map((output) => (
                      <li key={`${output.stepTitle}-${output.text}`}>
                        <span className="pc-output-step">{output.stepTitle}</span>
                        <span>{output.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="pc-block">
                <h3 className="pc-block-title">过程</h3>
                <ol className="pc-process">
                  {process.map((entry) => (
                    <li key={entry.title} className={`pc-process-item is-${entry.status}`}>
                      <span className="pc-process-dot" aria-hidden="true" />
                      <span className="pc-process-body">
                        <span className="pc-process-title">{entry.title}</span>
                        <span className="pc-process-action">{entry.activity}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}

          <p className="pc-side-foot">
            {liveMode ? '与列表视图共用同一份课堂状态；完整分析按需在原生记录中打开。' : '这里的上下文、结果与过程都是演示脚本内容，用于说明课堂怎么运转；教室没有连接任何真实服务。'}
            <br /><a href="https://github.com/pixel-agents-hq/pixel-agents" target="_blank" rel="noreferrer">基于 Pixel Agents</a> · <a href="./LICENSE" target="_blank">MIT</a>
          </p>
        </aside>
      </div>
    </div>
  );
}
