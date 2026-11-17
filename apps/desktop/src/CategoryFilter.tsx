import {useState, type FormEvent} from 'react';
import type {DatasetProfile} from './dataset-understanding.mjs';
import {describeCategoryFilter,validateCategoryFilter,type CategoryFilter as Filter} from './local-analysis.mjs';

export default function CategoryFilter({profile,active,onApply}:{profile:DatasetProfile;active:Filter|null;onApply:(filter:Filter|null)=>void}) {
  const [column,setColumn]=useState('');
  const [value,setValue]=useState('');
  const [error,setError]=useState('');
  const columns=profile.columns.filter(c=>c.type==='categorical');
  function apply(event:FormEvent) {
    event.preventDefault();setError('');
    try {onApply(validateCategoryFilter({column,value},profile));}
    catch(cause){setError(cause instanceof Error?cause.message:'Choose a categorical column and exact value.');}
  }
  return <section className="lab-panel lab-filter-panel" aria-label="Local category filter">
    <div className="lab-panel-title"><span>LOCAL CALCULATION SCOPE</span><h3>Analyze a subset</h3></div>
    <p className="lab-target-description">Optionally match one categorical column to an exact value. Matching is case-sensitive and trims surrounding whitespace. The dataset profile and source preview still show the full CSV.</p>
    {columns.length?<form className="lab-filter-controls" onSubmit={apply}>
      <div><label htmlFor="bolt-filter-column">CATEGORY COLUMN</label>
        <select id="bolt-filter-column" value={column} onChange={e=>{setColumn(e.target.value);setError('');}}>
          <option value="">Choose a categorical column</option>
          {columns.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
      </div>
      <div><label htmlFor="bolt-filter-value">EXACT VALUE</label>
        <input id="bolt-filter-value" value={value} maxLength={1000} disabled={!column}
          onChange={e=>{setValue(e.target.value);setError('');}} placeholder="Enter the category value"/>
      </div>
      <button className="lab-filter-apply" type="submit" disabled={!column||!value.trim()}>Apply filter</button>
    </form>:<p className="lab-table-note">No categorical columns were detected in this CSV.</p>}
    {error&&<p className="lab-error" role="alert">{error}</p>}
    <div className="lab-filter-status" role="status">
      <div><strong className="lab-filter-scope">{describeCategoryFilter(active)}</strong>
        <p>{active?'Local calculations and questions use this subset. Applying or clearing resets results and follow-up context.':'Local calculations and questions use all accepted source rows.'}</p></div>
      {active&&<button type="button" className="lab-filter-clear" onClick={()=>{setColumn('');setValue('');setError('');onApply(null);}}>Clear filter</button>}
    </div>
    <p className="lab-table-note">Edits take effect after Apply filter. Nonblank values only; date ranges and free-text filter expressions are not supported. Filter values stay on-device and are included in reports you choose to save.</p>
  </section>;
}
