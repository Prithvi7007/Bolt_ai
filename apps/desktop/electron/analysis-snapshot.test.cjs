'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {createDataAnswerExport,saveDataAnswer}=require('./data-answer-export.cjs');
const {decodeAnalysisSnapshot,openDataAnalysis,readSnapshotBytes,MAX_SNAPSHOT_BYTES}=require('./analysis-snapshot.cjs');
const input=()=>({format:'bolt',sourceName:'synthetic.csv',target:'income',question:'Total income by region',
  interpretation:'local',result:{title:'Total income',answer:'The calculated total is 30.',table:[{label:'East',value:'30',detail:'2 target rows'}],
    calculation:'Sum of valid income within matching rows',evidence:'2 matching rows / 3 accepted rows',
    warnings:['Local category filter: region = "East".','Local date filter: day from 2026-01-01 through 2026-01-31.'],
    chart:{type:'bar',title:'Total income by region',xLabel:'income',yLabel:'region',note:'Observed local values.',
      points:[{label:'East <&>',value:30.1234567890123,detail:'2 target rows'}]}}});
const instant=new Date('2026-11-18T00:00:00.000Z');
const tools=()=>import('../shared/data-chart.mjs');
async function encoded(value=input()){return createDataAnswerExport(value,instant,await tools()).content;}
async function document(){return JSON.parse(await encoded());}

