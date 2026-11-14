import {useEffect, useState, type FormEvent, type KeyboardEvent} from 'react';
import {Activity, ArrowUp, BarChart3, Check, ChevronDown, CircleHelp, Clock3, Database,
        FileText, Layers, MessageSquareText, PanelRightClose, PanelRightOpen, Plus,
        Sparkles, Table2, TerminalSquare, Zap} from 'lucide-react';

type Evidence = {source:string; query_id:string; sql:string; parameters:Record<string,string>;
  metric_id:string; row_count:number; is_synthetic:boolean};
type Data = {columns:string[]; rows: Record<string,string|number>[]};
type Chart = {type:'line'|'bar';title:string;labels:string[];values:number[];unit:string};
type Reply = {status:'ok'|'unsupported'|'no_data';answer:string;evidence:Evidence|null;
  data:Data|null;chart:Chart|null;cost:{prompt_tokens:number;completion_tokens:number;context_characters:number};limitations:string[]};
type Turn = {role:'user'|'assistant';body:string;payload:Reply|null;created_at:string};
type Session = {session_id:string;created_at:string};
const API=import.meta.env.VITE_BOLT_API_URL || 'http://127.0.0.1:8787';
const EXAMPLES=['Show monthly revenue trend over the last 12 months',
                'Break down 2026 revenue by channel',
                'Compare in-state and out-of-state revenue'];

async function request<T>(path:string,init?:RequestInit):Promise<T>{
  if (window.boltApi) {
    // Authenticated Electron IPC: renderer never receives the backend port or token.
    const reply=await window.boltApi.request(path,{
      method:init?.method === 'POST' ? 'POST' : 'GET',
      ...(typeof init?.body === 'string' ? {body:init.body} : {})
    });
    if(!reply.ok) throw new Error(`API request failed (${reply.status})`);
    return reply.data as T;
  }
  if (window.location.protocol === 'file:') {
    throw new Error('Authenticated desktop API bridge is unavailable');
  }
  // Browser development mode retains explicit loopback-only access.
  const response=await fetch(`${API}${path}`,{...init,headers:{'Content-Type':'application/json',...(init?.headers||{})}});
  if(!response.ok) throw new Error(`API request failed (${response.status})`);
  return response.json() as Promise<T>;
}
function formatUSD(v:number){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v);}

function ResultChart({chart}:{chart:Chart}){
  const max=Math.max(...chart.values,1);
  const values=chart.values;
  if(chart.type==='bar') return <div className="bars" role="img" aria-label={`${chart.title}. ${chart.labels.map((s,i)=>`${s}: ${formatUSD(values[i])}`).join('; ')}`}>
    {chart.labels.map((name,i)=><div className="bar-row" key={name}>
      <span className="bar-label">{name}</span>
      <div className="bar-track"><span className="bar-fill" style={{width:`${100*values[i]/max}%`}} /></div>
      <span className="bar-value">{formatUSD(values[i])}</span>
    </div>)}
  </div>;
  const points=values.map((v,i)=>[24+(i*618/Math.max(1,values.length-1)),170-140*v/max]);
  const line=points.map(([x,y])=>`${x},${y}`).join(' ');
  return <svg className="line-chart" role="img" aria-label={`${chart.title}. Revenue ranges from ${formatUSD(Math.min(...values))} to ${formatUSD(max)}`} viewBox="0 0 670 210" preserveAspectRatio="xMidYMid meet">
    {[30,65,100,135,170].map(y=><line key={y} x1="24" x2="650" y1={y} y2={y} stroke="#35425D" strokeWidth="1" strokeDasharray="4 5" />)}
    <polygon points={`24,174 ${line} 642,174`} fill="#3B82F6" opacity=".08" />
    <polyline points={line} stroke="#60A5FA" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    {points.map(([x,y],i)=><circle key={i} cx={x} cy={y} r="3" fill="#FBBF24" />)}
    <text x="24" y="199" fill="#9DACBF" fontSize="13">{chart.labels[0]}</text>
    <text x="640" y="199" fill="#9DACBF" fontSize="13" textAnchor="end">{chart.labels[chart.labels.length-1]}</text>
  </svg>;
}

