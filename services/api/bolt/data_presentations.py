"""Editable presentation snapshots of calculated local CSV answers; no persistence."""
from __future__ import annotations
import base64
from datetime import datetime, timezone
import unicodedata
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .artifacts import presentation_bytes
from .data_chart_slides import ChartSnapshot, chart_shapes

MAX_SLIDES = 40
LINES_PER_SLIDE = 16
LINE_WIDTH = 72


class SnapshotRow(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    label: str = Field(max_length=1000)
    value: str = Field(min_length=1, max_length=1000)
    detail: str = Field(max_length=2000)


class AnswerSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    title: str = Field(min_length=1, max_length=600)
    answer: str = Field(min_length=1, max_length=10000)
    table: list[SnapshotRow] = Field(max_length=512)
    calculation: str | None = Field(max_length=2000)
    evidence: str | None = Field(max_length=2000)
    warnings: list[str] = Field(max_length=40)
    chart: ChartSnapshot | None = None


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def _xml_text(value):
    return all(char in "\t\n\r" or 0x20 <= ord(char) <= 0xD7FF
               or 0xE000 <= ord(char) <= 0xFFFD or 0x10000 <= ord(char) <= 0x10FFFF
               for char in value)


class DataPresentationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    format: Literal["pptx"]
    source_name: str = Field(alias="sourceName", min_length=1, max_length=255)
    target: str = Field(min_length=1, max_length=160)
    question: str = Field(min_length=1, max_length=400)
    interpretation: Literal["local", "model"]
    result: AnswerSnapshot

    @model_validator(mode="after")
    def validate_snapshot(self):
        required = [self.source_name, self.target, self.question, self.result.title,
                    self.result.answer, *(row.value for row in self.result.table)]
        if not all(value.strip() for value in required):
            raise ValueError("Nonblank presentation fields are required")
        if any(not warning.strip() or len(warning) > 2000 for warning in self.result.warnings):
            raise ValueError("Invalid presentation caveats")
        if not all(_xml_text(value) for value in _strings(self.model_dump(by_alias=True))):
            raise ValueError("Unsupported presentation text")
        if len(self.model_dump_json(by_alias=True).encode("utf-8")) > 250_000:
            raise ValueError("Presentation snapshot is too large")
        return self


def _wrapped_lines(text):
    """Preserve all characters while estimating space for wide glyphs."""
    lines = []
    for paragraph in (text.splitlines() or [""]):
        current, width = "", 0
        for char in paragraph:
            units = (0 if unicodedata.combining(char) else
                     2 if unicodedata.east_asian_width(char) in {"W", "F"} or char in "WM@"
                     else 4 if char == "\t" else 1)
            if current and width + units > LINE_WIDTH:
                lines.append(current)
                current, width = "", 0
            current += char
            width += units
        lines.append(current)
    return lines


def build_data_presentation(request: DataPresentationRequest) -> dict:
    result = request.result
    created = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    method = ("AI interpreted the question; the answer was calculated on-device."
              if request.interpretation == "model"
              else "The question was interpreted and calculated locally.")
    sections = [("Finding", result.title + "\n\n" + result.answer + "\n\nQuestion: " + request.question)]
    if result.table:
        rows = [f"{index}. {row.label}\nResult: {row.value}\nEvidence: {row.detail}"
                for index, row in enumerate(result.table, 1)]
        sections.append(("Displayed table", "\n\n".join(rows)))
    if result.chart:
        chart = result.chart
        rows = [f"{point.label}: {point.value} · {point.detail}" for point in chart.points]
        sections.append(("Full chart data", "\n".join([
            "Chart: " + chart.title, "X axis: " + chart.x_label, "Y axis: " + chart.y_label,
            "Coverage: " + chart.note, "Unrounded calculated values in chart order:", *rows,
        ])))
    sections.extend([
        ("Calculation and coverage", "\n\n".join([
            "Calculation: " + (result.calculation or "Not available"),
            "Coverage: " + (result.evidence or "Not available"), method])),
        ("Source and caveats", "\n\n".join([
            "Source file: " + request.source_name, "Approved target: " + request.target,
            "Exported at (UTC): " + created,
            "Snapshot of the displayed answer and table. Values retain their display formatting.",
            "Source CSV rows are not included. No additional model call was made for this export.",
            *(f"Caveat {index}: {warning}" for index, warning in enumerate(result.warnings, 1)),
        ])),
    ])
    slides = []
    for title, body in sections:
        lines = _wrapped_lines(body)
        for start in range(0, len(lines), LINES_PER_SLIDE):
            page = start // LINES_PER_SLIDE + 1
            slides.append((title if page == 1 else f"{title} ({page})",
                           "\n".join(lines[start:start + LINES_PER_SLIDE])))
            if len(slides) > MAX_SLIDES:
                raise ValueError("This analysis is too long for PowerPoint. Save it as HTML or CSV instead.")
    shapes = None
    if result.chart:
        if len(slides) >= MAX_SLIDES:
            raise ValueError("This analysis is too long for PowerPoint. Save it as HTML or CSV instead.")
        slides.insert(1, ("Calculated chart", ""))
        shapes = {2: chart_shapes(result.chart)}
    content = presentation_bytes(slides, created, slide_shapes=shapes)
    return {"content_base64": base64.b64encode(content).decode("ascii"), "slide_count": len(slides)}
