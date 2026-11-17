/**
 * BOLT v1.0: transparent, template-routed questions against a local CSV.
 *
 * No model, network calls, arbitrary code, natural-language SQL, or full-row
 * persistence. Every supported answer is computed by analyzeCsvFile() from
 * an explicitly approved numeric target and a bounded streaming CSV pass.
 */
import {analyzeCsvFile} from './local-analysis.mjs';
import {validateChart} from '../shared/data-chart.mjs';

const MAX_QUESTION_LENGTH = 400;
const UNSUPPORTED_SCOPE = /\b(?:where|filter(?:ed)?|only rows|excluding|except|before|after|since|until|between \d{4}|last \d+|next \d+|previous \d+|in \d{4}|during \d{4}|for \d{4}|from \d{4}|greater than|less than|at least|more than \d+)\b/i;
const FORBIDDEN_INFERENCE = /\b(?:forecast|predict|prediction|project|future|cause|causal|why|significan(?:ce|t)|p-value|regression|optimi[sz]e|drivers?|impact|influence)\b/i;
const RELATIONSHIP = /\b(?:correlat\w*|relationship|relat(?:e|ed|ion)\w*|association)\b/i;
const UNSUPPORTED_STATISTIC = /\b(?:median|mode|percentiles?|quantiles?|quartiles?|variance|ratios?|proportions?|growth|weighted|cumulative|rolling|moving)\b/i;
const REQUESTED_GRAIN = /\b(?:daily|weekly|monthly|yearly|annual|by day|by week|by month|by year)\b/i;
const TIMELINE = /\b(?:trend|over time|time series|timeline|by date|by day|by week|by month|monthly|weekly|daily|across months?|across weeks?|changes? over time|period by period)\b/i;
const GROUP_CUE = /\b(?:by|per|across|each|among|within|breakdown|compare|comparison|highest|lowest|top|bottom|which)\b/i;
const TOTAL = /\b(?:sum|total|overall|aggregate|combined)\b/i;
const AVERAGE = /\b(?:average|mean|typical)\b/i;
const COUNT = /\b(?:how many|number of|count|records?|rows?|observations?)\b/i;
const RANGE = /\b(?:range|minimum|maximum|min|max|standard deviation|spread|distribution)\b/i;
const QUALITY = /\b(?:missing|nulls?|quality|blank|incomplete|invalid|malformed)\b/i;
const RANK_TOP = /\b(?:top|highest|largest|greatest|most|best)\b/i;
const RANK_BOTTOM = /\b(?:bottom|lowest|smallest|least|worst)\b/i;

