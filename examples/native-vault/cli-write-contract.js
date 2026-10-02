// Only commands whose writes go through the existing Vault IO / native CAS.
// Skill files and generated media use different writers and stay in the child.
export const CLI_WRITE_COMMANDS = Object.freeze(['write-batch', 'record-review', 'undo-review', 'create-route', 'revise-route', 'schedule-lesson']);
export const CLI_WRITE_PATH = '/v1/cli-write';
export const CLI_WRITE_LIMIT = 2 * 1024 * 1024 + 64 * 1024;
export const CLI_WRITE_URL_ENV = 'DSH_NOTARA_CLI_WRITE_URL';
export const CLI_WRITE_TOKEN_ENV = 'DSH_NOTARA_CLI_WRITE_TOKEN';
export const CLI_WRITE_MODE_ENV = 'DSH_NOTARA_CLI_WRITE_MODE';
