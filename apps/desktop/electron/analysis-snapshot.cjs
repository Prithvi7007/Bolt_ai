'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {validateDataAnswerInput}=require('./data-answer-export.cjs');

const MAX_SNAPSHOT_BYTES=300_000;
const ROOT_KEYS=['kind','version','savedAt','sourceName','target','question','interpretation','result'];
function trace(phase){if(process.env.BOLT_DIAGNOSTICS==='1')console.error('BOLT_SNAPSHOT_PHASE: '+phase);}
function invalid(){throw new Error('Invalid saved analysis snapshot');}

async function decodeAnalysisSnapshot(bytes) {
  trace('decode-start');
  if(!Buffer.isBuffer(bytes)||bytes.length<2||bytes.length>MAX_SNAPSHOT_BYTES)invalid();
  let doc;
  try{doc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{invalid();}
  if(!doc||typeof doc!=='object'||Array.isArray(doc)
    ||Object.keys(doc).sort().join(',')!==[...ROOT_KEYS].sort().join(',')
    ||doc.kind!=='bolt.analysis.snapshot'||doc.version!==1
    ||typeof doc.savedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(doc.savedAt))invalid();
  let savedAt;
  try{savedAt=new Date(doc.savedAt).toISOString();}catch{invalid();}
  if(savedAt!==doc.savedAt)invalid();
  const input={format:'bolt',sourceName:doc.sourceName,target:doc.target,question:doc.question,
    interpretation:doc.interpretation,result:doc.result};
  validateDataAnswerInput(input,['bolt']);
  if(doc.result.chart!==undefined){
    trace('chart-import-start');
    const {validateChart}=await import('../shared/data-chart.mjs');
    trace('chart-import-complete');
    validateChart(doc.result.chart);
  }
  trace('decode-complete');
  return {kind:'bolt.analysis.snapshot',version:1,savedAt,sourceName:doc.sourceName,
    target:doc.target,question:doc.question,interpretation:doc.interpretation,result:doc.result};
}

async function readSnapshotBytes(filePath,{openFile=fs.promises.open}={}) {
  const flags=fs.constants.O_RDONLY|(process.platform==='win32'?0:fs.constants.O_NONBLOCK);
  trace('file-open-start');
  const handle=await openFile(filePath,flags);
  trace('file-open-complete');
  try{
    const stat=await handle.stat();
    trace('file-stat-complete');
    if(!stat.isFile()||!Number.isSafeInteger(stat.size)||stat.size<1||stat.size>MAX_SNAPSHOT_BYTES)invalid();
    const buffer=Buffer.alloc(MAX_SNAPSHOT_BYTES+1);
    let offset=0;
    trace('file-read-start');
    while(offset<buffer.length){
      const remaining=buffer.length-offset;
      const {bytesRead}=await handle.read(buffer,offset,remaining,null);
      if(!Number.isInteger(bytesRead)||bytesRead<0||bytesRead>remaining)invalid();
      if(bytesRead===0)break;
      offset+=bytesRead;
    }
    trace('file-read-complete');
    if(offset>MAX_SNAPSHOT_BYTES)invalid();
    return buffer.subarray(0,offset);
  }finally{trace('file-close-start');await handle.close();trace('file-close-complete');}
}

async function openDataAnalysis({showOpenDialog,readBytes=readSnapshotBytes}) {
  try{
    trace('picker-start');
    const choice=await showOpenDialog({title:'Open BOLT analysis',properties:['openFile'],
      filters:[{name:'BOLT saved analysis',extensions:['bolt']}]});
    trace('picker-complete');
    if(choice.canceled)return {opened:false};
    if(!Array.isArray(choice.filePaths)||choice.filePaths.length!==1
      ||typeof choice.filePaths[0]!=='string'||!choice.filePaths[0]||choice.filePaths[0].includes('\0')
      ||path.extname(choice.filePaths[0]).toLowerCase()!=='.bolt')invalid();
    const snapshot=await decodeAnalysisSnapshot(await readBytes(choice.filePaths[0]));
    trace('snapshot-ready');
    return {opened:true,snapshot};
  }catch{
    throw new Error('Could not open this saved analysis. Choose a valid BOLT .bolt snapshot and try again.');
  }
}
module.exports={decodeAnalysisSnapshot,openDataAnalysis,readSnapshotBytes,MAX_SNAPSHOT_BYTES};
