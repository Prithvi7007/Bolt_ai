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


@pytest.mark.parametrize("charted", [False, True])
def test_private_desktop_export_does_not_persist_or_call_a_model(tmp_path, charted):
    class NoModel:
        def __getattr__(self, name):
            raise AssertionError("Presentation export must not use a model")
    artifact_dir = tmp_path / "artifacts"
    app = create_app(tmp_path/"desktop.db", FIXTURE, access_token=TOKEN,
                     artifact_path=artifact_dir, local_model_runtime=NoModel())
    client = TestClient(app, headers={"Authorization":"Bearer "+TOKEN})
    snapshot = chart_snapshot() if charted else SNAPSHOT
    response = client.post("/_desktop/data/presentation", json=snapshot)
    assert response.status_code == 200
    assert base64.b64decode(response.json()["content_base64"]).startswith(b"PK\x03\x04")
    assert client.get("/v1/sessions").json() == {"sessions":[]}
    assert list(artifact_dir.iterdir()) == []
    invalid = client.post("/_desktop/data/presentation", json={**SNAPSHOT,"rows":[["private-row"]]})
    assert invalid.status_code == 422 and "private-row" not in invalid.text
    assert client.post("/_desktop/data/presentation", json=snapshot,
                       headers={"Authorization":""}).status_code == 401
    browser = TestClient(create_app(tmp_path/"browser.db", FIXTURE))
    assert browser.post("/_desktop/data/presentation", json=snapshot).status_code == 404
    identity = SimpleNamespace(resolve=lambda request: SimpleNamespace(subject="test"))
    enterprise = TestClient(create_app(tmp_path/"enterprise.db", FIXTURE,
                            query_adapter=object(), identity_resolver=identity))
    assert enterprise.post("/_desktop/data/presentation", json=snapshot).status_code == 404


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


@pytest.mark.parametrize("kind", ["local", "stored"])
def test_powerpoint_theme_and_layout_have_required_open_xml_structure(kind, tmp_path):
    # DrawingML requires three style entries and Latin/East Asian/complex-script font entries.
    if kind == "local":
        archive, _, _ = unpack(build_data_presentation(DataPresentationRequest.model_validate(SNAPSHOT)))
    else:
        from bolt.artifacts import PresentationBuilder
        artifact = PresentationBuilder(tmp_path).build(title="Synthetic brief", owner_id="test", analyses=[{
            "answer": "Synthetic result", "evidence": {"query_id":"synthetic-1","source":"synthetic"},
        }])
        archive = zipfile.ZipFile(artifact.path)
    namespaces = {"a":"http://schemas.openxmlformats.org/drawingml/2006/main",
                  "p":"http://schemas.openxmlformats.org/presentationml/2006/main"}
    theme = ET.fromstring(archive.read("ppt/theme/theme1.xml"))
    for name in ["fillStyleLst","lnStyleLst","effectStyleLst","bgFillStyleLst"]:
        styles = theme.find(".//a:"+name, namespaces)
        assert styles is not None and len(styles) >= 3, name
    for collection in ["majorFont","minorFont"]:
        fonts = theme.find(".//a:"+collection, namespaces)
        for font in ["latin","ea","cs"]:
            assert fonts.find("a:"+font, namespaces) is not None
    master = ET.fromstring(archive.read("ppt/slideMasters/slideMaster1.xml"))
    for layout in master.findall("p:sldLayoutIdLst/p:sldLayoutId", namespaces):
        assert 2147483648 <= int(layout.attrib["id"]) <= 4294967295

CHART = {
    "type": "bar", "title": "Total attendance by region", "xLabel": "region",
    "yLabel": "total attendance", "note": "All retained category aggregates.",
    "points": [
        {"label": "East <&>", "value": -12.5, "detail": "2 target rows"},
        {"label": "West", "value": 28.25, "detail": "3 target rows"},
        {"label": "Zero", "value": 0, "detail": "1 target row"},
    ],
}
NS = {"p": "http://schemas.openxmlformats.org/presentationml/2006/main",
      "a": "http://schemas.openxmlformats.org/drawingml/2006/main"}


def chart_snapshot(chart=None):
    data = deepcopy(SNAPSHOT)
    data["result"]["chart"] = deepcopy(CHART if chart is None else chart)
    return data


def chart_shapes(archive):
    roots = [ET.fromstring(archive.read(name)) for name in archive.namelist()
             if name.startswith("ppt/slides/slide") and name.endswith(".xml")]
    return [shape for root in roots for shape in root.findall(".//p:sp", NS)
            if shape.find("p:nvSpPr/p:cNvPr", NS).attrib["name"].startswith("Data ")]


def test_bar_chart_is_editable_and_preserves_signed_values_and_complete_evidence():
    response = build_data_presentation(DataPresentationRequest.model_validate(chart_snapshot()))
    archive, slides, texts = unpack(response)
    shapes = chart_shapes(archive)
    bars = [s for s in shapes if s.find("p:nvSpPr/p:cNvPr", NS).attrib["name"].startswith("Data bar ")]
    assert len(bars) == 3 and response["slide_count"] == len(slides) <= 40
    for value in ["-12.5", "28.25", "East <&>", "All retained category aggregates.", "2 target rows",
                  "Full chart data", "total attendance", "synthetic-local.csv"]:
        assert value in "".join(texts)
    extents = [s.find("p:spPr/a:xfrm/a:ext", NS).attrib for s in bars]
    assert all(int(e["cx"]) >= 0 and int(e["cy"]) > 0 for e in extents)
    assert not any(name.startswith(("ppt/media/", "ppt/embeddings/")) for name in archive.namelist())
    for name in archive.namelist():
        if name.endswith((".xml", ".rels")):
            root = ET.fromstring(archive.read(name))
            assert not any(node.attrib.get("TargetMode") == "External" for node in root.iter())
            assert not any(node.tag.endswith("hlinkClick") for node in root.iter())


