/**
 * The student surfaces this client adds to the native frame.
 *
 * Each page is one keyed occupant of the layout's `main` slot plus one row in
 * the sidebar's `sidebar.panellist`; the reserved `conversation` key stays
 * native. Nothing here re-declares Session identity: a page is navigation, not
 * a classroom.
 */
export interface StudentPage {
  /** Registered `main` key and matching `sidebar.panellist` row id. */
  readonly id: string;
  /** Sidebar row label and page kicker. */
  readonly title: string;
  /** Ascending sidebar row order. */
  readonly order: number;
}

export const STUDENT_PAGES = [
  { id: 'studyforge.home', title: '首页', order: 10 },
  { id: 'studyforge.courses', title: '课程', order: 20 },
  { id: 'studyforge.materials', title: '资料', order: 30 },
  { id: 'studyforge.sets', title: '学习集', order: 40 },
  { id: 'studyforge.memory', title: '学情', order: 45 },
  { id: 'studyforge.calendar', title: '日历', order: 50 },
] as const satisfies readonly StudentPage[];

/** One registered student page, as the page table spells it. */
export type StudentPageSpec = (typeof STUDENT_PAGES)[number];
/** Identity of one student page. */
export type StudentPageId = StudentPageSpec['id'];
