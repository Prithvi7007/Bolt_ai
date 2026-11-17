import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {profileCsvText} from './dataset-understanding.mjs';
import {answerWithAIPlanning} from './ai-data.mjs';
import {resolveDataQuestionPlan,describeDataPlan} from './ask-data.mjs';
const require=createRequire(import.meta.url);
const {createDataAnswerExport}=require('../electron/data-answer-export.cjs');
const csv='date,region,channel,income,spend\n2026-01,East,Web,1,2\n2026-01,East,Store,3,4\n2026-02,West,Web,10,6\n2026-02,West,Store,14,8';
const profile=profileCsvText(csv,'synthetic.csv');
const file={name:'synthetic.csv',stream:()=>new Blob([csv]).stream()};
const noModel=async()=>{throw new Error('Follow-up must not call a model or graph');};
const group={kind:'group',target:'income',dimension:'region',aggregation:'mean',limit:5};
const options={useModel:true,planData:noModel,completeDataRun:noModel};

test('aggregation follow-ups preserve the prior grouping and use fresh numeric results',async()=>{
  const first=await answerWithAIPlanning(file,'Average income by region',profile,'income',options);
  const next=await answerWithAIPlanning(file,'And total?',profile,'income',{...options,previousPlan:first.planning.plan});
  assert.equal(next.planning.mode,'local');assert.equal(next.planning.contextUsed,true);
  assert.equal(next.planning.plan.dimension,'region');assert.equal(next.planning.plan.aggregation,'sum');
  assert.deepEqual(next.chart.points.map(p=>p.value),[24,4]);
  assert.ok(next.warnings.some(w=>w.includes('Follow-up interpreted as: Total income by region')));
  const fresh=await answerWithAIPlanning(file,'Total income',profile,'income',{...options,previousPlan:next.planning.plan});
  assert.match(fresh.answer,/28/);assert.equal(fresh.chart,undefined);assert.equal(fresh.planning.contextUsed,false);
});
test('date follow-ups retain observed buckets while switching sum to mean',async()=>{
  const first=await answerWithAIPlanning(file,'Show income over time',profile,'income',options);
  assert.deepEqual(first.chart.points.map(p=>p.value),[4,24]);
  const next=await answerWithAIPlanning(file,'What about the average?',profile,'income',{...options,previousPlan:first.planning.plan});
  assert.equal(next.planning.plan.kind,'timeline');
  assert.deepEqual(next.chart.points.map(p=>p.value),[2,12]);
  assert.match(next.evidence,/4 numeric target rows/);
});
test('categorical follow-ups preserve the chosen aggregation and update only the dimension',async()=>{
  const next=await answerWithAIPlanning(file,'And by channel?',profile,'income',{...options,previousPlan:group});
  assert.equal(next.planning.plan.dimension,'channel');assert.equal(next.planning.plan.aggregation,'mean');
  assert.deepEqual(next.chart.points.map(p=>p.value),[8.5,5.5]);
  const summed=resolveDataQuestionPlan('And by region?',profile,'income',{kind:'sum',target:'income'});
  assert.equal(summed.plan.aggregation,'sum');
  assert.equal(group.dimension,'region','Reusable plans are never mutated');
});
test('ranking follow-ups use the validated categorical plan and reject unsupported limits',async()=>{
  const ranked=await answerWithAIPlanning(file,'And bottom 1?',profile,'income',{...options,previousPlan:group});
  assert.equal(ranked.table[0].label,'East');assert.equal(ranked.table.length,1);
  assert.equal(ranked.planning.plan.ranking,'bottom');
  const highest=resolveDataQuestionPlan('And highest?',profile,'income',group);
  assert.equal(highest.plan.ranking,'top');assert.equal(highest.plan.limit,1);
  for(const question of ['And top 0?','And top 20?']){
    const result=resolveDataQuestionPlan(question,profile,'income',group);
    assert.equal(result.plan.kind,'unsupported');
  }
});
test('missing or incompatible context clarifies without file reads or model requests',async()=>{
  let scans=0;const untouched={...file,stream:()=>{scans++;throw new Error('must not scan');}};
  for(const previousPlan of [null,{...group,target:'spend'},{...group,sql:'SELECT secret'},{kind:'mean',target:'income',filter:'x'}]){
    const result=await answerWithAIPlanning(untouched,'And average?',profile,'income',{...options,previousPlan});
    assert.equal(result.kind,'unsupported');assert.equal(result.planning.plan,undefined);
  }
  assert.equal(scans,0);
});
test('filters, dates, unsupported inference and alternate targets never inherit into an execution',async()=>{
  let scans=0;const untouched={...file,stream:()=>{scans++;throw new Error('must not scan');}};
  for(const question of ['And average where region is East?','And total in 2026?','And forecast?','And median?','And average spend?','And over time?','And the same for West?']){
    const result=await answerWithAIPlanning(untouched,question,profile,'income',{...options,previousPlan:group});
    assert.equal(result.kind,'unsupported',question);
  }
  assert.equal(scans,0);
});
test('fully specified questions work without prior scope even when prefixed',async()=>{
  for(const question of ['And what is total income?','And total income by region?']){
    const result=await answerWithAIPlanning(file,question,profile,'income',options);
    assert.equal(result.kind,'answered',question);assert.equal(result.planning.contextUsed,false);
  }
});
test('repeat runs a new calculation instead of reusing the previous numeric answer',async()=>{
  let scans=0,current=csv;
  const changing={name:'synthetic.csv',stream:()=>{scans++;return new Blob([current]).stream();}};
  const first=await answerWithAIPlanning(changing,'Total income',profile,'income',options);
  assert.match(first.answer,/28/);
  current=csv.replace('West,Store,14,8','West,Store,20,8');
  const second=await answerWithAIPlanning(changing,'Repeat that',profile,'income',{...options,previousPlan:first.planning.plan});
  assert.match(second.answer,/34/);assert.equal(scans,2);assert.equal(second.planning.contextUsed,true);
  assert.deepEqual(Object.keys(first.planning.plan).sort(),['kind','target'],'Only the calculation plan is retained as context');
});
test('follow-up interpretation survives the existing report export snapshot',async()=>{
  const next=await answerWithAIPlanning(file,'And total?',profile,'income',{...options,previousPlan:group});
  const {title,table,calculation,evidence,warnings}=next;
  const html=createDataAnswerExport({format:'html',sourceName:'synthetic.csv',target:'income',question:'And total?',
    interpretation:'local',result:{title,answer:next.answer,table,calculation,evidence,warnings}}).content;
  assert.ok(html.includes('And total?'));assert.ok(html.includes('Follow-up interpreted as: Total income by region'));
  assert.ok(html.includes('24'));
});
test('stale local follow-ups neither scan an old file nor publish a replaced-source answer',async()=>{
  let scans=0,current=false;
  const source={...file,stream:()=>{scans++;current=false;return new Blob([csv]).stream();}};
  await assert.rejects(()=>answerWithAIPlanning(source,'And total?',profile,'income',{
    ...options,previousPlan:group,isCurrent:()=>current,
  }),/dataset changed/);
  assert.equal(scans,0);
  current=true;
  await assert.rejects(()=>answerWithAIPlanning(source,'And total?',profile,'income',{
    ...options,previousPlan:group,isCurrent:()=>current,
  }),/dataset changed/);
  assert.equal(scans,1);
});
test('scope labels describe the validated plan without including cached calculation values',()=>{
  assert.equal(describeDataPlan(group),'Mean income by region');
  assert.equal(describeDataPlan({kind:'timeline',target:'income',dateColumn:'date',aggregation:'sum'}),'Total income by date (observed dates)');
  assert.equal(describeDataPlan(null),'No active calculation');
});

