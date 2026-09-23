/**
 * 像素教室（Notara 课堂演示）— 教室布局与演示脚本的唯一数据源。
 *
 * 这里只有三类东西：
 *
 * 1. `CLASSROOM_LAYOUT`：一条上游 Pixel Agents 原生 `OfficeLayout`（tile = 16px，
 *    墙件向上占半格）。白板与书架挂在北墙，讲台居中，两张学生课桌在南侧，
 *    图书角在左前，绿植围边。它的坐标语义完全按上游走，所以可以直接交给上游
 *    `OfficeState` / `OfficeCanvas` 渲染与寻路，本文件不复制任何绘制逻辑。
 *
 * 2. `DEMO_ROLES`：1 位老师 + 2 位子代理，以及它们各自的座位 uid。座位 uid 就是
 *    布局里椅子的 uid（上游 `layoutToSeats` 用椅子生成座位），所以老师把椅子拖走，
 *    角色下次就坐到新位置，不需要第二套坐标。
 *
 * 3. `DEMO_STEPS`：演示工作流。每一步都是**声明式状态**（谁坐哪、在读写什么、
 *    上下文占用多少、有没有等待气泡），播放 / 单步 / 归零 / 定点退回都只是重新套用
 *    某一步，不做增量推算，因此来回跳步不会漂移。
 *
 * 全部是演示数据：不调用模型、不读取真实课堂、不写真实学习记录。
 */
import type { ColorValue } from '../upstream/webview-ui/src/components/ui/types';
import type { OfficeLayout, PlacedFurniture } from '../upstream/webview-ui/src/office/types';
import { TileType } from '../upstream/webview-ui/src/office/types';

// ── 尺寸与配色 ────────────────────────────────────────────────────────────────
// 房间 16×13：第 0 行只用于挂墙装饰，第 1 行是北墙，第 2..10 行是可走地板，
// 第 11 行被南墙上半部分遮住（作者用的过渡行），第 12 行是南墙。
const COLS = 16;
const ROWS = 13;
const WALL_ROW_NORTH = 1;
const HIDDEN_ROW_SOUTH = 11;
const WALL_ROW_SOUTH = 12;

/** 木地板。取自上游默认布局里久经使用的木色，避免自创配色翻车。 */
export const CLASSROOM_FLOOR_COLOR: ColorValue = { h: 25, s: 48, b: -43, c: -88 };
/** 深蓝墙面。同样取自上游默认布局。 */
export const CLASSROOM_WALL_COLOR: ColorValue = { h: 214, s: 30, b: -100, c: -55 };

/** 浏览器里持久化教室布局的 key（与本地 bridge 的 `saveLayout` 一致）。 */
export const CLASSROOM_LAYOUT_KEY = 'notara.pixel-classroom.layout.v1';

function buildTiles(): OfficeLayout['tiles'] {
  const tiles: OfficeLayout['tiles'] = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (row === 0 || row === HIDDEN_ROW_SOUTH) {
        tiles.push(TileType.VOID);
      } else if (row === WALL_ROW_NORTH || row === WALL_ROW_SOUTH) {
        tiles.push(TileType.WALL);
      } else if (col === 0 || col === COLS - 1) {
        tiles.push(TileType.WALL);
      } else {
        tiles.push(TileType.FLOOR_7);
      }
    }
  }
  return tiles;
}

function buildTileColors(tiles: OfficeLayout['tiles']): Array<ColorValue | null> {
  return tiles.map((tile) => {
    if (tile === TileType.WALL) return { ...CLASSROOM_WALL_COLOR };
    if (tile === TileType.VOID) return null;
    return { ...CLASSROOM_FLOOR_COLOR };
  });
}

