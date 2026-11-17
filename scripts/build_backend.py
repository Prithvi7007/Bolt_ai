"""Build the BOLT synthetic FastAPI backend as a platform-native PyInstaller sidecar.

Run on each target OS; PyInstaller does not cross-compile Windows binaries on Linux.
"""
from __future__ import annotations
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / 'services' / 'api'
FIXTURE = ROOT / 'fixtures' / 'synthetic' / 'revenue.csv'
ENTRY = API / 'bolt' / 'desktop_service.py'
OUTPUT = ROOT / 'apps' / 'desktop' / 'backend'
TEMP = ROOT / '.local' / 'pyinstaller'


def main() -> None:
    if not ENTRY.is_file() or not FIXTURE.is_file():
        raise SystemExit('BOLT source or synthetic fixture is missing')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    TEMP.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile',
        '--name', 'bolt-service', '--paths', str(API),
        '--recursive-copy-metadata', 'langgraph',
        '--add-data', f'{FIXTURE}{":" if sys.platform != "win32" else ";"}fixtures/synthetic',
        '--distpath', str(OUTPUT), '--workpath', str(TEMP / 'work'),
        '--specpath', str(TEMP), str(ENTRY),
    ]
    subprocess.run(command, cwd=ROOT, check=True)
    filename = 'bolt-service.exe' if sys.platform == 'win32' else 'bolt-service'
    binary = OUTPUT / filename
    if not binary.is_file() or binary.stat().st_size < 10_000:
        raise SystemExit('Missing packaged backend binary: ' + str(binary))
    print('Built native synthetic-only BOLT sidecar:', binary)


if __name__ == '__main__':
    main()
