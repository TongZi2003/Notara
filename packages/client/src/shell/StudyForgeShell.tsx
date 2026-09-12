import { STUDENT_PAGES, type StudentPageId } from './navigation.ts';

/** One lesson row projected from the native session list; the title is native-owned. */
export interface StudentLesson {
  /** Native Session identity, echoed back to the native controller on open. */
  readonly id: string;
  readonly title: string;
  readonly running: boolean;
}

export interface StudyForgeShellProps {
  readonly page: StudentPageId;
  readonly today: string;
  readonly lessons: readonly StudentLesson[];
  readonly lessonsLoaded: boolean;
  /** Return to the native Conversation for the current Session. */
  onOpenClassroom(): void;
  /** Select an existing native Session and show its Conversation. */
  onOpenLesson(id: string): void;
}

interface PageCopy {
  readonly heading: string;
  readonly body: string;
}

const COPY: Record<StudentPageId, PageCopy> = {
  'studyforge.home': {
    heading: '今天想学什么',
    body: '中间那一页就是课堂：写下想学的主题，或者把书里的段落放进去，随时可以开口。',
  },
  'studyforge.courses': {
    heading: '你的课',
    body: '每一节课都留着当时的对话和材料，点开就能接着上。',
  },
  'studyforge.materials': {
    heading: '资料',
    body: '书会在这里打开：左边读原文，右边看整理出来的结构。',
  },
  'studyforge.sets': {
    heading: '学习集',
    body: '一个学习集是一摞要记的卡片，连带它的复习安排。',
  },
  'studyforge.calendar': {
    heading: '日历',
    body: '按日期回看学过什么，也看接下来安排了什么。',
  },
  'studyforge.memory': { heading: '学情', body: '这里收着学习中留下的观察，也可以随时补充和修正。' },
};

/** One student page inside the native frame's centre column. */
export function StudyForgeShell({ page, today, lessons, lessonsLoaded, onOpenClassroom, onOpenLesson }: StudyForgeShellProps): React.JSX.Element {
  const spec = STUDENT_PAGES.find(candidate => candidate.id === page) ?? STUDENT_PAGES[0];
  const copy = COPY[page];
  const index = String(STUDENT_PAGES.findIndex(candidate => candidate.id === spec.id) + 1).padStart(2, '0');
  return <main className="sf-page" data-studyforge-page={page} data-testid={`studyforge-page-${page}`}>
    <header className="sf-page-head"><span className="sf-kicker">{spec.title}</span><span className="sf-page-date">{today}</span></header>
    <div className="sf-page-body">
      <span className="sf-page-index">{index}</span>
      <h1>{copy.heading}</h1>
      <p>{copy.body}</p>
      {page === 'studyforge.home' && <button className="sf-action" data-testid="open-classroom" onClick={onOpenClassroom}>
        回到课堂<span aria-hidden="true">↗</span>
      </button>}
      {page === 'studyforge.courses' && <LessonList lessons={lessons} loaded={lessonsLoaded} onOpenLesson={onOpenLesson} />}
    </div>
  </main>;
}

function LessonList({ lessons, loaded, onOpenLesson }: {
  readonly lessons: readonly StudentLesson[];
  readonly loaded: boolean;
  onOpenLesson(id: string): void;
}): React.JSX.Element {
  if (!loaded) return <p className="sf-note" role="status">正在看你的课…</p>;
  if (lessons.length === 0) return <p className="sf-note">还没有课。回到课堂写下想学的主题，就会开出第一节。</p>;
  return <ul className="sf-lessons" data-testid="studyforge-lessons">
    {lessons.map(lesson => <li key={lesson.id}>
      <button type="button" onClick={() => { onOpenLesson(lesson.id); }}>
        <span>{lesson.title}</span>
        {lesson.running && <span className="sf-meta">进行中</span>}
      </button>
    </li>)}
  </ul>;
}
