import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {analyzeCsvText} from './local-analysis.mjs';
import {profileCsvText} from './dataset-understanding.mjs';
import {answerWithAIPlanning} from './ai-data.mjs';
import * as chartTools from '../shared/data-chart.mjs';
const require=createRequire(import.meta.url);
const {createDataAnswerExport,saveDataAnswer}=require('../electron/data-answer-export.cjs');
const csv='day,region,channel,income,spend\n2026-01-31,East,Web,1,1\n2026-02-01,East,Web,2,2\n2026-02-15,West,Shop,3,3\n2026-02-28,East,Web,4,4\n2026-03-01,West,Shop,5,5\n2026-02-20,East,Shop,,6\n2026-02-02,East,Web,99,9,extra';
const profile=profileCsvText(csv,'synthetic.csv');
const source=text=>({name:'synthetic.csv',stream:()=>new Blob([text]).stream()});
const dateFilter={column:'day',from:'2026-02-01',to:'2026-02-28'};
const noRemote=async()=>{throw new Error('Unexpected model or graph call');};
const options={dateFilter,useModel:true,planData:noRemote,completeDataRun:noRemote};

test('inclusive date bounds filter all statistics and retain source/matched/target-missing counts',()=>{
  const r=analyzeCsvText(csv,{target:'income',dimension:'channel',dateColumn:'day',dateFilter});
  assert.equal(r.scannedRows,6);assert.equal(r.matchedRows,4);assert.equal(r.validRows,3);
  assert.equal(r.excludedTargetRows,1);assert.equal(r.excludedByDateFilterRows,2);
  assert.equal(r.total,9);assert.equal(r.mean,3);assert.equal(r.standardDeviation,1);
  assert.deepEqual(r.groups.map(g=>[g.label,g.sum]),[['Web',6],['Shop',3]]);
  assert.deepEqual(r.timeline.map(g=>[g.date,g.sum]),[['2026-02-01',2],['2026-02-15',3],['2026-02-28',4]]);
  assert.equal(r.correlations[0].pairedRows,3);assert.ok(Math.abs(r.correlations[0].correlation-1)<1e-12);
  assert.ok(r.warnings.some(w=>w.includes('2026-02-01')&&w.includes('2026-02-28')));
  assert.ok(r.warnings.some(w=>w.includes('1 malformed')));
  assert.deepEqual(dateFilter,{column:'day',from:'2026-02-01',to:'2026-02-28'});
});
test('open bounds and leap days use strict inclusive calendar dates',()=>{
  assert.equal(analyzeCsvText(csv,{target:'income',dateFilter:{column:'day',from:'2026-03-01',to:null}}).total,5);
  assert.equal(analyzeCsvText(csv,{target:'income',dateFilter:{column:'day',from:null,to:'2026-01-31'}}).total,1);
  const leap='day,income\n2024-02-28,1\n2024-02-29,2\n2024-03-01,4';
  assert.equal(analyzeCsvText(leap,{target:'income',dateFilter:{column:'day',from:'2024-02-29',to:'2024-02-29'}}).total,2);
});
test('month-only source keys use their first day without splitting monthly aggregates',()=>{
  const text='month,income\n2026-01,100\n2026/02,200\n 2026-03 ,300';
  const feb=analyzeCsvText(text,{target:'income',dateFilter:{column:'month',from:'2026-02-01',to:'2026-02-28'}});
  assert.equal(feb.total,200);assert.equal(feb.matchedRows,1);
  const later=analyzeCsvText(text,{target:'income',dateFilter:{column:'month',from:'2026-02-02',to:'2026-03-01'}});
  assert.equal(later.total,300);
  assert.ok(feb.warnings.some(w=>/first day.*month|month.*first day/i.test(w)));
});
test('category and date filters intersect before matched-row missingness and aggregation',async()=>{
  const opts={...options,categoryFilter:{column:'region',value:'East'}};
  const r=analyzeCsvText(csv,{target:'income',...opts});
  assert.equal(r.scannedRows,6);assert.equal(r.matchedRows,3);assert.equal(r.validRows,2);
  assert.equal(r.excludedByCategoryRows,2);assert.equal(r.excludedByDateFilterRows,1);
  assert.equal(r.total,6);assert.equal(r.mean,3);
  assert.ok(r.warnings.some(w=>w.includes('2 category exclusions')&&w.includes('1 date-filter exclusions')));
  const quality=await answerWithAIPlanning(source(csv),'Missing income',profile,'income',opts);
  assert.match(quality.answer,/1 missing cells \(33.3%\).*3/);
  assert.match(quality.evidence,/3 matching rows.*6 accepted/);
});
test('missing or invalid source dates are counted before target statistics',()=>{
  const rows=Array.from({length:20},(_,i)=>'2026-02-'+String(i+1).padStart(2,'0')+',1');
  const text='day,income\n'+rows.join('\n')+'\n,1\ninvalid,1';
  const r=analyzeCsvText(text,{target:'income',dateFilter});
  assert.equal(r.scannedRows,22);assert.equal(r.matchedRows,20);assert.equal(r.total,20);
  assert.equal(r.invalidFilterDateRows,2);assert.equal(r.excludedByDateFilterRows,2);
  assert.equal(r.excludedTargetRows,0);
  assert.ok(r.warnings.some(w=>w.includes('2')&&w.includes('invalid')&&w.includes('filter')));
});
test('invalid or ambiguous range objects reject before source/model use',async()=>{
  let scans=0;
  const untouched={name:'synthetic.csv',stream:()=>{scans++;throw new Error('Unexpected source scan');}};
  for(const invalid of [
    {...dateFilter,column:'region'},{...dateFilter,column:'missing'},{...dateFilter,column:'income'},
    {...dateFilter,from:'2025-02-29'},{...dateFilter,to:'2026-02-30'},
    {...dateFilter,from:'2026-03-01'},{...dateFilter,from:null,to:null},
    {...dateFilter,from:'2026-02'},{...dateFilter,from:'2026/02/01'},
    {...dateFilter,from:2026},{...dateFilter,from:'1899-01-01'},{...dateFilter,to:'2201-01-01'},
    {...dateFilter,sql:'SELECT secret'},['day','2026-02-01'],
  ]){
    await assert.rejects(()=>answerWithAIPlanning(untouched,'Give a snapshot',profile,'income',{...options,dateFilter:invalid}),/date filter/i);
  }
  assert.equal(scans,0);
});
test('fresh questions and follow-ups use the applied range without caching previous results',async()=>{
  const first=await answerWithAIPlanning(source(csv),'Total income by channel',profile,'income',options);
  assert.deepEqual(first.chart.points.map(p=>p.value),[6,3]);
  assert.match(first.evidence,/4 matching rows.*6 accepted/);
  const next=await answerWithAIPlanning(source(csv),'And average?',profile,'income',{...options,previousPlan:first.planning.plan});
  assert.deepEqual(next.chart.points.map(p=>p.value),[3,3]);assert.equal(next.planning.contextUsed,true);
  const total=await answerWithAIPlanning(source(csv),'Total income',profile,'income',options);
  assert.match(total.answer,/9/);assert.match(total.calculation,/matching/);
});
test('empty ranges have null statistics and explicit answers without charts',async()=>{
  const absent={column:'day',from:'2027-01-01',to:null};
  const r=analyzeCsvText(csv,{target:'income',dateFilter:absent});
  assert.equal(r.matchedRows,0);assert.equal(r.total,null);assert.equal(r.mean,null);
  for(const question of ['Total income','Total income by channel','Missing income']){
    const answer=await answerWithAIPlanning(source(csv),question,profile,'income',{...options,dateFilter:absent});
    assert.match(answer.answer,/no.*match/i);assert.equal(answer.chart,undefined);
  }
});
test('range bounds and category values are absent from model requests and graph receipts',async()=>{
  const requests=[],receipts=[];
  const result=await answerWithAIPlanning(source(csv),'Give me a snapshot',profile,'income',{
    dateFilter,categoryFilter:{column:'region',value:'East'},useModel:true,
    planData:async input=>{requests.push(input);return {plan:{kind:'sum',target:'income'},usage:{},model:'synthetic',
      workflow:{engine:'langgraph',run_id:'b'.repeat(32),status:'awaiting_local',awaiting_local:true,steps:['awaiting_local']}};},
    completeDataRun:async receipt=>{receipts.push(receipt);return {
      workflow:{engine:'langgraph',run_id:'b'.repeat(32),status:'completed',awaiting_local:false,steps:['local_completed','workflow_finished']}};},
  });
  assert.match(result.answer,/6/);assert.deepEqual(Object.keys(requests[0]).sort(),['columns','question','target']);
  for(const value of ['East','2026-02','dateFilter','categoryFilter'])assert.equal(JSON.stringify(requests).includes(value),false);
  assert.deepEqual(receipts,[{run_id:'b'.repeat(32),status:'completed'}]);
});
test('all export paths preserve date-key convention, bounds and coverage',async()=>{
  const answer=await answerWithAIPlanning(source(csv),'Show income over time',profile,'income',options);
  const {title,table,calculation,evidence,warnings,chart}=answer;
  const payload={sourceName:'synthetic.csv',target:'income',question:'Show income over time',interpretation:'local',
    result:{title,answer:answer.answer,table,calculation,evidence,warnings,chart}};
  for(const format of ['html','csv','svg']){
    const text=createDataAnswerExport({...payload,format},new Date(),chartTools).content;
    for(const value of ['2026-02-01','2026-02-28','first day','4 matching rows'])assert.ok(text.includes(value),format+': '+value);
  }
  let written=false;
  const bytes=Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]),Buffer.alloc(100)]);
  await saveDataAnswer({...payload,format:'pptx'},{
    showSaveDialog:async()=>({canceled:false,filePath:'selected.pptx'}),
    createPresentation:async snapshot=>{
      assert.ok(snapshot.result.warnings.some(w=>w.includes('2026-02-01')&&w.includes('first day')));
      return {content_base64:bytes.toString('base64'),slide_count:5};
    },writeFile:async()=>{written=true;},
  });
  assert.equal(written,true);
});
test('long combined constraints preserve charts and complete export methodology',async()=>{
  const category='c'.repeat(160),date='d'.repeat(160),value=String.fromCharCode(92).repeat(599);
  const text=category+','+date+',income\n'+value+',2026-02-01,1\nOther,2026-03-01,2';
  const schema=profileCsvText(text,'synthetic.csv');
  const answer=await answerWithAIPlanning(source(text),'Total income by '+category,schema,'income',{
    ...options,categoryFilter:{column:category,value},dateFilter:{column:date,from:'2026-02-01',to:'2026-02-28'},
  });
  assert.equal(answer.chart.points[0].value,1);assert.ok(answer.chart.note.length<=2000);
  assert.ok(answer.warnings.every(w=>w.length<=2000));
  const {title,table,calculation,evidence,warnings,chart}=answer;
  assert.doesNotThrow(()=>createDataAnswerExport({format:'html',sourceName:'synthetic.csv',target:'income',
    question:'Total income by '+category,interpretation:'local',
    result:{title,answer:answer.answer,table,calculation,evidence,warnings,chart}},new Date(),chartTools));
});