test('profile-derived quality summaries are not reused as fresh numeric calculations',async()=>{
  let scans=0;const source={...file,stream:()=>{scans++;throw new Error('must not scan');}};
  const result=await answerWithAIPlanning(source,'Again',profile,'income',{
    ...options,previousPlan:{kind:'quality',target:'income'},
  });
  assert.equal(result.kind,'unsupported');assert.equal(result.planning.plan,undefined);assert.equal(scans,0);
});

test('ambiguous normalized categorical names clarify without scanning or model calls',async()=>{
  const text='sales_region,sales-region,income\nA,C,1\nB,D,3';
  const schema=profileCsvText(text,'synthetic.csv');
  let scans=0;const untouched={name:'synthetic.csv',stream:()=>{scans++;throw new Error('must not scan');}};
  const result=await answerWithAIPlanning(untouched,'And by sales region?',schema,'income',{
    ...options,previousPlan:{kind:'sum',target:'income'},
  });
  assert.equal(result.kind,'unsupported');assert.match(result.answer,/more than one column/);
  assert.equal(result.planning.plan,undefined);assert.equal(scans,0);
});
test('exact categorical names take precedence over normalized aliases',async()=>{
  for(const second of ['sales-region','sales region','sales  region']){
    const text='sales_region,'+second+',income\nA,C,1\nB,D,3';
    const schema=profileCsvText(text,'synthetic.csv');
    const source={name:'synthetic.csv',stream:()=>new Blob([text]).stream()};
    const result=await answerWithAIPlanning(source,'And by '+second+'?',schema,'income',{
      ...options,previousPlan:{kind:'mean',target:'income'},
    });
    assert.equal(result.kind,'answered');assert.equal(result.planning.plan.dimension,second);
    assert.deepEqual(result.chart.points.map(p=>p.label),['D','C']);
  }
});
test('overlapping numeric aliases cannot bypass the approved-target guard',async()=>{
  const text='region,spend_rate,spend-rate\nA,1,20\nB,3,40';
  const schema=profileCsvText(text,'synthetic.csv');
  let scans=0;const untouched={name:'synthetic.csv',stream:()=>{scans++;throw new Error('must not scan');}};
  for(const question of ['And average spend-rate?','And average spend rate?','And average spend_rate?']){
    const result=await answerWithAIPlanning(untouched,question,schema,'spend_rate',{
      ...options,previousPlan:{kind:'sum',target:'spend_rate'},
    });
    assert.equal(result.kind,'unsupported',question);assert.match(result.answer,/Another numeric field/);
    assert.equal(result.planning.plan,undefined);
  }
  assert.equal(scans,0);
});
