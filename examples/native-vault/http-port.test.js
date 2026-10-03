import { test } from 'node:test';
import assert from 'node:assert/strict';
import { httpUrlPort, isBrowserBlockedPort } from './http-port.js';

test('Fetch-blocked ports include automatic results in a custom OS dynamic range', () => {
  for (const port of [0, 22, 2049, 6000, 6667, 10080]) assert.equal(isBrowserBlockedPort(port), true);
  for (const port of [80, 443, 1024, 47093, 57093, 65535]) assert.equal(isBrowserBlockedPort(port), false);
});
test('HTTP URL ports preserve normalized defaults and explicit non-default ports', () => {
  for (const [address, port] of [['http://127.0.0.1:80/', 80], ['http://127.0.0.1/', 80], ['https://example.test:443/', 443], ['https://example.test/', 443], ['http://127.0.0.1:57093/', 57093], ['http://127.0.0.1:0/', 0]]) {
    assert.equal(httpUrlPort(new URL(address)), port);
  }
  assert.throws(() => httpUrlPort(new URL('file:///tmp/a')), /Invalid HTTP URL/);
});