// ── 家具 ─────────────────────────────────────────────────────────────────────
// 约定（与上游 `canPlaceFurniture` 一致）：
//   · 挂墙件（canPlaceOnWalls）底行必须落在 WALL 上，往上可以压 VOID；
//   · 其余家具有 `backgroundTiles: 1` 的，顶行可走/可叠放，第二行才是阻挡行；
//   · 椅子 uid 就是座位 uid，椅子方向决定角色落座朝向。
const CLASSROOM_FURNITURE: PlacedFurniture[] = [
  // 北墙：白板居中，左边书架，其余是钟、吊兰与画
  { uid: 'cl-whiteboard', type: 'WHITEBOARD', col: 7, row: 0 },
  { uid: 'cl-bookshelf', type: 'DOUBLE_BOOKSHELF', col: 1, row: 0 },
  { uid: 'cl-clock', type: 'CLOCK', col: 5, row: 0 },
  { uid: 'cl-hanging-plant', type: 'HANGING_PLANT', col: 11, row: 0 },
  { uid: 'cl-painting', type: 'SMALL_PAINTING', col: 14, row: 0 },

  // 讲台：讲桌 + 桌面电脑（放在左端，正对老师时不会挡住人）
  { uid: 'cl-podium', type: 'DESK_FRONT', col: 6, row: 3 },
  { uid: 'cl-podium-pc', type: 'PC_FRONT_OFF', col: 6, row: 3 },

  // 两张学生课桌，各带一台电脑（角色活动时上游会让电脑自动亮起）
  { uid: 'cl-desk-a', type: 'DESK_FRONT', col: 2, row: 6 },
  { uid: 'cl-desk-a-pc', type: 'PC_FRONT_OFF', col: 2, row: 6 },
  { uid: 'cl-desk-b', type: 'DESK_FRONT', col: 11, row: 6 },
  { uid: 'cl-desk-b-pc', type: 'PC_FRONT_OFF', col: 11, row: 6 },

  // 椅子 = 座位。老师面向全班（DOWN），学生面向白板（UP），图书角也面向书架（UP）
  { uid: 'chair-teacher', type: 'WOODEN_CHAIR_FRONT', col: 7, row: 2 },
  { uid: 'chair-desk-a', type: 'WOODEN_CHAIR_BACK', col: 3, row: 8 },
  { uid: 'chair-desk-b', type: 'WOODEN_CHAIR_BACK', col: 12, row: 8 },
  { uid: 'chair-desk-c', type: 'WOODEN_CHAIR_BACK', col: 5, row: 8 },
  { uid: 'chair-desk-d', type: 'WOODEN_CHAIR_BACK', col: 10, row: 8 },
  { uid: 'chair-reading', type: 'WOODEN_CHAIR_BACK', col: 2, row: 3 },

  // 四角绿植
  { uid: 'cl-plant-front-left', type: 'PLANT', col: 1, row: 2 },
  { uid: 'cl-plant-front-right', type: 'PLANT_2', col: 14, row: 2 },
  { uid: 'cl-plant-back-left', type: 'PLANT', col: 1, row: 9 },
  { uid: 'cl-plant-back-right', type: 'PLANT_2', col: 14, row: 9 },
];

/** 出厂教室。视为只读：交给 `OfficeState` 前请先 `structuredClone`。 */
export const CLASSROOM_LAYOUT: OfficeLayout = (() => {
  const tiles = buildTiles();
  return {
    version: 1,
    cols: COLS,
    rows: ROWS,
    layoutRevision: 1,
    tiles,
    tileColors: buildTileColors(tiles),
    furniture: CLASSROOM_FURNITURE,
    pets: [],
  };
})();

/** 座位 uid（= 椅子 uid），演示脚本只引用这里的名字。 */
export const CLASSROOM_SEATS = {
  teacher: 'chair-teacher',
  deskA: 'chair-desk-a',
  deskB: 'chair-desk-b',
  deskC: 'chair-desk-c',
  deskD: 'chair-desk-d',
  reading: 'chair-reading',
} as const;

/** 五个后台岗位的座位顺序：一位工作员一张椅子。 */
export const CLASSROOM_WORKER_SEATS = [
  CLASSROOM_SEATS.deskA,
  CLASSROOM_SEATS.deskB,
  CLASSROOM_SEATS.deskC,
  CLASSROOM_SEATS.deskD,
  CLASSROOM_SEATS.reading,
] as const;

// ── 演示角色 ─────────────────────────────────────────────────────────────────
export type DemoRoleKey = 'teacher' | 'helperA' | 'helperB';
/** 上游动画只区分“阅读”与“书写”，这里沿用它的工具名（不上屏）。 */
export type DemoActivity = 'Read' | 'Write';

