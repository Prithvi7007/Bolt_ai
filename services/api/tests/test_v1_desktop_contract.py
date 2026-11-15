"""Contracts for the completed v1 desktop Explore/Present surfaces and artifact IPC."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DESKTOP = ROOT / "apps" / "desktop"


def test_desktop_exposes_explore_present_and_live_capability_status():
    app = (DESKTOP / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "Explore" in app
    assert "Present" in app
    assert "Collections" in app
    assert "Data Sources" in app
    assert "Artifacts" in app
    assert "Settings" in app
    assert "/v1/catalog" in app
    assert "/v1/presentations" in app
    assert "/v1/charts" in app
    assert "/v1/memory/search" in app
    assert "/v1/preferences" in app
    assert "snowflake_connected" in app
    assert "llm_connected" in app
    assert "Next slice" not in app
    assert "sessionTokens" in app
    assert "tab==='artifact'" in app


def test_artifact_save_stays_in_main_process_and_never_exposes_filesystem():
    preload = (DESKTOP / "electron" / "preload.cjs").read_text(encoding="utf-8")
    main = (DESKTOP / "electron" / "main.cjs").read_text(encoding="utf-8")
    renderer = (DESKTOP / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "saveArtifact" in preload
    assert "bolt:save-artifact" in preload
    assert "ipcMain.handle('bolt:save-artifact'" in main
    assert "showSaveDialog" in main
    assert "Buffer.from" in main and "base64" in main
    assert ".svg" in main
    assert "window.boltApi.saveArtifact" in renderer
    assert "require('node:fs')" not in preload
    assert "BOLT_API_TOKEN" not in renderer


def test_desktop_request_bridge_handles_empty_204_responses():
    runtime = (DESKTOP / "electron" / "runtime.cjs").read_text(encoding="utf-8")
    app = (DESKTOP / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "raw ? JSON.parse(raw) : null" in runtime
    assert "response.status===204" in app
