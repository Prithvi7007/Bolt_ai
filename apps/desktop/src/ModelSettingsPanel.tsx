import {useEffect,useState,type FormEvent} from 'react';
import './model-settings.css';

export default function ModelSettingsPanel({onChange}:{onChange:()=>void}){
  const [status,setStatus]=useState<BoltModelStatus|null>(null);
  const [endpoint,setEndpoint]=useState('');
  const [model,setModel]=useState('');
  const [auth,setAuth]=useState<BoltModelInput['auth_mode']>('bearer');
  const [token,setToken]=useState('');
  const [timeout,setTimeoutSeconds]=useState(30);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const bridge=window.boltApi;
  function apply(next:BoltModelStatus){
    setStatus(next);setEndpoint(next.endpoint);setModel(next.model);
    setAuth(next.auth_mode);setTimeoutSeconds(next.timeout_seconds);setToken('');
  }
  useEffect(()=>{
    let live=true;
    if(bridge)void bridge.modelSettings('get').then(next=>{if(live)apply(next);})
      .catch(()=>{if(live)setError('Could not load the model connection. Restart BOLT and try again.');});
    return()=>{live=false;};
  },[]);
  const keyReusable=!!status?.has_key&&endpoint.trim().replace(/\/+$/,'')===status.endpoint&&auth===status.auth_mode;
  const dirty=!!status&&(endpoint!==status.endpoint||model!==status.model||auth!==status.auth_mode||timeout!==status.timeout_seconds||!!token);
  async function run(operation:'save'|'test'|'disconnect'){
    if(!bridge||busy)return;
    setBusy(operation);setError('');setMessage('');
    try{
      const input:BoltModelInput={endpoint,model,auth_mode:auth,token,timeout_seconds:timeout};
      const next=await bridge.modelSettings(operation,operation==='save'?input:undefined);
      apply(next);
      setMessage(operation==='test'?'Connected. The model returned a valid analysis plan.':
        operation==='disconnect'?'Model disconnected.':
        next.persisted?'Connection saved on this device.':'Connection active for this session.');
      onChange();
    }catch{
      if(operation==='test'){
        try{setStatus(await bridge.modelSettings('get'));onChange();}catch{/* Keep the test failure visible. */}
      }
      setToken('');
      setError(operation==='test'?'Connection test failed. Check the base URL, key, model name and network, then try again.':
        operation==='save'?'Could not save. Check the HTTPS base URL, model name, authentication and key.':
        'Could not disconnect the model. Try again.');
    }finally{setBusy('');}
  }
  function submit(event:FormEvent){event.preventDefault();void run('save');}
  return <article className="governance-card model-settings" aria-labelledby="model-connection-title">
    <h2 id="model-connection-title">Model connection</h2>
    <p>Connect your own OpenAI-compatible chat endpoint. Questions and bounded conversation context can be sent to this provider. Imported CSV rows stay on your device.</p>
    {!bridge?<p>Open the desktop application to configure a model connection.</p>:<>
      <p role="status" className="connection-note">{status?.configured?
        status.verified?'Connection verified':'Configured · test the saved connection':
        'No model configured · local analytics are available'}</p>
      <form onSubmit={submit}>
        <fieldset disabled={!!busy||!status} className="model-fields">
          <div><label htmlFor="model-endpoint">Base URL</label><input id="model-endpoint" type="url" required value={endpoint} onChange={event=>setEndpoint(event.target.value)} placeholder="https://provider.example/v1" spellCheck={false}/><small>Enter the base URL, without /chat/completions.</small></div>
          <div><label htmlFor="model-name">Model or deployment name</label><input id="model-name" required value={model} onChange={event=>setModel(event.target.value)} maxLength={200} autoComplete="off"/></div>
          <div><label htmlFor="model-auth">Authentication</label><select id="model-auth" value={auth} onChange={event=>{setAuth(event.target.value as BoltModelInput['auth_mode']);setToken('');}}>
            <option value="bearer">Bearer API key</option><option value="apim">APIM subscription key</option><option value="none">No authentication</option>
          </select></div>
          <div><label htmlFor="model-key">API or subscription key</label><input id="model-key" type="password" autoComplete="off" spellCheck={false} value={token} onChange={event=>setToken(event.target.value)} disabled={auth==='none'} required={auth!=='none'&&!keyReusable} maxLength={4096} placeholder={keyReusable?'Saved key retained':'Enter key'}/><small>{keyReusable?'Leave blank to keep the saved key for this endpoint.':'Use no authentication for a keyless local provider.'}</small></div>
          <div><label htmlFor="model-timeout">Timeout (seconds)</label><input id="model-timeout" type="number" min={1} max={120} value={timeout} onChange={event=>setTimeoutSeconds(Number(event.target.value))}/></div>
        </fieldset>
        <div className="model-actions">
          <button type="submit" disabled={!!busy||!status}>{busy==='save'?'Saving…':'Save connection'}</button>
          <button type="button" disabled={!!busy||!status?.configured||dirty} onClick={()=>void run('test')}>{busy==='test'?'Testing…':'Test saved connection'}</button>
          <button type="button" disabled={!!busy||!status?.configured} onClick={()=>void run('disconnect')}>{busy==='disconnect'?'Disconnecting…':'Disconnect'}</button>
        </div>
      </form>
      {dirty&&<p className="connection-note">Save your changes before testing the connection.</p>}
      {status?.notice&&<p className="connection-note">{status.notice}</p>}
      {message&&<p role="status" className="connection-note">{message}</p>}
      {error&&<p role="alert" className="error-notice">{error}</p>}
      <small>Keys use the operating system's protected storage when available. Otherwise they are used for this session only. This connection currently assists Analyst queries against the built-in revenue catalog; it does not upload or analyze your CSV with a model.</small>
    </>}
  </article>;
}
