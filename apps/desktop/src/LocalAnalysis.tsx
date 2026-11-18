import {useState,useEffect,useRef} from 'react';
import {Activity, AlertTriangle, BarChart3, CheckCircle2, Database, Play, ShieldCheck} from 'lucide-react';
import {analyzeCsvFile, type LocalAnalysisReport,type CategoryFilter,type DateFilter} from './local-analysis.mjs';
import type {DatasetProfile} from './dataset-understanding.mjs';
import './local-analysis.css';

function display(n: number | null, digits = 2) {
  return n === null || !Number.isFinite(n) ? 'Not available'
    : n.toLocaleString(undefined, {maximumFractionDigits: digits});
}

function Timeline({report, aggregation}: {report: LocalAnalysisReport; aggregation: 'sum' | 'mean'}) {
  const data = report.timeline;
  if (data.length < 2) {
    return <p className="lab-analysis-empty">At least two distinct valid dates are needed to draw a time series.</p>;
  }
  const values = data.map(d => d[aggregation]);
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min;
  const points = values.map((value, index) => {
    const x = 18 + index / (values.length - 1) * 664;
    const y = span === 0 ? 64 : 112 - ((value - min) / span) * 96;
    return x.toFixed(2) + ',' + y.toFixed(2);
  }).join(' ');
  return <div className="lab-series">
    <div className="lab-series-range"><span>{display(max)} max</span><span>{display(min)} min</span></div>
    <svg role="img" aria-label={aggregation + ' of ' + report.target + ' across ' + data.length + ' observed date buckets'} viewBox="0 0 700 132" preserveAspectRatio="none">
      <path d="M18 112 H682" stroke="#38506C" strokeWidth="1" strokeDasharray="4 6" fill="none"/>
      <polyline points={points} fill="none" stroke="#60A5FA" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
    </svg>
    <div className="lab-series-dates"><span>{data[0].date}</span><span>{data.length} observed periods</span><span>{data[data.length - 1].date}</span></div>
  </div>;
}

