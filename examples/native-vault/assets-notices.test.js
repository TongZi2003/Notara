import test from 'node:test';
import assert from 'node:assert/strict';
import {assetFailureNotice} from './assets-client.js';

test('an oversized PDF explains the 512 MiB limit instead of claiming the file was deleted',()=>{
  for(const error of [{code:'vault_pdf_too_large'},new Error('vault_pdf_too_large')]){
    const notice=assetFailureNotice(error);
    assert.match(notice,/512 MiB/);assert.match(notice,/拆/);assert.doesNotMatch(notice,/移动或删除/);
  }
  assert.match(assetFailureNotice({code:'vault_file_not_found'}),/移动或删除/);
});
