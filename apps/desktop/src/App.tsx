import {useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode} from 'react';
import {Activity, ArrowUp, BarChart3, Check, ChevronDown, CircleHelp, Clock3, Database,
        Download, FileText, Folder, HardDrive, Image, Layers, MessageSquareText,
        PanelRightClose, PanelRightOpen, Plus, Search, Settings, Sparkles, Table2,
        TerminalSquare, Zap} from 'lucide-react';
import DatasetLab from './DatasetLab';
import ModelSettingsPanel from './ModelSettingsPanel';
import './sidebar-workspace.css';

type Evidence = {source:string;query_id:string;sql:string;parameters:Record<string,string>;
  metric_id:string;row_count:number;is_synthetic:boolean;freshness?:string;role?:string};
type Data = {columns:string[];rows:Record<string,string|number>[]};
type Chart = {type:'line'|'bar';title:string;labels:string[];values:number[];unit:string};
type Reply = {status:'ok'|'unsupported'|'no_data';answer:string;evidence:Evidence|null;
  data:Data|null;chart:Chart|null;cost:{prompt_tokens:number;completion_tokens:number;context_characters:number};limitations:string[]};
type Turn = {role:'user'|'assistant';body:string;payload:Reply|null;created_at:string};
type Session = {session_id:string;created_at:string};
type Health = {mode:'synthetic'|'enterprise';version:string;snowflake_connected:boolean;llm_connected:boolean;llm_configured?:boolean;
  capabilities:Record<string,boolean>};
type Metric = {metric_id:string;name:string;description:string;unit:string;dimensions:string[]};
type Artifact = {artifact_id:string;session_id?:string;filename:string;size_bytes:number;slide_count:number;
  kind?:'presentation'|'chart';mime_type?:string;extension?:string;created_at?:string};
type CollectionItem = {session_id:string;result_ref:string;title:string;created_at:string};
type Collection = {collection_id:string;name:string;created_at:string;items:CollectionItem[]};
type DataSource = {source_id:string;name:string;mode:string;connected:boolean;read_only:boolean};
type MemoryResult = {kind:string;reference:string;session_id?:string;summary:string};
type Workspace = 'analyst'|'data'|'explore'|'present'|'collections'|'sources'|'artifacts'|'settings';

const API=import.meta.env.VITE_BOLT_API_URL || 'http://127.0.0.1:8787';
const EXAMPLES=['Show monthly revenue trend over the last 12 months',
                'Break down 2026 revenue by channel',
                'Compare in-state and out-of-state revenue'];
const WORKSPACE_LABELS:Record<Workspace,string>={
  analyst:'AI Analyst',data:'Data Lab',explore:'Explore',present:'Present',
  collections:'Collections',sources:'Data Sources',artifacts:'Artifacts',settings:'Settings'
};

async function request<T>(path:string,init?:RequestInit):Promise<T>{
  if(window.boltApi){
    const reply=await window.boltApi.request(path,{
      method:init?.method==='POST'?'POST':'GET',
      ...(typeof init?.body==='string'?{body:init.body}:{})
    });
    if(!reply.ok)throw new Error(`API request failed (${reply.status})`);
    return reply.data as T;
  }
  if(window.location.protocol==='file:')throw new Error('Authenticated desktop API bridge is unavailable');
  const response=await fetch(`${API}${path}`,{...init,headers:{'Content-Type':'application/json',...(init?.headers||{})}});
  if(!response.ok)throw new Error(`API request failed (${response.status})`);
  if(response.status===204)return undefined as T;
  return response.json() as Promise<T>;
}

function formatUSD(value:number){
  return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value);
}

