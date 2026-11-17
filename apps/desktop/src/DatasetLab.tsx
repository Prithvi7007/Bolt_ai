import {useState, type ChangeEvent, type DragEvent} from 'react';
import {Activity, Check, ChevronRight, Database, FileSpreadsheet, HardDriveDownload,
        Info, RefreshCcw, ShieldCheck, Sparkles, UploadCloud, AlertTriangle} from 'lucide-react';
import {profileCsvFile, type DatasetProfile} from './dataset-understanding.mjs';
import LocalAnalysis from './LocalAnalysis';
import AskYourData from './AskYourData';
import './dataset-lab.css';

function Metric({label, value, detail}: {label: string; value: string; detail: string}) {
  return <div className="lab-metric">
    <span>{label}</span><strong>{value}</strong><small>{detail}</small>
  </div>;
}

export default function DatasetLab() {
  const [profile, setProfile] = useState<DatasetProfile | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [selectedTarget, setSelectedTarget] = useState('');
  const [approvedTarget, setApprovedTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const numericColumns = profile?.columns.filter(col => col.type === 'numeric') ?? [];
  const missingCount = profile?.columns.reduce((total, col) => total + col.missing, 0) ?? 0;
  const cellCount = profile ? profile.rowCount * profile.columns.length : 0;
  const missingPct = cellCount > 0 ? Math.round(missingCount / cellCount * 1000) / 10 : 0;

  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setError('');
    setProfile(null);
    setSourceFile(null);
    setApprovedTarget('');
    try {
      const result = await profileCsvFile(file);
      setProfile(result);
      setSourceFile(file);
      setSelectedTarget(result.suggestedTargets[0]?.name || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to read this CSV file');
    } finally {
      setBusy(false);
    }
  }

  function changeFile(event: ChangeEvent<HTMLInputElement>) {
    void importFile(event.target.files?.[0]);
    event.target.value = '';
  }

  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void importFile(event.dataTransfer.files[0]);
  }

  return <main className="data-lab" aria-label="Data Lab">
    <div className="lab-container">
      <div className="lab-hero">
        <div className="lab-eyebrow"><span className="lab-pulse"/><span>DATA LAB</span><span className="lab-sep">/</span><span>LOCAL UNDERSTANDING</span></div>
        <h1>Know your data.<br/><span>Before you model.</span></h1>
        <p>Bring a CSV into BOLT. Understand its structure, check data quality, and decide which outcome matters before any forecasting or analysis begins.</p>
      </div>

      <div className="lab-privacy"><ShieldCheck size={17}/><div><strong>Local by design</strong><span>CSV rows are profiled and calculated on-device. Optional AI planning below shares only your question, approved target, and column names/types. Row values and previews are not uploaded; imported data is not saved after you close the app.</span></div></div>

      <section className="lab-upload-section" aria-label="Import a CSV dataset">
        <div className="lab-section-heading"><div><span>01 / IMPORT</span><h2>Dataset source</h2></div><span className="lab-section-meta">CSV · UTF-8 · On-device</span></div>
        <div className={'lab-drop-zone' + (dragging ? ' dragging' : '')}
          onDragEnter={event => {event.preventDefault(); setDragging(true);}}
          onDragOver={event => event.preventDefault()}
          onDragLeave={event => {event.preventDefault(); setDragging(false);}}
          onDrop={dropFile}>
          <div className="lab-upload-icon"><UploadCloud size={25}/></div>
          <h3>{busy ? 'Reading and profiling locally…' : 'Drop your dataset here'}</h3>
          <p>or choose a CSV file to inspect its columns, types, missingness, and target candidates.</p>
          <label htmlFor="bolt-csv-import" className={'lab-upload-button' + (busy ? ' disabled' : '')}><FileSpreadsheet size={16}/>{profile ? 'Replace dataset' : 'Choose CSV file'}<ChevronRight size={16}/></label>
          <input id="bolt-csv-import" type="file" accept=".csv,text/csv" onChange={changeFile} disabled={busy} aria-label="Choose a local CSV dataset"/>
          <div className="lab-upload-footnote"><HardDriveDownload size={13}/> The entire file is streamed for a local structural profile. Only five preview rows are retained.</div>
        </div>
        {error && <p className="lab-error" role="alert"><AlertTriangle size={16}/>{error}</p>}
      </section>

      {profile && <>
        <section className="lab-result" aria-label="Dataset understanding results">
          <div className="lab-result-header"><div><span className="lab-overline">DATASET PROFILE</span><h2><Database size={21}/>{profile.fileName}</h2><small>Profiling complete · No model or external API used</small></div>
            <button className="lab-reset" onClick={() => {setProfile(null); setSourceFile(null); setSelectedTarget(''); setApprovedTarget('');}}><RefreshCcw size={14}/> Clear</button>
          </div>
          <div className="lab-metrics">
            <Metric label="VALID ROWS" value={profile.rowCount.toLocaleString()} detail="Full file scanned"/>
            <Metric label="COLUMNS" value={String(profile.columns.length)} detail="Inferred schema"/>
            <Metric label="MISSING CELLS" value={missingPct + '%'} detail="Across valid rows"/>
            <Metric label="DATE GRAIN" value={profile.timeGrain || 'Unknown'} detail={profile.dateColumn || 'No date detected'}/>
          </div>
          <div className="lab-dual">
            <div className="lab-panel">
              <div className="lab-panel-title"><span>02 / SCHEMA</span><h3>Column intelligence</h3></div>
              <div className="lab-table-scroll"><table className="lab-table">
                <thead><tr><th>Column</th><th>Type</th><th>Missing</th><th>Distinct*</th></tr></thead>
                <tbody>{profile.columns.map(col => <tr key={col.name}>
                  <td title={col.name}>{col.name}</td>
                  <td><span className={'lab-type type-' + col.type}>{col.type}</span></td>
                  <td>{col.missingPct}%</td><td>{col.distinctObserved}{col.distinctCapped ? '+' : ''}</td>
                </tr>)}</tbody>
              </table></div>
              <p className="lab-table-note">*Distinct values are counted up to 2,048 per column to bound memory use.</p>
            </div>
            <div className="lab-panel">
              <div className="lab-panel-title"><span>03 / DIAGNOSE</span><h3>What BOLT detected</h3></div>
              <div className="lab-findings">
                <div className="lab-finding"><Activity size={18}/><div><strong>Time structure</strong><p>{profile.dateColumn ? 'Detected ' + profile.dateColumn + (profile.timeGrain ? ' with ' + profile.timeGrain + ' intervals.' : '; more dates are needed to infer frequency.') : 'No reliable ISO-formatted date field was found.'}</p></div></div>
                <div className="lab-finding"><Sparkles size={18}/><div><strong>Outcome candidates</strong><p>{profile.suggestedTargets.length ? profile.suggestedTargets.map(t => t.name).join(', ') : 'No numeric target candidates found.'} These suggestions are deterministic, not AI predictions.</p></div></div>
                {profile.observations.map((observation, index) => <div className="lab-finding warning" key={index}><AlertTriangle size={17}/><div><strong>Data quality</strong><p>{observation}</p></div></div>)}
                {!profile.observations.length && <div className="lab-finding"><Check size={18}/><div><strong>Initial structural checks passed</strong><p>No inconsistent rows or high-missingness columns detected. This is not a full quality audit.</p></div></div>}
              </div>
            </div>
          </div>
        </section>

        <section className="lab-panel lab-target-panel" aria-label="Target approval">
          <div className="lab-panel-title"><span>04 / HUMAN DECISION</span><h3>What should BOLT analyze?</h3></div>
          <p className="lab-target-description">The target is your outcome variable. BOLT can suggest candidates from numeric columns, but only you can approve the objective. No model is trained by this step.</p>
          <div className="lab-target-control">
            <div><label htmlFor="bolt-target">TARGET VARIABLE</label>
              <select id="bolt-target" value={selectedTarget} onChange={e => {setSelectedTarget(e.target.value); setApprovedTarget('');}}>
                <option value="">Choose a numeric column</option>
                {numericColumns.map(col => <option key={col.name} value={col.name}>{col.name}</option>)}
              </select>
            </div>
            <button onClick={() => setApprovedTarget(selectedTarget)} disabled={!selectedTarget}><Check size={16}/> Approve target</button>
          </div>
          {selectedTarget && <p className="lab-target-rationale"><Info size={15}/>{profile.suggestedTargets.find(item => item.name === selectedTarget)?.reason || 'Selected numeric column; confirm it represents the intended outcome.'}</p>}
          {approvedTarget && <div className="lab-approved" role="status"><Check size={18}/><div><strong>Target approved: {approvedTarget}</strong><p>The objective is ready. Run local descriptive analysis below. AI question planning is optional and does not upload CSV rows or train a model.</p></div></div>}
        </section>

        {approvedTarget && sourceFile && <LocalAnalysis key={approvedTarget} file={sourceFile} profile={profile} target={approvedTarget}/>}

        {approvedTarget && sourceFile && <AskYourData key={"ask:"+approvedTarget} file={sourceFile} profile={profile} target={approvedTarget}/>}

        <section className="lab-panel lab-preview-panel" aria-label="CSV data preview">
          <div className="lab-panel-title"><span>07 / VERIFY</span><h3>Source preview</h3></div>
          <div className="lab-table-scroll"><table className="lab-table lab-preview"><thead><tr>{profile.columns.map(col => <th key={col.name}>{col.name}</th>)}</tr></thead>
            <tbody>{profile.preview.map((row, index) => <tr key={index}>{row.map((cell, col) => <td key={col} title={cell}>{cell || '—'}</td>)}</tr>)}</tbody></table></div>
          <p className="lab-table-note">First five valid rows shown. Preview values are truncated to 160 characters; all valid rows contribute to profile statistics. {profile.rejectedRows ? profile.rejectedRows + ' malformed rows were excluded.' : ''}</p>
        </section>
      </>}
      <div className="lab-bottom-note"><ShieldCheck size={14}/> Data Lab calculates against your imported CSV. Optional AI interprets questions from schema only. The separate Analyst workspace continues to use the synthetic demo dataset.</div>
    </div>
  </main>;
}
