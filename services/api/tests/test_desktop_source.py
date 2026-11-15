"""Source contract checks until npm packages are available to run the Electron build."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[3]
DESKTOP=ROOT/'apps'/'desktop'

def test_electron_renderer_security():
    main=(DESKTOP/'electron'/'main.cjs').read_text(encoding="utf-8")
    assert 'contextIsolation: true' in main
    assert 'sandbox: true' in main
    assert 'nodeIntegration: false' in main
    assert 'webSecurity: true' in main
    assert 'setWindowOpenHandler' in main
    assert 'will-navigate' in main
    assert 'process.env.BOLT_SNOWFLAKE_PASSWORD' not in main

def test_desktop_has_react_vite_electron_and_no_production_secrets():
    pkg=json.loads((DESKTOP/'package.json').read_text(encoding="utf-8"))
    assert 'react' in pkg['dependencies']
    assert 'vite' in pkg['devDependencies']
    assert 'electron' in pkg['devDependencies']
    source='\n'.join(p.read_text(encoding="utf-8") for p in (DESKTOP/'src').rglob('*') if p.is_file())
    assert '127.0.0.1:8787' in source
    assert 'Snowflake connected' not in source
    assert 'SNOWFLAKE_PASSWORD' not in source

def test_desktop_has_accessible_evidence_and_offline_preview():
    app=(DESKTOP/'src'/'App.tsx').read_text(encoding="utf-8")
    assert 'View SQL' in app
    assert 'Synthetic' in app
    assert 'aria-label' in app
    assert 'role="status"' in app
    html=(DESKTOP/'preview.html').read_text(encoding="utf-8")
    assert 'api/chat' not in html  # correct contracted /v1/chat route
    assert '/v1/chat' in html
    assert '127.0.0.1:8787' in html

def test_older_chart_opens_its_own_sql_not_latest_sql():
    app=(DESKTOP/'src'/'App.tsx').read_text(encoding="utf-8")
    assert 'setSelectedReply(turn.payload)' in app
    assert 'selectedReply ||' in app
    preview=(DESKTOP/'preview.html').read_text(encoding="utf-8")
    assert 'selectedReply=payload' in preview

def test_production_electron_fails_closed_without_dist():
    main=(DESKTOP/'electron'/'main.cjs').read_text(encoding="utf-8")
    assert main.count('win.loadURL(DEV_URL);')==1
    assert 'app.quit();' in main