function ResultChart({chart}:{chart:Chart}){
  const max=Math.max(...chart.values,1);
  if(chart.type==='bar')return <div className="bars" role="img" aria-label={`${chart.title}. ${chart.labels.map((label,index)=>`${label}: ${formatUSD(chart.values[index])}`).join('; ')}`}>
    {chart.labels.map((name,index)=><div className="bar-row" key={name}>
      <span className="bar-label">{name}</span>
      <div className="bar-track"><span className="bar-fill" style={{width:`${100*chart.values[index]/max}%`}}/></div>
      <span className="bar-value">{formatUSD(chart.values[index])}</span>
    </div>)}
  </div>;
  const points=chart.values.map((value,index)=>[24+(index*618/Math.max(1,chart.values.length-1)),170-140*value/max]);
  const line=points.map(([x,y])=>`${x},${y}`).join(' ');
  return <svg className="line-chart" role="img" aria-label={chart.title} viewBox="0 0 670 210" preserveAspectRatio="xMidYMid meet">
    {[30,65,100,135,170].map(y=><line key={y} x1="24" x2="650" y1={y} y2={y} stroke="#35425D" strokeWidth="1" strokeDasharray="4 5"/>)}
    <polygon points={`24,174 ${line} 642,174`} fill="#3B82F6" opacity=".08"/>
    <polyline points={line} stroke="#60A5FA" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    {points.map(([x,y],index)=><circle key={index} cx={x} cy={y} r="3" fill="#FBBF24"/>)}
    <text x="24" y="199" fill="#9DACBF" fontSize="13">{chart.labels[0]}</text>
    <text x="640" y="199" fill="#9DACBF" fontSize="13" textAnchor="end">{chart.labels.at(-1)}</text>
  </svg>;
}

