from fastapi.testclient import TestClient
from bolt.api import create_app
from pathlib import Path

FIXTURE = Path(__file__).resolve().parents[3] / 'fixtures' / 'synthetic' / 'revenue.csv'

def client(tmp_path):
    return TestClient(create_app(tmp_path/'bolt.db', FIXTURE))

def test_health_explicitly_discloses_synthetic_mode(tmp_path):
    response = client(tmp_path).get('/health')
    assert response.status_code == 200
    assert response.json()['mode'] == 'synthetic'

def test_query_returns_grounded_answer_and_evidence(tmp_path):
    c = client(tmp_path)
    sid = c.post('/v1/sessions').json()['session_id']
    response = c.post('/v1/chat',json={'session_id':sid,'question':'Show revenue by channel in 2026'})
    assert response.status_code == 200
    body = response.json()
    assert body['status'] == 'ok'
    assert body['evidence']['source'] == 'Synthetic revenue fixture (not Snowflake)'
    assert body['evidence']['query_id'].startswith('demo_')
    assert body['evidence']['sql'].lower().startswith('select')
    assert len(body['data']['rows']) == 4
    assert body['chart']['type'] == 'bar'
    assert body['cost']['prompt_tokens'] == 0
    assert 'synthetic' in body['answer'].lower()

def test_followup_retains_metric_and_persists_history(tmp_path):
    c = client(tmp_path)
    sid = c.post('/v1/sessions').json()['session_id']
    c.post('/v1/chat',json={'session_id':sid,'question':'What was 2026 revenue by month?'})
    r = c.post('/v1/chat',json={'session_id':sid,'question':'Compare in-state and out-of-state'})
    assert r.status_code == 200
    assert r.json()['data']['columns'] == ['region','revenue']
    history = c.get(f'/v1/sessions/{sid}/turns').json()['turns']
    assert len(history) == 4
    other = client(tmp_path)
    assert len(other.get(f'/v1/sessions/{sid}/turns').json()['turns']) == 4

def test_reject_unsafe_and_unsupported_requests_without_query(tmp_path):
    c = client(tmp_path)
    sid = c.post('/v1/sessions').json()['session_id']
    for q in ('DROP TABLE revenue; SELECT * FROM users', 'Show customer email addresses'):
        res=c.post('/v1/chat',json={'session_id':sid,'question':q})
        assert res.status_code == 200
        assert res.json()['status'] == 'unsupported'
        assert res.json()['evidence'] is None

def test_missing_session_empty_question_and_bad_limits(tmp_path):
    c=client(tmp_path)
    assert c.post('/v1/chat',json={'session_id':'missing','question':'revenue'}).status_code == 404
    sid=c.post('/v1/sessions').json()['session_id']
    assert c.post('/v1/chat',json={'session_id':sid,'question':''}).status_code == 422
    assert c.post('/v1/chat',json={'session_id':sid,'question':'x'*2001}).status_code == 422
    assert c.get('/v1/sessions/missing/turns').status_code == 404
