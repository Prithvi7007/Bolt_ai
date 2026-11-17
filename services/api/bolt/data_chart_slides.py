"""Strict local chart snapshots and editable DrawingML shapes (no image or workbook)."""
from __future__ import annotations
from html import escape
import unicodedata
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .artifacts import _text_shape


class ChartPoint(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    label: str = Field(max_length=1000)
    value: float = Field(allow_inf_nan=False)
    detail: str = Field(max_length=2000)


class ChartSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    type: Literal["bar", "line"]
    title: str = Field(min_length=1, max_length=600)
    x_label: str = Field(alias="xLabel", min_length=1, max_length=180)
    y_label: str = Field(alias="yLabel", min_length=1, max_length=180)
    points: list[ChartPoint] = Field(min_length=1, max_length=512)
    note: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def validate_chart(self):
        if not all(value.strip() for value in [self.title, self.x_label, self.y_label, self.note]):
            raise ValueError("Nonblank chart metadata is required")
        if self.type == "bar" and len(self.points) > 12:
            raise ValueError("Bar charts support at most 12 retained categories")
        return self


def _short(value, limit):
    text = " ".join(value.split())
    # Wide glyphs need more room than Latin labels.
    width, chars = 0, []
    for char in text:
        units = 2 if unicodedata.east_asian_width(char) in {"W", "F"} or char in "WM@" else 1
        if width + units > limit:
            return "".join(chars) + "…"
        chars.append(char)
        width += units
    return text


def chart_shapes(chart: ChartSnapshot) -> str:
    """Return trusted shape XML for one 960 by 540 slide, in original point order."""
    parts, shape_id = [], 2
    emu = lambda value: round(value * 12700)

    def label(name, value, x, y, width, height=24, size=1100):
        nonlocal shape_id
        shape_id += 1
        parts.append(_text_shape(shape_id, name, emu(x), emu(y), emu(width), emu(height),
                                 value, size, text_inset=0))

    def shape(name, x, y, width, height, *, geometry="rect", fill=None, stroke=None, flip=False):
        nonlocal shape_id
        shape_id += 1
        fill_xml = f'<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>' if fill else '<a:noFill/>'
        line_xml = (f'<a:ln w="19050"><a:solidFill><a:srgbClr val="{stroke}"/></a:solidFill></a:ln>'
                    if stroke else '<a:ln><a:noFill/></a:ln>')
        parts.append(
            f'<p:sp><p:nvSpPr><p:cNvPr id="{shape_id}" name="{escape(name, quote=True)}"/>'
            '<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>'
            f'<a:xfrm flipV="{1 if flip else 0}"><a:off x="{emu(x)}" y="{emu(y)}"/>'
            f'<a:ext cx="{max(1, emu(width))}" cy="{max(1, emu(height))}"/></a:xfrm>'
            f'<a:prstGeom prst="{geometry}"><a:avLst/></a:prstGeom>'
            f'{fill_xml}{line_xml}</p:spPr></p:sp>'
        )

    def line(name, x1, y1, x2, y2, color):
        shape(name, min(x1, x2), min(y1, y2), abs(x2-x1), abs(y2-y1),
              geometry="line", stroke=color, flip=(y2 < y1))

    values = [point.value for point in chart.points]
    scale = max(map(abs, values)) or 1
    low, high = min(v / scale for v in values), max(v / scale for v in values)
    if chart.type == "bar":
        low, high = min(0, low), max(0, high)
    if low == high:
        low, high = min(0, low), max(0, high)
        if low == high:
            low, high = -1, 1
    fraction = lambda value: (value / scale - low) / (high - low)
    ticks = [low, (low + high) / 2, high]
    label("Chart title", _short(chart.title, 80), 48, 104, 864, size=1400)
    if chart.type == "bar":
        left, right, top = 240, 800, 150
        row_height = min(52, 264 / len(chart.points))
        bottom = top + len(chart.points) * row_height
        x = lambda value: left + fraction(value) * (right - left)
        for i, tick in enumerate(ticks):
            position = x(tick * scale)
            line(f"Grid {i}", position, top, position, bottom, "CBD5E1")
            label(f"Tick {i}", format(tick * scale, ".4g"), position-25, bottom+8, 85, size=1000)
        zero = x(0)
        line("Zero baseline", zero, top, zero, bottom, "64748B")
        for i, point in enumerate(chart.points):
            y = top + i * row_height + (row_height-16) / 2
            position = x(point.value)
            shape(f"Data bar {i+1}", min(zero, position), y, abs(position-zero), 16,
                  fill="7C3AED" if point.value < 0 else "2563EB")
            label(f"Category {i+1}", _short(point.label, 23), 48, y-5, 186)
            label(f"Value {i+1}", format(point.value, ".4g"), 813, y-5, 100)
    else:
        left, right, top, bottom = 110, 900, 155, 410
        y = lambda value: bottom - fraction(value) * (bottom-top)
        for i, tick in enumerate(ticks):
            position = y(tick * scale)
            line(f"Grid {i}", left, position, right, position, "CBD5E1")
            label(f"Tick {i}", format(tick * scale, ".4g"), 25, position-10, 85, size=1000)
        points = [(left + i / (len(values)-1) * (right-left) if len(values) > 1 else (left+right)/2,
                   y(point.value)) for i, point in enumerate(chart.points)]
        for i in range(1, len(points)):
            line(f"Data segment {i}", *points[i-1], *points[i], "2563EB")
        for i, (cx, cy) in enumerate(points):
            shape(f"Data marker {i+1}", cx-2, cy-2, 4, 4, geometry="ellipse", fill="2563EB")
        label("First observed key", _short(chart.points[0].label, 38), left, 422, 380)
        if len(points) > 1:
            label("Last observed key", _short(chart.points[-1].label, 38), right-340, 422, 380)
    label("Chart axes", _short(chart.x_label, 46) + " · " + _short(chart.y_label, 46), 48, 462, 864)
    label("Chart scope", ("Observed keys use equal spacing; elapsed gaps may differ. " if chart.type == "line" else "")
          + "Full labels, values and coverage follow in the chart-data appendix.", 48, 496, 864, height=32, size=1000)
    return "".join(parts)
