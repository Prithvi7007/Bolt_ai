"""Chart calculations and export boundaries run in the offline test environment."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]


def test_local_chart_calculation_and_export_contract():
    result = subprocess.run(
        ["node", "--test", "apps/desktop/shared/data-chart.test.mjs"],
        cwd=ROOT, text=True, capture_output=True, encoding="utf-8", timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_svg_remains_valid_xml_for_noncharacters_controls_and_unpaired_surrogates():
    import xml.etree.ElementTree as ET
    script = r"""
import {renderChartSvg} from './apps/desktop/shared/data-chart.mjs';
const text='unsafe\u0000\uFFFE\uFFFF\uD800\uDC00\uD800 text 😀';
const chart={type:'bar',title:text,xLabel:'income',yLabel:'region',note:text,
  points:[{label:text,value:1,detail:text}]};
process.stdout.write(renderChartSvg(chart,{sourceName:text,question:text,evidence:text,warnings:[text]}));
"""
    result = subprocess.run(["node", "--input-type=module", "-e", script],
                            cwd=ROOT, text=True, capture_output=True, encoding="utf-8", timeout=10)
    assert result.returncode == 0, result.stderr
    root = ET.fromstring(result.stdout)
    assert root.tag == "{http://www.w3.org/2000/svg}svg"
    assert "\ufffd" in result.stdout
    assert "😀" in result.stdout