function normalize(text) {
  return text.toLowerCase().replace(/[_-]+/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function containsColumn(question, name) {
  const q = ' ' + normalize(question) + ' ';
  const n = normalize(name);
  return n.length > 0 && q.includes(' ' + n + ' ');
}

function unsupported(message, title = 'Question needs clarification') {
  return {kind: 'unsupported', title, answer: message, table: [],
    calculation: null, evidence: null, warnings: []};
}

function metricChoice(question, profile, approvedTarget) {
  const mentioned = profile.columns.filter(col => col.type === 'numeric'
    && col.name !== approvedTarget && containsColumn(question, col.name));
  // When multiple predictors are named in a correlation question, these are not alternate targets.
  return mentioned;
}

export function suggestedDataQuestions(profile, target) {
  const group = profile.columns.find(col => col.type === 'categorical');
  const prompts = [
    'Summarize ' + target,
    'What is the average ' + target + '?',
    'What is the total ' + target + '?',
    'Which numeric columns correlate with ' + target + '?',
  ];
  if (group) prompts.splice(1, 0, 'Which ' + group.name + ' has the highest average ' + target + '?');
  if (profile.dateColumn) prompts.push('Show the trend of ' + target + ' over time');
  return prompts;
}

function questionGuard(question, profile, approvedTarget) {
  if (!profile || typeof approvedTarget !== 'string'
      || !profile.columns.some(col => col.name === approvedTarget && col.type === 'numeric')) {
    return {kind:'unsupported', error:'Approve a numeric target in the Data Lab first'};
  }
  if (typeof question !== 'string' || !question.trim()) {
    return {kind:'unsupported', error:'Enter a question about the approved target'};
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return {kind:'unsupported', error:'Keep questions under 400 characters'};
  }
  const q = question.trim();
  const namedCategoryValue = profile.columns
    .filter(col => col.type === 'categorical')
    .some(col => col.examples.some(example => example.length >= 3 && containsColumn(q, example)));
  if (namedCategoryValue) {
    return {kind:'unsupported', error:'Category-value filters are not supported yet. Ask for a grouped breakdown, such as “total ' + approvedTarget + ' by region”.'};
  }
  if (UNSUPPORTED_SCOPE.test(q) || /\b(?:19|20)\d{2}\b/.test(q)) {
    return {kind:'unsupported', error:'Filtered subsets and date-range questions are not available yet. Answers currently use all valid CSV rows.'};
  }
  if (FORBIDDEN_INFERENCE.test(q)) {
    return {kind:'unsupported', error:'This release calculates descriptive statistics only. It does not forecast, test statistical significance, determine causes or optimize.'};
  }
  if (UNSUPPORTED_STATISTIC.test(q)) {
    return {kind:'unsupported', error:'That statistic is not available yet. Ask for a total, arithmetic mean, range, count or descriptive overview.'};
  }
  if (REQUESTED_GRAIN.test(q)) {
    return {kind:'unsupported', error:'Calendar reaggregation is not available yet. Ask for a trend over time to summarize the observed date keys in the CSV.'};
  }
  return null;
}

export function planDataQuestion(question, profile, approvedTarget) {
  const blocked=questionGuard(question,profile,approvedTarget);
  if(blocked)return blocked;
  const q=question.trim();
  if (QUALITY.test(q)) return {kind:'quality', target: approvedTarget};
  const relationship = RELATIONSHIP.test(q);
  const mentions = metricChoice(q,profile,approvedTarget);
  const dimensions = profile.columns.filter(col => col.type === 'categorical' && containsColumn(q,col.name));
  const byDim = dimensions.sort((a,b) => b.name.length - a.name.length)[0];
  if (dimensions.length > 1 || (byDim && profile.dateColumn && containsColumn(q,profile.dateColumn))) {
    return {kind:'unsupported', error:'Ask for one categorical breakdown at a time. Combined categorical and date breakdowns are not supported yet.'};
  }
  const numerical = mentions.sort((a,b) => b.name.length - a.name.length);
  if (!relationship && numerical.length) {
    return {kind:'unsupported', error:'Another numeric field was mentioned. Approve that field as the target first, or explicitly ask for its correlation with ' + approvedTarget + '.'};
  }
  if (relationship) {
    if (numerical.length > 1) return {kind:'unsupported', error:'Ask for one numeric predictor at a time, or ask which columns correlate with the approved target.'};
    return {kind:'correlation', target:approvedTarget, predictor:numerical[0]?.name || null};
  }
  const dimension = byDim?.name || null;
  const ranking = RANK_TOP.test(q) ? 'top' : RANK_BOTTOM.test(q) ? 'bottom' : null;
  const aggregation = AVERAGE.test(q) ? 'mean' : 'sum';
  const numericLimit = /\b(?:top|bottom)\s+(\d{1,2})\b/i.exec(q);
  const limit = numericLimit ? Math.min(10,Math.max(1,Number(numericLimit[1]))) : 5;
  if (dimension && (GROUP_CUE.test(q) || ranking)) {
    if (RANGE.test(q) || (COUNT.test(q) && !AVERAGE.test(q) && !TOTAL.test(q))) {
      return {kind:'unsupported', error:'Grouped calculations support totals and arithmetic means only. Grouped counts and ranges are not available yet.'};
    }
    return {kind:'group', target:approvedTarget, dimension, aggregation, ranking, limit};
  }
  if (TIMELINE.test(q)) {
    if (RANGE.test(q) || (COUNT.test(q) && !AVERAGE.test(q) && !TOTAL.test(q))) {
      return {kind:'unsupported', error:'Date summaries support totals and arithmetic means only.'};
    }
    if (!profile.dateColumn) return {kind:'unsupported', error:'No reliable date column was detected. A time-series answer cannot be calculated.'};
    return {kind:'timeline', target:approvedTarget, dateColumn:profile.dateColumn, aggregation};
  }
  if (/\b(?:by|per|group(?:ed)?|breakdown)\b/i.test(q)) {
    return {kind:'unsupported', error:'Specify a categorical column from this CSV for a grouped total or mean.'};
  }
  if (ranking && !dimension) {
    return {kind:'unsupported', error:'Specify a categorical breakdown, for example “Which region has the highest total ' + approvedTarget + '?”'};
  }
  if (COUNT.test(q) && !AVERAGE.test(q) && !TOTAL.test(q)) return {kind:'count', target:approvedTarget};
  if (RANGE.test(q)) return {kind:'range', target:approvedTarget};
  if (AVERAGE.test(q)) return {kind:'mean', target:approvedTarget};
  if (TOTAL.test(q)) return {kind:'sum', target:approvedTarget};
  const targetName = normalize(approvedTarget);
  const overviewQuestions = [
    targetName, 'summarize '+targetName, 'summarise '+targetName,
    'describe '+targetName, 'summary of '+targetName, 'overview of '+targetName,
    'statistics for '+targetName, 'tell me about '+targetName,
    'show me '+targetName, 'what is '+targetName,
  ];
  if (overviewQuestions.includes(normalize(q))) return {kind:'overview', target:approvedTarget};
  return {kind:'unsupported', aiEligible:true, error:'I could not match that to a supported calculation. Try one of the suggested questions.'};
}

function fmt(n, digits = 2) {
  return Number.isFinite(n) ? n.toLocaleString('en-US',{maximumFractionDigits:digits}) : 'not available';
}
function datum(n) {
  return typeof n === 'number' ? fmt(n) : 'not available';
}
function qualityAnswer(profile, target) {
  const col = profile.columns.find(c=>c.name===target);
  const table = profile.columns.filter(c=>c.missing>0).sort((a,b)=>b.missing-a.missing)
    .slice(0,10).map(c=>({label:c.name, value:fmt(c.missing), detail:c.missingPct+'% missing'}));
  return {
    kind:'answered', title:'Data quality snapshot',
    answer:'The approved target ' + target + ' has ' + fmt(col.missing) + ' missing cells (' + col.missingPct + '%) across ' + fmt(profile.rowCount) + ' valid CSV records.',
    table, calculation:'Missing percentage = missing cells ÷ valid CSV rows × 100',
    evidence:'Local CSV schema profile · ' + fmt(profile.rowCount) + ' accepted rows · ' + fmt(profile.rejectedRows) + ' records rejected for malformed field counts',
    warnings:['This is a structural missingness summary, not a complete data-quality audit.','Rows rejected during CSV parsing are not included in missing percentages.'],
  };
}
function result(kind, title, answer, calculation, report, table = [], extra = []) {
  return {
    kind:'answered', title, answer, calculation, table,
    evidence:'On-device CSV scan · ' + fmt(report.validRows) + ' numeric target rows / '
      + fmt(report.scannedRows) + ' accepted rows · ' + fmt(report.excludedTargetRows) + ' missing or invalid target rows'
      + (report.dateColumn ? ' · ' + fmt(report.timelineRows) + ' rows represented in date buckets · '
        + fmt(report.excludedDateRows) + ' missing or invalid date rows · '
        + fmt(report.datedTargetRows - report.timelineRows) + ' valid date rows omitted at the date limit' : ''),
    warnings: [...extra, ...report.warnings],
  };
}

export async function answerDataQuestion(file, question, profile, approvedTarget) {
  return answerDataPlan(file, planDataQuestion(question,profile,approvedTarget), profile, approvedTarget);
}

export function validateDataPlan(input, profile, approvedTarget) {
  const all = ['kind','target','dimension','dateColumn','predictor','aggregation','ranking','limit','reason'];
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !all.includes(key))) throw new Error('Invalid calculation plan');
  if (!profile?.columns?.some(c => c.name === approvedTarget && c.type === 'numeric')
      || input.target !== approvedTarget) throw new Error('The model cannot change the approved numeric target');
  const plan = Object.fromEntries(Object.entries(input).filter(([,value]) => value !== null && value !== undefined));
  const allowed = ['kind','target'];
  const column = (name,type) => profile.columns.some(c => c.name === name && c.type === type);
  switch (plan.kind) {
    case 'overview': case 'sum': case 'mean': case 'count': case 'range': case 'quality': break;
    case 'group':
      allowed.push('dimension','aggregation','ranking','limit');
      if (!column(plan.dimension,'categorical') || !['sum','mean'].includes(plan.aggregation)
          || (plan.ranking !== undefined && !['top','bottom'].includes(plan.ranking))) throw new Error('Invalid grouped calculation');
      plan.limit ??= 5;
      if (!Number.isInteger(plan.limit) || plan.limit < 1 || plan.limit > 10) throw new Error('Invalid ranking limit');
      break;
    case 'timeline':
      allowed.push('dateColumn','aggregation');
      if (!column(plan.dateColumn,'date') || !['sum','mean'].includes(plan.aggregation)) throw new Error('Invalid date calculation');
      break;
    case 'correlation':
      allowed.push('predictor');
      if (plan.predictor !== undefined && (plan.predictor === approvedTarget || !column(plan.predictor,'numeric'))) throw new Error('Invalid numeric predictor');
      break;
    case 'unsupported':
      allowed.push('reason');
      if (plan.reason !== undefined && (typeof plan.reason !== 'string' || plan.reason.length > 200)) throw new Error('Invalid clarification');
      plan.reason = 'Choose a supported descriptive calculation, such as a total, mean or categorical breakdown.';
      break;
    default: throw new Error('Unsupported calculation');
  }
  if (Object.keys(plan).some(key => !allowed.includes(key))) throw new Error('Unsupported fields in calculation plan');
  return plan;
}


