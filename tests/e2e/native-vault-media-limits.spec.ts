import {test,expect} from '@playwright/test';
import {mkdir,open,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {startVaultIsolated} from '../../scripts/dev-isolated.ts';

async function writePaddedRangePdf(path:string){
  const chunks:Buffer[]=[],offsets:number[]=[0];let cursor=0;
  const append=(value:string|Buffer)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(value,'latin1');chunks.push(bytes);cursor+=bytes.length;};
  append('%PDF-1.4\n%\u0000\u0001\u0002\u0003\n');
  const object=(id:number,body:string|Buffer)=>{offsets[id]=cursor;append(`${id} 0 obj\n`);append(body);append('\nendobj\n');};
  object(1,'<< /Type /Catalog /Pages 2 0 R >>');
  object(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>');
  object(4,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const content=Buffer.from('BT /F1 20 Tf 30 150 Td (Range transport page) Tj ET\n','latin1');
  object(5,Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`,'latin1'),content,Buffer.from('endstream','latin1')]));
  const xrefOffset=384*1024*1024,objectSixOffset=cursor,tail=Buffer.from('\nendstream\nendobj\n','latin1');
  append('6 0 obj\n');offsets[6]=objectSixOffset;
  let payloadLength=xrefOffset-cursor-tail.length;
  for(let pass=0;pass<8;pass++){
    const header=`<< /Length ${payloadLength} >>\nstream\n`,next=xrefOffset-cursor-Buffer.byteLength(header,'latin1')-tail.length;
    if(next===payloadLength)break;payloadLength=next;
  }
  append(`<< /Length ${payloadLength} >>\nstream\n`);
  const payloadEnd=cursor+payloadLength;
  const xref=Buffer.from(`xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,'latin1');
  const file=await open(path,'w');
  try{await file.truncate(xrefOffset+xref.length);const prefix=Buffer.concat(chunks);await file.write(prefix,0,prefix.length,0);await file.write(tail,0,tail.length,payloadEnd);await file.write(xref,0,xref.length,xrefOffset);}finally{await file.close();}
}

// Object 6 is an unreferenced sparse stream with an explicit /Length. The parser
// can seek past its payload while resolving xref data at the tail, so this tests
// file-size transport without making an artificial whitespace scan the fixture.
test('384 MiB PDF renders through bounded range RPCs without a whole-file data URL, while other media and small PDFs keep working',async({page})=>{
  test.setTimeout(180_000);
  const runtime=await startVaultIsolated({testModel:true}),errors:string[]=[],receipts:{length:number;dataUrl:boolean}[]=[];
  let busyOpenInjected=false,openAssetRangeCalls=0,openEnvelopeSummary:Record<string,unknown>|undefined;
  const cancelResponses:Array<{status:number;ok:boolean;cancelled:boolean}> = [];
  let firstRangeRequestShape:string|undefined;
  const rangeStats={count:0,totalRangeBytes:0,totalBodyLength:0,maxBodyLength:0,maxLength:0,allOk:true,noDataUrl:true,first:[] as Array<{offset:number|null;length:number|null;status:number;bodyLength:number}>,last:[] as Array<{offset:number|null;length:number|null;status:number;bodyLength:number}>};
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.route('**/api/notaraVault/openAssetRange',async route=>{
    const upstream=await route.fetch();
    const text=await upstream.text();
    openAssetRangeCalls++;
    if(busyOpenInjected){await route.fulfill({response:upstream,body:text});return;}
    let envelope:any;
    try{envelope=JSON.parse(text);}catch{throw new Error('openAssetRange returned a non-JSON response');}
    openEnvelopeSummary={status:upstream.status(),type:envelope.type,rpcIdType:typeof envelope.rpcId,topKeys:Object.keys(envelope).sort(),resultKeys:Object.keys(envelope.result??{}).sort(),ok:envelope.result?.ok,error:envelope.result?.error,valueKeys:Object.keys(envelope.result?.value??{}).sort()};
    console.log('PDF_OPEN_ENVELOPE_SHAPE',JSON.stringify(openEnvelopeSummary));
    if(typeof envelope.type!=='string'||typeof envelope.rpcId!=='string'||envelope.result?.ok!==true||typeof envelope.result?.value?.rangeId!=='string')throw new Error('openAssetRange did not create the real range lease before the injected busy response');
    busyOpenInjected=true;
    // Typert serializes ordinary Host Error(code) as gateway/internal with the
    // original message and empty details. Keep that real wire shape intact.
    const failed={...envelope,result:{ok:false,error:{code:'gateway/internal',message:'vault_asset_range_busy',details:{}}}};
    if(failed.type!==envelope.type||failed.rpcId!==envelope.rpcId)throw new Error('injected openAssetRange response changed its RPC identity');
    await route.fulfill({response:upstream,body:JSON.stringify(failed)});
  });
  page.on('response',response=>{
    const pathname=new URL(response.url()).pathname;
    if(pathname.endsWith('/api/notaraVault/readAsset'))void response.text().then(text=>receipts.push({length:text.length,dataUrl:text.includes('dataUrl')}));
    if(pathname.endsWith('/api/notaraVault/cancelAssetRange'))void response.text().then(text=>{
      let body:any={};try{body=JSON.parse(text);}catch{}
      cancelResponses.push({status:response.status(),ok:body.result?.ok===true,cancelled:body.result?.value?.cancelled===true});
    });
    if(pathname.endsWith('/api/notaraVault/readAssetRange'))void response.text().then(text=>{
      let body:any={};
      firstRangeRequestShape??=response.request().postData()?.slice(0,300);
      try{body=JSON.parse(text);}catch{}
      const value=body.result?.value??body.value??{},row={offset:Number.isSafeInteger(value.offset)?value.offset:null,length:Number.isSafeInteger(value.length)?value.length:null,status:response.status(),bodyLength:text.length};
      rangeStats.count++;rangeStats.totalRangeBytes+=row.length??0;rangeStats.totalBodyLength+=text.length;rangeStats.maxBodyLength=Math.max(rangeStats.maxBodyLength,text.length);rangeStats.maxLength=Math.max(rangeStats.maxLength,row.length??0);rangeStats.allOk&&=response.status()===200&&body.result?.ok===true&&row.offset!==null&&row.length!==null;rangeStats.noDataUrl&&=!text.includes('dataUrl');
      if(rangeStats.first.length<8)rangeStats.first.push(row);rangeStats.last=[...rangeStats.last,row].slice(-4);
    });
  });
  try{
    const directory=join(runtime.root,'workspace','vault','大文件');await mkdir(directory,{recursive:true});
    await writePaddedRangePdf(join(directory,'容量回归.pdf'));
    for(const name of ['容量回归.png']){
      const file=await open(join(directory,name),'w');
      try{await file.write(name.endsWith('.pdf')?'%PDF-1.7\n':'PNG size guard fixture');await file.truncate(384*1024*1024);}finally{await file.close();}
    }
    expect((await stat(join(directory,'容量回归.pdf'))).size).toBeGreaterThan(384*1024*1024);
    expect((await stat(join(directory,'容量回归.pdf'))).size).toBeLessThan(512*1024*1024);
    await page.goto(runtime.authUrl);
    const later=page.getByRole('button',{name:/Configure later|稍后配置/});
    try{await later.waitFor({timeout:5000});await later.click();}catch{/* already acknowledged */}
    await page.getByRole('navigation',{name:'学习导航'}).getByRole('button',{name:'Vault',exact:true}).click();
    await page.getByRole('tab',{name:'文件',exact:true}).click();
    const files=page.getByRole('group',{name:'文件列表'});
    await files.getByRole('button',{name:/容量回归\.pdf$/}).click();
    await expect(page.getByRole('alert')).toBeVisible({timeout:30_000});
    const firstAlert=await page.getByRole('alert').innerText();
    console.log('PDF_OPEN_RETRY_DIAGNOSTICS',JSON.stringify({busyOpenInjected,openAssetRangeCalls,openEnvelopeSummary,firstAlert,errors}));
    expect(firstAlert).toContain('PDF 正在读取的范围太多');
    expect(busyOpenInjected).toBe(true);
    expect(openAssetRangeCalls).toBe(1);
    const retry=page.getByRole('button',{name:'重新读取 PDF',exact:true});
    await expect(retry).toBeVisible();
    await retry.click();
    await expect.poll(()=>openAssetRangeCalls).toBe(2);
    await expect.poll(()=>cancelResponses.some(item=>item.status===200&&item.ok&&item.cancelled)).toBe(true);
    const largeCanvas=page.locator('canvas[aria-label="容量回归.pdf"]');
    try{await expect.poll(()=>largeCanvas.evaluate(canvas=>{
      const element=canvas as HTMLCanvasElement;
      if(!element.width||!element.height)return false;
      const data=element.getContext('2d')?.getImageData(0,0,element.width,element.height).data;
      if(!data)return false;
      for(let index=0;index<data.length;index+=4){if(data[index+3]!>0&&(data[index]!<245||data[index+1]!<245||data[index+2]!<245))return true;}
      return false;
    }),{timeout:60_000}).toBe(true);}catch(error){
      const renderState=await page.locator('.nv-pdf-body').innerText().catch(()=>''),canvasState=await largeCanvas.evaluate(canvas=>{const element=canvas as HTMLCanvasElement;return{width:element.width,height:element.height,style:element.getAttribute('style'),visible:!!element.getClientRects().length};}).catch(()=>null);
      console.log('PDF_RANGE_DIAGNOSTICS',JSON.stringify({errors,receipts,rangeStats,firstRangeRequestShape,renderState,canvasState}));
      throw error;
    }
    await expect(largeCanvas).toBeVisible({timeout:1000});
    await expect(page.getByText(/PDF 文字层可能缺字或乱码/)).toBeVisible();
    await expect.poll(()=>rangeStats.count).toBeGreaterThan(0);
    expect(receipts.every(receipt=>receipt.length<4096&&!receipt.dataUrl)).toBe(true);
    expect(rangeStats.allOk&&rangeStats.noDataUrl&&rangeStats.maxLength<=1024*1024&&rangeStats.maxBodyLength<2*1024*1024).toBe(true);
    expect(rangeStats.totalBodyLength).toBeLessThan(16*1024*1024);
    const pixels=await largeCanvas.evaluate(canvas=>{
      const element=canvas as HTMLCanvasElement,data=element.getContext('2d')?.getImageData(0,0,element.width,element.height).data;
      let inkPixels=0;if(data)for(let index=0;index<data.length;index+=4)if(data[index+3]!>0&&(data[index]!<245||data[index+1]!<245||data[index+2]!<245))inkPixels++;
      return{width:element.width,height:element.height,inkPixels};
    });
    console.log('PDF_RANGE_METRICS',JSON.stringify({rangeCount:rangeStats.count,rangeBytes:rangeStats.totalRangeBytes,responseBytes:rangeStats.totalBodyLength,maxRangeBytes:rangeStats.maxLength,maxResponseBytes:rangeStats.maxBodyLength,first:rangeStats.first,last:rangeStats.last,canvas:pixels,openAssetRangeCalls,cancelledFailedLease:cancelResponses.some(item=>item.status===200&&item.ok&&item.cancelled),readAssetCalls:receipts.length,wholeFileDataUrl:receipts.some(receipt=>receipt.dataUrl)}));
    await files.getByRole('button',{name:/容量回归\.png$/}).click();
    await expect(page.getByText(/这个文件超过 256 MiB/)).toBeVisible();
    await expect.poll(()=>receipts.length).toBe(2);
    await files.getByRole('button',{name:/向量讲义\.pdf$/}).click();
    await expect(page.locator('canvas[aria-label="向量讲义.pdf"]')).toBeVisible({timeout:30_000});
    expect(errors).toEqual([]);
  }finally{await runtime.stop();}
});
