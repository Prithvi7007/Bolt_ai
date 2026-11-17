import {useEffect,useRef,useState, type FormEvent, type KeyboardEvent} from 'react';
import {Activity, ArrowUp, CheckCircle2, Database, FileText, Info,
  MessageSquareText, ShieldCheck, Sparkles} from 'lucide-react';
import {suggestedDataQuestions, type DataAnswer} from './ask-data.mjs';
import {answerWithAIPlanning} from './ai-data.mjs';
import type {DatasetProfile} from './dataset-understanding.mjs';
import './ask-data.css';

type Turn = {id:number; question:string; answer:DataAnswer};

const stepLabels:Record<string,string>={
  schema_validated:'Schema checked',model_planned:'Model plan prepared',plan_validated:'Plan checked',
  awaiting_local:'Local calculation requested',local_completed:'Local completion reported',
  local_failed:'Local failure reported',local_cancelled:'Calculation cancelled',
  unsupported:'No supported calculation',workflow_finished:'Workflow finished',
};
const statusLabels:Record<BoltDataWorkflow['status'],string>={
  awaiting_local:'Awaiting local calculation',unsupported:'No calculation',completed:'Completed',
  failed:'Failed',cancelled:'Cancelled',unconfirmed:'Confirmation unavailable',
};

function WorkflowCard({workflow}:{workflow:BoltDataWorkflow}) {
  return <div className="lab-data-workflow">
    <div role="status" className="lab-data-workflow-status">
      <span>Calculation workflow · LangGraph</span><strong>{statusLabels[workflow.status]}</strong>
    </div>
    <details><summary>View workflow steps</summary>
      <ol>{workflow.steps.map((step,index)=><li key={index}>{stepLabels[step]}</li>)}</ol>
      <p>The workflow records the app's execution status. Calculation evidence comes from the local CSV.</p>
    </details>
  </div>;
}

function AnswerCard({answer}: {answer:DataAnswer}) {
  return <article className={'lab-ask-answer '+(answer.kind==='unsupported'?'lab-ask-unsupported':'')} aria-label="Calculated dataset answer">
    <div className="lab-ask-answer-title">
      {answer.kind==='answered'?<CheckCircle2 size={17}/>:<Info size={17}/>}
      <strong>{answer.title}</strong>
    </div>
    {answer.planning&&<p className="lab-ask-planning">{answer.planning.mode==='model'?
      'AI interpretation: '+answer.planning.operation+' · '+(answer.kind==='answered'?'calculated on-device':'no calculation executed')+
      ' · '+((answer.planning.usage?.prompt_tokens||0)+(answer.planning.usage?.completion_tokens||0))+' reported tokens':
      'Local interpretation · no model call'}</p>}
    {answer.planning?.workflow&&<WorkflowCard workflow={answer.planning.workflow}/>}
    <p className="lab-ask-primary">{answer.answer}</p>
    {answer.table.length>0 && <div className="lab-ask-table-scroll"><table>
      <thead><tr><th>Value / category</th><th>Calculated result</th><th>Evidence</th></tr></thead>
      <tbody>{answer.table.map((row,index)=><tr key={index}>
        <td title={row.label}>{row.label}</td><td>{row.value}</td><td>{row.detail}</td>
      </tr>)}</tbody>
    </table></div>}
    {answer.calculation && <div className="lab-ask-proof">
      <FileText size={15}/><div><b>Calculation</b><span>{answer.calculation}</span></div>
    </div>}
    {answer.evidence && <p className="lab-ask-evidence"><Database size={14}/>{answer.evidence}</p>}
    {answer.warnings.length>0 && <details className="lab-ask-caveats">
      <summary>Methodology and caveats ({answer.warnings.length})</summary>
      <ul>{answer.warnings.map((item,index)=><li key={index}>{item}</li>)}</ul>
    </details>}
  </article>;
}

