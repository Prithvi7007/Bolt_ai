import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {profileCsvText} from '../src/dataset-understanding.mjs';
import {answerDataQuestion} from '../src/ask-data.mjs';
import * as chartTools from './data-chart.mjs';
const require=createRequire(import.meta.url);
const {createDataAnswerExport,saveDataAnswer,validateDataPresentationInput}=require('../electron/data-answer-export.cjs');
const file=text=>({name:'synthetic.csv',stream:()=>new Blob([text]).stream()});
const chart=(values,type='bar')=>({type,title:'Calculated income',xLabel:'income',yLabel:'region',
  note:'Observed values calculated locally.',points:values.map((value,i)=>({label:'Group '+i,value,detail:'1 target row'}))});
const payload=chart=>({format:'html',sourceName:'synthetic.csv',target:'income',question:'Average income by region',
  interpretation:'local',result:{title:'Average income',answer:'Calculated from local data.',table:[],
    calculation:'Sum divided by valid rows',evidence:'3 numeric target rows',warnings:['Not causal.'],chart}});

test('group chart values use the actual unrounded calculation and the displayed groups',async()=>{
  const csv='region,income\nEast,1\nEast,0\nEast,0\nWest,-2\nWest,-2\nWest,-2';
  const profile=profileCsvText(csv,'synthetic.csv');
  const answer=await answerDataQuestion(file(csv),'Average income by region',profile,'income');
  assert.equal(answer.chart.type,'bar');
  assert.deepEqual(answer.chart.points.map(p=>p.label),answer.table.map(r=>r.label));
  assert.equal(answer.chart.points[0].value,1/3);
  assert.equal(answer.chart.points[1].value,-2);
  assert.equal(answer.chart.points[0].detail,'3 target rows');
  assert.notEqual(String(answer.chart.points[0].value),answer.table[0].value,'Chart values must not be parsed from rounded display text');
});
test('date charts include every retained date bucket beyond the answer table preview',async()=>{
  const csv='date,income\n'+Array.from({length:13},(_,i)=>'2026-01-'+String(i+1).padStart(2,'0')+','+(i+1)).join('\n');
  const answer=await answerDataQuestion(file(csv),'Show income over time',profileCsvText(csv,'synthetic.csv'),'income');
  assert.equal(answer.chart.type,'line');
  assert.equal(answer.table.length,12);
  assert.equal(answer.chart.points.length,13);
  assert.deepEqual(answer.chart.points.map(p=>p.value),Array.from({length:13},(_,i)=>i+1));
  assert.match(answer.chart.note,/equal spacing/);
});
test('partial group rankings disclose coverage and chart only the reported individual groups',async()=>{
  const csv='region,income\n'+Array.from({length:20},(_,i)=>Array.from({length:20},()=>('G'+i+','+(i+1))).join('\n')).join('\n');
  const answer=await answerDataQuestion(file(csv),'Top 5 region by total income',profileCsvText(csv,'synthetic.csv'),'income');
  assert.equal(answer.chart.points.length,5);
  assert.deepEqual(answer.chart.points.map(p=>p.label),answer.table.map(r=>r.label));
  assert.match(answer.chart.note,/partial/i);
  assert.ok(answer.warnings.some(w=>w.includes('first 16')));
});
test('scalar and unsupported questions do not create charts',async()=>{
  const csv='region,income\nEast,1\nEast,2\nWest,3';
  const profile=profileCsvText(csv,'synthetic.csv');
  for(const q of ['Total income','Forecast income next year']){
    const answer=await answerDataQuestion(file(csv),q,profile,'income');
    assert.equal(answer.chart,undefined);
  }
});
test('bar geometry includes zero and stays finite for signed, zero and extreme numeric values',()=>{
  for(const values of [[0,0],[-4,-2],[-5,10],[Number.MAX_VALUE,-Number.MAX_VALUE]]){
    const c=chart(values),g=chartTools.chartLayout(c);
    assert.ok(g.zero>=g.left&&g.zero<=g.right);
    for(const bar of g.bars){
      assert.ok(Number.isFinite(bar.x)&&Number.isFinite(bar.width));
      assert.ok(bar.x>=g.left-1e-8&&bar.x+bar.width<=g.right+1e-8);
      assert.ok(bar.width>=0);
      if(bar.value===0)assert.equal(bar.width,0);
    }
    assert.doesNotMatch(chartTools.renderChartSvg(c),/NaN|Infinity/);
  }
});
test('line geometry supports a single bucket, flat series and extreme mixed-sign values',()=>{
  for(const values of [[0],[5,5],[Number.MAX_VALUE,-Number.MAX_VALUE]]){
    const g=chartTools.chartLayout(chart(values,'line'));
    for(const p of g.points)assert.ok(Number.isFinite(p.cx)&&Number.isFinite(p.cy)&&p.cy>=g.top-1e-8&&p.cy<=g.bottom+1e-8);
  }
});
test('invalid/nonfinite points, extra fields and oversized charts are rejected',()=>{
  for(const value of [NaN,Infinity,-Infinity,'1',null])assert.throws(()=>chartTools.validateChart(chart([value])));
  assert.throws(()=>chartTools.validateChart({...chart([1]),url:'https://invalid'}));
  assert.throws(()=>chartTools.validateChart(chart(Array(13).fill(1))));
  assert.throws(()=>chartTools.validateChart(chart(Array(513).fill(1),'line')));
  assert.throws(()=>chartTools.validateChart({...chart([1]),points:[{label:'x',value:1,detail:'',script:'run'}]}));
});
test('HTML and SVG escape chart labels and include calculation evidence and caveats',()=>{
  const c=chart([1,-2]);c.points[0].label='</text><script>alert(1)</script>';
  const input=payload(c);
  const html=createDataAnswerExport(input,new Date('2026-11-17'),chartTools).content;
  const svg=createDataAnswerExport({...input,format:'svg'},new Date('2026-11-17'),chartTools).content;
  for(const document of [html,svg]){
    assert.ok(document.includes('<svg'));
    assert.ok(document.includes('&lt;script&gt;'));
    assert.equal(document.includes('<script'),false);
    assert.equal(document.includes('<image'),false);
    assert.ok(document.includes('3 numeric target rows'));
    assert.ok(document.includes('Not causal.'));
    assert.ok(document.includes('synthetic.csv'));
  }
  assert.ok(html.includes('Full chart data'));
  assert.ok(svg.includes('X axis:'));
});
test('CSV chart rows retain full numeric precision separately from formatted table values',()=>{
  const c=chart([1/3]);
  const input=payload(c);input.result.table=[{label:'Group 0',value:'0.33',detail:'3 rows'}];
  const csv=createDataAnswerExport({...input,format:'csv'},new Date(),chartTools).content;
  assert.ok(csv.includes('"chart_value","Group 0","0.3333333333333333"'));
  assert.ok(csv.includes('"table","Group 0","0.33"'));
});
test('native chart save validates before its dialog and cancellation never writes or calls the backend',async()=>{
  let dialogs=0,writes=0,backend=0;
  const deps={showSaveDialog:async()=>{dialogs++;return {canceled:true};},
    writeFile:async()=>{writes++;},createPresentation:async()=>{backend++;}};
  assert.deepEqual(await saveDataAnswer({...payload(chart([1])),format:'svg'},deps),{saved:false});
  assert.equal(dialogs,1);assert.equal(writes,0);assert.equal(backend,0);
  await assert.rejects(()=>saveDataAnswer({...payload(chart([NaN])),format:'svg'},deps));
  assert.equal(dialogs,1);
  assert.throws(()=>createDataAnswerExport({...payload(undefined),format:'svg'}));
  assert.throws(()=>validateDataPresentationInput({...payload(chart([1])),format:'pptx'}));
});
test('SVG saving writes generated XML only to the dialog-selected destination',async()=>{
  const writes=[];
  const result=await saveDataAnswer({...payload(chart([2])),format:'svg'},{
    showSaveDialog:async options=>{assert.deepEqual(options.filters[0].extensions,['svg']);return {canceled:false,filePath:'chosen.svg'};},
    writeFile:async(...args)=>writes.push(args),
  });
  assert.deepEqual(result,{saved:true});
  assert.equal(writes[0][0],'chosen.svg');assert.ok(writes[0][1].startsWith('<svg'));
});

test('date-limit coverage is disclosed and no omitted bucket is invented',async()=>{
  const rows=Array.from({length:513},(_,i)=>new Date(Date.UTC(2024,0,1)+i*86400000).toISOString().slice(0,10)+',1');
  const csv='date,income\n'+rows.join('\n');
  const answer=await answerDataQuestion(file(csv),'Show income over time',profileCsvText(csv,'synthetic.csv'),'income');
  assert.equal(answer.chart.points.length,512);
  assert.match(answer.chart.note,/omitted|incomplete/);
  assert.ok(answer.warnings.some(w=>/512|limit/.test(w)));
});
test('an overflowing aggregate omits the chart instead of showing a fabricated partial total',async()=>{
  const csv='region,income\nEast,1e308\nEast,1e308\nWest,1\nWest,1';
  const answer=await answerDataQuestion(file(csv),'Total income by region',profileCsvText(csv,'synthetic.csv'),'income');
  assert.equal(answer.chart,undefined);
  assert.ok(answer.warnings.some(w=>w.includes('chart could not')));
});
test('chart data cannot enter the strict PowerPoint snapshot',()=>{
  assert.throws(()=>validateDataPresentationInput({...payload(chart([1])),format:'pptx'}),/Invalid/);
});