export default function App(){
  const [sessions,setSessions]=useState<Session[]>([]);
  const [sid,setSid]=useState<string>('');
  const [turns,setTurns]=useState<Turn[]>([]);
  const [question,setQuestion]=useState('');
  const [busy,setBusy]=useState(false);
  const [healthy,setHealthy]=useState<'checking'|'online'|'offline'>('checking');
  const [error,setError]=useState<string>('');
  const [tab,setTab]=useState<'sql'|'data'|'details'>('sql');
  const [showInspector,setShowInspector]=useState(true);
  const [selectedReply,setSelectedReply]=useState<Reply|null>(null);
  const answers=turns.filter(t=>t.role==='assistant' && t.payload?.status==='ok');
  const latest=selectedReply || answers.at(-1)?.payload || null;
  const currentEvidence=latest?.evidence || null;

  async function openSession(id:string){
    const history=await request<{turns:Turn[]}>(`/v1/sessions/${id}/turns`);
    setSid(id);setTurns(history.turns);setSelectedReply(null);setError('');
  }
  async function createSession(){
    const item=await request<{session_id:string}>('/v1/sessions',{method:'POST'});
    setSessions(prev=>[{session_id:item.session_id,created_at:new Date().toISOString()},...prev]);
    setSid(item.session_id);setTurns([]);setSelectedReply(null);setError('');setTab('sql');
  }
  useEffect(()=>{
    let live=true;
    (async()=>{
      try{
        const status=await request<{mode:string}>('/health');
        if(!live)return;
        if(status.mode!=='synthetic') throw new Error('Unexpected API mode');
        setHealthy('online');
        const result=await request<{sessions:Session[]}>('/v1/sessions');
        if(!live)return;
        setSessions(result.sessions);
        if(result.sessions[0]) await openSession(result.sessions[0].session_id);
        else await createSession();
      }catch(e){if(live){setHealthy('offline');setError('The BOLT local service is offline. Restart the application and try again.')}}
    })();
    return ()=>{live=false;};
  },[]);
  async function submit(text:string){
    if(!sid||busy||!text.trim()||healthy!=='online')return;
    const clean=text.trim();setQuestion('');setBusy(true);setError('');
    setTurns(prev=>[...prev,{role:'user',body:clean,payload:null,created_at:new Date().toISOString()}]);
    try{
      const reply=await request<Reply>('/v1/chat',{method:'POST',body:JSON.stringify({session_id:sid,question:clean})});
      setTurns(prev=>[...prev,{role:'assistant',body:reply.answer,payload:reply,created_at:new Date().toISOString()}]);
      setSelectedReply(null);setTab('sql');
    }catch(e){setError('Unable to complete that query. The server may be unavailable.');setHealthy('offline');}
    finally{setBusy(false);}
  }
  function submitForm(event:FormEvent){event.preventDefault();void submit(question);}
  function onComposerKey(event:KeyboardEvent<HTMLTextAreaElement>){
    if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();void submit(question);}
  }
  return <div className="app-shell">
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="brand"><span className="brand-symbol"><Zap size={20} fill="currentColor"/></span><div><strong>BOLT</strong><small>INTELLIGENCE</small></div></div>
      <button className="new-chat" onClick={()=>void createSession()}><Plus size={16}/> New conversation</button>
      <div className="sidebar-section-title">WORKSPACE</div>
      <div className="nav-active"><MessageSquareText size={17}/> Analyst <span className="nav-tag">01</span></div>
      <div className="nav-text"><BarChart3 size={17}/> Insights <span className="muted-small">Next slice</span></div>
      <div className="nav-text"><Layers size={17}/> Presentations <span className="muted-small">Next slice</span></div>
      <div className="sidebar-section-title past-title">RECENT SESSIONS</div>
      <nav className="sessions" aria-label="Past conversations">
        {sessions.map(s=><button key={s.session_id} onClick={()=>void openSession(s.session_id)} className={`session-button ${sid===s.session_id?'selected':''}`}>
          <Clock3 size={14}/> <span>Conversation {s.session_id.slice(0,6)}</span>
        </button>)}
      </nav>
      <div className="sidebar-footer"><span className="status-light"/> Synthetic sandbox <span className="version">v0.1</span></div>
    </aside>
    <div className="main-column">
      <header className="topbar"><div className="crumb"><span>Workspace</span><span className="crumb-sep">/</span><strong>AI Analyst</strong><ChevronDown size={13}/></div>
        <div className="top-actions"><span className="chip"><Database size={14}/> Demo dataset</span><span className="chip"><Activity size={14}/> 0 LLM tokens</span><button className="icon-button" aria-label={showInspector?'Hide inspector':'Show inspector'} onClick={()=>setShowInspector(!showInspector)}>{showInspector?<PanelRightClose size={19}/>:<PanelRightOpen size={19}/>}</button></div>
      </header>
      <main className="conversation" aria-label="BOLT analyst conversation">
        {turns.length===0&&<section className="welcome"><div className="welcome-symbol"><Zap size={30} fill="currentColor"/></div>
          <p className="eyebrow">YOUR AI DATA ANALYST</p><h1>Ask anything about your data.</h1>
          <p className="lead">Go from questions to evidence-backed insights in one conversation. Start with synthetic revenue data; enterprise connections come later.</p>
          <div className="example-list">{EXAMPLES.map((x,i)=><button key={x} className="example" onClick={()=>void submit(x)}><span className="example-number">0{i+1}</span><span>{x}</span><ArrowUp size={15}/></button>)}</div>
        </section>}
        {turns.length>0&&<div className="turn-list">{turns.map((turn,i)=><section key={i} className={`turn ${turn.role}`} aria-label={turn.role==='user'?'Your message':'BOLT answer'}>
          <div className="turn-icon">{turn.role==='user'?'YOU':<Zap size={16} fill="currentColor" />}</div>
          <div className="turn-body"><div className="turn-meta">{turn.role==='user'?'You':'BOLT'} <span>{turn.role==='assistant'?'· Synthetic analysis':''}</span></div>
            <p>{turn.body}</p>
            {turn.payload?.chart&&<div className="result-chart"><div className="chart-head"><div><span className="eyebrow">VERIFIED DEMO RESULT</span><strong>{turn.payload.chart.title}</strong></div><span className="chart-chip">{turn.payload.data?.rows.length} groups</span></div><ResultChart chart={turn.payload.chart}/>
              <div className="chart-footer"><span><Check size={14}/> Query executed</span><button onClick={()=>{setSelectedReply(turn.payload);setTab('sql');setShowInspector(true)}}>View SQL <ArrowUp size={13}/></button></div></div>}
            {turn.payload?.status==='unsupported'&&<span className="notice">No query executed · Supported: synthetic revenue</span>}
          </div>
        </section>)}</div>}
        {busy&&<div className="loading" role="status"><span className="pulse"/> Validating query and calculating results…</div>}
        {error&&<div className="error-notice" role="alert">{error}</div>}
      </main>
      <div className="composer-area"><form className="composer" onSubmit={submitForm}><textarea value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={onComposerKey}
        aria-label="Ask BOLT a question" placeholder="Ask a follow-up question..." rows={2} disabled={busy||healthy!=='online'}/>
        <div className="composer-bottom"><span><Sparkles size={14}/> Read-only demo analytics · Ctrl+Enter to send</span><button type="submit" className="send-button" disabled={busy||!question.trim()||healthy!=='online'} aria-label="Send question"><ArrowUp size={19}/></button></div></form>
        <div className="composer-disclaimer">BOLT prototype · Synthetic data only · No Snowflake or LLM connection</div>
      </div>
    </div>
    {showInspector&&<aside className="inspector" aria-label="Evidence inspector">
      <div className="inspector-header"><div><span className="eyebrow">SELECTED QUERY EVIDENCE</span><strong>Evidence inspector</strong></div><CircleHelp size={17}/></div>
      <div className="inspector-tabs" role="tablist" aria-label="Evidence tabs">
        <button role="tab" aria-selected={tab==='sql'} className={tab==='sql'?'active':''} onClick={()=>setTab('sql')}><TerminalSquare size={14}/> SQL</button>
        <button role="tab" aria-selected={tab==='data'} className={tab==='data'?'active':''} onClick={()=>setTab('data')}><Table2 size={14}/> Data</button>
        <button role="tab" aria-selected={tab==='details'} className={tab==='details'?'active':''} onClick={()=>setTab('details')}><FileText size={14}/> Details</button>
      </div>
      <div className="inspector-content">
        {currentEvidence?<>
          {tab==='sql'&&<><div className="evidence-label">EXECUTED QUERY</div><pre className="sql"><code>{currentEvidence.sql}</code></pre><div className="evidence-label">BOUND PARAMETERS</div><pre className="sql"><code>{JSON.stringify(currentEvidence.parameters,null,2)}</code></pre></>}
          {tab==='data'&&latest?.data&&<div className="data-table-wrapper"><table><thead><tr>{latest.data.columns.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{latest.data.rows.map((r,i)=><tr key={i}>{latest.data!.columns.map(c=><td key={c}>{typeof r[c]==='number'?formatUSD(Number(r[c])):r[c]}</td>)}</tr>)}</tbody></table></div>}
          {tab==='details'&&<div className="details-grid"><div>Source<strong>{currentEvidence.source}</strong></div><div>Metric<strong>{currentEvidence.metric_id}</strong></div><div>Rows<strong>{currentEvidence.row_count}</strong></div><div>Query ID<strong className="mono">{currentEvidence.query_id}</strong></div><div>Model calls<strong>0 (deterministic demo)</strong></div></div>}
        </>:<div className="empty-inspector"><Database size={30}/><strong>Nothing to inspect yet</strong><p>Run a supported question to see the exact SQL, bound parameters and calculated results.</p></div>}
      </div>
      <div className="inspector-footer"><span className={`connection-dot ${healthy}`}/><span>{healthy==='online'?'Synthetic API online':healthy==='offline'?'API unavailable':'Checking API...'}</span><span className="mono">127.0.0.1</span></div>
    </aside>}
  </div>;
}
