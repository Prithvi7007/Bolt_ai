"""Static release checks supplement the offline backend test gate.

These tests intentionally do not claim that npm dependencies were installed
or a production desktop binary was built in the bridge's offline runner.
"""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[3]
DESKTOP = ROOT / "apps" / "desktop"


def test_build_and_packaging_scripts_are_explicit():
    pkg = json.loads((DESKTOP / "package.json").read_text(encoding="utf-8"))
    scripts = pkg["scripts"]
    assert "tsc --noEmit" in scripts["build"]
    assert "vite build" in scripts["build"]
    assert "check-dist.mjs" in scripts["build"]
    assert "node --test electron/navigation.test.cjs" in scripts["verify:source"]
    assert "electron-builder" in pkg["devDependencies"]
    assert "--win nsis" in scripts["pack:win"]
    assert "--linux AppImage" in scripts["pack:linux"]
    build = pkg["build"]
    assert build["asar"] is True
    assert "dist/**/*" in build["files"]
    assert "electron/navigation.cjs" in build["files"]
    assert not any("env" in name or "secret" in name for name in build["files"])


def test_production_navigation_uses_cross_platform_urls():
    main = (DESKTOP / "electron" / "main.cjs").read_text(encoding="utf-8")
    guard = (DESKTOP / "electron" / "navigation.cjs").read_text(encoding="utf-8")
    tests = (DESKTOP / "electron" / "navigation.test.cjs").read_text(encoding="utf-8")
    assert "isAllowedNavigation(" in main
    assert "pathToFileURL" in guard
    assert "file://${path.join" not in main
    assert "node:test" in tests
    assert "file:///etc/passwd" in tests
    assert "devTools: process.env.BOLT_DEV === '1'" in main


def test_emitted_asset_contract_exists():
    source = (DESKTOP / "scripts" / "check-dist.mjs").read_text(encoding="utf-8")
    assert "Content-Security-Policy" in source
    assert "object-src 'none'" in source
    assert "Missing compiled JS or CSS" in source
    assert "relative path" in source


def test_docs_do_not_claim_self_contained_installer():
    docs = (ROOT / "docs" / "desktop-build.md").read_text(encoding="utf-8")
    assert "not a standalone" in docs.lower()
    assert "separate" in docs.lower() and "FastAPI" in docs
