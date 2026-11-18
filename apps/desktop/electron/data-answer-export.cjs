'use strict';
const path = require('node:path');

const MAX_PAYLOAD_BYTES = 250_000;
const RESULT_KEYS = ['answer','calculation','evidence','table','title','warnings'];
function invalid() { throw new Error('Invalid Data Lab export. Calculate an answer before saving.'); }
function object(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function text(value, max, nullable = false) {
  if (nullable && value === null) return true;
  return typeof value === 'string' && value.length <= max && (nullable || value.trim().length > 0);
}
function validateDataAnswerInput(input, formats = ['html','csv','svg','bolt']) {
  if (!object(input, ['format','sourceName','target','question','interpretation','result'])
      || !formats.includes(input.format)
      || !text(input.sourceName,255) || !text(input.target,160) || !text(input.question,400)
      || !['local','model'].includes(input.interpretation)
      || !object(input.result,input.result?.chart===undefined?RESULT_KEYS:[...RESULT_KEYS,'chart'])) invalid();
  let encoded;
  try { encoded = JSON.stringify(input); } catch { invalid(); }
  if (Buffer.byteLength(encoded,'utf8') > MAX_PAYLOAD_BYTES) invalid();
  const r = input.result;
  if (!text(r.title,600) || !text(r.answer,10000)
      || !text(r.calculation,2000,true) || !text(r.evidence,2000,true)
      || !Array.isArray(r.table) || r.table.length > 512
      || !Array.isArray(r.warnings) || r.warnings.length > 40
      || !r.warnings.every(w => text(w,2000))) invalid();
  for (const row of r.table) {
    if (!object(row,['label','value','detail']) || !text(row.label,1000,true)
        || typeof row.label !== 'string' || !text(row.value,1000)
        || !text(row.detail,2000,true) || typeof row.detail !== 'string') invalid();
  }
  return input;
}

const clean = value => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');
const html = value => clean(value).replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
}[c]));
const method = input => input.interpretation === 'model'
  ? 'AI interpreted the question; the answer was calculated on-device.'
  : 'The question was interpreted and calculated locally.';
const SNAPSHOT_NOTE = 'Snapshot of the displayed answer and table, with formatted display values. This is not a full extract of the source CSV.';

