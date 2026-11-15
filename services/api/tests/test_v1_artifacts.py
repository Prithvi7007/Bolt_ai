import base64
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from bolt.api import create_app
from bolt.artifacts import PresentationBuilder


FIXTURE = Path(__file__).resolve().parents[3] / "fixtures" / "synthetic" / "revenue.csv"


def analysis_payload():
    return {
        "answer": "Revenue increased in the synthetic analysis.",
        "evidence": {
            "query_id": "demo_q1",
            "source": "Synthetic revenue fixture",
            "metric_id": "demo.revenue",
            "freshness": "2026-10",
            "sql": "SELECT channel, SUM(revenue) FROM revenue GROUP BY channel",
        },
        "chart": {
            "type": "bar",
            "title": "Revenue by channel",
            "labels": ["Search", "Social"],
            "values": [120.0, 90.0],
            "unit": "USD",
        },
        "limitations": ["Demonstration data only."],
    }


def test_presentation_builder_creates_editable_three_to_five_slide_pptx(tmp_path):
    artifact = PresentationBuilder(tmp_path).build(
        title="Leadership revenue review",
        analyses=[analysis_payload()],
        owner_id="local",
    )
    assert artifact.path.suffix == ".pptx"
    assert artifact.path.is_file()
    with zipfile.ZipFile(artifact.path) as deck:
        names = set(deck.namelist())
        assert "[Content_Types].xml" in names
        assert "ppt/presentation.xml" in names
        slides = sorted(name for name in names if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
        assert 3 <= len(slides) <= 5
        text = b"".join(deck.read(name) for name in slides).decode("utf-8")
        assert "Leadership revenue review" in text
        assert "demo_q1" in text
        assert "Demonstration data only" in text


def test_presentation_api_uses_stored_analysis_and_returns_scoped_download(tmp_path):
    app = create_app(
        tmp_path / "bolt.db",
        FIXTURE,
        artifact_path=tmp_path / "artifacts",
    )
    client = TestClient(app)
    sid = client.post("/v1/sessions").json()["session_id"]
    chat = client.post("/v1/chat", json={
        "session_id": sid,
        "question": "Show revenue by channel in 2026",
    })
    assert chat.status_code == 200

    created = client.post("/v1/presentations", json={
        "session_id": sid,
        "title": "BOLT leadership brief",
    })
    assert created.status_code == 201
    artifact = created.json()
    assert artifact["filename"].endswith(".pptx")
    assert artifact["slide_count"] >= 3

    listing = client.get("/v1/artifacts", params={"session_id": sid})
    assert listing.status_code == 200
    assert listing.json()["artifacts"][0]["artifact_id"] == artifact["artifact_id"]

    download = client.get(f"/v1/artifacts/{artifact['artifact_id']}", params={"session_id": sid})
    assert download.status_code == 200
    raw = base64.b64decode(download.json()["content_base64"])
    assert raw.startswith(b"PK")
    assert download.json()["mime_type"] == "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def test_artifact_download_is_session_scoped(tmp_path):
    app = create_app(tmp_path / "bolt.db", FIXTURE, artifact_path=tmp_path / "artifacts")
    client = TestClient(app)
    first = client.post("/v1/sessions").json()["session_id"]
    second = client.post("/v1/sessions").json()["session_id"]
    client.post("/v1/chat", json={"session_id": first, "question": "Revenue by region in 2026"})
    artifact = client.post("/v1/presentations", json={"session_id": first, "title": "Private brief"}).json()
    response = client.get(f"/v1/artifacts/{artifact['artifact_id']}", params={"session_id": second})
    assert response.status_code == 404
