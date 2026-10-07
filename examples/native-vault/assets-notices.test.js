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
test('whole-file PDF and other media limits describe preview restrictions',()=>{
  const pdf=assetFailureNotice({code:'vault_pdf_data_url_too_large'});
  assert.match(pdf,/256 MiB/);assert.match(pdf,/512 MiB/);assert.match(pdf,/范围读取/);
  const image=assetFailureNotice(new Error('vault_asset_too_large'));
  assert.match(image,/256 MiB/);assert.doesNotMatch(image,/移动或删除/);
});
