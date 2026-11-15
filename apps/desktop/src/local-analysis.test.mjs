import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeCsvText, analyzeCsvFile} from './local-analysis.mjs';

const sample = 'month,region,spend,revenue,constant\n'
  + '2026-01,East,1,10,3\n'
  + '2026-01,East,2,20,3\n'
  + '2026-02,West,3,30,3\n'
  + '2026-02,West,4,40,3\n';

test('computes exact descriptive target moments, correlation, group means and date sums', () => {
  const result = analyzeCsvText(sample, {target:'revenue', dimension:'region', dateColumn:'month'});
  assert.equal(result.scannedRows, 4);
  assert.equal(result.validRows, 4);
  assert.equal(result.total, 100);
  assert.equal(result.mean, 25);
  assert.ok(Math.abs(result.standardDeviation - Math.sqrt(500 / 3)) < 1e-9);
  assert.equal(result.min, 10);
  assert.equal(result.max, 40);
  assert.equal(result.groups.length, 2);
  assert.deepEqual(result.groups.map(x => [x.label,x.rows,x.sum,x.mean]), [
    ['East', 2, 30, 15], ['West', 2, 70, 35],
  ]);
  assert.deepEqual(result.timeline.map(x => [x.date,x.rows,x.sum]), [
    ['2026-01',2,30],['2026-02',2,70],
  ]);
  assert.equal(result.correlations.length, 1);
  assert.equal(result.correlations[0].column, 'spend');
  assert.ok(Math.abs(result.correlations[0].correlation - 1) < 1e-12);
  assert.ok(result.warnings.some(x => x.includes('not evidence of causality')));
});

test('excludes missing target, mismatched records and missing paired predictors', () => {
  const csv = 'date,target,other\n'
    + '2026-01-01,1,10\n'
    + '2026-01-02,2,\n'
    + '2026-01-03,3,30\n'
    + '2026-01-04,,40\n'
    + '2026-01-05,99,30,extra\n'
    + '2026-01-06,4,40\n';
  const result = analyzeCsvText(csv, {target:'target', dateColumn:'date'});
  assert.equal(result.scannedRows, 5);
  assert.equal(result.validRows, 4);
  assert.equal(result.excludedTargetRows, 1);
  assert.equal(result.mean, 2.5);
  assert.equal(result.correlations[0].pairedRows, 3);
  assert.ok(result.warnings.some(x => x.includes('malformed CSV records')));
  assert.equal(result.timeline.length, 4);
});

test('date coverage counts only rows with both numeric target and a valid date', () => {
  const dated = Array.from({length:19},(_,i)=>'2026-01-'+String(i+1).padStart(2,'0')+',1');
  const csv = ['date,metric',...dated,',1','invalid,1',','].join('\n');
  const result = analyzeCsvText(csv,{target:'metric',dateColumn:'date'});
  assert.equal(result.scannedRows,22);
  assert.equal(result.validRows,21);
  assert.equal(result.datedTargetRows,19);
  assert.equal(result.excludedDateRows,2);
  assert.equal(result.timelineRows,19);
  assert.ok(result.warnings.some(w=>/2.*missing or invalid date/.test(w)));
});

test('rejects unknown, nonnumeric and conflicting target selections', () => {
  assert.throws(() => analyzeCsvText(sample,{target:'not_here'}), /not present/);
  assert.throws(() => analyzeCsvText(sample,{target:'region'}), /consistently numeric/);
  assert.throws(() => analyzeCsvText(sample,{target:'revenue',dimension:'revenue'}), /separate/);
  assert.throws(() => analyzeCsvText(sample,{target:'revenue',dateColumn:'spend'}), /date-formatted/);
  assert.throws(() => analyzeCsvText(sample,{target:'revenue',dimension:'spend'}), /categorical/);
  assert.throws(() => analyzeCsvText(sample,{}), /Approve a numeric target/);
});

test('group cardinality cap rolls later groups into a disclosed overflow bucket', () => {
  const rows = Array.from({length:20}, (_,i) => Array.from({length:5}, ()=>'G'+i+','+(i+1))).flat();
  const result = analyzeCsvText('group,metric\n'+rows.join('\n'), {target:'metric',dimension:'group'});
  assert.equal(result.validRows, 100);
  assert.equal(result.groupsLimited,true);
  assert.equal(result.groups.length,17);
  const extra = result.groups.find(x=>x.label==='Additional groups');
  assert.equal(extra.rows,20);
  assert.equal(extra.sum,370);
});

