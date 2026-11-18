import {useState, type FormEvent} from 'react';
import type {DatasetProfile} from './dataset-understanding.mjs';
import {describeFilterScope,validateCategoryFilter,validateDateFilter,DATE_FILTER_CONVENTION,
  type CategoryFilter as Filter,type DateFilter} from './local-analysis.mjs';

export default function CategoryFilter({profile,active,activeDate,onApply}:{
  profile:DatasetProfile;active:Filter|null;activeDate:DateFilter|null;
  onApply:(filter:Filter|null,dateFilter:DateFilter|null)=>void;
}) {
  const [column,setColumn]=useState('');
  const [value,setValue]=useState('');
  const [dateColumn,setDateColumn]=useState('');
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [error,setError]=useState('');
  const columns=profile.columns.filter(c=>c.type==='categorical');
  const dates=profile.columns.filter(c=>c.type==='date');
  const hasFilters=Boolean(active||activeDate);
  function apply(event:FormEvent) {
    event.preventDefault();setError('');
    try {
      const category=validateCategoryFilter(column?{column,value}:null,profile);
      const date=validateDateFilter(dateColumn?{column:dateColumn,from:from||null,to:to||null}:null,profile);
      onApply(category,date);
    } catch(cause){setError(cause instanceof Error?cause.message:'Check the selected filter fields.');}
  }
  function clear() {
    setColumn('');setValue('');setDateColumn('');setFrom('');setTo('');setError('');onApply(null,null);
  }
  return <section className="lab-panel lab-filter-panel" aria-label="Local subset filters">
    <div className="lab-panel-title"><span>LOCAL CALCULATION SCOPE</span><h3>Analyze a subset</h3></div>
    <p className="lab-target-description">Choose an exact category value, an inclusive date-key range, or both. Both filters must match when combined. Category matching is case-sensitive and trims surrounding whitespace. The profile and source preview still show the full CSV.</p>
    {(columns.length||dates.length)?<form className="lab-filter-controls" onSubmit={apply}>
      {columns.length>0&&<>
        <div><label htmlFor="bolt-filter-column">CATEGORY COLUMN (OPTIONAL)</label>
          <select id="bolt-filter-column" value={column} onChange={e=>{setColumn(e.target.value);setValue('');setError('');}}>
            <option value="">No category filter</option>
            {columns.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </div>
        <div><label htmlFor="bolt-filter-value">EXACT VALUE</label>
          <input id="bolt-filter-value" value={value} maxLength={1000} disabled={!column}
            onChange={e=>{setValue(e.target.value);setError('');}} placeholder="Enter the category value"/>
        </div>
      </>}
      {dates.length>0&&<fieldset className="lab-date-filter-controls">
        <legend>OBSERVED DATE KEYS (OPTIONAL)</legend>
        <div><label htmlFor="bolt-date-filter-column">DATE COLUMN</label>
          <select id="bolt-date-filter-column" value={dateColumn} onChange={e=>{setDateColumn(e.target.value);setFrom('');setTo('');setError('');}}>
            <option value="">No date range</option>
            {dates.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </div>
        <div><label htmlFor="bolt-date-filter-from">FROM (INCLUSIVE)</label>
          <input id="bolt-date-filter-from" type="date" min="1900-01-01" max="2200-12-31" value={from} disabled={!dateColumn}
            onChange={e=>{setFrom(e.target.value);setError('');}}/>
        </div>
        <div><label htmlFor="bolt-date-filter-to">THROUGH (INCLUSIVE)</label>
          <input id="bolt-date-filter-to" type="date" min="1900-01-01" max="2200-12-31" value={to} disabled={!dateColumn}
            onChange={e=>{setTo(e.target.value);setError('');}}/>
        </div>
        <p>{DATE_FILTER_CONVENTION} A range needs at least one bound; a blank bound is open-ended. Missing or invalid date keys are excluded.</p>
      </fieldset>}
      <button className="lab-filter-apply" type="submit"
        disabled={(!column&&!dateColumn)||Boolean(column&&!value.trim())||Boolean(dateColumn&&!from&&!to)}>Apply filter</button>
    </form>:<p className="lab-table-note">No categorical or date columns were detected in this CSV.</p>}
    {error&&<p className="lab-error" role="alert">{error}</p>}
    <div className="lab-filter-status" role="status">
      <div><strong className="lab-filter-scope">{describeFilterScope(active,activeDate)}</strong>
        <p>{hasFilters?'Local calculations and questions use this subset. Applying or clearing resets results and follow-up context.':'Local calculations and questions use all accepted source rows.'}</p></div>
      {hasFilters&&<button type="button" className="lab-filter-clear" onClick={clear}>Clear filter</button>}
    </div>
    <p className="lab-table-note">Edits take effect after Apply filter. Free-text filter expressions are not supported. Filter values stay on-device and are included in reports you choose to save.</p>
  </section>;
}
