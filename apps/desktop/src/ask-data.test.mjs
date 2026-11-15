import {test} from 'node:test';
import assert from 'node:assert/strict';
import {profileCsvText} from './dataset-understanding.mjs';
import {answerDataQuestion, planDataQuestion, suggestedDataQuestions} from './ask-data.mjs';

const csv = 'month,region,spend,revenue\n'
  + '2026-01,East,1,10\n'
  + '2026-01,East,2,20\n'
  + '2026-02,West,3,30\n'
  + '2026-02,West,4,40\n';
const profile = profileCsvText(csv, 'synthetic.csv');
function fileFromText(source=csv) {
  const data=new TextEncoder().encode(source);
  return {
    name:'synthetic.csv',
    stream(){let i=0;return new ReadableStream({pull(controller){
      if (i>=data.length) controller.close();
      else controller.enqueue(data.slice(i,i++ + 1));
    }});},
  };
}
const ask = question => answerDataQuestion(fileFromText(),question,profile,'revenue');

for (const question of [
  'What is the median revenue?',
  'What is total revenue per customer?',
  'How many revenue rows by region?',
  'What is minimum revenue by region?',
  'Give me a pizza recipe about revenue',
  'Show daily revenue trend over time',
  'What is total revenue by region and month?',
  'What is the impact of spend on revenue?',
]) {
  test('asks for clarification instead of substituting another calculation: '+question, async()=>{
    const answer = await ask(question);
    assert.equal(answer.kind, 'unsupported');
    assert.equal(answer.evidence, null);
    assert.equal(answer.calculation, null);
  });
}

test('understands summaries and computes actual on-device answers rather than synthetic demo data',async()=>{
  const q=await ask('What is the total revenue?');
  assert.equal(q.kind,'answered');
  assert.match(q.answer,/100/);
  assert.match(q.evidence,/4 numeric target rows/);
  assert.match(q.calculation,/Sum/);
  const mean=await ask('What is the average revenue?');
  assert.match(mean.answer,/25/);
  const overview=await ask('Summarize revenue');
  assert.match(overview.answer,/40/);
  const range=await ask('What is the range of revenue?');
  assert.match(range.answer,/10/);
  const count=await ask('How many rows of revenue?');
  assert.match(count.answer,/4 of 4/);
});

test('routes a categorical group query to correct sums and ranked means',async()=>{
  const group=await ask('What is total revenue by region?');
  assert.match(group.answer,/2 observed group categories/);
  assert.deepEqual(group.table.map(r=>r.label),['West','East']);
  assert.equal(group.table[0].value,'70');
  const rank=await ask('Which region has highest average revenue?');
  assert.match(rank.answer,/West has the highest observed average revenue: 35/);
  assert.equal(rank.table[0].value,'35');
});

test('handles time buckets, paired correlations and numeric missingness',async()=>{
  const time=await ask('Show revenue trend over time');
  assert.equal(time.kind,'answered');
  assert.match(time.answer,/2026-01/);
  assert.match(time.answer,/2026-02/);
  assert.equal(time.table.length,2);
  const corr=await ask('What is the correlation of revenue with spend?');
  assert.match(corr.answer,/r = 1/);
  assert.match(corr.answer,/4 paired rows/);
  assert.ok(corr.warnings.some(w=>w.includes('not causal')));
  const quality=await ask('How much missing data do I have?');
  assert.match(quality.answer,/0 missing cells/);
});

test('rejects hallucination-prone requests, filtering, forecast and unapproved target',async()=>{
  for(const q of [
    'Forecast revenue next year',
    'Why did revenue fall?',
    'What is revenue in 2026?',
    'What is average revenue where region is East?',
    'What is total revenue for East?',
    'What is total spend?',
  ]) {
    const answer=await ask(q);
    assert.equal(answer.kind,'unsupported',q);
    assert.equal(answer.evidence,null);
  }
  const alternate=planDataQuestion('What is spend?',profile,'revenue');
  assert.equal(alternate.kind,'unsupported');
  assert.match(alternate.error,/Approve/);
  const long=await ask('A'.repeat(401));
  assert.equal(long.kind,'unsupported');
});

test('unsupported date analysis and target selection cannot silently run',async()=>{
  const plain=profileCsvText('region,revenue\nEast,1\nWest,2');
  assert.equal(planDataQuestion('Show revenue trend over time',plain,'revenue').kind,'unsupported');
  assert.equal(planDataQuestion('Summarize revenue',plain,'unknown').kind,'unsupported');
  const prompts=suggestedDataQuestions(profile,'revenue');
  assert.ok(prompts.some(p=>p.includes('region')));
  assert.ok(prompts.some(p=>p.includes('over time')));
});

test('each query scans a local File and never transmits dataset bytes',async()=>{
  const answer=await ask('What is average revenue by region?');
  assert.equal(answer.kind,'answered');
  assert.equal(JSON.stringify(answer).includes('BOLT_READY'),false);
  assert.equal(answer.table.length,2);
  assert.equal(answer.table[0].detail,'2 target rows');
});