@pytest.mark.parametrize("values", [[0], [0, 0], [-4, -4], [-1.7e308, 0, 1.7e308]])
def test_line_chart_geometry_remains_finite_for_zero_constant_single_and_extreme_values(values):
    chart = deepcopy(CHART)
    chart.update(type="line", points=[{"label": str(i), "value": value, "detail": "1 target row"}
                                      for i, value in enumerate(values)])
    archive, _, _ = unpack(build_data_presentation(DataPresentationRequest.model_validate(chart_snapshot(chart))))
    shapes = chart_shapes(archive)
    markers = [s for s in shapes if s.find("p:nvSpPr/p:cNvPr", NS).attrib["name"].startswith("Data marker ")]
    segments = [s for s in shapes if s.find("p:nvSpPr/p:cNvPr", NS).attrib["name"].startswith("Data segment ")]
    assert len(markers) == len(values) and len(segments) == max(0, len(values)-1)
    for shape in shapes:
        transform = shape.find("p:spPr/a:xfrm", NS)
        if transform is not None:
            for node in transform:
                assert all(0 <= int(v) <= 12192000 for v in node.attrib.values())


def test_line_chart_retains_all_512_points_with_unrounded_values_in_the_appendix():
    chart = deepcopy(CHART)
    chart.update(type="line", note="Observed dates use equal spacing; elapsed gaps may differ.",
                 points=[{"label": f"period-{i}", "value": i + 0.123456789012,
                          "detail": "1 target row"} for i in range(512)])
    response = build_data_presentation(DataPresentationRequest.model_validate(chart_snapshot(chart)))
    archive, _, texts = unpack(response)
    shapes = chart_shapes(archive)
    assert sum(s.find("p:nvSpPr/p:cNvPr", NS).attrib["name"].startswith("Data marker ") for s in shapes) == 512
    flattened = "".join(texts)
    for point in chart["points"]:
        assert point["label"] in flattened and str(point["value"]) in flattened
    assert chart["note"] in flattened and response["slide_count"] <= 40


@pytest.mark.parametrize("mutation", [
    lambda c: c.update(type="pie"), lambda c: c.update(svg="<svg/>"),
    lambda c: c.update(url="https://bad"), lambda c: c.update(points=[]),
    lambda c: c.update(points=c["points"] * 5),
    lambda c: c["points"][0].update(value=True),
    lambda c: c["points"][0].update(value="1"),
    lambda c: c["points"][0].update(value=float("inf")),
    lambda c: c["points"][0].update(value=float("nan")),
    lambda c: c["points"][0].update(rows=[["raw"]]),
    lambda c: c.update(title=" "), lambda c: c["points"][0].update(label="invalid\u0000xml"),
])
def test_chart_snapshot_rejects_unsupported_or_unbounded_content(mutation):
    data = chart_snapshot()
    mutation(data["result"]["chart"])
    with pytest.raises(ValueError):
        DataPresentationRequest.model_validate(data)


def test_chart_text_is_escaped_and_long_labels_and_notes_are_not_lost():
    chart = deepcopy(CHART)
    chart["title"] = '<a:hlinkClick r:id="evil"/> & chart'
    chart["points"][0]["label"] = "界" * 90 + "ENDLABEL"
    chart["note"] = ("A retained chart caveat. " * 35) + "ENDNOTE"
    archive, _, texts = unpack(build_data_presentation(DataPresentationRequest.model_validate(chart_snapshot(chart))))
    flattened = "".join(texts)
    for value in [chart["title"], chart["points"][0]["label"], "ENDNOTE"]:
        assert value in flattened
    for name in archive.namelist():
        if name.endswith(".xml"):
            assert not any(node.tag.endswith("hlinkClick") for node in ET.fromstring(archive.read(name)).iter())

@pytest.mark.parametrize("values", [[-4, -2], [0, 0], [-1.7e308, 1.7e308]])
def test_bar_shapes_anchor_negative_and_positive_values_at_the_zero_baseline(values):
    chart = deepcopy(CHART)
    chart["points"] = [{"label": str(i), "value": value, "detail": ""} for i, value in enumerate(values)]
    archive, _, _ = unpack(build_data_presentation(DataPresentationRequest.model_validate(chart_snapshot(chart))))
    root = ET.fromstring(archive.read("ppt/slides/slide2.xml"))
    all_shapes = root.findall(".//p:sp", NS)
    baseline = next(s for s in all_shapes if s.find("p:nvSpPr/p:cNvPr", NS).attrib["name"] == "Zero baseline")
    zero = int(baseline.find("p:spPr/a:xfrm/a:off", NS).attrib["x"])
    bars = chart_shapes(archive)
    assert len(bars) == len(values)
    for shape, value in zip(bars, values):
        transform = shape.find("p:spPr/a:xfrm", NS)
        left = int(transform.find("a:off", NS).attrib["x"])
        width = int(transform.find("a:ext", NS).attrib["cx"])
        assert 0 <= left <= left + width <= 12192000
        if value < 0:
            assert abs(left + width - zero) <= 1
        elif value > 0:
            assert left == zero
        else:
            assert width <= 1 and left == zero
