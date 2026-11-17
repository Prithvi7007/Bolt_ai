"""Editable neutral PowerPoint generation and local scoped artifact storage."""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timezone
from html import escape
from io import BytesIO
from pathlib import Path
import os
import math
import re
import uuid
import zipfile


PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
SVG_MIME = "image/svg+xml"


@dataclass(frozen=True)
class PresentationArtifact:
    artifact_id: str
    path: Path
    filename: str
    size_bytes: int
    slide_count: int
    mime_type: str = PPTX_MIME


def _safe_filename(title: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9._ -]+", "", title).strip().replace(" ", "_")
    return (clean[:70] or "BOLT_brief") + ".pptx"


def _text_shape(shape_id: int, name: str, x: int, y: int, cx: int, cy: int,
                text: str, size: int, bold: bool = False, *, text_inset: int | None = None) -> str:
    insets = (f' lIns="{text_inset}" tIns="{text_inset}" rIns="{text_inset}" bIns="{text_inset}"'
              if text_inset is not None else '')
    paragraphs = []
    for line in (text.splitlines() or [""]):
        paragraphs.append(
            '<a:p><a:r><a:rPr lang="en-US" sz="%d" b="%d" dirty="0"/>'
            '<a:t>%s</a:t></a:r><a:endParaRPr lang="en-US" sz="%d"/></a:p>'
            % (size, 1 if bold else 0, escape(line), size)
        )
    return (
        '<p:sp><p:nvSpPr><p:cNvPr id="%d" name="%s"/>'
        '<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>'
        '<a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
        '<a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>'
        f'<p:txBody><a:bodyPr wrap="square"{insets}/><a:lstStyle/>%s</p:txBody></p:sp>'
        % (shape_id, escape(name), x, y, cx, cy, "".join(paragraphs))
    )


def _slide_xml(title: str, body: str, shapes: str | None = None) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
        '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/>'
        '<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>'
        '<a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
        '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
        + _text_shape(2, "Title", 609600, 381000, 10972800, 914400, title, 2800, True)
        + (shapes if shapes is not None else _text_shape(3, "Body", 609600, 1524000, 10972800, 4572000, body, 1500, False))
        + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
    )


def _source_lines(analyses: list[dict]) -> str:
    lines = ["Sources and calculation assumptions"]
    for index, analysis in enumerate(analyses, 1):
        evidence = analysis.get("evidence") or {}
        lines.extend([
            f"{index}. Query ID: {evidence.get('query_id', 'not available')}",
            f"   Source: {evidence.get('source', 'not available')}",
            f"   Metric: {evidence.get('metric_id', 'not available')}",
            f"   Freshness: {evidence.get('freshness') or 'not reported'}",
        ])
        for limitation in analysis.get("limitations") or []:
            lines.append(f"   Limitation: {limitation}")
    return "\n".join(lines)