test('snapshot round trip preserves bounded values, charts and all evidence without runtime/configuration fields',async()=>{
  const text=await encoded(),doc=await decodeAnalysisSnapshot(Buffer.from(text));
  assert.equal(doc.kind,'bolt.analysis.snapshot');assert.equal(doc.version,1);assert.equal(doc.savedAt,instant.toISOString());
  const {format,...expected}=input();assert.deepEqual({...doc,kind:undefined,version:undefined,savedAt:undefined},
    {...expected,kind:undefined,version:undefined,savedAt:undefined});
  assert.equal(doc.result.chart.points[0].value,30.1234567890123);
  for(const forbidden of ['rows','preview','columns','planning','workflow','token','modelSettings','path']){
    assert.equal(Object.hasOwn(doc,forbidden),false);assert.equal(Object.hasOwn(doc.result,forbidden),false);
  }
});
test('a real calculated CSV answer saves derived results without source notes or full source bytes',async()=>{
  const {profileCsvText}=await import('../src/dataset-understanding.mjs');
  const {answerDataQuestion}=await import('../src/ask-data.mjs');
  const csv='region,income,private_note\nEast,10,private-row-one\nEast,20,private-row-two\nWest,40,private-row-three';
  const file={name:'synthetic.csv',stream:()=>new Blob([csv]).stream()};
  const answer=await answerDataQuestion(file,'Total income by region',profileCsvText(csv,'synthetic.csv'),'income');
  const {title,table,calculation,evidence,warnings,chart}=answer;
  const text=await encoded({...input(),result:{title,answer:answer.answer,table,calculation,evidence,warnings,chart}});
  assert.equal(text.includes('private_note'),false);assert.equal(text.includes('private-row-one'),false);assert.equal(text.includes(csv),false);
  const doc=await decodeAnalysisSnapshot(Buffer.from(text));
  assert.deepEqual(doc.result.chart.points.map(p=>p.value),[40,30]);
});
test('unknown snapshot versions, fields and invalid save times are rejected',async()=>{
  for(const mutate of [
    d=>d.version=2,d=>d.version='1',d=>d.kind='other',d=>d.savedAt='2026-02-30T00:00:00.000Z',
    d=>d.path='../secret',d=>d.modelSettings={token:'private'},d=>d.result.rows=[['private']],
    d=>d.result.planning={kind:'sum'},d=>d.result.chart.url='https://invalid',
    d=>d.result.chart.points[0].value='30',d=>d.result.chart.points[0].sql='SELECT secret',
  ]){
    const d=await document();mutate(d);
    await assert.rejects(()=>decodeAnalysisSnapshot(Buffer.from(JSON.stringify(d))));
  }
});
test('malformed encoding, JSON, byte limits and nonfinite chart values are rejected',async()=>{
  for(const bytes of [Buffer.from([0xff]),Buffer.from('{'),Buffer.from('[]'),Buffer.alloc(MAX_SNAPSHOT_BYTES+1)]){
    await assert.rejects(()=>decodeAnalysisSnapshot(bytes));
  }
  const text=await encoded();
  await assert.rejects(()=>decodeAnalysisSnapshot(Buffer.from(text.replace('30.1234567890123','1e309'))));
  const d=await document();d.result.chart.points=Array(13).fill(d.result.chart.points[0]);
  await assert.rejects(()=>decodeAnalysisSnapshot(Buffer.from(JSON.stringify(d))));
});
test('markup and URLs remain inert saved text rather than execution fields',async()=>{
  const value=input();value.question='<script>never execute</script> https://example.invalid';
  value.result.chart.points[0].label='<svg onload="run()">';
  const loaded=await decodeAnalysisSnapshot(Buffer.from(await encoded(value)));
  assert.equal(loaded.question,value.question);assert.equal(loaded.result.chart.points[0].label,value.result.chart.points[0].label);
  assert.equal(Object.hasOwn(loaded.result,'planning'),false);
});
test('saving a snapshot uses only the dialog-selected file and never calls the Python/model service',async()=>{
  const writes=[];
  const result=await saveDataAnswer(input(),{
    showSaveDialog:async opts=>{assert.equal(opts.defaultPath,'BOLT-analysis.bolt');assert.deepEqual(opts.filters[0].extensions,['bolt']);return {canceled:false,filePath:'selected.bolt'};},
    createPresentation:async()=>{throw new Error('No backend call');},
    writeFile:async(...args)=>writes.push(args),
  });
  assert.deepEqual(result,{saved:true});assert.equal(writes[0][0],'selected.bolt');assert.equal(writes[0][2],'utf8');
  const loaded=await decodeAnalysisSnapshot(Buffer.from(writes[0][1]));assert.equal(loaded.result.table[0].value,'30');
  let writesAfterCancel=0;
  assert.deepEqual(await saveDataAnswer(input(),{showSaveDialog:async()=>({canceled:true}),
    writeFile:async()=>{writesAfterCancel++;},createPresentation:async()=>{throw new Error('No backend');}}),{saved:false});
  assert.equal(writesAfterCancel,0);
});
test('opening and cancellation accept only a single native-selected .bolt path',async()=>{
  let reads=0;
  assert.deepEqual(await openDataAnalysis({showOpenDialog:async()=>({canceled:true}),readBytes:async()=>{reads++;}}),{opened:false});
  const content=Buffer.from(await encoded());
  const result=await openDataAnalysis({
    showOpenDialog:async opts=>{assert.deepEqual(opts.properties,['openFile']);assert.deepEqual(opts.filters[0].extensions,['bolt']);return {canceled:false,filePaths:['chosen.bolt']};},
    readBytes:async selected=>{reads++;assert.equal(selected,'chosen.bolt');return content;},
  });
  assert.equal(result.opened,true);assert.equal(result.snapshot.result.answer,input().result.answer);assert.equal(reads,1);
  for(const filePaths of [[],['a.bolt','b.bolt'],['bad.csv'],['bad.bolt\0'],[12]]){
    await assert.rejects(()=>openDataAnalysis({showOpenDialog:async()=>({canceled:false,filePaths}),
      readBytes:async()=>{throw new Error('Must not read');}}));
  }
});
test('bounded reads support partial reads and close the handle on success or failure',async()=>{
  const bytes=Buffer.from(await encoded());let position=0,closed=0;
  const handle={stat:async()=>({isFile:()=>true,size:bytes.length}),
    read:async(buffer,offset,length)=>{const n=Math.min(7,bytes.length-position,length);if(n>0)bytes.copy(buffer,offset,position,position+n);position+=n;return {bytesRead:n};},
    close:async()=>{closed++;}};
  const result=await readSnapshotBytes('native.bolt',{openFile:async()=>handle});
  assert.deepEqual(result,bytes);assert.equal(closed,1);
  handle.stat=async()=>({isFile:()=>false,size:1});
  await assert.rejects(()=>readSnapshotBytes('native.bolt',{openFile:async()=>handle}));assert.equal(closed,2);
  handle.stat=async()=>({isFile:()=>true,size:MAX_SNAPSHOT_BYTES+1});
  await assert.rejects(()=>readSnapshotBytes('native.bolt',{openFile:async()=>handle}));assert.equal(closed,3);
});
test('a file that grows after stat is bounded and rejected, and read errors still close it',async()=>{
  let read=0,closed=0;
  const handle={stat:async()=>({isFile:()=>true,size:1}),
    read:async(buffer,offset,length)=>{read+=length;buffer.fill(32,offset,offset+length);return {bytesRead:length};},
    close:async()=>{closed++;}};
  await assert.rejects(()=>readSnapshotBytes('native.bolt',{openFile:async()=>handle}));
  assert.ok(read<=MAX_SNAPSHOT_BYTES+1);assert.equal(closed,1);
  handle.read=async()=>{throw new Error('private path');};
  await assert.rejects(()=>readSnapshotBytes('native.bolt',{openFile:async()=>handle}));assert.equal(closed,2);
});
test('a saved file can be opened from disk without a backend, CSV or shared runtime state',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bolt-snapshot-'));
  try{
    const chosen=path.join(folder,'saved.bolt');fs.writeFileSync(chosen,await encoded());
    const opened=await openDataAnalysis({showOpenDialog:async()=>({canceled:false,filePaths:[chosen]})});
    assert.equal(opened.opened,true);assert.equal(opened.snapshot.target,'income');
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('open failures hide filesystem details and allow a later retry',async()=>{
  await assert.rejects(()=>openDataAnalysis({showOpenDialog:async()=>({canceled:false,filePaths:['chosen.bolt']}),
    readBytes:async()=>{throw new Error('/private/path or token');}}),error=>{
      assert.equal(error.message.includes('/private'),false);assert.match(error.message,/saved analysis/i);return true;
    });
});
test('preload rejects renderer-supplied open arguments before IPC',async()=>{
  let exposed,calls=0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'preload.cjs'),'utf8'),{
    require:name=>{assert.equal(name,'electron');return {
      contextBridge:{exposeInMainWorld:(_,api)=>{exposed=api;}},
      ipcRenderer:{invoke:async channel=>{calls++;assert.equal(channel,'bolt:open-data-analysis');return {opened:false};}},
    };},
  });
  await assert.rejects(()=>exposed.openDataAnalysis({path:'private.bolt'}));
  assert.equal(calls,0);assert.deepEqual(await exposed.openDataAnalysis(),{opened:false});assert.equal(calls,1);
});