/** Display schema-only scope; never include calculated values in reusable context. */
export function describeDataPlan(plan) {
  if(!plan||plan.kind==='unsupported')return 'No active calculation';
  const aggregate=plan.aggregation==='mean'?'Mean':'Total';
  switch(plan.kind){
    case 'group':return (plan.ranking?(plan.ranking==='top'?'Top ':'Bottom ')+plan.limit+' · ':'')+aggregate+' '+plan.target+' by '+plan.dimension;
    case 'timeline':return aggregate+' '+plan.target+' by '+plan.dateColumn+' (observed dates)';
    case 'sum':return 'Total '+plan.target;
    case 'mean':return 'Mean '+plan.target;
    case 'count':return 'Valid '+plan.target+' rows';
    case 'range':return 'Range of '+plan.target;
    case 'overview':return 'Overview of '+plan.target;
    case 'quality':return 'Data quality for '+plan.target;
    case 'correlation':return 'Correlation of '+plan.target+(plan.predictor?' with '+plan.predictor:' with checked numeric columns');
    default:return 'No active calculation';
  }
}
function clarification(message) {return {plan:{kind:'unsupported',error:message},contextUsed:false};}
const sameName=(a,b)=>a.toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim()===b.toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();

export function resolveDataQuestionPlan(question,profile,approvedTarget,previousPlan=null) {
  if(typeof question!=='string')return {plan:planDataQuestion(question,profile,approvedTarget),contextUsed:false};
  const normalized=question.trim().replace(/[?!.]+$/g,'').trim();
  const repeat=/^(?:again|repeat\s+that|same\s+calculation)$/i.test(normalized);
  const cue=/^(?:and|also|now|instead|what about|how about)\s+(?:the\s+)?(.+)$/i.exec(normalized);
  if(!repeat&&!cue)return {plan:planDataQuestion(question,profile,approvedTarget),contextUsed:false};
  const blocked=questionGuard(question,profile,approvedTarget);
  if(blocked)return {plan:blocked,contextUsed:false};
  const tail=cue?.[1]||'';
  const fresh=planDataQuestion(question,profile,approvedTarget);
  if(!RELATIONSHIP.test(question)&&metricChoice(question,profile,approvedTarget).length){
    return clarification('Another numeric field was mentioned. Approve that field as the target first, or explicitly ask for its correlation with '+approvedTarget+'.');
  }
  const explicit=containsColumn(question,approvedTarget)&&(fresh.kind==='group'||fresh.kind==='timeline'||
    fresh.kind==='correlation'||fresh.kind==='quality'||/^(?:what is|what are|show|calculate|summari[sz]e|give)\b/i.test(tail));
  if(fresh.kind!=='unsupported'&&explicit)return {plan:fresh,contextUsed:false};
  if(!previousPlan)return clarification('There is no previous calculation to use. Ask a full question about the approved target first.');
  let prior;
  try{prior=validateDataPlan(previousPlan,profile,approvedTarget);}catch{return clarification('The previous calculation no longer matches this dataset and target. Ask a full question.');}
  if(prior.kind==='unsupported'||prior.kind==='quality')return clarification('There is no reusable numeric calculation. Ask a full question about the approved target.');
  let plan;
  if(repeat)plan=prior;
  else {
    const aggregate=/^(total|sum|average|mean)(?:\s+(.+))?$/i.exec(tail);
    const dimension=/^by\s+(.+)$/i.exec(tail);
    const ranking=/^(top|bottom)\s+(\d{1,2})(?:\s+(?:ones|groups|categories))?$/i.exec(tail);
    if(aggregate&&(!aggregate[2]||sameName(aggregate[2],approvedTarget))){
      const aggregation=/^(average|mean)$/i.test(aggregate[1])?'mean':'sum';
      if(prior.kind==='group'||prior.kind==='timeline')plan={...prior,aggregation};
      else if(['sum','mean','overview','count','range'].includes(prior.kind))plan={kind:aggregation,target:approvedTarget};
      else return clarification('Specify the target calculation explicitly after a quality or correlation question.');
    }else if(dimension){
      const categorical=profile.columns.filter(c=>c.type==='categorical');
      const exact=categorical.filter(c=>c.name.toLowerCase()===dimension[1].toLowerCase().trim());
      const matches=exact.length?exact:categorical.filter(c=>sameName(dimension[1],c.name));
      if(matches.length>1)return clarification('That breakdown matches more than one column. Use an exact CSV column name.');
      const column=matches[0];
      if(!column)return clarification('Choose a categorical column from this CSV for the breakdown.');
      if(prior.kind==='group')plan={...prior,dimension:column.name};
      else if(prior.kind==='sum'||prior.kind==='mean')plan={kind:'group',target:approvedTarget,dimension:column.name,
        aggregation:prior.kind,limit:5};
      else return clarification('Ask for a total or mean before changing the categorical breakdown.');
    }else if(ranking||/^(highest|lowest)$/i.test(tail)){
      if(prior.kind!=='group')return clarification('A top or bottom follow-up needs a previous categorical breakdown.');
      const limit=ranking?Number(ranking[2]):1;
      if(limit<1||limit>10)return clarification('Choose a top or bottom count from 1 to 10.');
      plan={...prior,ranking:ranking?ranking[1].toLowerCase():/^highest$/i.test(tail)?'top':'bottom',limit};
    }else return clarification('That follow-up is ambiguous. Ask for a total, mean, categorical breakdown or top/bottom count explicitly.');
  }
  return {plan:validateDataPlan(plan,profile,approvedTarget),contextUsed:true};
}

