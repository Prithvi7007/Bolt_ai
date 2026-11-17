import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {profileCsvText} from './dataset-understanding.mjs';
import {answerWithAIPlanning,schemaPlanningRequest} from './ai-data.mjs';
import {validateDataPlan} from './ask-data.mjs';
const require=createRequire(import.meta.url);
const {validateDataPlanningRequest,validateRequest}=require('../electron/runtime.cjs');
const csv='date,region,spend,income\n2026-01,PrivateEast,1,10\n2026-01,PrivateEast,2,20\n2026-02,PrivateWest,3,30\n2026-02,PrivateWest,4,40';
const profile=profileCsvText(csv,'private-name.csv');
const file={name:'private-name.csv',stream:()=>new Blob([csv]).stream()};
const target='income';
const question='Give me a quick snapshot of income';

test('only schema descriptors and the question leave the renderer',async()=>{
  let sent;
  const result=await answerWithAIPlanning(file,question,profile,target,{
    useModel:true,planData:async input=>{sent=input;return {plan:{kind:'sum',target},model:'personal',usage:{prompt_tokens:5,completion_tokens:3}};},
  });
  assert.equal(result.kind,'answered');
  assert.match(result.answer,/100/);
  assert.match(result.evidence,/4 numeric target rows/);
  assert.equal(result.planning.mode,'model');
  assert.deepEqual(Object.keys(sent).sort(),['columns','question','target']);
  const payload=JSON.stringify(sent);
  for(const privateValue of ['private-name','PrivateEast','PrivateWest','2026-01','preview','examples','rows']) assert.equal(payload.includes(privateValue),false,privateValue);
  assert.deepEqual(validateDataPlanningRequest(sent),sent);
});
test('model planning is opt-in and deterministic questions avoid a model call',async()=>{
  let calls=0;
  const planData=async()=>{calls++;throw new Error('must not call');};
  const local=await answerWithAIPlanning(file,'What is total income?',profile,target,{useModel:true,planData});
  assert.match(local.answer,/100/);
  assert.equal(local.planning.mode,'local');
  const unknown=await answerWithAIPlanning(file,question,profile,target,{useModel:false,planData});
  assert.equal(unknown.kind,'unsupported');
  assert.equal(calls,0);
});
test('known unsupported inference and filtering never reach the model',async()=>{
  let calls=0;
  for(const q of ['Forecast income next year','Why did income fall?','income in 2026','total spend','income where region is PrivateEast']){
    const answer=await answerWithAIPlanning(file,q,profile,target,{useModel:true,planData:async()=>{calls++;}});
    assert.equal(answer.kind,'unsupported',q);
  }
  assert.equal(calls,0);
});
test('a hallucinated or executable plan cannot read the CSV',async()=>{
  let scanned=0;
  const untouched={...file,stream:()=>{scanned++;throw new Error('should not scan');}};
  for(const plan of [
    {kind:'sum',target:'spend'},
    {kind:'sum',target,sql:'SELECT secret'},
    {kind:'sum',target,filter:'region = x'},
    {kind:'forecast',target},
    {kind:'group',target,dimension:'spend',aggregation:'sum'},
    {kind:'group',target,dimension:'region',aggregation:'sum',limit:true},
  ]) await assert.rejects(()=>answerWithAIPlanning(untouched,question,profile,target,{
    useModel:true,planData:async()=>({plan,usage:{}}),
  }));
  assert.equal(scanned,0);
});
test('validated model plans reuse real group, timeline and correlation calculations',async()=>{
  const plans=[
    {kind:'group',target,dimension:'region',aggregation:'mean',ranking:'top',limit:1},
    {kind:'timeline',target,dateColumn:'date',aggregation:'sum'},
    {kind:'correlation',target,predictor:'spend'},
  ];
  const answers=[];
  for(const plan of plans)answers.push(await answerWithAIPlanning(file,question,profile,target,{
    useModel:true,planData:async()=>({plan,model:'personal',usage:{}}),
  }));
  assert.match(answers[0].answer,/PrivateWest.*35/);
  assert.match(answers[1].answer,/30.*70/);
  assert.match(answers[2].answer,/r = 1/);
});
test('unsupported model intent produces no fabricated statistics',async()=>{
  const answer=await answerWithAIPlanning(file,question,profile,target,{
    useModel:true,planData:async()=>({plan:{kind:'unsupported',target,reason:'Please specify a calculation.'},usage:{}}),
  });
  assert.equal(answer.kind,'unsupported');
  assert.equal(answer.evidence,null);
});
test('IPC rejects rows, previews and extra column fields',()=>{
  const request=schemaPlanningRequest(question,profile,target);
  for(const extra of [{rows:[['secret']]},{preview:['secret']},{filename:'secret.csv'}]){
    assert.throws(()=>validateDataPlanningRequest({...request,...extra}));
  }
  assert.throws(()=>validateDataPlanningRequest({...request,columns:[{name:'income',type:'numeric',examples:['secret']}]}));
  assert.throws(()=>validateRequest('/_desktop/data/plan',{method:'POST',body:'{}'}));
  assert.throws(()=>validateDataPlan({kind:'timeline',target,dateColumn:'region',aggregation:'sum'},profile,target));
});

test('a stale model interpretation does not scan a replaced dataset',async()=>{
  let current=true,scans=0;
  const source={...file,stream:()=>{scans++;throw new Error('must not scan');}};
  await assert.rejects(()=>answerWithAIPlanning(source,question,profile,target,{
    useModel:true,isCurrent:()=>current,
    planData:async()=>{current=false;return {plan:{kind:'sum',target},usage:{}};},
  }),/dataset changed/);
  assert.equal(scans,0);
});

test('model clarification text cannot invent an uncalculated finding',async()=>{
  const answer=await answerWithAIPlanning(file,question,profile,target,{
    useModel:true,planData:async()=>({plan:{kind:'unsupported',target,reason:'Your total income is 999999.'},usage:{}}),
  });
  assert.equal(answer.kind,'unsupported');
  assert.equal(answer.evidence,null);
  assert.equal(answer.answer.includes('999999'),false);
});