/** 画面上的一个岗位。演示模式用 DEMO_ROLES，真实模式用 Host 的 workers。 */
export interface DisplayRole {
  /** 角色在上游 OfficeState 里的 id（正数 = 常驻角色，由座位承载） */
  id: number;
  /** 这个岗位的稳定 key：演示是 DemoRoleKey，真实模式是 preset id */
  key: string;
  /** 界面上显示的中文名 */
  name: string;
  /** 一句话说明它在本课里的分工 */
  title: string;
  /** 默认座位 uid */
  seatId: string;
  /** 真实模式下的 preset id（如 problem/lesson/review/general/exercise） */
  preset?: string;
}

export interface DemoRole extends DisplayRole { key: DemoRoleKey }

export const DEMO_ROLES: DemoRole[] = [
  { id: 1, key: 'teacher', name: '大肥鱼', title: '主教师 · 编排与汇总', seatId: CLASSROOM_SEATS.teacher },
  { id: 2, key: 'helperA', name: '解题者', title: '子代理 · 独立研究', seatId: CLASSROOM_SEATS.deskA },
  { id: 3, key: 'helperB', name: '核验者', title: '子代理 · 原文核对', seatId: CLASSROOM_SEATS.deskB },
];

/**
 * 真实课堂里五个岗位沿用的 sprite id：从 DEMO_ROLES 已有的子代理编号起顺延，
 * 不另起一套编号。上游 PALETTE_COUNT 是 6，够一位老师加五个岗位。
 */
export const LIVE_ROLE_OFFSET = DEMO_ROLES[1].id; // 2
export function liveRoleId(index: number): number { return LIVE_ROLE_OFFSET + index; }
export function liveRoleSeat(index: number): string { return CLASSROOM_WORKER_SEATS[index] ?? CLASSROOM_WORKER_SEATS[CLASSROOM_WORKER_SEATS.length - 1]; }

// ── 演示工作流 ───────────────────────────────────────────────────────────────
export interface DemoStepAssignment {
  /** 本步坐在哪个座位（换座位 = 走动，复用上游寻路） */
  seatId: string;
  /** 阅读 / 书写动画 */
  tool: DemoActivity | null;
  /** 是否处于工作中（上游用它决定回到座位并坐下） */
  active: boolean;
  /** 头上是否出现「等待」气泡 */
  waiting?: boolean;
  /** 上下文占用（0-100，仅演示数据） */
  contextPercent: number;
  /** 当前活动（列表用语，短） */
  activity: string;
  /** 当前活动的一句话说明 */
  detail: string;
  /** 此刻它在上下文里握着什么 */
  knowledge: string[];
}

export interface DemoOutput {
  role: DemoRoleKey;
  text: string;
}

export interface DemoStep {
  id: string;
  /** 步骤名（时间轴上的按钮文案） */
  title: string;
  /** 本步目标，可在「定点退回」时改写 */
  goal: string;
  /** 演示停留秒数 */
  seconds: number;
  assignment: Record<DemoRoleKey, DemoStepAssignment>;
  /** 本步产出的结果 */
  outputs: DemoOutput[];
}