def _package_files(slides: list[tuple[str, str]], created: str,
                   slide_shapes: dict[int, str] | None = None) -> dict[str, str]:
    overrides = "".join(
        f'<Override PartName="/ppt/slides/slide{i}.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        for i in range(1, len(slides) + 1)
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        + overrides + '</Types>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        '</Relationships>'
    )
    slide_ids = "".join(
        f'<p:sldId id="{255 + i}" r:id="rId{i + 1}"/>' for i in range(1, len(slides) + 1)
    )
    presentation = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
        '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
        f'<p:sldIdLst>{slide_ids}</p:sldIdLst>'
        '<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>'
        '<p:notesSz cx="6858000" cy="9144000"/></p:presentation>'
    )
    presentation_rels = [
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>'
    ]
    presentation_rels.extend(
        f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{i}.xml"/>'
        for i in range(1, len(slides) + 1)
    )
    rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(presentation_rels) + '</Relationships>'
    )
    master = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
        '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/>'
        '<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>'
        '<a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
        '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>'
        '</p:grpSpPr></p:spTree></p:cSld>'
        '<p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" '
        'accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" '
        'hlink="hlink" tx1="dk1" tx2="dk2"/>'
        '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
        '<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>'
    )
    master_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>'
        '</Relationships>'
    )
    layout = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">'
        '<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/>'
        '<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>'
        '<a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
        '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>'
        '</p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'
    )
    layout_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>'
        '</Relationships>'
    )
    theme = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="BOLT Neutral">'
        '<a:themeElements><a:clrScheme name="BOLT">'
        '<a:dk1><a:srgbClr val="0F172A"/></a:dk1><a:lt1><a:srgbClr val="F8FAFC"/></a:lt1>'
        '<a:dk2><a:srgbClr val="111827"/></a:dk2><a:lt2><a:srgbClr val="CBD5E1"/></a:lt2>'
        '<a:accent1><a:srgbClr val="1E40AF"/></a:accent1><a:accent2><a:srgbClr val="D97706"/></a:accent2>'
        '<a:accent3><a:srgbClr val="0F766E"/></a:accent3><a:accent4><a:srgbClr val="7C3AED"/></a:accent4>'
        '<a:accent5><a:srgbClr val="0369A1"/></a:accent5><a:accent6><a:srgbClr val="BE123C"/></a:accent6>'
        '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>'
        '</a:clrScheme><a:fontScheme name="BOLT"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
        '<a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
        '<a:fmtScheme name="BOLT"><a:fillStyleLst>'
        + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' * 3
        + '</a:fillStyleLst><a:lnStyleLst>'
        + ''.join(
            f'<a:ln w="{width}"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
            '<a:prstDash val="solid"/></a:ln>' for width in (12700, 25400, 38100)
        )
        + '</a:lnStyleLst><a:effectStyleLst>'
        + '<a:effectStyle><a:effectLst/></a:effectStyle>' * 3
        + '</a:effectStyleLst><a:bgFillStyleLst>'
        + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' * 3
        + '</a:bgFillStyleLst></a:fmtScheme>'
        '</a:themeElements></a:theme>'
    )
    core = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        '<dc:title>BOLT AI analysis brief</dc:title><dc:creator>BOLT AI</dc:creator>'
        f'<dcterms:created xsi:type="dcterms:W3CDTF">{created}</dcterms:created></cp:coreProperties>'
    )
    app = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        '<Application>BOLT AI</Application><PresentationFormat>Widescreen</PresentationFormat>'
        f'<Slides>{len(slides)}</Slides></Properties>'
    )
    package = {
        "[Content_Types].xml": content_types,
        "_rels/.rels": root_rels,
        "docProps/core.xml": core,
        "docProps/app.xml": app,
        "ppt/presentation.xml": presentation,
        "ppt/_rels/presentation.xml.rels": rels_xml,
        "ppt/slideMasters/slideMaster1.xml": master,
        "ppt/slideMasters/_rels/slideMaster1.xml.rels": master_rels,
        "ppt/slideLayouts/slideLayout1.xml": layout,
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels": layout_rels,
        "ppt/theme/theme1.xml": theme,
    }
    for index, (title, body) in enumerate(slides, 1):
        package[f"ppt/slides/slide{index}.xml"] = _slide_xml(title, body, (slide_shapes or {}).get(index))
        package[f"ppt/slides/_rels/slide{index}.xml.rels"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" '
            'Target="../slideLayouts/slideLayout1.xml"/></Relationships>'
        )
    return package


def presentation_bytes(slides: list[tuple[str, str]], created: str, *,
                       slide_shapes: dict[int, str] | None = None) -> bytes:
    """Build editable slides in memory; optional shapes are trusted, internally generated XML."""
    output = BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as deck:
        for name, xml in _package_files(slides, created, slide_shapes).items():
            deck.writestr(name, xml)
    return output.getvalue()


class PresentationBuilder:
    def __init__(self, output_dir: Path):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def build(self, *, title: str, analyses: list[dict], owner_id: str) -> PresentationArtifact:
        if not title.strip() or len(title) > 140:
            raise ValueError("Presentation title is required and must be at most 140 characters")
        selected = [item for item in analyses if item.get("evidence")][:3]
        if not selected:
            raise ValueError("At least one evidence-backed analysis is required")
        slides: list[tuple[str, str]] = [
            (title.strip(), "Evidence-backed leadership brief\nGenerated by BOLT AI"),
        ]
        for index, item in enumerate(selected, 1):
            evidence = item.get("evidence") or {}
            chart = item.get("chart") or {}
            body = [
                item.get("answer", "Analysis result"),
                "",
                f"Metric: {evidence.get('metric_id', 'not available')}",
                f"Query ID: {evidence.get('query_id', 'not available')}",
                f"Source: {evidence.get('source', 'not available')}",
            ]
            if chart:
                labels = chart.get("labels") or []
                values = chart.get("values") or []
                body.append("Chart data:")
                body.extend(f"  {label}: {value}" for label, value in zip(labels[:8], values[:8]))
            slides.append((chart.get("title") or f"Analysis {index}", "\n".join(str(x) for x in body)))
        slides.append(("Sources, assumptions and limitations", _source_lines(selected)))
        artifact_id = uuid.uuid4().hex
        path = self.output_dir / f"{artifact_id}.pptx"
        temporary = path.with_suffix(".tmp")
        created = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as deck:
            for name, xml in _package_files(slides, created).items():
                deck.writestr(name, xml)
        os.replace(temporary, path)
        return PresentationArtifact(
            artifact_id=artifact_id,
            path=path,
            filename=_safe_filename(title),
            size_bytes=path.stat().st_size,
            slide_count=len(slides),
        )


