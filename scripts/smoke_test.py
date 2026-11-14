"""Standalone synthetic workflow smoke test, deliberately no live Snowflake/LLM."""
from pathlib import Path
import tempfile,sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'services'/'api'))
from bolt.api import create_app
from fastapi.testclient import TestClient

with tempfile.TemporaryDirectory() as d:
    path=Path(d)/'sessions.db'
    fixture=ROOT/'fixtures'/'synthetic'/'revenue.csv'
    with TestClient(create_app(path,fixture)) as client:
        h=client.get('/health').json()
        assert h['mode']=='synthetic' and h['snowflake_connected'] is False
        sid=client.post('/v1/sessions').json()['session_id']
        first=client.post('/v1/chat',json={'session_id':sid,'question':'Break down 2026 revenue by channel'}).json()
        assert first['status']=='ok' and len(first['data']['rows'])==4
        assert first['evidence']['sql'].lower().startswith('select')
        assert first['evidence']['source']=='Synthetic revenue fixture (not Snowflake)'
        second=client.post('/v1/chat',json={'session_id':sid,'question':'Compare in-state and out-of-state'}).json()
        assert second['status']=='ok' and len(second['data']['rows'])==2
        assert second['evidence']['parameters']['start']=='2026-01'
        assert second['cost']['prompt_tokens']==0
    with TestClient(create_app(path,fixture)) as after_restart:
        turns=after_restart.get(f'/v1/sessions/{sid}/turns').json()['turns']
        assert len(turns)==4
        assert turns[-1]['payload']['evidence']['query_id']==second['evidence']['query_id']
    print('PASS: synthetic API health → session → channel breakdown → region follow-up → persisted replay; 0 LLM calls')
