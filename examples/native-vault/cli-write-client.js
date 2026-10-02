import { request } from 'node:http';
import { CLI_WRITE_LIMIT, CLI_WRITE_PATH, CLI_WRITE_URL_ENV, CLI_WRITE_TOKEN_ENV } from './cli-write-contract.js';

/** A short-lived, Host-bound capability. Never retry through an unconfined writer. */
export async function requestCliWrite(command, args, env) {
  const url = new URL(env[CLI_WRITE_URL_ENV]);
  const token = env[CLI_WRITE_TOKEN_ENV];
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== CLI_WRITE_PATH || url.username || url.password || url.search || url.hash || !/^[a-f0-9]{64}$/.test(token ?? '')) throw new Error('cli_write_unavailable');
  const body = JSON.stringify({ command, args });
  if (Buffer.byteLength(body) > CLI_WRITE_LIMIT) throw new Error('cli_stdin_too_large');
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', agent: false, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
      const chunks = []; let length = 0;
      res.on('data', chunk => {
        length += chunk.length;
        if (length > CLI_WRITE_LIMIT) { res.destroy(new Error('cli_write_response_too_large')); return; }
        chunks.push(chunk);
      });
      res.on('error', () => reject(new Error('cli_write_unavailable')));
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) throw new Error('cli_write_unavailable');
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (value?.command !== command || typeof value.ok !== 'boolean' || (!Object.hasOwn(value, 'result') && !Object.hasOwn(value, 'error'))) throw new Error('cli_write_unavailable');
          resolve(value);
        } catch { reject(new Error('cli_write_unavailable')); }
      });
    });
    req.setTimeout(60_000, () => req.destroy(new Error('cli_write_unavailable')));
    req.on('error', () => reject(new Error('cli_write_unavailable')));
    req.end(body);
  });
}