export const DEMO_STEPS: DemoStep[] = [
  {
    "id": "scope",
    "title": "拆分任务",
    "goal": "将一道向量题分成独立研究与原文核对",
    "seconds": 5,
    "assignment": {
      "teacher": {
        "seatId": "chair-teacher",
        "tool": "Write",
        "active": true,
        "waiting": false,
        "contextPercent": 20,
        "activity": "准备交接材料",
        "detail": "圈定题目与原页范围，把研究和核验交给两个子代理。",
        "knowledge": [
          "用户目标：整理本题题卡",
          "本题题干与原页",
          "题卡三段格式"
        ]
      },
      "helperA": {
        "seatId": "chair-desk-a",
        "tool": null,
        "active": false,
        "waiting": false,
        "contextPercent": 0,
        "activity": "等待分派",
        "detail": "等待老师交接本次任务，不继承整段主会话。",
        "knowledge": []
      },
      "helperB": {
        "seatId": "chair-desk-b",
        "tool": null,
        "active": false,
        "waiting": false,
        "contextPercent": 0,
        "activity": "等待分派",
        "detail": "等待老师交接本次任务，不继承整段主会话。",
        "knowledge": []
      }
    },
    "outputs": []
  },
  {
    "id": "parallel",
    "title": "并行研究",
    "goal": "两个子代理各自处理有边界的任务",
    "seconds": 7,
    "assignment": {
      "teacher": {
        "seatId": "chair-teacher",
        "tool": "Write",
        "active": false,
        "waiting": false,
        "contextPercent": 20,
        "activity": "等待交付",
        "detail": "保留任务清单，等待独立上下文返回；不在主线程重复解题。",
        "knowledge": [
          "本题任务清单",
          "两份交接范围"
        ]
      },
      "helperA": {
        "seatId": "chair-desk-a",
        "tool": "Write",
        "active": true,
        "waiting": false,
        "contextPercent": 27,
        "activity": "独立求解与成稿",
        "detail": "核对题面，研究解法，一次交付可保存的三段草稿。",
        "knowledge": [
          "完整题干与选项",
          "本题原页图像",
          "内容 / 参考理解 / 学生理解格式"
        ]
      },
      "helperB": {
        "seatId": "chair-desk-b",
        "tool": "Read",
        "active": true,
        "waiting": false,
        "contextPercent": 18,
        "activity": "核对原文条件",
        "detail": "独立核对原图中的条件、符号与图形关系，记录必须保留的事实。",
        "knowledge": [
          "原页图像",
          "题干转写",
          "条件与来源核对要求"
        ]
      }
    },
    "outputs": []
  },
  {
    "id": "inspect",
    "title": "交付检查",
    "goal": "检查两份结果，定位具体疑点",
    "seconds": 6,
    "assignment": {
      "teacher": {
        "seatId": "chair-teacher",
        "tool": "Write",
        "active": true,
        "waiting": false,
        "contextPercent": 20,
        "activity": "比较交付",
        "detail": "核验者发现草稿的适用条件表述不完整，老师定位到对应段落。",
        "knowledge": [
          "子代理返回的草稿",
          "原文核验记录"
        ]
      },
      "helperA": {
        "seatId": "chair-desk-a",
        "tool": null,
        "active": false,
        "waiting": true,
        "contextPercent": 31,
        "activity": "已交初稿",
        "detail": "原题已保留，解法与草稿交给老师；等待具体反馈。",
        "knowledge": [
          "本题材料",
          "已交草稿"
        ]
      },
      "helperB": {
        "seatId": "chair-desk-b",
        "tool": null,
        "active": false,
        "waiting": true,
        "contextPercent": 22,
        "activity": "指出条件缺口",
        "detail": "对照老师追加的草稿段落，指出系数和结论的使用前提需要说清。",
        "knowledge": [
          "原页依据",
          "老师追加的适用条件段落"
        ]
      }
    },
    "outputs": [
      {
        "role": "helperA",
        "text": "三段题卡初稿，学生理解留空。"
      },
      {
        "role": "helperB",
        "text": "核对发现：适用条件需要明确，不应省略。"
      }
    ]
  },
  {
    "id": "revise",
    "title": "定点返修",
    "goal": "在原子会话追问，补充适用条件",
    "seconds": 6,
    "assignment": {
      "teacher": {
        "seatId": "chair-teacher",
        "tool": "Write",
        "active": true,
        "waiting": false,
        "contextPercent": 20,
        "activity": "向原解题者追问",
        "detail": "只要求修改条件段落，复用已有有效分析与草稿。",
        "knowledge": [
          "具体疑点",
          "上次交付草稿"
        ]
      },
      "helperA": {
        "seatId": "chair-desk-a",
        "tool": "Write",
        "active": true,
        "waiting": false,
        "contextPercent": 37,
        "activity": "修订指定段落",
        "detail": "保留本题上下文，补充基底与系数和关系的适用条件。",
        "knowledge": [
          "原研究与草稿",
          "新消息：只补适用条件，不重解整题"
        ]
      },
      "helperB": {
        "seatId": "chair-desk-b",
        "tool": null,
        "active": false,
        "waiting": false,
        "contextPercent": 22,
        "activity": "本项已交付",
        "detail": "原文核对已完成，需要时可在同一子会话继续追问。",
        "knowledge": [
          "原文核对记录"
        ]
      }
    },
    "outputs": [
      {
        "role": "teacher",
        "text": "退回要求：补充条件；保留其余已核验内容。"
      }
    ]
  },
  {
    "id": "merge",
    "title": "汇总结果",
    "goal": "检查修订与来源，组织最终题卡",
    "seconds": 5,
    "assignment": {
      "teacher": {
        "seatId": "chair-teacher",
        "tool": "Write",
        "active": true,
        "waiting": false,
        "contextPercent": 20,
        "activity": "合并修订",
        "detail": "对照修订段落与原文核验记录，准备一份完整题卡草稿。",
        "knowledge": [
          "修订后的草稿",
          "来源与核验记录"
        ]
      },
      "helperA": {
        "seatId": "chair-desk-a",
        "tool": null,
        "active": false,
        "waiting": false,
        "contextPercent": 39,
        "activity": "返回修订",
        "detail": "已补充使用前提，其余正文保持不变。",
        "knowledge": [
          "修订段落",
          "保留原题与出处"
        ]
      },
      "helperB": {
        "seatId": "chair-desk-b",
        "tool": null,
        "active": false,
        "waiting": false,
        "contextPercent": 22,
        "activity": "核对范围已标明",
        "detail": "核验结果只覆盖本题，不扩大成整讲义通过。",
        "knowledge": [
          "本题核验结论"
        ]
      }
    },
    "outputs": [
      {
        "role": "helperA",
        "text": "修订稿：补充基底不共线与系数和为定值的前提。"
      }
    ]
  },
  {
    "id": "complete",
    "title": "本轮完成",
    "goal": "回看交接，区分保存与核验",
    "seconds": 5,
    "assignment": {
      "teacher": {
        "seatId": "chair-teacher",
        "tool": "Write",
        "active": false,
        "waiting": false,
        "contextPercent": 20,
        "activity": "完成汇总",
        "detail": "得到一份可保存草稿；演示不会写入真实Vault。",
        "knowledge": [
          "本题完整草稿",
          "两份子代理交付",
          "修订记录"
        ]
      },
      "helperA": {
        "seatId": "chair-desk-a",
        "tool": null,
        "active": false,
        "waiting": false,
        "contextPercent": 39,
        "activity": "等待新任务",
        "detail": "本题研究完成，保留子会话供后续追问。",
        "knowledge": [
          "本题研究与修订"
        ]
      },
      "helperB": {
        "seatId": "chair-desk-b",
        "tool": null,
        "active": false,
        "waiting": false,
        "contextPercent": 22,
        "activity": "等待新任务",
        "detail": "原文核对完成，保留本题证据范围。",
        "knowledge": [
          "本题核验记录"
        ]
      }
    },
    "outputs": [
      {
        "role": "teacher",
        "text": "题卡草稿已汇总：完整原题、参考理解与待填写的学生理解。"
      }
    ]
  }
];