@dataclass(frozen=True)
class ChartArtifact:
    artifact_id: str
    path: Path
    filename: str
    size_bytes: int
    slide_count: int = 0
    mime_type: str = SVG_MIME
    kind: str = "chart"
    extension: str = "svg"


def _safe_chart_filename(title: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9._ -]+", "", title).strip().replace(" ", "_")
    return (clean[:70] or "BOLT_chart") + ".svg"


class ChartBuilder:
    """Create a standalone accessible SVG without executing renderer content."""

    def __init__(self, output_dir: Path):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def build(self, *, chart: dict, evidence: dict, owner_id: str) -> ChartArtifact:
        title = str(chart.get("title") or "BOLT analysis chart").strip()
        labels = [str(value) for value in (chart.get("labels") or [])]
        raw_values = chart.get("values") or []
        if (
            not owner_id
            or not title
            or len(title) > 200
            or not labels
            or len(labels) != len(raw_values)
            or len(labels) > 100
        ):
            raise ValueError("Chart artifact requires bounded labels and values")
        try:
            values = [float(value) for value in raw_values]
        except (TypeError, ValueError) as exc:
            raise ValueError("Chart values must be numeric") from exc
        if not all(math.isfinite(value) for value in values):
            raise ValueError("Chart values must be finite")
        chart_type = chart.get("type")
        if chart_type not in {"bar", "line"}:
            raise ValueError("Chart type is not supported")
        query_id = str(evidence.get("query_id") or "not available")
        source = str(evidence.get("source") or "not available")
        unit = str(chart.get("unit") or "")
        width = 960
        height = max(360, 150 + 44 * len(labels))
        maximum = max(max(values), 1.0)
        elements = [
            f'<title>{escape(title)}</title>',
            f'<desc>Source: {escape(source)}. Query ID: {escape(query_id)}. '
            f'Values are expressed in {escape(unit or "the reported unit")}.</desc>',
            f'<metadata>Query ID: {escape(query_id)} | Source: {escape(source)}</metadata>',
            f'<rect width="{width}" height="{height}" fill="#0F172A"/>',
            f'<text x="48" y="58" fill="#F8FAFC" font-size="28" '
            f'font-family="Arial, sans-serif" font-weight="700">{escape(title)}</text>',
            f'<text x="48" y="88" fill="#CBD5E1" font-size="14" '
            f'font-family="Arial, sans-serif">Source: {escape(source)} · Query {escape(query_id)}</text>',
        ]
        if chart_type == "bar":
            for index, (label, value) in enumerate(zip(labels, values)):
                y = 125 + index * 44
                bar_width = max(0.0, value) / maximum * 520
                elements.extend([
                    f'<text x="48" y="{y + 21}" fill="#CBD5E1" font-size="14" '
                    f'font-family="Arial, sans-serif">{escape(label)}</text>',
                    f'<rect x="250" y="{y}" width="520" height="26" rx="4" fill="#1E293B"/>',
                    f'<rect x="250" y="{y}" width="{bar_width:.2f}" height="26" rx="4" fill="#3B82F6"/>',
                    f'<text x="790" y="{y + 20}" fill="#F8FAFC" font-size="14" '
                    f'font-family="Arial, sans-serif">{escape(f"{value:g} {unit}".strip())}</text>',
                ])
        else:
            plot_top, plot_bottom = 125, height - 72
            plot_left, plot_right = 70, 890
            points = []
            for index, value in enumerate(values):
                x = plot_left + index * (plot_right - plot_left) / max(1, len(values) - 1)
                y = plot_bottom - value / maximum * (plot_bottom - plot_top)
                points.append((x, y))
            elements.append(
                '<polyline fill="none" stroke="#60A5FA" stroke-width="4" '
                'stroke-linejoin="round" stroke-linecap="round" points="'
                + " ".join(f"{x:.2f},{y:.2f}" for x, y in points) + '"/>'
            )
            for index, (x, y) in enumerate(points):
                elements.extend([
                    f'<circle cx="{x:.2f}" cy="{y:.2f}" r="5" fill="#F59E0B"/>',
                    f'<text x="{x:.2f}" y="{plot_bottom + 28}" fill="#CBD5E1" '
                    f'font-size="12" text-anchor="middle" font-family="Arial, sans-serif">'
                    f'{escape(labels[index])}</text>',
                ])
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" role="img" '
            f'viewBox="0 0 {width} {height}">' + "".join(elements) + "</svg>"
        )
        artifact_id = uuid.uuid4().hex
        path = self.output_dir / f"{artifact_id}.svg"
        temporary = path.with_suffix(".tmp")
        temporary.write_text(svg, encoding="utf-8")
        os.replace(temporary, path)
        return ChartArtifact(
            artifact_id=artifact_id,
            path=path,
            filename=_safe_chart_filename(title),
            size_bytes=path.stat().st_size,
        )
