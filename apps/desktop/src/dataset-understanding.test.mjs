import {test} from 'node:test';
import assert from 'node:assert/strict';
import {profileCsvText, profileCsvFile} from './dataset-understanding.mjs';

test('profiles quoted CSV values, ISO months, numeric target and missingness', () => {
  const profile = profileCsvText(
    '\uFEFFmonth,region,revenue,notes\r\n' +
    '2026-01,"In,state",100,"A ""quoted"" note"\r\n' +
    '2026-02,Out-of-state,125,\r\n' +
    '2026-03,Out-of-state,130,"new\nline"\r\n',
    'marketing.csv',
  );
  assert.equal(profile.fileName, 'marketing.csv');
  assert.equal(profile.rowCount, 3);
  assert.equal(profile.rejectedRows, 0);
  assert.equal(profile.dateColumn, 'month');
  assert.equal(profile.timeGrain, 'monthly');
  assert.equal(profile.columns.find(x => x.name === 'revenue').type, 'numeric');
  assert.equal(profile.columns.find(x => x.name === 'notes').missing, 1);
  assert.equal(profile.preview[0][1], 'In,state');
  assert.equal(profile.preview[0][3], 'A "quoted" note');
  assert.equal(profile.preview[2][3], 'new\nline');
  assert.equal(profile.suggestedTargets[0].name, 'revenue');
  assert.equal(profile.processing.includes('locally'), true);
});

test('detects weekly and irregular frequencies without treating IDs as targets', () => {
  const weekly = profileCsvText('week,store_id,demand\n2026-01-04,A,200\n2026-01-11,B,250\n2026-01-18,C,210\n');
  assert.equal(weekly.timeGrain, 'weekly');
  assert.equal(weekly.suggestedTargets[0].name, 'demand');
  const irregular = profileCsvText('date,count\n2026-01-01,1\n2026-01-09,2\n2026-01-25,3');
  assert.equal(irregular.timeGrain, 'irregular');
  assert.ok(irregular.observations.some(x => x.includes('irregular')));
});

test('counts rows with inconsistent fields without silently including them', () => {
  const result = profileCsvText('month,revenue\n2026-01,100\n2026-02,200,extra\n2026-03,300');
  assert.equal(result.rowCount, 2);
  assert.equal(result.rejectedRows, 1);
  assert.ok(result.observations.some(x => x.includes('3 fields; expected 2')));
});

test('rejects malformed quotes, empty columns and no rows', () => {
  assert.throws(() => profileCsvText('a,b\n"unfinished,123'), /unclosed quoted/);
  assert.throws(() => profileCsvText('a,a\n1,2'), /Duplicate CSV/);
  assert.throws(() => profileCsvText('a,\n1,2'), /headers cannot be empty/);
  assert.throws(() => profileCsvText('a,b'), /valid data rows/);
  assert.throws(() => profileCsvText('a,b\n"ok"x,1'), /after a quoted/);
});

test('performs streaming UTF-8 parsing across arbitrary chunk boundaries', async () => {
  const source = 'date,revenue,notes\r\n2026-01-01,12,"caf\u00e9, good"\r\n2026-01-02,13,"two ""quotes"""\r\n';
  const bytes = new TextEncoder().encode(source);
  const file = {
    name: 'metrics.csv',
    stream() {
      let i = 0;
      return new ReadableStream({
        pull(controller) {
          if (i >= bytes.length) controller.close();
          else controller.enqueue(bytes.slice(i, i++ + 1));
        },
      });
    },
  };
  const result = await profileCsvFile(file);
  assert.equal(result.rowCount, 2);
  assert.equal(result.preview[0][2], 'café, good');
  assert.equal(result.preview[1][2], 'two "quotes"');
});

test('does not assume any numeric target was approved', () => {
  const data = profileCsvText('date,tickets\n2026-01,200\n2026-02,210');
  assert.ok(data.suggestedTargets.some(x => x.name === 'tickets'));
  assert.equal(Object.hasOwn(data, 'approvedTarget'), false);
});
