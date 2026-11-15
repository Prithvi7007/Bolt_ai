/**
 * Local-only, streaming CSV data understanding. No network, disk writes, or LLMs.
 * Summaries are exact except distinct values are capped at 2048 per column.
 */
const MAX_DISTINCT = 2048;
const NULLS = new Set(['', 'null', 'n/a', 'na']);
const NUMERIC = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;
const METRIC_WORDS = /(revenue|sales|attendance|demand|volume|visitors|visits|orders|units|bookings|tickets|profit|cost|spend|conversions|value|target|y$)/i;
const DATE_WORDS = /(date|day|week|month|year|period|timestamp|time)/i;

function dateValue(value) {
  const match = /^(\d{4})[-/](\d{2})(?:[-/](\d{2}))?$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] === undefined ? 1 : Number(match[3]);
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const actual = new Date(Date.UTC(year, month - 1, day));
  if (actual.getUTCFullYear() !== year || actual.getUTCMonth() !== month - 1 || actual.getUTCDate() !== day) return null;
  return {stamp: actual.getTime(), isMonth: match[3] === undefined};
}

function createCsvProfiler(filename = 'dataset.csv') {
  let header = null;
  let stats = [];
  let rowCount = 0;
  let malformedRows = 0;
  let lineNumber = 0;
  let columnIssues = [];
  const preview = [];
  let cell = '';
  let record = [];
  let quoted = false;
  let quoteEnded = false;
  let any = false;
  let justCR = false;
  let firstChar = true;

  function endField() {
    record.push(cell);
    cell = '';
    quoteEnded = false;
  }

  function endRow() {
    if (!any && record.length === 0 && cell.length === 0) return;
    endField();
    lineNumber += 1;
    const values = record;
    record = [];
    any = false;
    if (header === null) {
      header = values.map(x => x.trim());
      if (!header.length || header.some(x => !x)) throw new Error('CSV headers cannot be empty');
      const keys = header.map(x => x.toLocaleLowerCase());
      if (new Set(keys).size !== header.length) throw new Error('Duplicate CSV column headers are not supported');
      stats = header.map(name => ({
        name, nonNull: 0, missing: 0, numeric: 0, date: 0, min: null, max: null,
        examples: [], distinct: new Set(), distinctCapped: false,
        dates: new Set(), allDatesMonth: true,
      }));
      return;
    }
    if (values.length !== header.length) {
      malformedRows++;
      if (columnIssues.length < 5) {
        columnIssues.push('Record ' + lineNumber + ' has ' + values.length +
          ' fields; expected ' + header.length);
      }
      return;
    }
    rowCount++;
    if (preview.length < 5) preview.push(values.map(x => x.slice(0, 160)));
    for (let index = 0; index < values.length; index++) {
      const column = stats[index];
      const value = values[index].trim();
      if (NULLS.has(value.toLowerCase())) {
        column.missing++;
        continue;
      }
      column.nonNull++;
      if (column.examples.length < 3 && !column.examples.includes(value)) column.examples.push(value.slice(0, 80));
      if (column.distinct.size < MAX_DISTINCT) column.distinct.add(value);
      else if (!column.distinct.has(value)) column.distinctCapped = true;
      if (NUMERIC.test(value) && Number.isFinite(Number(value))) {
        const num = Number(value);
        column.numeric++;
        column.min = column.min === null ? num : Math.min(column.min, num);
        column.max = column.max === null ? num : Math.max(column.max, num);
      }
      const date = dateValue(value);
      if (date) {
        column.date++;
        if (column.dates.size < MAX_DISTINCT) column.dates.add(date.stamp);
        column.allDatesMonth &&= date.isMonth;
      }
    }
  }

  function push(chunk) {
    if (typeof chunk !== 'string') throw new TypeError('CSV decoder must produce text');
    for (const ch of chunk) {
      if (firstChar) {
        firstChar = false;
        if (ch === '\uFEFF') continue;
      }
      if (justCR) {
        justCR = false;
        if (ch === '\n') continue;
      }
      if (quoted) {
        if (ch === '"') {
          quoted = false;
          quoteEnded = true;
        } else {
          cell += ch;
        }
        any = true;
        continue;
      }
      if (quoteEnded) {
        if (ch === '"') {
          cell += '"';
          quoted = true;
          quoteEnded = false;
          any = true;
          continue;
        }
        if (ch !== ',' && ch !== '\n' && ch !== '\r') {
          throw new Error('Unexpected characters after a quoted CSV value');
        }
      } else if (ch === '"') {
        if (cell.length) throw new Error('Unexpected quote inside an unquoted CSV value');
        quoted = true;
        any = true;
        continue;
      }
      if (ch === ',') {
        endField();
        any = true;
      } else if (ch === '\n' || ch === '\r') {
        endRow();
        if (ch === '\r') justCR = true;
      } else {
        cell += ch;
        any = true;
      }
    }
  }

  function finish() {
    if (quoted) throw new Error('CSV has an unclosed quoted field');
    endRow();
    if (header === null) throw new Error('CSV is empty or has no header row');
    if (rowCount === 0) throw new Error('CSV does not contain any valid data rows');

    const columns = stats.map(stat => {
      const confidence = stat.nonNull ? 0.95 * stat.nonNull : 0;
      const type = stat.numeric >= confidence && stat.numeric > 0 ? 'numeric'
        : stat.date >= confidence && stat.date > 0 ? 'date'
        : stat.distinct.size <= Math.min(20, Math.max(2, rowCount / 5)) ? 'categorical' : 'text';
      return {
        name: stat.name, type, missing: stat.missing,
        missingPct: Math.round((stat.missing / rowCount) * 1000) / 10,
        distinctObserved: stat.distinct.size,
        distinctCapped: stat.distinctCapped,
        examples: stat.examples,
        min: type === 'numeric' ? stat.min : null,
        max: type === 'numeric' ? stat.max : null,
        dateCount: stat.date,
      };
    });
    const numeric = columns.filter(x => x.type === 'numeric' && x.missingPct < 100);
    const suggestedTargets = numeric.map(column => {
      const nameMatch = METRIC_WORDS.test(column.name);
      const variable = column.min !== column.max;
      const score = (nameMatch ? 50 : 0) + (variable ? 30 : 0)
        + (column.missingPct <= 5 ? 20 : 0) + (column.missingPct <= 20 ? 5 : 0);
      return {
        name: column.name, score,
        reason: nameMatch ? 'Metric-like column name; numeric data'
          : 'Numeric column; confirm whether this is the outcome to explain or forecast',
      };
    }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 5);

    const possibleDate = columns.filter(x => x.type === 'date').sort((a, b) =>
      Number(DATE_WORDS.test(b.name)) - Number(DATE_WORDS.test(a.name)));
    const dateColumn = possibleDate[0]?.name || null;
    let timeGrain = null;
    if (dateColumn) {
      const stat = stats.find(x => x.name === dateColumn);
      const dates = [...stat.dates].sort((a, b) => a - b);
      if (dates.length > 1) {
        const gaps = dates.slice(1).map((stamp, i) => Math.round((stamp - dates[i]) / 86400000))
          .sort((a, b) => a - b);
        const median = gaps[Math.floor(gaps.length / 2)];
        if (stat.allDatesMonth || (median >= 28 && median <= 31)) timeGrain = 'monthly';
        else if (median === 7) timeGrain = 'weekly';
        else if (median === 1) timeGrain = 'daily';
        else timeGrain = 'irregular';
      }
    }
    const observations = [];
    if (malformedRows) observations.push(malformedRows + ' records have inconsistent field counts and were excluded');
    const missingColumns = columns.filter(x => x.missingPct > 20);
    if (missingColumns.length) observations.push('High missingness: ' + missingColumns.map(x => x.name).join(', '));
    if (!dateColumn) observations.push('No reliable ISO date column detected; forecasting frequency is unknown');
    else if (timeGrain === 'irregular') observations.push('Date intervals look irregular; confirm the intended time frequency');
    if (!suggestedTargets.length) observations.push('No numeric outcome candidate detected');
    return {
      fileName: String(filename), rowCount, rejectedRows: malformedRows,
      columns, preview, suggestedTargets, dateColumn, timeGrain,
      observations: [...columnIssues, ...observations],
      processing: 'All rows profiled locally; distinct counts capped at ' + MAX_DISTINCT + ' values per column',
    };
  }
  return {push, finish};
}

export function profileCsvText(text, filename = 'dataset.csv') {
  const analyzer = createCsvProfiler(filename);
  analyzer.push(text);
  return analyzer.finish();
}

export async function profileCsvFile(file) {
  if (!file?.stream || typeof file.name !== 'string') throw new TypeError('Select a CSV file');
  if (!/\.csv$/i.test(file.name)) throw new Error('Choose a .csv dataset file');
  const analyzer = createCsvProfiler(file.name);
  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8', {fatal: true});
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      analyzer.push(decoder.decode(value, {stream: true}));
    }
    analyzer.push(decoder.decode());
    return analyzer.finish();
  } finally {
    reader.releaseLock();
  }
}
