"""Static checks for packaged desktop auth/IPC and Node regression suite."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
ELECTRON = ROOT/'apps'/'desktop'/'electron'


def test_preload_and_renderer_never_expose_bearer_token():
    preload=(ELECTRON/'preload.cjs').read_text()
    main=(ELECTRON/'main.cjs').read_text()
    renderer=(ROOT/'apps'/'desktop'/'src'/'App.tsx').read_text()
    assert 'contextBridge.exposeInMainWorld' in preload
    assert 'ipcRenderer.invoke' in preload
    assert 'preload:' in main
    assert "ipcMain.handle('bolt:request'" in main
    assert 'isAllowedNavigation(source' in main
    assert 'window.boltApi.request' in renderer
    assert 'BOLT_API_TOKEN' not in preload
    assert 'BOLT_API_TOKEN' not in renderer


def test_node_runtime_contracts():
    result=subprocess.run(['node','--test', str(ELECTRON/'runtime.test.cjs')],
        cwd=ELECTRON,text=True,capture_output=True,timeout=20)
    assert result.returncode == 0, result.stdout+'\n'+result.stderr
