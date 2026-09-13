| 测试文件与场景 | 最终结果 | 日志 |
|---|---|---|
| tests/e2e/coauthor-memory.spec.ts: the student rewrites one judgement, keeps its evidence, and survives a conflict | PASS | ui-memory-final.log |
| tests/e2e/content-history.spec.ts: book coverage and classroom back-links use saved ranges and actual native turns | PASS | ui-latest.log |
| tests/e2e/conversation-home.spec.ts: learning modes stay inside the native composer and real recommendations hide only after acceptance | PASS | ui-workbench.log |
| tests/e2e/layout-roadmap.spec.ts: the default roadmap shows real lessons, places and mounts them on the same route, and survives refresh | PASS | ui-course-final.log |
| tests/e2e/layout-roadmap.spec.ts: six navigation entries are visible and learning-space management remains reachable through settings | PASS | ui-composer-final.log |
| tests/e2e/material-import.spec.ts: an imported original is read directly and never opens a lesson | PASS | ui-cleanup-e2e.log |
| tests/e2e/material-import.spec.ts: a second file with the same name is refused with a next action | PASS | ui-cleanup-e2e.log |
| tests/e2e/material-import.spec.ts: a new version is explicit, keeps the old bytes readable, and a refresh keeps both | PASS | ui-cleanup-e2e.log |
| tests/e2e/sets-calendar.spec.ts: student set edits preserve their draft through a real concurrent update and persist at narrow width | PASS | ui-cleanup-e2e.log |
| tests/e2e/sets-calendar.spec.ts: calendar opens date details in a recoverable right pane and keeps review plans reachable | PASS | ui-cleanup-e2e.log |
| tests/e2e/coauthor-organization.spec.ts: a planned node really opens one native lesson, and a restart keeps it bound | PASS | ui-extended.log |
| tests/e2e/coauthor-organization.spec.ts: two writers move different nodes from the same read, and only the same node refuses | PASS | ui-extended.log |
| tests/e2e/coauthor-organization.spec.ts: a plan is edited by its own target, keeps the draft on a stale save, and never rewrites another plan | PASS | ui-extended.log |
| tests/e2e/coauthor-organization.spec.ts: at 390 the course page really widens after the sidebar collapses, and the canvas still fits | PASS | ui-extended.log |
| tests/e2e/notebook-pages.spec.ts: original notebook pages show real books, cards, calendar and learning records at desktop and phone widths | PASS | ui-extended-final.log |
| tests/e2e/notebook-theme.spec.ts: notebook fonts, paper controls and browser routes preserve the actual native lesson and its draft | PASS | ui-settings-final.log |
| tests/e2e/notebook-theme.spec.ts: notebook card slips open the real card and its source returns to the originating lesson without recording study | PASS | ui-extended.log |
| tests/e2e/planning-overview-v2.spec.ts: a date range narrows the roadmap, keeps ancestors as context, and clearing restores the tree | PASS | ui-extended-final.log |
| tests/e2e/planning-overview-v2.spec.ts: an opened planned lesson stays visible in the whole roadmap and keeps its real lesson | PASS | ui-extended.log |
| tests/e2e/planning-overview-v2.spec.ts: a card the student really placed keeps its coordinate, and a content edit does not lose it | PASS | ui-extended.log |
| tests/e2e/book-workspace.spec.ts: book expands along its real tree, opens a card and its original in place, and returns without writing | PASS | ui-book-final.log |
| tests/e2e/classroom-import.spec.ts: conversation import saves directly, retries an uncertain reply once, and keeps the draft and original accessible | PASS | ui-workbench-final.log |
| tests/e2e/classroom-import.spec.ts: empty desk imports a dropped batch even when its first saved file replaces the empty state | PASS | ui-workbench-final.log |
| tests/e2e/lesson-materials-mindmap.spec.ts: the lesson right column is one material map that opens originals and cards in place | PASS | ui-workbench-final.log |
| tests/e2e/workbench-library.spec.ts: whiteboard defaults to the library and filters actual lesson references without writing on browse | PASS | ui-workbench-final.log |
| tests/e2e/current-classroom.spec.ts: native classroom keeps its own composer and carries the student lesson surfaces | PASS | ui-native-final.log |
| tests/e2e/current-classroom.spec.ts: a creation session keeps the classroom and hides the learning lesson surfaces | PASS | ui-native-final.log |
