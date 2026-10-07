// Shared by the Host and the settings form. The child has its own allowance;
// it must not silently inherit the teacher's short conversational response cap.
export const SOLVER_MAX_TOKENS = 32768;
export const SOLVER_MIN_TOKENS = 1024;
export const SOLVER_TOKEN_LIMIT = 131072;
// Shared Host/client error contract for the classroom's compare-and-swap save.
export const SOLVER_SETTINGS_CONFLICT_CODE = 'solver_settings_conflict';
export const SOLVER_SETTINGS_CONFLICT_MESSAGE = '解题者设置已被修改，请刷新后再保存。';
export function validSolverBudget(value) {
  return Number.isSafeInteger(value) && value >= SOLVER_MIN_TOKENS && value <= SOLVER_TOKEN_LIMIT;
}
export function preferredSolverEffort(efforts = []) {
  return ['ultra', 'max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'].find(value => efforts.includes(value)) ?? efforts[0];
}
