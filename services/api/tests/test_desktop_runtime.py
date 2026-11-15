"""Desktop subprocess/API boundary: bearer authentication and loopback lifecycle."""
import os
from pathlib import Path
import re
from queue import Queue
from threading import Thread
import subprocess
import sys
import time

import httpx
import pytest
from fastapi.testclient import TestClient
from bolt.api import create_app
from bolt.desktop_service import bundled_fixture

FIXTURE = Path(__file__).resolve().parents[3] / "fixtures" / "synthetic" / "revenue.csv"
TOKEN = "t" * 64


def test_managed_api_requires_token_on_every_route(tmp_path):
    app = create_app(tmp_path / 'sessions.sqlite3', FIXTURE, access_token=TOKEN)
    client = TestClient(app)
    for route in ['/health', '/v1/sessions', '/docs', '/openapi.json']:
        response = client.get(route)
        assert response.status_code == 401
        assert response.json()['detail'] == 'Unauthorized desktop request'
    assert client.post('/v1/sessions').status_code == 401
    assert client.get('/health', headers={'Authorization': 'Bearer wrong'}).status_code == 401
    headers = {'Authorization': 'Bearer '+TOKEN}
    assert client.get('/health', headers=headers).json()['mode'] == 'synthetic'
    sid = client.post('/v1/sessions', headers=headers).json()['session_id']
    response = client.post('/v1/chat', json={'session_id': sid, 'question':'Show revenue by channel in 2026'}, headers=headers)
    assert response.status_code == 200
    assert response.json()['evidence']['sql'].lower().startswith('select')
    assert len(client.get(f'/v1/sessions/{sid}/turns',headers=headers).json()['turns']) == 2


def test_managed_api_disables_cors_and_weak_secrets(tmp_path):
    with pytest.raises(ValueError):
        create_app(tmp_path/'db', FIXTURE, access_token='weak')
    app = create_app(tmp_path/'db',FIXTURE, access_token=TOKEN)
    client = TestClient(app)
    response = client.options('/v1/sessions', headers={
        'origin':'https://untrusted.example', 'access-control-request-method':'POST',
        'Authorization':'Bearer '+TOKEN,
    })
    assert response.headers.get('access-control-allow-origin') is None


def test_dev_mode_preserves_browser_preview(tmp_path):
    client = TestClient(create_app(tmp_path/'db', FIXTURE))
    assert client.get('/health').status_code == 200
    response = client.options('/v1/sessions',headers={
        'origin':'null','access-control-request-method':'POST',
    })
    assert response.headers.get('access-control-allow-origin') == 'null'


def test_fixture_resolution_for_source_checkout():
    assert bundled_fixture().is_file()
    assert bundled_fixture().resolve() == FIXTURE.resolve()


def test_loopback_sidecar_auth_and_roundtrip(tmp_path):
    """Start the real subprocess with an ephemeral socket and test actual HTTP."""
    env = dict(os.environ, BOLT_API_TOKEN=TOKEN, PYTHONUNBUFFERED='1')
    cwd = Path(__file__).resolve().parents[1]
    proc = subprocess.Popen([sys.executable,'-m','bolt.desktop_service','--db',str(tmp_path/'session.db')],
        cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE, text=True,bufsize=1)
    try:
        lines = Queue()
        Thread(target=lambda: lines.put(proc.stdout.readline()), daemon=True).start()
        line = lines.get(timeout=8).strip()
        match=re.fullmatch(r'BOLT_READY ([1-9][0-9]{0,4})',line)
        assert match, f'Unexpected service greeting: {line!r}'
        port=int(match.group(1))
        base=f'http://127.0.0.1:{port}'
        with httpx.Client(trust_env=False,timeout=2) as client:
            for attempt in range(30):
                try:
                    response=client.get(base+'/health')
                    break
                except httpx.ConnectError:
                    time.sleep(.1)
            else:
                pytest.fail('Backend never accepted connections')
            assert response.status_code == 401
            headers={'Authorization':'Bearer '+TOKEN}
            assert client.get(base+'/health',headers=headers).json()['mode']=='synthetic'
            sid=client.post(base+'/v1/sessions',headers=headers).json()['session_id']
            answer=client.post(base+'/v1/chat',headers=headers,json={
                'session_id':sid,'question':'Show revenue by channel in 2026'})
            assert answer.status_code==200
            assert answer.json()['status']=='ok'
            assert (tmp_path/'session.db').is_file()
    finally:
        proc.terminate()
        try: proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate(timeout=5)