function csvCell(value) {
  let cell = clean(value);
  // Quoting alone does not prevent spreadsheet formula evaluation.
  const numeric = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(cell) && Number.isFinite(Number(cell));
  const hazard = cell.normalize('NFKC'); // Includes full-width formula characters used by some spreadsheet locales.
  if (!numeric && (/^\s*[=+@-]/u.test(hazard) || /^[\t\r\n]/.test(hazard))) cell = "'" + cell;
  return '"' + cell.replace(/"/g,'""') + '"';
}
function csvDocument(input, created) {
  const r = input.result;
  const rows = [
    ['Section','Label','Value','Detail'],
    ['context','Source file',input.sourceName,''],
    ['context','Approved target',input.target,''],
    ['context','Question',input.question,''],
    ['context','Exported at (UTC)',created,''],
    ['result','Title',r.title,''],
    ['result','Answer',r.answer,''],
    ['method','Interpretation',method(input),''],
    ['method','Calculation',r.calculation || 'Not available',''],
    ['evidence','Coverage',r.evidence || 'Not available',''],
    ...r.table.map(row => ['table',row.label,row.value,row.detail]),
    ...(r.chart?[
      ['chart','Title',r.chart.title,''],['chart','X axis',r.chart.xLabel,''],['chart','Y axis',r.chart.yLabel,''],
      ['chart','Coverage',r.chart.note,''],
      ...r.chart.points.map(point=>['chart_value',point.label,String(point.value),point.detail]),
    ]:[]),
    ...r.warnings.map((warning,index) => ['limitation',String(index+1),warning,'']),
    ['scope','Export scope',SNAPSHOT_NOTE,''],
  ];
  return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function htmlDocument(input, created, chartSvg) {
  const r = input.result;
  const table = r.table.length ? [
    '<section><h2>Calculated table</h2><div class="table-scroll"><table>',
    '<thead><tr><th scope="col">Value / category</th><th scope="col">Calculated result</th><th scope="col">Evidence</th></tr></thead>',
    '<tbody>' + r.table.map(row => '<tr><td>' + html(row.label) + '</td><td>'
      + html(row.value) + '</td><td>' + html(row.detail) + '</td></tr>').join('') + '</tbody>',
    '</table></div></section>',
  ].join('') : '';
  const caveats = r.warnings.length ? '<section><h2>Methodology and caveats</h2><ul>'
    + r.warnings.map(w => '<li>' + html(w) + '</li>').join('') + '</ul></section>' : '';
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">',
    '<title>BOLT analysis — ' + html(r.title) + '</title>',
    '<style>',
    '*{box-sizing:border-box}body{margin:0;background:#f1f5f9;color:#0f172a;font:16px/1.65 system-ui,sans-serif}',
    'main{max-width:960px;margin:36px auto;padding:40px;background:#fff;border:1px solid #cbd5e1;border-radius:16px}',
    '.brand{color:#1e40af;font-weight:750;letter-spacing:.12em;font-size:13px}h1{font-size:30px;line-height:1.3;margin:16px 0}h2{font-size:18px;margin:24px 0 10px}',
    'p,li,td,dd{overflow-wrap:anywhere;white-space:pre-wrap}dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 20px;margin:24px 0}dt{font-weight:650}dd{margin:0}',
    '.finding{background:#eff6ff;border-left:4px solid #1e40af;padding:16px 20px;font-size:18px}.muted{color:#475569;font-size:13px}',
    'section>svg{display:block;width:100%;height:auto}.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:10px 12px;border-bottom:1px solid #cbd5e1;vertical-align:top}th{background:#f1f5f9;font-size:13px}',
    'footer{margin-top:30px;border-top:1px solid #cbd5e1;padding-top:14px}',
    '@media(max-width:680px){main{margin:0;padding:22px;border:0;border-radius:0}dl{grid-template-columns:1fr;gap:3px}dd{margin-bottom:9px}}',
    '@media print{body{background:#fff}main{margin:0;border:0;padding:0;max-width:none}.finding{break-inside:avoid}thead{display:table-header-group}tr{break-inside:avoid}}',
    '</style></head><body><main><header><div class="brand">BOLT AI · DATA LAB</div>',
    '<h1>' + html(r.title) + '</h1><p class="muted">Exported ' + html(created) + ' (UTC)</p></header>',
    '<dl><dt>Source file</dt><dd>' + html(input.sourceName) + '</dd><dt>Approved target</dt><dd>'
      + html(input.target) + '</dd><dt>Question</dt><dd>' + html(input.question) + '</dd></dl>',
    '<section aria-label="Calculated answer"><h2>Finding</h2><p class="finding">' + html(r.answer) + '</p></section>',
    chartSvg?'<section><h2>Calculated chart</h2>'+chartSvg+'<details><summary>Full chart data</summary><div class="table-scroll"><table><thead><tr><th>Label</th><th>Calculated value</th><th>Evidence</th></tr></thead><tbody>'+
      r.chart.points.map(point=>'<tr><td>'+html(point.label)+'</td><td>'+html(String(point.value))+'</td><td>'+html(point.detail)+'</td></tr>').join('')+
      '</tbody></table></div></details></section>':'',
    table,
    '<section><h2>Calculation and evidence</h2><p>' + html(r.calculation || 'Calculation not available')
      + '</p><p>' + html(r.evidence || 'Coverage not available') + '</p><p class="muted">' + method(input) + '</p></section>',
    caveats,
    '<footer class="muted"><p>' + SNAPSHOT_NOTE + '</p><p>Generated locally. No additional model request was made to create this export.</p></footer>',
    '</main></body></html>',
  ].join('');
}

function createDataAnswerExport(input, createdAt = new Date(), chartTools) {
  validateDataAnswerInput(input);
  let chartSvg='';
  if(input.result.chart!==undefined){
    if(typeof chartTools?.validateChart!=='function')invalid();
    chartTools.validateChart(input.result.chart);
    if(input.format!=='bolt'){
      if(typeof chartTools?.renderChartSvg!=='function')invalid();
      chartSvg=chartTools.renderChartSvg(input.result.chart,{
      sourceName:input.sourceName,target:input.target,question:input.question,
      calculation:input.result.calculation,evidence:input.result.evidence,warnings:input.result.warnings,
      });
    }
  }
  if(input.format==='svg'&&!chartSvg)invalid();
  const created = createdAt.toISOString();
  if(input.format==='bolt')return {
    filename:'BOLT-analysis.bolt',extension:'bolt',
    content:JSON.stringify({kind:'bolt.analysis.snapshot',version:1,savedAt:created,
      sourceName:input.sourceName,target:input.target,question:input.question,
      interpretation:input.interpretation,result:input.result})+'\n',
  };
  return {
    filename:'BOLT-analysis.' + input.format,
    extension:input.format,
    content:input.format === 'html' ? htmlDocument(input,created,chartSvg) : input.format === 'svg' ? chartSvg : csvDocument(input,created),
  };
}

function validateDataPresentationInput(input) {
  return validateDataAnswerInput(input, ['pptx']);
}

async function presentationContent(input, createPresentation) {
  if (typeof createPresentation !== 'function') throw new Error('PowerPoint generation is unavailable. Save as HTML or CSV instead.');
  let result;
  try { result = await createPresentation(input); }
  catch { throw new Error('Could not create this PowerPoint. Save as HTML or CSV for long or unsupported text, or try again.'); }
  const encoded = result?.content_base64;
  if (typeof encoded !== 'string' || encoded.length > 2_000_000
      || !Number.isInteger(result.slide_count) || result.slide_count < 3 || result.slide_count > 40) {
    throw new Error('Invalid local PowerPoint response');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 100 || bytes.length > 1_500_000 || bytes.toString('base64') !== encoded
      || !bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04]))) {
    throw new Error('Invalid local PowerPoint response');
  }
  return bytes;
}

