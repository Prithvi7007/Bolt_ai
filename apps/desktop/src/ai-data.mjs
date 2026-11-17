/** Optional schema-only interpretation; all reported numbers come from local calculation. */
import {answerDataQuestion,answerDataPlan,planDataQuestion,validateDataPlan} from './ask-data.mjs';

export function schemaPlanningRequest(question, profile, target) {
  const columns=profile.columns.map(({name,type})=>({name,type}));
  if(columns.length>256||columns.some(c=>c.name.length>160)) throw new Error('AI planning supports up to 256 columns with names under 160 characters. Use local mode for this file.');
  return {question,target,columns};
}

export async function answerWithAIPlanning(file,question,profile,target,{useModel=false,planData,onPhase=()=>{},isCurrent=()=>true}={}) {
  const localPlan=planDataQuestion(question,profile,target);
  if(!useModel||localPlan.kind!=='unsupported'||!localPlan.aiEligible){
    onPhase('calculating');
    const answer=await answerDataQuestion(file,question,profile,target);
    return {...answer,planning:{mode:'local',operation:localPlan.kind}};
  }
  if(typeof planData!=='function') throw new Error('Use the desktop application and configure a model in Settings.');
  onPhase('planning');
  const response=await planData(schemaPlanningRequest(question.trim(),profile,target));
  if(!isCurrent())throw new Error('The dataset changed. Ask again with the current dataset.');
  const plan=validateDataPlan(response?.plan,profile,target);
  onPhase('calculating');
  const answer=await answerDataPlan(file,plan,profile,target);
  const usage=Object.fromEntries(['prompt_tokens','completion_tokens','cached_tokens'].map(key=>{
    const value=response.usage?.[key];
    return [key,Number.isInteger(value)&&value>=0&&value<=1_000_000_000?value:0];
  }));
  return {...answer,planning:{mode:'model',operation:plan.kind,
    model:typeof response.model==='string'?response.model.slice(0,200):'Configured model',usage}};
}
