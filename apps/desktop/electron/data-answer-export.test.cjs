'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createDataAnswerExport,saveDataAnswer} = require('./data-answer-export.cjs');

function input(overrides = {}) {
  return {format:'html',sourceName:'synthetic.csv',target:'attendance',question:'What is the total attendance?',
    interpretation:'local',result:{
      title:'Total attendance',answer:'The total attendance is 350 across 3 valid target rows.',
      table:[],calculation:'Sum of all valid numeric attendance values, with no filter',
      evidence:'3 numeric target rows from 3 accepted CSV rows',warnings:['No forecast was calculated.'],
    },...overrides};
}
const instant = new Date('2026-11-17T00:00:00Z');
test('actual local CSV result exports its answer and calculation evidence',async()=>{
  const {profileCsvText} = await import('../src/dataset-understanding.mjs');
  const {answerDataQuestion} = await import('../src/ask-data.mjs');
  const csv='month,attendance\n2026-01,100\n2026-02,120\n2026-03,130';
  const profile=profileCsvText(csv,'synthetic.csv');
  const answer=await answerDataQuestion({name:'synthetic.csv',stream:()=>new Blob([csv]).stream()},'What is total attendance?',profile,'attendance');
  const {title,table,calculation,evidence,warnings}=answer;
  const artifact=createDataAnswerExport(input({result:{title,answer:answer.answer,table,calculation,evidence,warnings}}),instant);
  assert.equal(artifact.filename,'BOLT-analysis.html');
  for(const value of ['350','3 numeric target rows','Sum of all valid numeric attendance','synthetic.csv','not a full extract','2026-11-17T00:00:00.000Z'])assert.ok(artifact.content.includes(value),value);
  assert.equal(artifact.content.includes('2026-01'),false,'The source rows are not included');
  assert.match(artifact.content,/default-src &#?['"]?none|default-src 'none'/);
});
test('HTML treats source, questions, answers and table labels as inert text',()=>{
  const payload=input();
  const attack='<script>alert("x")</script><img src="https://example.invalid/secret" onerror="steal()">';
  payload.sourceName=attack;
  payload.question=attack;
  payload.result.answer=attack;
  payload.result.table=[{label:'<svg onload=run()>',value:'1',detail:'<iframe src=x>'}];
  payload.result.warnings=[attack];
  const content=createDataAnswerExport(payload,instant).content;
  assert.equal(content.includes('<script'),false);
  assert.equal(content.includes('<img'),false);
  assert.equal(content.includes('<iframe'),false);
  assert.equal(content.includes('<svg'),false);
  assert.ok(content.includes('&lt;script&gt;'));
  assert.ok(content.includes('&lt;svg onload=run()&gt;'));
  assert.ok(content.includes('form-action \'none\''));
  assert.equal(content.includes('<a '),false);
});
test('CSV includes formatted table values and caveats and quotes multiline fields',()=>{
  const payload=input({format:'csv',interpretation:'model'});
  payload.result.table=[{label:'East, "new"\nsegment',value:'1,234.50',detail:'5 target rows'}];
  const content=createDataAnswerExport(payload,instant).content;
  assert.ok(content.startsWith('\ufeff"Section","Label","Value","Detail"\r\n'));
  assert.ok(content.includes('"table","East, ""new""\nsegment","1,234.50","5 target rows"'));
  assert.ok(content.includes('No forecast was calculated.'));
  assert.ok(content.includes('AI interpreted the question; the answer was calculated on-device.'));
  assert.ok(content.includes('2026-11-17T00:00:00.000Z'));
});
test('spreadsheet formulas in every CSV text field are neutralized; negative values survive',()=>{
  const payload=input({format:'csv',sourceName:'=HYPERLINK("bad")',target:'@SUM(1)',question:'  +cmd|bad'});
  payload.result.title='-not-a-number';
  payload.result.answer='\t=1+1';
  payload.result.calculation='\r\n@SUM(1)';
  payload.result.table=[
    {label:'=1+1',value:'-12.5',detail:' \u0000=2+2'},
    {label:' \ufeff@SUM(1)',value:'-1+2',detail:'+cmd'},
  ];
  const content=createDataAnswerExport(payload,instant).content;
  for(const escaped of ["'=HYPERLINK","'@SUM","'  +cmd","'-not-a-number","'\t=1+1","'\r\n@SUM","'=1+1","' =2+2","'-1+2","'+cmd"])assert.ok(content.includes(escaped),escaped);
  assert.ok(content.includes('"-12.5"'),'A finite negative number remains usable');
  assert.equal(content.includes('\0'),false);
});
test('IPC export rejects paths, raw content, unknown fields, unsupported formats and oversized data',()=>{
  for(const extra of [{path:'../secret'},{content:'<script>run()</script>'},{url:'https://bad'},{bytes:'secret'}])assert.throws(()=>createDataAnswerExport({...input(),...extra}),/Invalid/);
  for(const format of ['exe','svg','pptx'])assert.throws(()=>createDataAnswerExport(input({format})),/Invalid/);
  const payload=input();
  for(const invalid of [
    {...payload,result:{...payload.result,rows:[['secret']]}},
    {...payload,sourceName:'s'.repeat(256)},
    {...payload,question:'q'.repeat(401)},
    {...payload,result:{...payload.result,table:Array(513).fill({label:'x',value:'1',detail:''})}},
    {...payload,result:{...payload.result,table:[{label:'x',value:'1',detail:'',url:'bad'}]}},
    {...payload,result:{...payload.result,warnings:Array(41).fill('too many')}},
    {...payload,result:{...payload.result,table:Array(512).fill({label:'界'.repeat(1000),value:'1',detail:''})}},
  ])assert.throws(()=>createDataAnswerExport(invalid),/Invalid/);
});
test('every save uses a dialog-selected path; cancellation writes nothing',async()=>{
  const writes=[],dialogs=[];
  const deps={showSaveDialog:async options=>{dialogs.push(options);return {canceled:true};},
    writeFile:async(...args)=>{writes.push(args);}};
  assert.deepEqual(await saveDataAnswer(input(),deps),{saved:false});
  assert.equal(dialogs[0].defaultPath,'BOLT-analysis.html');
  assert.deepEqual(dialogs[0].filters[0].extensions,['html']);
  assert.equal(writes.length,0);
  deps.showSaveDialog=async()=>({canceled:false,filePath:'chosen-report.html'});
  assert.deepEqual(await saveDataAnswer(input(),deps),{saved:true});
  assert.equal(writes.length,1);
  assert.equal(writes[0][0],'chosen-report.html');
  assert.ok(writes[0][1].includes('350'));
  assert.equal(writes[0][2],'utf8');
});
test('invalid input is rejected before opening a dialog and bad extensions never write',async()=>{
  let dialogs=0,writes=0;
  const deps={showSaveDialog:async()=>{dialogs++;return {canceled:false,filePath:'report.exe'};},
    writeFile:async()=>{writes++;}};
  await assert.rejects(()=>saveDataAnswer({...input(),path:'secret'},deps),/Invalid/);
  assert.equal(dialogs,0);
  await assert.rejects(()=>saveDataAnswer(input(),deps),/Choose a .html filename/);
  assert.equal(writes,0);
});
test('write failures are visible without leaking filesystem errors and can be retried',async()=>{
  let attempts=0;
  const deps={showSaveDialog:async()=>({canceled:false,filePath:'report.csv'}),
    writeFile:async()=>{if(++attempts===1)throw new Error('private filesystem path');}};
  await assert.rejects(()=>saveDataAnswer(input({format:'csv'}),deps),error=>{
    assert.match(error.message,/Could not save/);
    assert.equal(error.message.includes('private'),false);
    return true;
  });
  assert.deepEqual(await saveDataAnswer(input({format:'csv'}),deps),{saved:true});
});

test('full-width spreadsheet formula prefixes are neutralized without changing displayed Unicode',()=>{
  const payload=input({format:'csv'});
  payload.result.table=['＝1+1','＋1+1','－1+1','＠SUM(1)',' \ufeff＝2+2'].map(label=>({label,value:'1',detail:''}));
  const content=createDataAnswerExport(payload,instant).content;
  for(const row of payload.result.table)assert.ok(content.includes('"\''+row.label+'"'),row.label);
});

const pptxBytes=Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]),Buffer.alloc(100)]);
const pptxResponse=()=>({content_base64:pptxBytes.toString('base64'),slide_count:3});
test('PowerPoint generation receives only the validated snapshot and saves binary bytes',async()=>{
  const calls=[],writes=[];
  const payload=input({format:'pptx'});
  const outcome=await saveDataAnswer(payload,{
    showSaveDialog:async options=>{assert.equal(options.defaultPath,'BOLT-analysis.pptx');return {canceled:false,filePath:'chosen.pptx'};},
    createPresentation:async value=>{calls.push(value);return pptxResponse();},
    writeFile:async(...args)=>writes.push(args),
  });
  assert.deepEqual(outcome,{saved:true});
  assert.deepEqual(calls,[payload]);
  assert.equal(writes[0][0],'chosen.pptx');
  assert.deepEqual(writes[0][1],pptxBytes);
  assert.equal(writes[0][2],undefined,'Binary slides must not be re-encoded as text');
});
test('cancelling a PowerPoint save does not generate or write an artifact',async()=>{
  let generated=0,written=0;
  assert.deepEqual(await saveDataAnswer(input({format:'pptx'}),{
    showSaveDialog:async()=>({canceled:true}),
    createPresentation:async()=>{generated++;return pptxResponse();},
    writeFile:async()=>{written++;},
  }),{saved:false});
  assert.equal(generated,0);assert.equal(written,0);
});
test('invalid PowerPoint snapshots cannot open a dialog or reach the local service',async()=>{
  let calls=0;
  const deps={showSaveDialog:async()=>{calls++;return {canceled:true};},
    createPresentation:async()=>{calls++;return pptxResponse();},writeFile:async()=>{calls++;}};
  await assert.rejects(()=>saveDataAnswer(input({format:'pptx',path:'forbidden'}),deps),/Invalid/);
  assert.equal(calls,0);
});
test('invalid local presentation responses are never written',async()=>{
  for(const response of [
    {content_base64:'not-base64',slide_count:3},
    {content_base64:Buffer.alloc(120).toString('base64'),slide_count:3},
    {content_base64:pptxBytes.toString('base64'),slide_count:41},
    {content_base64:pptxBytes.toString('base64')+'!',slide_count:3},
  ]){
    let writes=0;
    await assert.rejects(()=>saveDataAnswer(input({format:'pptx'}),{
      showSaveDialog:async()=>({canceled:false,filePath:'chosen.pptx'}),
      createPresentation:async()=>response,writeFile:async()=>{writes++;},
    }),/Invalid local PowerPoint response/);
    assert.equal(writes,0);
  }
});
test('PowerPoint generation errors preserve retry and alternative-format guidance',async()=>{
  let attempts=0;
  const deps={showSaveDialog:async()=>({canceled:false,filePath:'chosen.pptx'}),
    createPresentation:async()=>{if(++attempts===1)throw new Error('private backend details');return pptxResponse();},
    writeFile:async()=>{}};
  await assert.rejects(()=>saveDataAnswer(input({format:'pptx'}),deps),error=>{
    assert.match(error.message,/HTML or CSV/);assert.equal(error.message.includes('private'),false);return true;
  });
  assert.deepEqual(await saveDataAnswer(input({format:'pptx'}),deps),{saved:true});
});

