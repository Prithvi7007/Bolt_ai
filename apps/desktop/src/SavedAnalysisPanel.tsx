import {useEffect,useRef,useState} from 'react';
import {FileText,FolderOpen,X} from 'lucide-react';
import {AnswerCard} from './AskYourData';
import type {DataAnswer} from './ask-data.mjs';

export default function SavedAnalysisPanel(){
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const [snapshot,setSnapshot]=useState<BoltAnalysisSnapshot|null>(null);
  const [opening,setOpening]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  async function open(){
    if(opening||!window.boltApi?.openDataAnalysis)return;
    setOpening(true);setError('');setNotice('');
    try{
      const result=await window.boltApi.openDataAnalysis();
      if(!alive.current)return;
      if(result.opened){setSnapshot(result.snapshot);setNotice('Saved analysis opened.');}
      else setNotice('Open cancelled.');
    }catch{
      if(alive.current)setError('Could not open this saved analysis. Choose a valid BOLT .bolt snapshot and try again.');
    }finally{if(alive.current)setOpening(false);}
  }
  const answer:DataAnswer|null=snapshot?{kind:'answered',...snapshot.result}:null;
  return <section className="lab-panel lab-snapshot-panel" aria-label="Saved Data Lab analyses">
    <div className="lab-snapshot-header">
      <div className="lab-panel-title"><span>LOCAL SNAPSHOTS</span><h3><FileText size={17}/> Review a saved analysis</h3></div>
      <button type="button" className="lab-open-analysis" disabled={opening||!window.boltApi?.openDataAnalysis} onClick={()=>void open()}><FolderOpen size={16}/>{opening?'Opening…':'Open saved analysis'}</button>
    </div>
    <p className="lab-target-description">Open a .bolt file created with Save analysis. It preserves the calculated answer, chart and evidence. New calculations require importing the source CSV again.</p>
    <p className="lab-snapshot-status" role="status">{notice}</p>
    {error&&<p className="lab-error lab-snapshot-error" role="alert">{error}</p>}
    {snapshot&&answer&&<div className="lab-saved-analysis">
      <div className="lab-saved-analysis-heading"><strong>Saved contents · not recalculated</strong>
        <button type="button" className="lab-close-analysis" disabled={opening} onClick={()=>{setSnapshot(null);setNotice('Saved preview closed.');}}><X size={15}/> Close preview</button>
      </div>
      <p className="lab-snapshot-disclosure">Snapshot files are editable outside BOLT. This view does not authenticate or recalculate their contents. Opening this file does not change the live dataset or its question context.</p>
      <dl className="lab-snapshot-metadata">
        <dt>Source filename</dt><dd>{snapshot.sourceName}</dd>
        <dt>Approved target (saved)</dt><dd>{snapshot.target}</dd>
        <dt>Original question</dt><dd>{snapshot.question}</dd>
        <dt>Saved at</dt><dd>{new Date(snapshot.savedAt).toLocaleString()}</dd>
        <dt>Interpretation (saved label)</dt><dd>{snapshot.interpretation==='model'?'AI-assisted interpretation':'Local interpretation'}</dd>
      </dl>
      <AnswerCard answer={answer} question={snapshot.question} sourceName={snapshot.sourceName} target={snapshot.target} archived/>
    </div>}
  </section>;
}