// ── 初始布局 ─────────────────────────────────────────────────────────────────
export interface InitialClassroomLayout {
  layout: OfficeLayout;
  /** `stored` = 上次在「布置教室」里保存的；`default` = 出厂教室 */
  source: 'stored' | 'default';
}

function isUsableLayout(value: unknown): value is OfficeLayout {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<OfficeLayout>;
  if (candidate.version !== 1) return false;
  if (!Number.isInteger(candidate.cols) || !Number.isInteger(candidate.rows)) return false;
  if (!Array.isArray(candidate.tiles) || !Array.isArray(candidate.furniture)) return false;
  return candidate.tiles.length === (candidate.cols as number) * (candidate.rows as number);
}

/** 出厂教室的独立副本（`OfficeState` 会持有它，别把常量本体交出去）。 */
export function createClassroomLayout(): OfficeLayout {
  return structuredClone(CLASSROOM_LAYOUT);
}

/**
 * 启动时用的布局：优先用本地保存过的教室，其次出厂教室。
 *
 * `layoutRevision` 与出厂值不一致时说明教室结构已升级，旧布局作废——和上游
 * 用 revision 强制重置的思路一致，避免老存档里少了白板或椅子。
 */
export function loadInitialClassroomLayout(): InitialClassroomLayout {
  if (typeof window === 'undefined') {
    return { layout: createClassroomLayout(), source: 'default' };
  }
  try {
    const raw = window.localStorage.getItem(CLASSROOM_LAYOUT_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isUsableLayout(parsed) && parsed.layoutRevision === CLASSROOM_LAYOUT.layoutRevision) {
        return { layout: parsed, source: 'stored' };
      }
    }
  } catch {
    // 存储不可用或内容损坏都退回出厂教室，不阻塞演示
  }
  return { layout: createClassroomLayout(), source: 'default' };
}