async function saveDataAnswer(input, {showSaveDialog,writeFile,createPresentation}) {
  const pptx = input?.format === 'pptx';
  if (pptx) validateDataPresentationInput(input);
  if(!pptx)validateDataAnswerInput(input);
  const chartTools=input.result.chart!==undefined?await import('../shared/data-chart.mjs'):undefined;
  if(pptx&&chartTools)chartTools.validateChart(input.result.chart);
  const artifact = pptx ? {filename:'BOLT-analysis.pptx',extension:'pptx'} : createDataAnswerExport(input,new Date(),chartTools);
  const choice = await showSaveDialog({
    title:'Save BOLT analysis',
    defaultPath:artifact.filename,
    filters:[{name:artifact.extension === 'html' ? 'HTML analysis report' : pptx ? 'Editable PowerPoint' : artifact.extension === 'bolt' ? 'BOLT saved analysis' : artifact.extension === 'svg' ? 'SVG calculated chart' : 'CSV analysis results',
      extensions:[artifact.extension]}],
  });
  if (choice.canceled) return {saved:false};
  if (typeof choice.filePath !== 'string' || !choice.filePath || choice.filePath.includes('\0')
      || path.extname(choice.filePath).toLowerCase() !== '.' + artifact.extension) {
    throw new Error('Choose a .' + artifact.extension + ' filename for this export.');
  }
  const content = pptx ? await presentationContent(input, createPresentation) : artifact.content;
  try { await writeFile(choice.filePath,content,pptx ? undefined : 'utf8'); }
  catch { throw new Error('Could not save the analysis. Choose a writable folder and try again.'); }
  return {saved:true};
}

module.exports = {createDataAnswerExport,saveDataAnswer,validateDataPresentationInput,validateDataAnswerInput};
