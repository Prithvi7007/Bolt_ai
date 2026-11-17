import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {analyzeCsvText} from './local-analysis.mjs';
import {profileCsvText} from './dataset-understanding.mjs';
import {answerWithAIPlanning} from './ai-data.mjs';
import * as chartTools from '../shared/data-chart.mjs';
const require=createRequire(import.meta.url);
const {createDataAnswerExport}=require('../electron/data-answer-export.cjs');
const csv='date,region,channel,income,spend\n2026-01,East,Web,10,1\n2026-01,East,Shop,20,2\n2026-02,East,Web,30,3\n2026-02,East,Shop,,4\n2026-01,West,Web,100,9\n2026-02,West,Shop,200,10\n2026-03,East,Web,9,4,extra';
const profile=profileCsvText(csv,'synthetic.csv');
const file={name:'synthetic.csv',stream:()=>new Blob([csv]).stream()};
const filter={column:'region',value:'East'};
const forbidden=async()=>{throw new Error('Unexpected model or graph call');};
const options={categoryFilter:filter,useModel:true,planData:forbidden,completeDataRun:forbidden};

test('a categorical subset filters every statistic before aggregation and separates row counts',()=>{
  const r=analyzeCsvText(csv,{target:'income',dimension:'channel',dateColumn:'date',categoryFilter:filter});
  assert.equal(r.scannedRows,6);assert.equal(r.matchedRows,4);assert.equal(r.excludedByFilterRows,2);
  assert.equal(r.validRows,3);assert.equal(r.excludedTargetRows,1);assert.equal(r.total,60);assert.equal(r.mean,20);
  assert.equal(r.standardDeviation,10);
  assert.deepEqual(r.groups.map(g=>[g.label,g.sum]),[['Web',40],['Shop',20]]);
  assert.deepEqual(r.timeline.map(g=>[g.date,g.sum]),[['2026-01',30],['2026-02',30]]);
  assert.equal(r.correlations[0].pairedRows,3);assert.ok(Math.abs(r.correlations[0].correlation-1)<1e-12);
  assert.ok(r.warnings.some(w=>w.includes('region = "East"')&&w.includes('4 of 6')));
  assert.ok(r.warnings.some(w=>w.includes('1 malformed')));
  assert.deepEqual(filter,{column:'region',value:'East'});
});
test('matching trims surrounding whitespace but preserves case and literal punctuation',()=>{
  const data='region,income\n'+Array(4).fill(' East ,1\nEast,2\neast,4\nEast.,8').join('\n');
  assert.equal(analyzeCsvText(data,{target:'income',categoryFilter:filter}).total,12);
  assert.equal(analyzeCsvText(data,{target:'income',categoryFilter:{column:'region',value:'east'}}).total,16);
  assert.equal(analyzeCsvText(data,{target:'income',categoryFilter:{column:'region',value:' East '}}).total,12);
});
test('fresh questions and follow-ups calculate against the applied subset and retain evidence',async()=>{
  const first=await answerWithAIPlanning(file,'Total income by channel',profile,'income',options);
  assert.deepEqual(first.chart.points.map(p=>p.value),[40,20]);
  assert.match(first.evidence,/4 matching rows.*6 accepted/);
  assert.ok(first.warnings.some(w=>w.includes('region = "East"')));
  assert.doesNotMatch(first.calculation,/no filter/);
  const follow=await answerWithAIPlanning(file,'And average?',profile,'income',{...options,previousPlan:first.planning.plan});
  assert.equal(follow.planning.contextUsed,true);assert.deepEqual(follow.chart.points.map(p=>p.value),[20,20]);
  const overall=await answerWithAIPlanning(file,'Total income',profile,'income',options);
  assert.match(overall.answer,/60/);assert.match(overall.calculation,/matching/);
});
test('subset missingness uses matched rows including missing targets',async()=>{
  const answer=await answerWithAIPlanning(file,'Missing income',profile,'income',options);
  assert.equal(answer.kind,'answered');assert.match(answer.answer,/1 missing cells \(25%\).*4/);
  assert.match(answer.evidence,/4 matching rows.*6 accepted/);
  assert.ok(answer.warnings.some(w=>w.includes('region = "East"')));
});
test('zero matching rows produce explicit empty answers and no invented chart or numeric total',async()=>{
  const categoryFilter={column:'region',value:'Nowhere'};
  const r=analyzeCsvText(csv,{target:'income',categoryFilter});
  assert.equal(r.matchedRows,0);assert.equal(r.total,null);assert.equal(r.mean,null);
  for(const question of ['Total income','Total income by channel','Missing income']){
    const answer=await answerWithAIPlanning(file,question,profile,'income',{...options,categoryFilter});
    assert.equal(answer.kind,'answered');assert.match(answer.answer,/no.*match/i);assert.equal(answer.chart,undefined);
  }
});
test('invalid filters reject before model calls or source scans',async()=>{
  let scans=0;const untouched={...file,stream:()=>{scans++;throw new Error('Unexpected source scan');}};
  for(const categoryFilter of [{column:'income',value:'10'},{column:'missing',value:'East'},
    {column:'region',value:''},{column:'region',value:' '.repeat(3)},
    {column:'region',value:'x'.repeat(1001)},{column:'region',value:'\\'.repeat(1000)},{column:'region',value:'East',sql:'SELECT secret'},
    {column:12,value:'East'},['region','East']]){
    await assert.rejects(()=>answerWithAIPlanning(untouched,'Give a quick snapshot',profile,'income',{
      ...options,categoryFilter,
    }),/filter/i);
  }
  assert.equal(scans,0);
});
test('schema-only model planning and completion receipts never receive the filter or subset values',async()=>{
  const requests=[],receipts=[];
  const result=await answerWithAIPlanning(file,'Give me a quick snapshot',profile,'income',{
    categoryFilter:filter,useModel:true,
    completeDataRun:async receipt=>{receipts.push(receipt);return {workflow:{engine:'langgraph',run_id:'a'.repeat(32),status:'completed',awaiting_local:false,steps:['local_completed']}};},
    planData:async input=>{requests.push(input);return {plan:{kind:'sum',target:'income'},model:'synthetic',usage:{},
      workflow:{engine:'langgraph',run_id:'a'.repeat(32),status:'awaiting_local',awaiting_local:true,steps:['awaiting_local']}};},
    completeDataRun:async input=>{receipts.push(input);return {workflow:{engine:'langgraph',run_id:'a'.repeat(32),
      status:'completed',awaiting_local:false,steps:['awaiting_local','local_completed','workflow_finished']}};},
  });
  assert.match(result.answer,/60/);
  assert.deepEqual(Object.keys(requests[0]).sort(),['columns','question','target']);
  assert.equal(JSON.stringify(requests).includes('East'),false);
  assert.deepEqual(receipts,[{run_id:'a'.repeat(32),status:'completed'}]);
  assert.match(result.answer,/60/);
  assert.deepEqual(Object.keys(requests[0]).sort(),['columns','question','target']);
  assert.equal(JSON.stringify(requests).includes('East'),false);
  assert.equal(JSON.stringify(requests).includes('categoryFilter'),false);
  assert.deepEqual(receipts,[{run_id:'a'.repeat(32),status:'completed'}]);
});
test('existing exports retain filter context and subset coverage with calculated chart data',async()=>{
  const answer=await answerWithAIPlanning(file,'Total income by channel',profile,'income',options);
  const {title,table,calculation,evidence,warnings,chart}=answer;
  for(const format of ['html','csv','svg']){
    const content=createDataAnswerExport({format,sourceName:'synthetic.csv',target:'income',question:'Total income by channel',
      interpretation:'local',result:{title,answer:answer.answer,table,calculation,evidence,warnings,chart}},new Date(),chartTools).content;
    assert.ok(content.includes('region'));assert.ok(content.includes('East'));assert.ok(content.includes('4 matching rows'));
  }
});

