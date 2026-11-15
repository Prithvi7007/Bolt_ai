"""Guard the artifact pipeline and packaged-backend smoke test contract."""
from pathlib import Path
import ast

ROOT = Path(__file__).resolve().parents[3]


def test_packaging_workflow_is_unprivileged_and_target_native():
    text = (ROOT / 'docs/ci-examples/desktop-installers.yml').read_text()
    assert 'contents: read' in text
    assert 'windows-2022' in text and 'ubuntu-22.04' in text
    assert 'pack:win' in text and 'pack:linux' in text
    assert 'npm ci' in text and 'pytest -q' in text
    assert 'verify_packaged_backend.py' in text
    assert 'upload-artifact@v4' in text
    assert 'deploy' not in text.lower()
    assert 'workflow_dispatch' in text


def test_smoke_script_exercises_actual_packaged_binary():
    smoke = ROOT / 'scripts/verify_packaged_backend.py'
    source = smoke.read_text()
    ast.parse(source)
    assert '--executable' in source
    assert 'BOLT_READY' in source
    assert 'Bearer ' in source
    assert 'Unauthenticated' in source
    assert 'sql' in source and 'sessions.sqlite3' in source
    assert '127.0.0.1:' in source
    assert 'secrets.token_hex' in source
    assert 'BOLT_API_TOKEN' in source