export default function App(){
  const [workspace,setWorkspace]=useState<Workspace>('analyst');
  const [sessions,setSessions]=useState<Session[]>([]);
  const [sid,setSid]=useState('');
  const [turns,setTurns]=useState<Turn[]>([]);
  const [question,setQuestion]=useState('');
  const [busy,setBusy]=useState(false);
  const [healthy,setHealthy]=useState<'checking'|'online'|'offline'>('checking');
  const [error,setError]=useState('');
  const [healthInfo,setHealthInfo]=useState<Health|null>(null);
  const [catalog,setCatalog]=useState<Metric[]>([]);
  const [artifacts,setArtifacts]=useState<Artifact[]>([]);
  const [allArtifacts,setAllArtifacts]=useState<Artifact[]>([]);
  const [collections,setCollections]=useState<Collection[]>([]);
  const [dataSources,setDataSources]=useState<DataSource[]>([]);
  const [preferences,setPreferences]=useState<Record<string,unknown>>({});
  const [memoryQuery,setMemoryQuery]=useState('');
  const [memoryResults,setMemoryResults]=useState<MemoryResult[]>([]);
  const [collectionName,setCollectionName]=useState('');
  const [defaultMetric,setDefaultMetric]=useState('revenue');
  const [eraseConfirmation,setEraseConfirmation]=useState('');
  const [presentationTitle,setPresentationTitle]=useState('Leadership analysis brief');
  const [artifactBusy,setArtifactBusy]=useState(false);
  const [tab,setTab]=useState<'sql'|'data'|'evidence'|'artifact'>('sql');
  const [showInspector,setShowInspector]=useState(true);
  const [selectedReply,setSelectedReply]=useState<Reply|null>(null);
  const answers=turns.filter(turn=>turn.role==='assistant'&&turn.payload?.status==='ok');
  const latest=selectedReply || answers.at(-1)?.payload || null;
  const currentEvidence=latest?.evidence||null;
  const sessionTokens=answers.reduce((total,turn)=>total+(turn.payload?.cost.prompt_tokens||0)+(turn.payload?.cost.completion_tokens||0),0);

  async function openSession(id:string){
    const history=await request<{turns:Turn[]}>(`/v1/sessions/${id}/turns`);
    setSid(id);setTurns(history.turns);setSelectedReply(null);setError('');
  }
  async function createSession(){
    const item=await request<{session_id:string}>('/v1/sessions',{method:'POST'});
    setSessions(previous=>[{session_id:item.session_id,created_at:new Date().toISOString()},...previous]);
    setSid(item.session_id);setTurns([]);setSelectedReply(null);setError('');setTab('sql');
  }
  async function refreshArtifacts(sessionId=sid){
    if(!sessionId)return;
    const result=await request<{artifacts:Artifact[]}>(`/v1/artifacts?session_id=${sessionId}`);
    setArtifacts(result.artifacts);
  }
  async function refreshAllArtifacts(){
    const result=await request<{artifacts:Artifact[]}>('/v1/artifacts/all');
    setAllArtifacts(result.artifacts);
  }
  async function refreshCollections(){
    const result=await request<{collections:Collection[]}>('/v1/collections');
    setCollections(result.collections);
  }
  async function switchWorkspace(next:Workspace){
    setWorkspace(next);setError('');
    try{
      if(next==='present')await refreshArtifacts();
      if(next==='collections')await refreshCollections();
      if(next==='sources')setDataSources((await request<{sources:DataSource[]}>('/v1/data-sources')).sources);
      if(next==='artifacts')await refreshAllArtifacts();
      if(next==='settings'){
        const result=await request<{preferences:Record<string,unknown>}>('/v1/preferences');
        setPreferences(result.preferences);
        if(typeof result.preferences.default_metric==='string')setDefaultMetric(result.preferences.default_metric);
      }
    }catch{setError('Unable to load this workspace.');}
  }
  useEffect(()=>{
    let live=true;
    (async()=>{
      try{
        const status=await request<Health>('/health');
        if(!live)return;
        if(!['synthetic','enterprise'].includes(status.mode))throw new Error('Unexpected API mode');
        setHealthInfo(status);setHealthy('online');
        setCatalog((await request<{metrics:Metric[]}>('/v1/catalog')).metrics);
        const result=await request<{sessions:Session[]}>('/v1/sessions');
        if(!live)return;
        setSessions(result.sessions);
        if(result.sessions[0])await openSession(result.sessions[0].session_id);
        else await createSession();
      }catch{if(live){setHealthy('offline');setError('The BOLT service is offline. Restart the application and try again.');}}
    })();
    return()=>{live=false;};
  },[]);

  async function submit(text:string){
    if(!sid||busy||!text.trim()||healthy!=='online')return;
    const clean=text.trim();setQuestion('');setBusy(true);setError('');
    setTurns(previous=>[...previous,{role:'user',body:clean,payload:null,created_at:new Date().toISOString()}]);
    try{
      const reply=await request<Reply>('/v1/chat',{method:'POST',body:JSON.stringify({session_id:sid,question:clean})});
      setTurns(previous=>[...previous,{role:'assistant',body:reply.answer,payload:reply,created_at:new Date().toISOString()}]);
      setSelectedReply(null);setTab('sql');
    }catch{setError('Unable to complete that query.');}
    finally{setBusy(false);}
  }
  async function saveArtifact(artifact:Artifact){
    if(!window.boltApi){setError('Artifact saving is available in the desktop application.');return;}
    await window.boltApi.saveArtifact(artifact.artifact_id,artifact.session_id||sid,artifact.filename);
  }
  async function createPresentation(){
    if(!sid||artifactBusy||!presentationTitle.trim())return;
    setArtifactBusy(true);setError('');
    try{
      const artifact=await request<Artifact>('/v1/presentations',{method:'POST',body:JSON.stringify({session_id:sid,title:presentationTitle.trim()})});
      await refreshArtifacts(sid);await refreshAllArtifacts();
      if(window.boltApi)await saveArtifact({...artifact,session_id:sid});
    }catch{setError('Run an evidence-backed analysis before creating a presentation.');}
    finally{setArtifactBusy(false);}
  }
  async function createChart(reply:Reply){
    if(!sid||!reply.evidence||!reply.chart)return;
    setArtifactBusy(true);setError('');
    try{
      const artifact=await request<Artifact>('/v1/charts',{method:'POST',body:JSON.stringify({session_id:sid,query_id:reply.evidence.query_id})});
      await refreshArtifacts(sid);
      if(window.boltApi)await saveArtifact({...artifact,session_id:sid});
    }catch{setError('Unable to export this chart.');}
    finally{setArtifactBusy(false);}
  }
  async function createCollection(){
    if(!collectionName.trim())return;
    await request('/v1/collections',{method:'POST',body:JSON.stringify({name:collectionName.trim()})});
    setCollectionName('');await refreshCollections();
  }
  async function addLatestToCollection(collectionId:string){
    if(!sid||!latest?.evidence)return;
    await request('/v1/collection-items',{method:'POST',body:JSON.stringify({
      collection_id:collectionId,session_id:sid,result_ref:latest.evidence.query_id,
      title:latest.chart?.title||'Saved BOLT analysis'
    })});
    await refreshCollections();
  }
  async function searchMemory(){
    if(!memoryQuery.trim())return;
    const result=await request<{results:MemoryResult[]}>('/v1/memory/search',{
      method:'POST',body:JSON.stringify({query:memoryQuery.trim(),limit:10})
    });
    setMemoryResults(result.results);
  }
  async function savePreference(){
    await request('/v1/preferences',{method:'POST',body:JSON.stringify({key:'default_metric',value:defaultMetric})});
    setPreferences(previous=>({...previous,default_metric:defaultMetric}));
  }
  async function eraseMemory(){
    if(eraseConfirmation!=='ERASE MY BOLT MEMORY')return;
    await request('/v1/memory/erase',{method:'POST',body:JSON.stringify({confirmation:eraseConfirmation})});
    setSessions([]);setTurns([]);setArtifacts([]);setAllArtifacts([]);setCollections([]);setMemoryResults([]);
    setEraseConfirmation('');await createSession();setWorkspace('analyst');
  }
  function submitForm(event:FormEvent){event.preventDefault();void submit(question);}
  function onComposerKey(event:KeyboardEvent<HTMLTextAreaElement>){
    if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();void submit(question);}
  }

  const nav=(target:Workspace,label:string,icon:ReactNode)=>
    <button type="button" className={'workspace-button '+(workspace===target?'nav-active':'nav-text')} onClick={()=>void switchWorkspace(target)}>
      {icon}{label}
    </button>;

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="brand"><span className="brand-symbol"><Zap size={20} fill="currentColor"/></span><div><strong>BOLT</strong><small>INTELLIGENCE</small></div></div>
      <button className="new-chat" onClick={()=>void createSession()}><Plus size={16}/> New conversation</button>
      <div className="sidebar-section-title">WORKSPACE</div>
      {nav('analyst','Analyst',<MessageSquareText size={17}/>)}
      {nav('data','Data Lab',<Database size={17}/>)}
      {nav('explore','Explore',<BarChart3 size={17}/>)}
      {nav('present','Present',<Layers size={17}/>)}
      <div className="sidebar-section-title">LIBRARY</div>
      {nav('collections','Collections',<Folder size={17}/>)}
      {nav('sources','Data Sources',<HardDrive size={17}/>)}
      {nav('artifacts','Artifacts',<Image size={17}/>)}
      {nav('settings','Settings',<Settings size={17}/>)}
      <div className="sidebar-section-title past-title">RECENT SESSIONS</div>
      <nav className="sessions" aria-label="Past conversations">
        {sessions.map(session=><button key={session.session_id} onClick={()=>void openSession(session.session_id)} className={`session-button ${sid===session.session_id?'selected':''}`}>
          <Clock3 size={14}/><span>Conversation {session.session_id.slice(0,6)}</span>
        </button>)}
      </nav>
      <div className="sidebar-footer"><span className="status-light"/> {healthInfo?.snowflake_connected?'Governed enterprise':'Safe synthetic mode'} <span className="version">v1</span></div>
    </aside>

    <div className="main-column">
      <header className="topbar"><div className="crumb"><span>Workspace</span><span className="crumb-sep">/</span><strong>{WORKSPACE_LABELS[workspace]}</strong><ChevronDown size={13}/></div>
        <div className="top-actions"><span className="chip"><Database size={14}/> {healthInfo?.snowflake_connected?'Governed Snowflake':'Synthetic fixture'}</span><span className="chip"><Activity size={14}/> {healthInfo?.llm_connected?'Model connected':healthInfo?.llm_configured?'Model configured':'Deterministic mode'}</span><span className="chip">{sessionTokens} session tokens</span>{workspace==='analyst'&&<button className="icon-button" aria-label={showInspector?'Hide inspector':'Show inspector'} onClick={()=>setShowInspector(!showInspector)}>{showInspector?<PanelRightClose size={19}/>:<PanelRightOpen size={19}/>}</button>}</div>
      </header>

      <main className="conversation" aria-label="BOLT analyst conversation" style={{display:workspace==='analyst'?undefined:'none'}}>
        {turns.length===0&&<section className="welcome"><div className="welcome-symbol"><Zap size={30} fill="currentColor"/></div>
          <p className="eyebrow">YOUR AI DATA ANALYST</p><h1>Ask anything about your data.</h1>
          <p className="lead">Go from questions to evidence-backed insights in one conversation.</p>
          <div className="example-list">{EXAMPLES.map((example,index)=><button key={example} className="example" onClick={()=>void submit(example)}><span className="example-number">0{index+1}</span><span>{example}</span><ArrowUp size={15}/></button>)}</div>
        </section>}
        {turns.length>0&&<div className="turn-list">{turns.map((turn,index)=><section key={index} className={`turn ${turn.role}`} aria-label={turn.role==='user'?'Your message':'BOLT answer'}>
          <div className="turn-icon">{turn.role==='user'?'YOU':<Zap size={16} fill="currentColor"/>}</div>
          <div className="turn-body"><div className="turn-meta">{turn.role==='user'?'You':'BOLT'}</div><p>{turn.body}</p>
            {turn.payload?.chart&&<div className="result-chart"><div className="chart-head"><div><span className="eyebrow">VERIFIED RESULT</span><strong>{turn.payload.chart.title}</strong></div><span className="chart-chip">{turn.payload.data?.rows.length} groups</span></div>
              <ResultChart chart={turn.payload.chart}/>
              <div className="chart-footer"><span><Check size={14}/> Query executed</span><div className="row-actions"><button onClick={()=>void createChart(turn.payload!)}><Download size={13}/> Save SVG</button><button onClick={()=>{setSelectedReply(turn.payload);setTab('sql');setShowInspector(true)}}>View SQL <ArrowUp size={13}/></button></div></div>
            </div>}
            {turn.payload?.status==='unsupported'&&<span className="notice">No query executed · Request is outside the governed catalog</span>}
          </div>
        </section>)}</div>}
        {busy&&<div className="loading" role="status"><span className="pulse"/> Understanding → planning → querying → analyzing…</div>}
        {error&&<div className="error-notice" role="alert">{error}</div>}
      </main>
      <div className="composer-area" style={{display:workspace==='analyst'?undefined:'none'}}><form className="composer" onSubmit={submitForm}><textarea value={question} onChange={event=>setQuestion(event.target.value)} onKeyDown={onComposerKey} aria-label="Ask BOLT a question" placeholder="Ask a follow-up question..." rows={2} disabled={busy||healthy!=='online'}/>
        <div className="composer-bottom"><span><Sparkles size={14}/> Read-only evidence-backed analytics · Ctrl+Enter to send</span><button type="submit" className="send-button" disabled={busy||!question.trim()||healthy!=='online'} aria-label="Send question"><ArrowUp size={19}/></button></div></form>
        <div className="composer-disclaimer">BOLT v1 · External connections fail closed</div>
      </div>

      <div style={{display:workspace==='data'?'contents':'none'}}><DatasetLab/></div>

      <section className="feature-workspace" style={{display:workspace==='explore'?'block':'none'}} aria-label="Governed semantic catalog">
        <span className="eyebrow">EXPLORE GOVERNED DATA</span><h1>Semantic catalog</h1>
        <p>Only approved metrics and compatible dimensions can reach the read-only adapter.</p>
        <div className="feature-grid">{catalog.map(metric=><article className="feature-card" key={metric.metric_id}><strong>{metric.name}</strong><span>{metric.metric_id} · {metric.unit}</span><p>{metric.description}</p><div>{metric.dimensions.map(dimension=><span className="dimension-chip" key={dimension}>{dimension}</span>)}</div></article>)}</div>
        <article className="governance-card"><strong>Execution guardrails</strong><p>Single approved SELECT · parameterized dates · bounded rows and timeout · query tag, role, freshness and source evidence · no write capability.</p></article>
      </section>

      <section className="feature-workspace" style={{display:workspace==='present'?'block':'none'}} aria-label="Presentation artifacts">
        <span className="eyebrow">PRESENT</span><h1>Leadership artifacts</h1><p>Create an editable 3–5 slide PowerPoint from evidence-backed analyses.</p>
        <div className="presentation-builder"><textarea aria-label="Presentation title" value={presentationTitle} onChange={event=>setPresentationTitle(event.target.value)} rows={2}/><button className="new-chat" disabled={artifactBusy||!sid} onClick={()=>void createPresentation()}>{artifactBusy?'Creating…':'Create editable PPTX'}</button></div>
        <ArtifactList items={artifacts} onSave={saveArtifact}/>
      </section>

      <section className="feature-workspace" style={{display:workspace==='collections'?'block':'none'}} aria-label="Collections">
        <span className="eyebrow">COLLECTIONS</span><h1>Saved analysis collections</h1><p>Group query references without copying raw result sets into memory.</p>
        <div className="inline-form"><input aria-label="Collection name" value={collectionName} onChange={event=>setCollectionName(event.target.value)} placeholder="Quarterly leadership review"/><button onClick={()=>void createCollection()} disabled={!collectionName.trim()}>Create collection</button></div>
        <div className="feature-grid">{collections.map(collection=><article className="feature-card" key={collection.collection_id}><strong>{collection.name}</strong><span>{collection.items.length} saved analyses</span><ul>{collection.items.map(item=><li key={item.result_ref}>{item.title}</li>)}</ul><button disabled={!latest?.evidence} onClick={()=>void addLatestToCollection(collection.collection_id)}>Save latest analysis</button></article>)}</div>
      </section>

      <section className="feature-workspace" style={{display:workspace==='sources'?'block':'none'}} aria-label="Data Sources">
        <span className="eyebrow">DATA SOURCES</span><h1>Governed connections</h1><p>Connection state is explicit; credentials never enter the renderer.</p>
        <div className="feature-grid">{dataSources.map(source=><article className="feature-card" key={source.source_id}><strong>{source.name}</strong><span>{source.mode}</span><p>{source.connected?'Connected':'Unavailable'} · {source.read_only?'Read only':'Write capable'}</p></article>)}</div>
      </section>

      <section className="feature-workspace" style={{display:workspace==='artifacts'?'block':'none'}} aria-label="Artifacts">
        <span className="eyebrow">ARTIFACTS</span><h1>Owned exports</h1><p>PowerPoint and SVG files inherit the owning session and identity scope.</p>
        <ArtifactList items={allArtifacts} onSave={saveArtifact}/>
      </section>

      <section className="feature-workspace" style={{display:workspace==='settings'?'block':'none'}} aria-label="Settings">
        <span className="eyebrow">SETTINGS & MEMORY</span><h1>Preferences and retention controls</h1>
        <div className="settings-grid">
          <ModelSettingsPanel onChange={()=>{void request<Health>('/health').then(setHealthInfo).catch(()=>setError('Could not refresh model status.'));}}/>
          <article className="governance-card"><strong>Default metric</strong><div className="inline-form"><input value={defaultMetric} onChange={event=>setDefaultMetric(event.target.value)} aria-label="Default metric"/><button onClick={()=>void savePreference()}>Save</button></div><small>Current: {String(preferences.default_metric||'not set')}</small></article>
          <article className="governance-card"><strong>Search scoped memory</strong><div className="inline-form"><input value={memoryQuery} onChange={event=>setMemoryQuery(event.target.value)} aria-label="Search memory"/><button onClick={()=>void searchMemory()}><Search size={14}/> Search</button></div>{memoryResults.map(result=><p key={result.kind+result.reference}><b>{result.kind}</b> · {result.summary}</p>)}</article>
          <article className="danger-card"><strong>Erase my BOLT memory</strong><p>Deletes your sessions, preferences, collections, audit records and artifact files.</p><input value={eraseConfirmation} onChange={event=>setEraseConfirmation(event.target.value)} aria-label="Erasure confirmation" placeholder="ERASE MY BOLT MEMORY"/><button disabled={eraseConfirmation!=='ERASE MY BOLT MEMORY'} onClick={()=>void eraseMemory()}>Erase scoped memory</button></article>
        </div>
      </section>
      {workspace!=='analyst'&&error&&<div className="error-notice workspace-error" role="alert">{error}</div>}
    </div>

    {showInspector&&workspace==='analyst'&&<aside className="inspector" aria-label="Evidence inspector">
      <div className="inspector-header"><div><span className="eyebrow">SELECTED QUERY EVIDENCE</span><strong>Evidence inspector</strong></div><CircleHelp size={17}/></div>
      <div className="inspector-tabs" role="tablist" aria-label="Evidence tabs"><button role="tab" aria-selected={tab==='sql'} className={tab==='sql'?'active':''} onClick={()=>setTab('sql')}><TerminalSquare size={14}/> SQL</button><button role="tab" aria-selected={tab==='data'} className={tab==='data'?'active':''} onClick={()=>setTab('data')}><Table2 size={14}/> Data</button><button role="tab" aria-selected={tab==='evidence'} className={tab==='evidence'?'active':''} onClick={()=>setTab('evidence')}><FileText size={14}/> Evidence</button><button role="tab" aria-selected={tab==='artifact'} className={tab==='artifact'?'active':''} onClick={()=>setTab('artifact')}><Image size={14}/> Artifact</button></div>
      <div className="inspector-content">{currentEvidence?<>{tab==='sql'&&<><div className="evidence-label">EXECUTED QUERY</div><pre className="sql"><code>{currentEvidence.sql}</code></pre><div className="evidence-label">BOUND PARAMETERS</div><pre className="sql"><code>{JSON.stringify(currentEvidence.parameters,null,2)}</code></pre></>}{tab==='data'&&latest?.data&&<div className="data-table-wrapper"><table><thead><tr>{latest.data.columns.map(column=><th key={column}>{column}</th>)}</tr></thead><tbody>{latest.data.rows.map((row,index)=><tr key={index}>{latest.data!.columns.map(column=><td key={column}>{typeof row[column]==='number'?formatUSD(Number(row[column])):row[column]}</td>)}</tr>)}</tbody></table></div>}{tab==='evidence'&&<div className="details-grid"><div>Source<strong>{currentEvidence.source}</strong></div><div>Metric<strong>{currentEvidence.metric_id}</strong></div><div>Rows<strong>{currentEvidence.row_count}</strong></div><div>Query ID<strong className="mono">{currentEvidence.query_id}</strong></div><div>Freshness<strong>{currentEvidence.freshness||'not reported'}</strong></div><div>Model tokens<strong>{latest?.cost.prompt_tokens||0}</strong></div></div>}{tab==='artifact'&&<ArtifactList items={artifacts} onSave={saveArtifact}/>} </>:<div className="empty-inspector"><Database size={30}/><strong>Nothing to inspect yet</strong><p>Run a supported question to see SQL, parameters and evidence.</p></div>}</div>
      <div className="inspector-footer"><span className={`connection-dot ${healthy}`}/><span>{healthy==='online'?(healthInfo?.mode==='enterprise'?'Enterprise API online':'Synthetic API online'):healthy==='offline'?'API unavailable':'Checking API...'}</span></div>
    </aside>}
  </div>;
}

function ArtifactList({items,onSave}:{items:Artifact[];onSave:(item:Artifact)=>Promise<void>}){
  if(items.length===0)return <p>No artifacts in this scope yet.</p>;
  return <div className="artifact-list">{items.map(item=><article className="artifact-row" key={item.artifact_id}><div><strong>{item.filename}</strong><span>{item.kind||'presentation'} · {Math.ceil(item.size_bytes/1024)} KB{item.slide_count? ` · ${item.slide_count} slides`:''}</span></div><button onClick={()=>void onSave(item)}><Download size={14}/> Save</button></article>)}</div>;
}
