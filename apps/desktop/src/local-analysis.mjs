/**
 * BOLT local descriptive analysis. Reads CSV using the existing streaming parser
 * and holds only bounded sufficient statistics, never individual source rows.
 * Not regression, a forecast, causality, or an LLM.
 */
import {createCsvProfiler, scanCsvFile} from './dataset-understanding.mjs';

const NUMBER = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;
const NULLS = new Set(['', 'null', 'na', 'n/a']);
const PREDICTOR_LIMIT = 256;
const GROUP_LIMIT = 16;
const DATE_LIMIT = 512;


export function validateCategoryFilter(input, profile=null) {
  if(input===null||input===undefined)return null;
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='column,value'
    ||typeof input.column!=='string'||!input.column.trim()||input.column.length>160
    ||typeof input.value!=='string'||!input.value.trim()||input.value.length>1000
    ||JSON.stringify(input.value.trim()).length>1200){
    throw new Error('Invalid local category filter');
  }
  if(profile&&!profile.columns.some(c=>c.name===input.column&&c.type==='categorical')){
    throw new Error('The filter must use an existing categorical column');
  }
  return {column:input.column,value:input.value.trim()};
}
export function describeCategoryFilter(filter) {
  return filter?filter.column+' = '+JSON.stringify(filter.value):'All accepted CSV rows';
}