test('keeps a real Additional groups category separate from the overflow bucket', () => {
  const names = ['Additional groups',...Array.from({length:19},(_,i)=>'G'+i)];
  const rows = names.flatMap((name,i)=>Array.from({length:5},()=>name+','+(i+1)));
  const result = analyzeCsvText('group,metric\n'+rows.join('\n'),{target:'metric',dimension:'group'});
  const matching = result.groups.filter(row=>row.label==='Additional groups');
  assert.equal(matching.length,2);
  assert.equal(matching.find(row=>!row.isOverflow).sum,5);
  assert.equal(matching.find(row=>row.isOverflow).sum,370);
  assert.equal(result.groupsLimited,true);
});

test('a requested correlation still respects the 256-column computation limit', () => {
  const names = Array.from({length:257},(_,i)=>'signal_'+i);
  const rows = Array.from({length:5},(_,i)=>[i+1,...names.map(()=>i+1)].join(','));
  const csv = ['metric,'+names.join(','),...rows].join('\n');
  const result = analyzeCsvText(csv,{target:'metric',predictor:'signal_256'});
  assert.equal(result.checkedPredictorColumns,256);
  assert.deepEqual(result.correlations,[]);
  assert.ok(result.warnings.some(w=>w.includes('first 256')));
});

test('rejects nonexistent, nonnumeric and self-correlation predictor selections', () => {
  for (const predictor of ['missing','region','revenue']) {
    assert.throws(()=>analyzeCsvText(sample,{target:'revenue',predictor}), /Correlation predictor/);
  }
});

test('processes 150 media predictors without materializing CSV rows', () => {
  const names = Array.from({length:150}, (_,i)=>'media_'+i);
  const lines = ['date,revenue,'+names.join(',')];
  for(let i=0;i<5;i++) lines.push('2026-01-0'+(i+1)+','+(10+i)+','+names.map((_,j)=>i+j).join(','));
  const result = analyzeCsvText(lines.join('\n'), {target:'revenue', dateColumn:'date'});
  assert.equal(result.checkedPredictorColumns,150);
  assert.equal(result.correlations.length,12);
  assert.equal(result.correlations[0].pairedRows,5);
  assert.equal(result.timeline.length,5);
});

test('streams UTF-8 chunks through the same CSV reader and never retains source rows',async()=>{
  const bytes=new TextEncoder().encode(sample);
  const file={name:'synthetic.csv',stream(){
    let i=0;
    return new ReadableStream({pull(controller){
      if(i>=bytes.length)controller.close();
      else controller.enqueue(bytes.slice(i,i++ + 1));
    }});
  }};
  const report=await analyzeCsvFile(file,{target:'revenue',dimension:'region',dateColumn:'month'});
  assert.equal(report.mean,25);
  assert.equal(report.total,100);
  assert.equal(Object.hasOwn(report,'rows'),false);
  assert.equal(JSON.stringify(report).includes('constant'),false);
});

test('exposes clearly bounded date aggregation above 512 distinct periods',()=>{
  const lines=['date,metric'];
  const start=Date.UTC(2025,0,1);
  for(let i=0;i<515;i++) lines.push(new Date(start+i*86400000).toISOString().slice(0,10)+',1');
  const r=analyzeCsvText(lines.join('\n'),{target:'metric',dateColumn:'date'});
  assert.equal(r.validRows,515);
  assert.equal(r.timeline.length,512);
  assert.equal(r.dateLimited,true);
  assert.ok(r.warnings.some(x=>x.includes('not complete')));
  assert.equal(r.datedTargetRows,515);
  assert.equal(r.timelineRows,512);
  assert.equal(r.excludedDateRows,0);
  const repeated = analyzeCsvText(lines.join('\n')+'\n2025-01-01,1', {target:'metric',dateColumn:'date'});
  assert.equal(repeated.datedTargetRows,516);
  assert.equal(repeated.timelineRows,513);
  assert.equal(repeated.timeline[0].rows,2);
});
