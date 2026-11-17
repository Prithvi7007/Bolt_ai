"""Local presentation snapshots stay private and contain editable evidence."""
import base64
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
import xml.etree.ElementTree as ET
import zipfile

from fastapi.testclient import TestClient
import pytest

from bolt.api import create_app
from bolt.data_presentations import DataPresentationRequest, build_data_presentation

FIXTURE = Path(__file__).resolve().parents[3] / "fixtures/synthetic/revenue.csv"
TOKEN = "p" * 64
SNAPSHOT = {
    "format": "pptx", "sourceName": "synthetic-local.csv", "target": "attendance",
    "question": "What is total attendance?", "interpretation": "local",
    "result": {"title": "Total attendance", "answer": "The total attendance is 350 across 3 valid target rows.",
        "table": [{"label": "East <&>", "value": "350", "detail": "3 target rows"}],
        "calculation": "Sum of all valid numeric attendance values, with no filter",
        "evidence": "On-device CSV scan: 3 numeric target rows / 3 accepted rows",
        "warnings": ["A descriptive result, not a forecast."]},
}


def unpack(response):
    archive = zipfile.ZipFile(BytesIO(base64.b64decode(response["content_base64"])))
    names = sorted((name for name in archive.namelist()
                    if name.startswith("ppt/slides/slide") and name.endswith(".xml")),
                   key=lambda name: int(name.split("slide")[-1].split(".")[0]))
    texts = []
    for name in names:
        root = ET.fromstring(archive.read(name))
        texts.append("".join(root.itertext()))
    return archive, names, texts


def test_snapshot_presentation_contains_editable_values_evidence_and_valid_relationships():
    response = build_data_presentation(DataPresentationRequest.model_validate(SNAPSHOT))
    archive, slides, texts = unpack(response)
    assert 3 <= len(slides) == response["slide_count"] <= 40
    flattened = "".join(texts)
    for text in ["350", "3 numeric target rows", "East <&>", "synthetic-local.csv",
                 "What is total attendance?", "Sum of all valid numeric attendance",
                 "not a forecast", "Source CSV rows are not included"]:
        assert text in flattened
    assert "Query ID:" not in flattened and "SELECT " not in flattened
    assert not any(name.startswith("ppt/media/") for name in archive.namelist())
    for name in archive.namelist():
        if name.endswith((".xml", ".rels")):
            root = ET.fromstring(archive.read(name))
            assert not any(item.attrib.get("TargetMode") == "External" for item in root.iter())
    presentation = ET.fromstring(archive.read("ppt/presentation.xml"))
    ns = {"p": "http://schemas.openxmlformats.org/presentationml/2006/main"}
    assert len(presentation.findall("p:sldIdLst/p:sldId", ns)) == len(slides)
    assert all(b"<p:sp>" in archive.read(name) and b"<a:t>" in archive.read(name) for name in slides)
    assert all("External" not in archive.read(name).decode() for name in archive.namelist() if name.endswith(".rels"))


def test_xml_metacharacters_remain_text_and_never_create_shapes_or_external_links():
    data = deepcopy(SNAPSHOT)
    data["question"] = '<script>not executable</script> & "quoted"'
    data["result"]["table"][0]["label"] = '<a:hlinkClick r:id="evil"/>'
    archive, _, texts = unpack(build_data_presentation(DataPresentationRequest.model_validate(data)))
    assert data["question"] in "".join(texts)
    assert data["result"]["table"][0]["label"] in "".join(texts)
    for name in archive.namelist():
        if name.endswith(".xml"):
            assert not any(node.tag.endswith("hlinkClick") for node in ET.fromstring(archive.read(name)).iter())