function attachChart(answer,chart) {
  try {validateChart(chart);return {...answer,chart};}
  catch {return {...answer,warnings:[...answer.warnings,'A chart could not be generated from these aggregate values. Use the calculation table.']};}
}

export async function answerDataPlan(file, inputPlan, profile, approvedTarget) {
  if (inputPlan.kind === 'unsupported') return unsupported(inputPlan.error || inputPlan.reason || 'Please rephrase the question.');
  const plan = validateDataPlan(inputPlan,profile,approvedTarget);
  if (plan.kind === 'quality') return qualityAnswer(profile,approvedTarget);

  const requestedDate = plan.kind === 'timeline' ? plan.dateColumn : null;
  const requestedGroup = plan.kind === 'group' ? plan.dimension : null;
  const report = await analyzeCsvFile(file,{
    target:approvedTarget, dimension:requestedGroup, dateColumn:requestedDate,
    predictor:plan.kind === 'correlation' ? plan.predictor : null,
  });
  if (!report.validRows) return result(plan.kind,'No numeric target observations',
    'The imported file has no valid numeric values for ' + approvedTarget + '.',
    'Count of rows with finite numeric target values',report);
  switch(plan.kind) {
    case 'overview':
      return result(plan.kind,approvedTarget + ' — descriptive overview',
        fmt(report.validRows) + ' target observations. Mean: ' + datum(report.mean) +
        ', total: ' + datum(report.total) + ', min: ' + datum(report.min) +
        ', max: ' + datum(report.max) + ', sample SD: ' + datum(report.standardDeviation) + '.',
        'Arithmetic mean, sum, min, max and sample standard deviation over nonmissing numeric target values',report);
    case 'count':
      return result(plan.kind,'Valid ' + approvedTarget + ' observations',
        fmt(report.validRows) + ' of ' + fmt(report.scannedRows) + ' accepted CSV rows contain a valid numeric ' + approvedTarget + '.',
        'Count of finite numeric target values',report);
    case 'sum':
      return result(plan.kind,'Total ' + approvedTarget,
        'The total ' + approvedTarget + ' is ' + datum(report.total) + ' across ' + fmt(report.validRows) + ' valid target rows.',
        'Sum of all valid numeric ' + approvedTarget + ' values, with no filter',report);
    case 'mean':
      return result(plan.kind,'Average ' + approvedTarget,
        'The arithmetic mean of ' + approvedTarget + ' is ' + datum(report.mean) + ' across ' + fmt(report.validRows) + ' valid target rows.',
        'Sum of ' + approvedTarget + ' ÷ number of valid numeric target rows',report);
    case 'range':
      return result(plan.kind,'Range of ' + approvedTarget,
        'Minimum: ' + datum(report.min) + '. Maximum: ' + datum(report.max) +
        '. Sample standard deviation: ' + datum(report.standardDeviation) + '.',
        'Minimum, maximum and sample standard deviation of numeric target observations',report);
    case 'group': {
      if (!report.groups.length) return result(plan.kind,'No group observations',
        'No valid grouped target observations were found.', 'Grouping by '+plan.dimension,report);
      // The overflow group combines distinct categories and cannot be used in a winner ranking.
      let groups = report.groups.filter(g => !g.isOverflow);
      groups = groups.sort((a,b)=>plan.ranking==='bottom'
        ? (a[plan.aggregation]-b[plan.aggregation] || a.label.localeCompare(b.label))
        : (b[plan.aggregation]-a[plan.aggregation] || a.label.localeCompare(b.label)));
      const rows = groups.slice(0,plan.ranking ? plan.limit : 12);
      const aggregateLabel = plan.aggregation==='mean' ? 'average' : 'total';
      const table = rows.map(g=>({label:g.label, value:datum(g[plan.aggregation]),
        detail:fmt(g.rows)+' target rows'}));
      const leader = rows[0];
      let answer = plan.ranking
        ? (leader ? leader.label+' has the '+(plan.ranking==='top'?'highest':'lowest')
          +' observed '+aggregateLabel+' '+approvedTarget+': '+datum(leader[plan.aggregation])+'.' : 'No individual groups were available.')
        : 'Calculated '+aggregateLabel+' '+approvedTarget+' for '+fmt(report.groups.length)+' observed group categories in '+plan.dimension+'.';
      if (report.groupsLimited) answer += ' More than 16 groups exist; results are partial, so the ranking is not guaranteed to be global.';
      return attachChart(result(plan.kind,aggregateLabel+' '+approvedTarget+' by '+plan.dimension,
        answer, (plan.aggregation==='mean'?'Sum ÷ valid target observations':'Sum of valid target observations')
        +' grouped by '+plan.dimension,report,table,
        report.groupsLimited ? ['Only the first 16 encountered groups are represented individually. Do not interpret the result as a complete top/bottom ranking.'] : []),{
          type:'bar',title:aggregateLabel+' '+approvedTarget+' by '+plan.dimension,
          xLabel:aggregateLabel+' '+approvedTarget,yLabel:plan.dimension,
          points:rows.map(g=>({label:g.label,value:g[plan.aggregation],detail:fmt(g.rows)+' target rows'})),
          note:'Showing '+rows.length+' of '+groups.length+' retained individual categories.'+
            (report.groupsLimited?' More categories exist; this is a partial comparison and rankings are not guaranteed global.':''),
        });
    }
    case 'timeline': {
      if (!report.timeline.length) return result(plan.kind,'No valid date observations',
        'No valid target observations with parseable ISO dates were found.',
        'Aggregate numeric target across observed date keys',report);
      const values=report.timeline;
      const first=values[0], last=values[values.length-1];
      const a=first[plan.aggregation], b=last[plan.aggregation];
      const unit = plan.aggregation==='mean' ? 'average' : 'total';
      const change=a===0 ? 'A percentage change is undefined because the first period is zero.'
        : 'Change between observed endpoints: '+fmt((b-a)/Math.abs(a)*100,1)+'%.';
      let sentence=unit+' '+approvedTarget+' was '+datum(a)+' on '+first.date
        +' and '+datum(b)+' on '+last.date+'. '+change;
      if (report.dateLimited) sentence+=' Dates were capped at 512 encountered distinct periods; this is an incomplete series.';
      return attachChart(result(plan.kind,approvedTarget+' across observed dates',
        sentence,'Group valid target values by parsed ISO date, then '+(plan.aggregation==='mean'?'calculate mean':'sum')+' by date',
        report,values.slice(0,12).map(v=>({label:v.date,value:datum(v[plan.aggregation]),detail:fmt(v.rows)+' target rows'})),
        ['First and last observed date buckets are not necessarily consecutive. No dates are imputed, and this is not a forecast.']),{
          type:'line',title:unit+' '+approvedTarget+' across observed dates',
          xLabel:plan.dateColumn,yLabel:unit+' '+approvedTarget,
          points:values.map(v=>({label:v.date,value:v[plan.aggregation],detail:fmt(v.rows)+' target rows'})),
          note:'All '+values.length+' retained observed date buckets are shown at equal spacing; elapsed gaps may differ. No dates are imputed.'+
            (report.dateLimited?' Additional date buckets were omitted at the 512-bucket limit.':''),
        });
    }
    case 'correlation': {
      const match=plan.predictor
        ? report.correlations.find(r=>r.column===plan.predictor)
        : report.correlations[0];
      if (!match) return result(plan.kind,'Correlation not available',
        plan.predictor
          ? 'A Pearson correlation with '+plan.predictor+' could not be estimated (insufficient paired numeric variation, or the predictor is beyond the 256-column check limit).'
          : 'No other numeric columns have enough paired variation for a Pearson correlation.',
        'Pearson r computed from nonmissing numeric pairs, requiring at least three pairs and nonzero variance',report);
      const answer = 'Pearson correlation of '+approvedTarget+' with '+match.column+': r = '
        +fmt(match.correlation,3)+' using '+fmt(match.pairedRows)+' paired rows.'
        +(plan.predictor?'':' This is the strongest absolute correlation among eligible checked predictors.');
      return result(plan.kind,'Relationship: '+approvedTarget+' and '+match.column,answer,
        'Pearson correlation coefficient r = covariance(x,y) ÷ (standard deviation(x) × standard deviation(y))',
        report,plan.predictor?[]:report.correlations.map(row=>({
          label:row.column,value:fmt(row.correlation,3),detail:fmt(row.pairedRows)+' paired rows',
        })),['This association is not causal. No statistical significance or predictive skill was established.']);
    }
    default:
      return unsupported('This calculation is not supported yet.');
  }
}