const calculatedChart={type:'bar',title:'Total income by region',xLabel:'region',yLabel:'total income',
  note:'All retained categories.',points:[{label:'East',value:-12.5,detail:'2 target rows'},{label:'West',value:28.25,detail:'3 target rows'}]};
test('PowerPoint saves validated calculated chart data without accepting renderer XML',async()=>{
  const payload=input({format:'pptx'});payload.result.chart=structuredClone(calculatedChart);
  let generated=0,written=0;
  assert.deepEqual(await saveDataAnswer(payload,{
    showSaveDialog:async()=>({canceled:false,filePath:'chart.pptx'}),
    createPresentation:async value=>{generated++;assert.deepEqual(value.result.chart,calculatedChart);return pptxResponse();},
    writeFile:async(_,bytes)=>{written++;assert.deepEqual(bytes,pptxBytes);},
  }),{saved:true});
  assert.equal(generated,1);assert.equal(written,1);
});
test('invalid calculated PowerPoint charts fail before dialog, generation or writing',async()=>{
  const bad=[
    {...calculatedChart,type:'pie'}, {...calculatedChart,svg:'<svg/>'},
    {...calculatedChart,points:[]}, {...calculatedChart,points:Array(13).fill(calculatedChart.points[0])},
    {...calculatedChart,points:[{label:'x',value:Infinity,detail:''}]},
    {...calculatedChart,points:[{label:'x',value:true,detail:''}]},
    {...calculatedChart,points:[{label:'x',value:1,detail:'',url:'https://bad'}]},
  ];
  let calls=0;
  const deps={showSaveDialog:async()=>{calls++;return {canceled:true};},
    createPresentation:async()=>{calls++;return pptxResponse();},writeFile:async()=>{calls++;}};
  for(const chart of bad){
    const payload=input({format:'pptx'});payload.result.chart=chart;
    await assert.rejects(()=>saveDataAnswer(payload,deps),/Invalid/);
  }
  assert.equal(calls,0);
});
