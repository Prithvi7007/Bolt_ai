"""Deterministic evidence-backed explanation for synthetic prototype mode."""
from uuid import uuid4
from .planner import resolve
from .data import run_query

UNSUPPORTED = ('I can answer revenue questions by month, channel, or region in the synthetic demo. '
               'This request is outside the current supported metrics, and no SQL was executed.')


def answer(question: str, memory: dict, connection) -> dict:
    plan = resolve(question,memory)
    cost={'prompt_tokens':0,'completion_tokens':0,'cached_tokens':0,
          'context_characters':len(str(memory)), 'llm_calls':0}
    if plan is None:
        return {'status':'unsupported','answer':UNSUPPORTED,'evidence':None,'data':None,
                'chart':None,'cost':cost,'memory_update':None,
                'limitations':['Only synthetic revenue is supported; no LLM or Snowflake executed.']}
    result = run_query(plan,connection)
    if not result.rows:
        return {'status':'no_data','answer':'No synthetic records match this period. No revenue total is available.',
                'evidence':{'source':'Synthetic revenue fixture (not Snowflake)','query_id':f'demo_{uuid4().hex[:12]}',
                            'sql':result.sql,'parameters':result.params,'metric_id':'demo.revenue','row_count':0},
                'data':{'columns':result.columns,'rows':[]},'chart':None,'cost':cost,
                'memory_update':{'metric':plan.metric,'dimension':plan.dimension,'period':plan.period},
                'limitations':['Demo fixture only; not real business data.']}
    total = round(sum(float(r['revenue']) for r in result.rows),2)
    label = {'month':'monthly trend','channel':'channel breakdown','region':'regional comparison'}[plan.dimension]
    text = (f'In the synthetic demo, the {label} for {plan.period.replace("last12","the latest 12 available months")} '
            f'totals ${total:,.2f} across {len(result.rows)} groups. '
            'The results come from an executed read-only SQLite query, not Snowflake.')
    query_id=f'demo_{uuid4().hex[:12]}'
    chart={'type':'line' if plan.dimension=='month' else 'bar',
           'title':f'Synthetic revenue — {label}', 'labels':[str(r[plan.dimension]) for r in result.rows],
           'values':[round(float(r['revenue']),2) for r in result.rows], 'unit':'USD'}
    return {'status':'ok','answer':text,
            'evidence':{'source':'Synthetic revenue fixture (not Snowflake)','query_id':query_id,
                        'sql':result.sql,'parameters':result.params,'metric_id':'demo.revenue',
                        'row_count':len(result.rows),'is_synthetic':True},
            'data':{'columns':result.columns,'rows':result.rows},'chart':chart,'cost':cost,
            'memory_update':{'metric':plan.metric,'dimension':plan.dimension,'period':plan.period,'result_ref':query_id},
            'limitations':['Demonstration data only; no Snowflake or LLM was queried.']}