export default function LocalAnalysis({file, profile, target,categoryFilter=null,dateFilter=null}: {file: File; profile: DatasetProfile; target: string;categoryFilter?:CategoryFilter|null;dateFilter?:DateFilter|null}) {
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const [dimension, setDimension] = useState('');
  const [aggregation, setAggregation] = useState<'sum' | 'mean'>('sum');
  const [report, setReport] = useState<LocalAnalysisReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const candidateDimensions = profile.columns.filter(col => col.type === 'categorical');
  async function runAnalysis() {
    setRunning(true);
    setReport(null);
    setError('');
    try {
      const outcome = await analyzeCsvFile(file, {
        target, dimension: dimension || null, dateColumn: profile.dateColumn,categoryFilter,dateFilter,
      });
      if(alive.current)setReport(outcome);
    } catch (cause) {
      if(alive.current)setError(cause instanceof Error ? cause.message : 'Unable to analyze this dataset');
    } finally {
      if(alive.current)setRunning(false);
    }
  }
  return <section className="lab-analysis" aria-label="Local target analysis">
    <div className="lab-panel-title"><span>05 / ON-DEVICE ANALYSIS</span><h3>Explore {target} in the actual CSV</h3></div>
    <p className="lab-target-description">Run a second, local streaming pass over the file to calculate real descriptive statistics. It does not send CSV data to the synthetic Analyst API or an LLM, and it does not train a forecasting model.</p>
    <div className="lab-analysis-controls">
      <div><label htmlFor="bolt-group">OPTIONAL BREAKDOWN</label>
        <select id="bolt-group" disabled={running} value={dimension} onChange={e => {setDimension(e.target.value); setReport(null);}}>
          <option value="">None — overall target only</option>
          {candidateDimensions.map(col => <option value={col.name} key={col.name}>{col.name}</option>)}
        </select>
      </div>
      <button className="lab-analyze-button" onClick={() => void runAnalysis()} disabled={running}>
        <Play size={15}/>{running ? 'Analyzing locally…' : 'Analyze approved target'}
      </button>
    </div>
    {error && <p role="alert" className="lab-error"><AlertTriangle size={16}/>{error}</p>}
    {report && <div className="lab-analysis-results">
      <div className="lab-analysis-provenance"><CheckCircle2 size={17}/>
        Analyzed {report.validRows.toLocaleString()} rows with valid {target} from {report.matchedRows.toLocaleString()} matching rows / {report.scannedRows.toLocaleString()} accepted CSV rows. No remote request.</div>
      {(categoryFilter||dateFilter)&&report.matchedRows===0&&<p className="lab-analysis-empty">No accepted rows match this filter. Change or clear it to calculate a result.</p>}
      <div className="lab-analysis-kpis">
        <div><span>AVERAGE {target.toUpperCase()}</span><strong>{display(report.mean)}</strong></div>
        <div><span>TOTAL</span><strong>{display(report.total)}</strong></div>
        <div><span>MIN / MAX</span><strong>{display(report.min)} / {display(report.max)}</strong></div>
        <div><span>STANDARD DEVIATION</span><strong>{display(report.standardDeviation)}</strong></div>
      </div>
      <div className="lab-analysis-dual">
        <div className="lab-analysis-section">
          <h4><Activity size={16}/> Target relationships</h4>
          <p>Strongest pairwise Pearson correlations among numeric columns; paired missing values are excluded. Correlation is not causation.</p>
          {report.correlations.length ? <div className="lab-correlation-list">
            {report.correlations.map(row => <div className="lab-correlation" key={row.column}>
              <div><strong title={row.column}>{row.column}</strong><span>r = {row.correlation.toFixed(3)} · n = {row.pairedRows.toLocaleString()}</span></div>
              <div className="lab-correlation-track"><div style={{width: Math.abs(row.correlation) * 100 + '%', background: row.correlation < 0 ? '#D6A8FA' : '#60A5FA'}}/></div>
            </div>)}
          </div> : <p className="lab-analysis-empty">No numeric predictors have enough paired variation to calculate a correlation.</p>}
          <small>Checked up to {report.checkedPredictorColumns} candidate columns; showing at most 12 correlations.</small>
        </div>
        <div className="lab-analysis-section">
          <h4><BarChart3 size={16}/> Breakdown by {dimension || 'group'}</h4>
          {report.groups.length ? <div className="lab-analysis-table-wrap"><table><thead><tr><th>Group</th><th>Valid rows</th><th>Mean</th><th>Sum</th></tr></thead>
            <tbody>{report.groups.map(row => <tr key={row.isOverflow?'overflow':'category:'+row.label}><td title={row.label}>{row.label}{row.isOverflow?' (combined overflow)':''}</td><td>{row.rows.toLocaleString()}</td><td>{display(row.mean)}</td><td>{display(row.sum)}</td></tr>)}</tbody>
          </table></div> : <p className="lab-analysis-empty">Select an optional categorical breakdown above, then run analysis to compare groups.</p>}
          <small>Groups are descriptive aggregations, not causal comparisons.</small>
        </div>
      </div>
      {report.dateColumn && <div className="lab-analysis-section lab-timeline-section">
        <div className="lab-analysis-timeline-header"><div><h4><Database size={16}/> {target} by {report.dateColumn}</h4><p>Observed date buckets only. No imputation, trend extrapolation or forecast.</p></div>
          <div className="lab-timeline-toggle" role="group" aria-label="Choose time series aggregation">
            <button aria-pressed={aggregation === 'sum'} className={aggregation === 'sum' ? 'active' : ''} onClick={() => setAggregation('sum')}>Sum</button>
            <button aria-pressed={aggregation === 'mean'} className={aggregation === 'mean' ? 'active' : ''} onClick={() => setAggregation('mean')}>Mean</button>
          </div>
        </div>
        <p className="lab-timeline-coverage">{report.timelineRows.toLocaleString()} of {report.validRows.toLocaleString()} valid target rows represented in date buckets; {report.excludedDateRows.toLocaleString()} missing or invalid date rows; {(report.datedTargetRows-report.timelineRows).toLocaleString()} valid date rows omitted at the date limit.</p>
        <Timeline report={report} aggregation={aggregation}/>
      </div>}
      <div className="lab-analysis-notes"><h4><AlertTriangle size={16}/> Interpretation and limitations</h4>
        {report.warnings.map(note => <p key={note}>{note}</p>)}
      </div>
      <p className="lab-analysis-footer"><ShieldCheck size={14}/>{report.processing}</p>
    </div>}
  </section>;
}
