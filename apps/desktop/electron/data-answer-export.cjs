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
function validateInput(input) {
  if (!object(input, ['format','sourceName','target','question','interpretation','result'])
      || !['html','csv'].includes(input.format)
      || !text(input.sourceName,255) || !text(input.target,160) || !text(input.question,400)
      || !['local','model'].includes(input.interpretation)
      || !object(input.result,RESULT_KEYS)) invalid();
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
    ...r.warnings.map((warning,index) => ['limitation',String(index+1),warning,'']),
    ['scope','Export scope',SNAPSHOT_NOTE,''],
  ];
  return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function htmlDocument(input, created) {
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
    '.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:10px 12px;border-bottom:1px solid #cbd5e1;vertical-align:top}th{background:#f1f5f9;font-size:13px}',
    'footer{margin-top:30px;border-top:1px solid #cbd5e1;padding-top:14px}',
    '@media(max-width:680px){main{margin:0;padding:22px;border:0;border-radius:0}dl{grid-template-columns:1fr;gap:3px}dd{margin-bottom:9px}}',
    '@media print{body{background:#fff}main{margin:0;border:0;padding:0;max-width:none}.finding{break-inside:avoid}thead{display:table-header-group}tr{break-inside:avoid}}',
    '</style></head><body><main><header><div class="brand">BOLT AI · DATA LAB</div>',
    '<h1>' + html(r.title) + '</h1><p class="muted">Exported ' + html(created) + ' (UTC)</p></header>',
    '<dl><dt>Source file</dt><dd>' + html(input.sourceName) + '</dd><dt>Approved target</dt><dd>'
      + html(input.target) + '</dd><dt>Question</dt><dd>' + html(input.question) + '</dd></dl>',
    '<section aria-label="Calculated answer"><h2>Finding</h2><p class="finding">' + html(r.answer) + '</p></section>',
    table,
    '<section><h2>Calculation and evidence</h2><p>' + html(r.calculation || 'Calculation not available')
      + '</p><p>' + html(r.evidence || 'Coverage not available') + '</p><p class="muted">' + method(input) + '</p></section>',
    caveats,
    '<footer class="muted"><p>' + SNAPSHOT_NOTE + '</p><p>Generated locally. No additional model request was made to create this export.</p></footer>',
    '</main></body></html>',
  ].join('');
}

function createDataAnswerExport(input, createdAt = new Date()) {
  validateInput(input);
  const created = createdAt.toISOString();
  return {
    filename:'BOLT-analysis.' + input.format,
    extension:input.format,
    content:input.format === 'html' ? htmlDocument(input,created) : csvDocument(input,created),
  };
}

async function saveDataAnswer(input, {showSaveDialog,writeFile}) {
  const artifact = createDataAnswerExport(input);
  const choice = await showSaveDialog({
    title:'Save BOLT analysis',
    defaultPath:artifact.filename,
    filters:[{name:artifact.extension === 'html' ? 'HTML analysis report' : 'CSV analysis results',
      extensions:[artifact.extension]}],
  });
  if (choice.canceled) return {saved:false};
  if (typeof choice.filePath !== 'string' || !choice.filePath || choice.filePath.includes('\0')
      || path.extname(choice.filePath).toLowerCase() !== '.' + artifact.extension) {
    throw new Error('Choose a .' + artifact.extension + ' filename for this export.');
  }
  try { await writeFile(choice.filePath,artifact.content,'utf8'); }
  catch { throw new Error('Could not save the analysis. Choose a writable folder and try again.'); }
  return {saved:true};
}

module.exports = {createDataAnswerExport,saveDataAnswer};