def test_long_caveats_and_wide_text_paginate_without_losing_the_end():
    data = deepcopy(SNAPSHOT)
    data["result"]["warnings"] = [("A long caveat repeated safely. " * 30) + f"ENDCAVEAT{index}" for index in range(5)]
    data["result"]["table"][0]["label"] = "界" * 160
    response = build_data_presentation(DataPresentationRequest.model_validate(data))
    _, slides, texts = unpack(response)
    assert len(slides) > 5
    flattened = "".join(texts)
    for index in range(5):
        assert f"ENDCAVEAT{index}" in flattened
    assert "界" * 160 in flattened


def test_oversized_deck_fails_instead_of_silently_dropping_content():
    data = deepcopy(SNAPSHOT)
    data["result"]["warnings"] = ["Long caveat " * 160 for _ in range(40)]
    request = DataPresentationRequest.model_validate(data)
    with pytest.raises(ValueError, match="HTML or CSV"):
        build_data_presentation(request)


@pytest.mark.parametrize("mutation", [
    lambda data: data.update(path="../secret"),
    lambda data: data.update(rows=[["private-row"]]),
    lambda data: data.update(format="html"),
    lambda data: data["result"].update(sql="SELECT secret"),
    lambda data: data["result"].update(answer="invalid\u0000xml"),
    lambda data: data["result"].update(table=[{"label":"x","value":True,"detail":""}]),
])
def test_request_rejects_unknown_fields_raw_rows_and_invalid_text(mutation):
    data = deepcopy(SNAPSHOT)
    mutation(data)
    with pytest.raises(ValueError):
        DataPresentationRequest.model_validate(data)


def test_private_desktop_export_does_not_persist_or_call_a_model(tmp_path):
    class NoModel:
        def __getattr__(self, name):
            raise AssertionError("Presentation export must not use a model")
    artifact_dir = tmp_path / "artifacts"
    app = create_app(tmp_path/"desktop.db", FIXTURE, access_token=TOKEN,
                     artifact_path=artifact_dir, local_model_runtime=NoModel())
    client = TestClient(app, headers={"Authorization":"Bearer "+TOKEN})
    response = client.post("/_desktop/data/presentation", json=SNAPSHOT)
    assert response.status_code == 200
    assert base64.b64decode(response.json()["content_base64"]).startswith(b"PK\x03\x04")
    assert client.get("/v1/sessions").json() == {"sessions":[]}
    assert list(artifact_dir.iterdir()) == []
    invalid = client.post("/_desktop/data/presentation", json={**SNAPSHOT,"rows":[["private-row"]]})
    assert invalid.status_code == 422 and "private-row" not in invalid.text
    assert client.post("/_desktop/data/presentation", json=SNAPSHOT,
                       headers={"Authorization":""}).status_code == 401
    browser = TestClient(create_app(tmp_path/"browser.db", FIXTURE))
    assert browser.post("/_desktop/data/presentation", json=SNAPSHOT).status_code == 404
    identity = SimpleNamespace(resolve=lambda request: SimpleNamespace(subject="test"))
    enterprise = TestClient(create_app(tmp_path/"enterprise.db", FIXTURE,
                            query_adapter=object(), identity_resolver=identity))
    assert enterprise.post("/_desktop/data/presentation", json=SNAPSHOT).status_code == 404


@pytest.mark.parametrize("separator", ["\u0085", "\u2028", "\u2029"])
def test_unicode_line_separators_obey_the_actual_slide_paragraph_budget(separator):
    data = deepcopy(SNAPSHOT)
    data["result"]["table"][0]["label"] = ("x" + separator) * 400
    response = build_data_presentation(DataPresentationRequest.model_validate(data))
    archive, slides, texts = unpack(response)
    assert 25 < len(slides) <= 40
    assert sum(text.count("x") for text in texts) >= 400
    namespaces = {"p":"http://schemas.openxmlformats.org/presentationml/2006/main",
                  "a":"http://schemas.openxmlformats.org/drawingml/2006/main"}
    for name in slides:
        root = ET.fromstring(archive.read(name))
        body = root.findall(".//p:sp/p:txBody", namespaces)[-1]
        assert len(body.findall("a:p", namespaces)) <= 16
