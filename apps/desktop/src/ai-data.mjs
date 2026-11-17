/** Optional schema-only interpretation; all reported numbers come from local calculation. */
import {answerDataQuestion,answerDataPlan,planDataQuestion,validateDataPlan} from './ask-data.mjs';

export function schemaPlanningRequest(question, profile, target) {
  const columns=profile.columns.map(({name,type})=>({name,type}));
  if(columns.length>256||columns.some(c=>c.name.length>160)) throw new Error('AI planning supports up to 256 columns with names under 160 characters. Use local mode for this file.');
  return {question,target,columns};
}

const workflowSteps=new Set(['schema_validated','model_planned','plan_validated','awaiting_local',
  'local_completed','local_failed','local_cancelled','unsupported','workflow_finished']);
function checkedWorkflow(value) {
  if(!value||value.engine!=='langgraph'||typeof value.run_id!=='string'||!/^[a-f0-9]{32}$/.test(value.run_id)
    ||!['awaiting_local','unsupported','completed','failed','cancelled'].includes(value.status)
    ||value.awaiting_local!==(value.status==='awaiting_local')
    ||!Array.isArray(value.steps)||value.steps.length>10||!value.steps.every(step=>workflowSteps.has(step))) {
    throw new Error('Invalid local workflow response. Ask again to start a new calculation.');
  }
  return {engine:'langgraph',run_id:value.run_id,status:value.status,steps:[...value.steps],awaiting_local:value.awaiting_local};
}
const staleError=()=>new Error('The dataset changed. Ask again with the current dataset.');

export async function answerWithAIPlanning(file,question,profile,target,{useModel=false,planData,completeDataRun,onPhase=()=>{},isCurrent=()=>true}={}) {
  const localPlan=planDataQuestion(question,profile,target);
  if(!useModel||localPlan.kind!=='unsupported'||!localPlan.aiEligible){
    onPhase('calculating');
    const answer=await answerDataQuestion(file,question,profile,target);
    return {...answer,planning:{mode:'local',operation:localPlan.kind}};
  }
  if(typeof planData!=='function') throw new Error('Use the desktop application and configure a model in Settings.');
  onPhase('planning');
  const response=await planData(schemaPlanningRequest(question.trim(),profile,target));
  // The legacy schema-only planner has no graph receipt; current desktop runs do.
  let workflow=response?.workflow===undefined?undefined:checkedWorkflow(response.workflow);
  const record=async status=>{
    if(workflow?.awaiting_local&&typeof completeDataRun==='function') {
      return completeDataRun({run_id:workflow.run_id,status});
    }
  };
  let plan,answer;
  try {
    if(!isCurrent())throw staleError();
    plan=validateDataPlan(response?.plan,profile,target);
    if(workflow) {
      if(workflow.status!==(plan.kind==='unsupported'?'unsupported':'awaiting_local'))throw new Error('The workflow is not ready for this calculation.');
      if(workflow.awaiting_local&&typeof completeDataRun!=='function')throw new Error('Restart the desktop app to enable local workflow confirmation.');
    }
    onPhase('calculating');
    answer=await answerDataPlan(file,plan,profile,target);
    if(!isCurrent())throw staleError();
  } catch(error) {
    try {await record(isCurrent()?'failed':'cancelled');} catch { /* Expiry or disconnect must not obscure the original local error. */ }
    throw error;
  }
  if(workflow?.awaiting_local) {
    onPhase('confirming');
    try {
      const result=await record('completed');
      const confirmed=checkedWorkflow(result?.workflow);
      if(confirmed.run_id!==workflow.run_id||confirmed.status!=='completed')throw new Error('Mismatched workflow confirmation');
      workflow=confirmed;
    } catch {
      // A receipt may have reached the graph even if the response was lost. Never submit a contradictory receipt.
      workflow={...workflow,status:'unconfirmed',awaiting_local:false};
      answer={...answer,warnings:[...answer.warnings,'Workflow confirmation is unavailable. The answer above was calculated locally; the calculation was not repeated.']};
    }
  }
  if(!isCurrent())throw staleError();
  const usage=Object.fromEntries(['prompt_tokens','completion_tokens','cached_tokens'].map(key=>{
    const value=response.usage?.[key];
    return [key,Number.isInteger(value)&&value>=0&&value<=1_000_000_000?value:0];
  }));
  return {...answer,planning:{mode:'model',operation:plan.kind,
    model:typeof response.model==='string'?response.model.slice(0,200):'Configured model',usage,...(workflow?{workflow}:{})}};
}