test('an in-flight subset cannot publish after its owning scope is replaced',async()=>{
  let current=true,scans=0;
  const source={...file,stream:()=>{scans++;current=false;return new Blob([csv]).stream();}};
  await assert.rejects(()=>answerWithAIPlanning(source,'Total income',profile,'income',{
    ...options,isCurrent:()=>current,
  }),/dataset changed/);
  assert.equal(scans,1);
});

test('matched rows with all targets missing remain distinct from zero matching rows',async()=>{
  const text='region,income\nEast,\nEast,NA\nWest,10\nWest,20';
  const schema=profileCsvText(text,'synthetic.csv');
  const source={name:'synthetic.csv',stream:()=>new Blob([text]).stream()};
  const total=await answerWithAIPlanning(source,'Total income',schema,'income',options);
  assert.match(total.answer,/No valid numeric.*matching rows/);
  assert.doesNotMatch(total.answer,/No accepted CSV rows match/);
  const quality=await answerWithAIPlanning(source,'Missing income',schema,'income',options);
  assert.match(quality.answer,/2 missing cells \(100%\).*2/);
});

test('accepted boundary-length values retain charts and exportable filter evidence',async()=>{
  for(const value of ['x'.repeat(1000),String.fromCharCode(92).repeat(599)]){
    const text='region,income\n'+value+',1\nOther,2';
    const schema=profileCsvText(text,'synthetic.csv');
    const source={name:'synthetic.csv',stream:()=>new Blob([text]).stream()};
    const answer=await answerWithAIPlanning(source,'Total income by region',schema,'income',{
      ...options,categoryFilter:{column:'region',value},
    });
    assert.equal(answer.chart.points[0].value,1);
    assert.ok(answer.chart.note.length<=2000&&answer.warnings.every(w=>w.length<=2000));
    const {title,table,calculation,evidence,warnings,chart}=answer;
    for(const format of ['html','csv','svg']){
      assert.doesNotThrow(()=>createDataAnswerExport({format,sourceName:'synthetic.csv',target:'income',
        question:'Total income by region',interpretation:'local',
        result:{title,answer:answer.answer,table,calculation,evidence,warnings,chart}},new Date(),chartTools));
    }
  }
});