function numeric(text) {
  const v = String(text).trim();
  if (NULLS.has(v.toLowerCase()) || !NUMBER.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dateKey(raw) {
  const v = String(raw).trim();
  const m = /^(\d{4})[-/](\d{2})(?:[-/](\d{2}))?$/.exec(v);
  if (!m) return null;
  const y = Number(m[1]), month = Number(m[2]), day = m[3] ? Number(m[3]) : 1;
  const date = new Date(Date.UTC(y, month - 1, day));
  if (y < 1900 || y > 2200 || date.getUTCFullYear() !== y
      || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return m[3] ? m[1] + '-' + m[2] + '-' + m[3] : m[1] + '-' + m[2];
}


export const DATE_FILTER_CONVENTION='Month-only source keys use the first day of that month; monthly aggregates are not split into days.';
export function validateDateFilter(input,profile=null) {
  if(input===null||input===undefined)return null;
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='column,from,to'
    ||typeof input.column!=='string'||!input.column.trim()||input.column.length>160){
    throw new Error('Invalid local date filter');
  }
  for(const bound of [input.from,input.to]){
    if(bound!==null&&(typeof bound!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(bound)||dateKey(bound)!==bound)){
      throw new Error('Date filter bounds must be real ISO dates from 1900 through 2200');
    }
  }
  if(input.from===null&&input.to===null)throw new Error('A date filter needs at least one bound');
  if(input.from&&input.to&&input.from>input.to)throw new Error('Date filter start must be on or before end');
  if(profile&&!profile.columns.some(c=>c.name===input.column&&c.type==='date')){
    throw new Error('The date filter must use an existing date column');
  }
  return {column:input.column,from:input.from,to:input.to};
}
export function describeDateFilter(filter) {
  return filter?filter.column+': '+(filter.from?'from '+filter.from:'from the first observed key')+
    (filter.to?' through '+filter.to:' through the last observed key')+' (inclusive date keys)':'';
}
export function describeFilterScope(categoryFilter,dateFilter) {
  if(!categoryFilter&&!dateFilter)return 'All accepted CSV rows';
  return [categoryFilter?describeCategoryFilter(categoryFilter):'',describeDateFilter(dateFilter)].filter(Boolean).join(' · ');
}

function newPair(name, index) {
  return {name, index, n: 0, meanX: 0, meanY: 0, m2X: 0, m2Y: 0, covariance: 0};
}

function addPair(p, x, y) {
  p.n++;
  const dx = x - p.meanX, dy = y - p.meanY;
  p.meanX += dx / p.n;
  p.meanY += dy / p.n;
  p.m2X += dx * (x - p.meanX);
  p.m2Y += dy * (y - p.meanY);
  p.covariance += dx * (y - p.meanY);
}

function collector(options) {
  if (!options || typeof options.target !== 'string' || !options.target.trim()) {
    throw new Error('Approve a numeric target before running analysis');
  }
  const categoryFilter = validateCategoryFilter(options.categoryFilter);
  const dateFilter = validateDateFilter(options.dateFilter);
  const filtered = Boolean(categoryFilter||dateFilter);
  const target = options.target;
  const dimension = options.dimension || null;
  const dateColumn = options.dateColumn || null;
  const predictor = options.predictor || null;
  if (target === dimension || target === dateColumn) throw new Error('Target must be separate from date and group columns');
  let targetIndex = -1, dimensionIndex = -1, dateIndex = -1, filterIndex = -1, rangeDateIndex = -1;
  let matchedRows = 0, categoryMatchedRows = 0, invalidFilterDateRows = 0, missingness = null;
  let pairs = null;
  let retainedPredictorCount = 0;
  let predictorLimited = false;
  let valid = 0, mean = 0, m2 = 0, sum = 0, min = null, max = null;
  let dateLimited = false, groupsLimited = false;
  let datedTargetRows = 0, timelineRows = 0;
  const dates = new Map(), groups = new Map();
  const OVERFLOW = Symbol('overflow');

  function consume(headers, values) {
    if (!pairs) {
      targetIndex = headers.indexOf(target);
      filterIndex = categoryFilter ? headers.indexOf(categoryFilter.column) : -1;
      if(categoryFilter&&filterIndex<0)throw new Error('Filter column is not present in the dataset');
      rangeDateIndex = dateFilter ? headers.indexOf(dateFilter.column) : -1;
      if(dateFilter&&rangeDateIndex<0)throw new Error('Date filter column is not present in the dataset');
      if(filtered)missingness = Array(headers.length).fill(0);
      dimensionIndex = dimension === null ? -1 : headers.indexOf(dimension);
      dateIndex = dateColumn === null ? -1 : headers.indexOf(dateColumn);
      if (targetIndex < 0) throw new Error('Target column is not present in the dataset');
      if (dimension !== null && dimensionIndex < 0) throw new Error('Group column is not present');
      if (dateColumn !== null && dateIndex < 0) throw new Error('Date column is not present');
      const predictorHeaders = headers.map((name, index) => ({name, index}))
        .filter(({index}) => ![targetIndex, dateIndex, dimensionIndex].includes(index));
      retainedPredictorCount = Math.min(predictorHeaders.length, PREDICTOR_LIMIT);
      predictorLimited = predictorHeaders.length > PREDICTOR_LIMIT;
      pairs = predictorHeaders.slice(0, PREDICTOR_LIMIT).map(({name, index}) => newPair(name, index));
    }
    if(categoryFilter&&values[filterIndex].trim()!==categoryFilter.value)return;
    categoryMatchedRows++;
    if(dateFilter){
      const key=dateKey(values[rangeDateIndex]);
      if(key===null){invalidFilterDateRows++;return;}
      const day=key.length===7?key+'-01':key;
      if((dateFilter.from&&day<dateFilter.from)||(dateFilter.to&&day>dateFilter.to))return;
    }
    matchedRows++;
    if(missingness)values.forEach((value,i)=>{if(NULLS.has(value.trim().toLowerCase()))missingness[i]++;});
    const y = numeric(values[targetIndex]);
    if (y === null) return;
    valid++;
    sum += y;
    const delta = y - mean;
    mean += delta / valid;
    m2 += delta * (y - mean);
    min = min === null ? y : Math.min(min, y);
    max = max === null ? y : Math.max(max, y);

    for (const p of pairs) {
      const x = numeric(values[p.index]);
      if (x !== null) addPair(p, x, y);
    }

    if (dimensionIndex >= 0) {
      const label = values[dimensionIndex].trim() || '(blank)';
      let key = label;
      if (!groups.has(key) && groups.size >= GROUP_LIMIT + (groups.has(OVERFLOW) ? 1 : 0)) {
        key = OVERFLOW;
        groupsLimited = true;
      }
      const entry = groups.get(key) || {label: key === OVERFLOW ? 'Additional groups' : label,
        isOverflow: key === OVERFLOW, sum: 0, n: 0};
      entry.sum += y;
      entry.n++;
      groups.set(key, entry);
    }

    if (dateIndex >= 0) {
      const key = dateKey(values[dateIndex]);
      if (key !== null) {
        datedTargetRows++;
        if (!dates.has(key) && dates.size >= DATE_LIMIT) {
          dateLimited = true;
        } else {
          const entry = dates.get(key) || {date: key, sum: 0, n: 0};
          entry.n++;
          entry.sum += y;
          dates.set(key, entry);
          timelineRows++;
        }
      }
    }
  }

  function finish(profile) {
    validateCategoryFilter(categoryFilter,profile);
    validateDateFilter(dateFilter,profile);
    const targetProfile = profile.columns.find(col => col.name === target);
    if (!targetProfile || targetProfile.type !== 'numeric') {
      throw new Error('Approved target must be a consistently numeric column');
    }
    if (dimension && profile.columns.find(col => col.name === dimension)?.type !== 'categorical') {
      throw new Error('Group column must be categorical');
    }
    if (dateColumn && profile.columns.find(col => col.name === dateColumn)?.type !== 'date') {
      throw new Error('Date column must be date-formatted');
    }
    if (predictor && (predictor === target
        || profile.columns.find(col => col.name === predictor)?.type !== 'numeric')) {
      throw new Error('Correlation predictor must be a separate numeric column in the dataset');
    }
    const corrs = (pairs || []).filter(p =>
      profile.columns.find(col => col.name === p.name)?.type === 'numeric'
      && p.n >= 3 && p.m2X > 0 && p.m2Y > 0
    ).map(p => ({
      column: p.name, pairedRows: p.n,
      correlation: Math.max(-1, Math.min(1, p.covariance / Math.sqrt(p.m2X * p.m2Y))),
    })).sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation)
      || a.column.localeCompare(b.column));
    const groupRows = [...groups.values()].map(row => ({
      label: row.label, isOverflow: row.isOverflow, rows: row.n, sum: row.sum, mean: row.sum / row.n,
    })).sort((a, b) => b.rows - a.rows || a.label.localeCompare(b.label));
    const timeline = [...dates.values()].sort((a, b) => a.date.localeCompare(b.date))
      .map(row => ({date: row.date, rows: row.n, sum: row.sum, mean: row.sum / row.n}));

    const warnings = [];
    if (profile.rejectedRows) warnings.push(profile.rejectedRows + ' malformed CSV records were excluded');
    const coverage=matchedRows+' of '+profile.rowCount+' accepted rows matched all active filters; '+(profile.rowCount-matchedRows)+' rows excluded by filters.';
    if(categoryFilter)warnings.push('Local category filter: '+describeCategoryFilter(categoryFilter)+'. '+coverage);
    if(dateFilter)warnings.push('Local date filter: '+describeDateFilter(dateFilter)+'. '+DATE_FILTER_CONVENTION+' '+coverage);
    if(dateFilter)warnings.push('Filter exclusions: '+(profile.rowCount-categoryMatchedRows)+' category exclusions; '+(categoryMatchedRows-matchedRows)+' date-filter exclusions, including '+invalidFilterDateRows+' missing or invalid date keys after category matching. All exclusions occur before target statistics.');
    if (matchedRows - valid) warnings.push((matchedRows - valid) + (filtered?' matching':' accepted')+' CSV rows had missing or nonnumeric target values');
    if (valid < 3) warnings.push('Very few valid target values; interpret patterns cautiously');
    if (valid && min === max) warnings.push('Target has no variation; correlations are undefined');
    const excludedDateRows = dateColumn ? valid - datedTargetRows : 0;
    if (excludedDateRows) warnings.push(excludedDateRows + ' numeric target rows had a missing or invalid date and were excluded from the date series');
    if (dateLimited) warnings.push('Date series is limited to the first 512 distinct dates encountered; '
      + (datedTargetRows - timelineRows) + ' valid date rows were omitted; it is not complete');
    if (groupsLimited) warnings.push('Only the first 16 distinct groups are shown individually; remaining groups are aggregated');
    if (predictorLimited) warnings.push('Correlation checks are limited to the first 256 non-target, non-date, non-group columns');
    if (profile.timeGrain === 'irregular' && dateColumn) warnings.push('Date intervals are irregular; no missing periods were filled');
    warnings.push('Correlation is descriptive, not evidence of causality; no model was trained');
    return {
      target, dimension, dateColumn, scannedRows: profile.rowCount, validRows: valid,
      categoryFilter, dateFilter, matchedRows, excludedByFilterRows: profile.rowCount-matchedRows,
      excludedByCategoryRows:profile.rowCount-categoryMatchedRows,excludedByDateFilterRows:categoryMatchedRows-matchedRows,invalidFilterDateRows,
      ...(filtered?{missingness:profile.columns.map((col,i)=>({name:col.name,missing:missingness?.[i]||0}))}:{}),
      excludedTargetRows: matchedRows - valid,
      total: valid ? sum : null, mean: valid ? mean : null,
      standardDeviation: valid > 1 ? Math.sqrt(m2 / (valid - 1)) : null,
      min, max, correlations: predictor ? corrs.filter(row => row.column === predictor) : corrs.slice(0, 12),
      checkedPredictorColumns: retainedPredictorCount,
      groups: groupRows, timeline, datedTargetRows, excludedDateRows, timelineRows,
      dateLimited, groupsLimited, warnings,
      processing: 'On-device descriptive statistics over valid CSV records; bounded memory; no network requests',
    };
  }
  return {consume, finish};
}

export function analyzeCsvText(text, options, filename = 'dataset.csv') {
  const analysis = collector(options);
  const parser = createCsvProfiler(filename, analysis.consume);
  parser.push(text);
  return analysis.finish(parser.finish());
}

export async function analyzeCsvFile(file, options) {
  const analysis = collector(options);
  const profile = await scanCsvFile(file, analysis.consume);
  return analysis.finish(profile);
}