export default function AskYourData({file, profile, target}:{file:File;profile:DatasetProfile;target:string}) {
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const [useModel,setUseModel]=useState(false);
  const [phase,setPhase]=useState<'planning'|'calculating'|'confirming'>('calculating');
  const [question,setQuestion]=useState('');
  const [turns,setTurns]=useState<Turn[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const questions=suggestedDataQuestions(profile,target);
  async function submit(value:string) {
    const q=value.trim();
    if (busy || !q) return;
    setQuestion('');
    setError('');
    setBusy(true);
    try {
      const answer=await answerWithAIPlanning(file,q,profile,target,{
        useModel,planData:window.boltApi?.planData,completeDataRun:window.boltApi?.completeDataRun,
        onPhase:setPhase,isCurrent:()=>alive.current,
      });
      if(!alive.current)return;
      setTurns(old=>[...old,{id:old.length?old[old.length-1].id+1:1,question:q,answer}].slice(-12));
    } catch(cause) {
      if(alive.current){setQuestion(q);setError(cause instanceof Error?cause.message:'Local calculation failed');}
    } finally {
      if(alive.current)setBusy(false);
    }
  }
  function onSubmit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(question);
  }
  function onKeyDown(event:KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit(question);
    }
  }
  return <section className="lab-ask" aria-label="Ask questions about the imported dataset">
    <div className="lab-panel-title"><span>06 / ASK YOUR DATA</span>
      <h3><MessageSquareText size={18}/> Ask a question. See the calculation.</h3></div>
    <p className="lab-target-description">BOLT calculates answers about your <strong>{target}</strong> from the actual CSV. Familiar questions run locally. You can enable AI to interpret an unfamiliar question into one of the same local calculations.</p>
    <label className="lab-ai-choice"><input type="checkbox" checked={useModel} disabled={busy||!window.boltApi?.planData} onChange={event=>setUseModel(event.target.checked)}/> Use AI for unfamiliar questions</label>
    <p className="lab-table-note">{useModel?'When needed, this sends your question, approved target, and column names/types to the model configured in Settings. CSV rows, example values and filenames are not sent.':'AI planning is off. Questions and CSV data stay local.'}</p>
    <div className="lab-ask-capabilities"><span><ShieldCheck size={14}/> Local data only</span><span><Activity size={14}/> Reproducible formulas</span><span><Sparkles size={14}/> {useModel?'AI assistance enabled':'No model calls'}</span></div>
    {turns.length===0 && <div className="lab-ask-examples">
      <p>TRY A QUESTION</p>
      <div>{questions.map((q,index)=><button type="button" key={index} disabled={busy} onClick={()=>void submit(q)}>{q}</button>)}</div>
    </div>}
    {turns.length>0&&<div className="lab-ask-transcript" aria-label="Recent local analysis questions">
      {turns.map(turn=><div className="lab-ask-turn" key={turn.id}>
        <p className="lab-ask-user">{turn.question}</p>
        <AnswerCard answer={turn.answer}/>
      </div>)}
    </div>}
    {error&&<div role="alert" className="lab-error"><Info size={16}/>{error}</div>}
    {busy&&<p role="status" className="lab-ask-running"><Activity size={15}/> {phase==='planning'?'Interpreting the question from column names and types…':phase==='confirming'?'Confirming the workflow after local calculation…':'Reading the local CSV and calculating your answer…'}</p>}
    <form onSubmit={onSubmit} className="lab-ask-composer">
      <textarea rows={2} value={question} maxLength={400} disabled={busy}
        onChange={event=>setQuestion(event.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Ask about the approved CSV target"
        placeholder={'For example: What is the average '+target+' by region?'}
      />
      <div><small>Supported: summaries, group totals, rankings, trends, missingness, correlations. No filters, forecasts or causal claims. Enter to send · Shift+Enter for a new line.</small>
        <button type="submit" disabled={busy||!question.trim()} aria-label="Calculate CSV answer"><ArrowUp size={18}/> Calculate</button></div>
    </form>
    <p className="lab-ask-bottom"><ShieldCheck size={13}/> Only approved-target calculations. Answers stay in this app session. AI planning, when enabled and needed, shares schema and the question through your personal model connection.</p>
  </section>;
}
