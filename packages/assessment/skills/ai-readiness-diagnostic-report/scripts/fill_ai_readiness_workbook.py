#!/usr/bin/env python3
"""Fill Sunstone AI Readiness Diagnostic workbook without changing layout/style."""
from __future__ import annotations

import argparse
import copy
import json
import re
import shutil
import sys
from pathlib import Path
from typing import Any

import os

from openpyxl import load_workbook

# No built-in default: the template path is deployment-specific. Resolve from
# ENSEMBLE_ASSESSMENT_TEMPLATE, or require --template explicitly (see argparse
# default below) — never assume a fixed on-disk location.
TEMPLATE = Path(os.environ["ENSEMBLE_ASSESSMENT_TEMPLATE"]) if os.environ.get("ENSEMBLE_ASSESSMENT_TEMPLATE") else None

HEADER_CELLS = {
    "Assessment": {"company": "D2", "assessment_date": "D3", "assessed_by": "D4", "assessment_type": "D5"},
    "Remediation & Recommnedations": {"company": "D2", "assessment_date": "D3", "assessed_by": "D4", "assessment_type": "D5"},
    "Tech Debt Catalog": {"company": "D2", "assessment_date": "D3", "assessed_by": "D4", "assessment_type": "D5"},
}

SUMMARY_CELLS = {
    "company": "D3",
    "overall_assessment": "D6",
    "key_strengths": "D7",
    "critical_gaps": "D8",
    "priority_actions": "D9",
    "investment_required": "D10",
    "engagement_level": "D11",
}

EDITABLE_COLUMNS = {
    "Assessment": {"score": 4, "context": 5},
    "Remediation & Recommnedations": {"priority": 4, "order": 5, "recommendation": 6},
    "Tech Debt Catalog": {"category": 3, "dimension": 4, "detail": 5},
}


def safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_. -]+", "_", name).strip()[:180] or "AI_Readiness_Diagnostic.xlsx"


def text(v: Any, limit: int = 32000) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    return s[:limit]


def score(v: Any) -> Any:
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return max(1, min(5, float(v)))
    m = {"A": 5, "B": 4, "C": 3, "D": 2, "F": 1}
    s = str(v).strip().upper()
    if s in m:
        return m[s]
    try:
        return max(1, min(5, float(s)))
    except ValueError:
        return None

def summary_text(v: Any) -> str:
    """Summary tab values are executive-facing; keep evidence details off-tab."""
    s = text(v)
    s = re.sub(r"(?is)\s*Evidence:\s*.*$", "", s)
    s = re.sub(r"(?is)\s*Confidence:\s*.*$", "", s)
    return s.strip()



def sheet_signature(ws) -> dict[str, Any]:
    """Capture layout/style invariant for workbook cells/geometry."""
    cells = {}
    for row in ws.iter_rows():
        for c in row:
            cells[c.coordinate] = {
                "style_id": c.style_id,
                "num_fmt": c.number_format,
                "font": copy.copy(c.font),
                "fill": copy.copy(c.fill),
                "border": copy.copy(c.border),
                "alignment": copy.copy(c.alignment),
                "protection": copy.copy(c.protection),
            }
    return {
        "max_row": ws.max_row,
        "max_column": ws.max_column,
        "merged": sorted(str(r) for r in ws.merged_cells.ranges),
        "row_heights": {k: v.height for k, v in ws.row_dimensions.items()},
        "col_widths": {k: v.width for k, v in ws.column_dimensions.items()},
        "cells": cells,
    }


def validate_signatures(before: dict[str, Any], after_wb) -> list[str]:
    errors = []
    for title, sig in before.items():
        if title not in after_wb.sheetnames:
            errors.append(f"missing sheet: {title}")
            continue
        ws = after_wb[title]
        now = sheet_signature(ws)
        for key in ("max_row", "max_column", "merged", "row_heights", "col_widths"):
            if sig[key] != now[key]:
                errors.append(f"{title}: layout changed: {key}")
        for coord, old in sig["cells"].items():
            c = ws[coord]
            if c.style_id != old["style_id"] or c.number_format != old["num_fmt"]:
                errors.append(f"{title}!{coord}: style changed")
                break
    return errors


def find_rows_by_dimension(ws, start_row: int = 1) -> dict[str, int]:
    rows = {}
    for r in range(start_row, ws.max_row + 1):
        v = ws.cell(r, 3).value
        if isinstance(v, str) and v.strip():
            rows[v.strip()] = r
    return rows


def fill_headers(wb, data: dict[str, Any]) -> None:
    for sheet, mapping in HEADER_CELLS.items():
        ws = wb[sheet]
        for key, cell in mapping.items():
            if data.get(key):
                ws[cell] = text(data[key])

    ws = wb["Summary"]
    ws[SUMMARY_CELLS["company"]] = text(data.get("company", ""))
    summary = data.get("summary", {}) or {}
    for key, cell in SUMMARY_CELLS.items():
        if key == "company":
            continue
        if key in summary:
            ws[cell] = summary_text(summary[key])


def fill_assessment(wb, data: dict[str, Any]) -> None:
    ws = wb["Assessment"]
    row_map = find_rows_by_dimension(ws, 8)
    for dim, item in (data.get("assessments", {}) or {}).items():
        r = row_map.get(dim)
        if not r:
            continue
        ws.cell(r, EDITABLE_COLUMNS["Assessment"]["score"]).value = score(item.get("score"))
        ws.cell(r, EDITABLE_COLUMNS["Assessment"]["context"]).value = text(item.get("context"))


def fill_recommendations(wb, data: dict[str, Any]) -> None:
    ws = wb["Remediation & Recommnedations"]
    row_map = find_rows_by_dimension(ws, 8)
    for dim, item in (data.get("recommendations", {}) or {}).items():
        r = row_map.get(dim)
        if not r:
            continue
        ws.cell(r, EDITABLE_COLUMNS["Remediation & Recommnedations"]["priority"]).value = text(item.get("priority"))
        ws.cell(r, EDITABLE_COLUMNS["Remediation & Recommnedations"]["order"]).value = item.get("order")
        ws.cell(r, EDITABLE_COLUMNS["Remediation & Recommnedations"]["recommendation"]).value = text(item.get("recommendation"))


def norm_name(v: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(v or "").lower()).strip()


SUMMARY_ALIASES = {
    "r d process agentic systems readiness": ["r d process agentic systems readiness"],
    "r d org ai adoption": ["r d ai adoption"],
    "product management people process roadmapping tools readiness": [
        "backlog health demand management",
        "workflow decomposition process mapping",
        "product metrics",
    ],
    "systems foundation readiness": ["technology platform foundation"],
    "security": ["agentic security posture"],
    "order to cash workflow definition": [
        "workflow decomposition process mapping",
        "data flow integration architecture api readiness",
    ],
    "cross functional ai adoption": ["r d ai adoption"],
    "cross functional teams ai champion presence": ["r d ai adoption", "r d people team capability technical leadership"],
    "organizational agility decision making": ["current value creation capacity throughput vs constraints"],
}


def assessment_dimension_scores(wb) -> dict[str, float]:
    """Compute real dimension/subdimension scores from Assessment D values."""
    ws = wb["Assessment"]
    headers: list[tuple[int, str]] = []
    out: dict[str, float] = {}

    for r in range(8, ws.max_row + 1):
        b = ws.cell(r, 2).value
        c = ws.cell(r, 3).value
        if isinstance(c, str) and c.strip():
            v = score(ws.cell(r, EDITABLE_COLUMNS["Assessment"]["score"]).value)
            if v is not None:
                out[norm_name(c)] = round(float(v), 2)
        if isinstance(b, int) and isinstance(c, str) and c.strip():
            headers.append((r, c.strip()))

    for i, (start, name) in enumerate(headers):
        end = headers[i + 1][0] if i + 1 < len(headers) else ws.max_row + 1
        vals = []
        for r in range(start + 1, end):
            v = score(ws.cell(r, EDITABLE_COLUMNS["Assessment"]["score"]).value)
            if v is not None:
                vals.append(float(v))
        if vals:
            out[norm_name(name)] = round(sum(vals) / len(vals), 2)
    return out


def scorecard_item(scorecard: dict[str, Any], dim: str) -> dict[str, Any] | None:
    if dim in scorecard:
        return scorecard[dim]
    nd = norm_name(dim)
    for k, v in scorecard.items():
        if norm_name(k) == nd:
            return v
    # Backward-compatible alias for existing payloads.
    if dim.replace("R&D Org", "R&D") in scorecard:
        return scorecard[dim.replace("R&D Org", "R&D")]
    return None


def explicit_summary_score(item: dict[str, Any] | None) -> float | None:
    if not item:
        return None
    for key in ("score", "avg_score", "avg", "average"):
        v = score(item.get(key))
        if v is not None:
            return round(float(v), 2)
    return None


def scope_is_future(item: dict[str, Any] | None) -> bool:
    return bool(item and "future" in str(item.get("scope", "")).lower())

def phase_is_later_than_i(value: Any) -> bool:
    phase = str(value or "").strip().upper()
    if not phase:
        return False
    normalized = phase.replace("PHASE", "").strip()
    return normalized in {"II", "III", "2", "3"}




def implicit_summary_score(dim: str, computed: dict[str, float]) -> float | None:
    nd = norm_name(dim)
    if nd in computed:
        return computed[nd]

    vals = [computed[candidate] for candidate in SUMMARY_ALIASES.get(nd, []) if candidate in computed]
    if vals:
        return round(sum(vals) / len(vals), 2)
    return None


def fill_scorecard(
    wb,
    data: dict[str, Any],
    score_future_scope: bool = False,
    score_all_phases: bool = False,
) -> None:
    ws = wb["Summary"]
    scorecard = data.get("scorecard", {}) or {}
    company_scorecard = data.get("company_scorecard", {}) or {}
    computed = assessment_dimension_scores(wb)

    for r in range(15, 35):
        dim = ws.cell(r, 3).value
        if not isinstance(dim, str) or not dim.strip() or "dimension" in dim.lower():
            continue

        # Rows 28-34 are company-wide dimensions. Never infer these from R&D
        # rows/aliases; only write explicit company_scorecard evidence.
        is_company_wide = r >= 28
        item = scorecard_item(company_scorecard if is_company_wide else scorecard, dim.strip())

        if item:
            if item.get("scope") is not None:
                ws.cell(r, 5).value = text(item.get("scope"))
            if item.get("phase") is not None:
                ws.cell(r, 6).value = text(item.get("phase"))

        # Summary scores represent the selected assessment phase. Default to
        # Phase I only: Phase II/III rows are marked N/A unless explicitly
        # requested. Future-scope rows remain blank unless caller opts in.
        row_scope_is_future = "future" in str(ws.cell(r, 5).value or "").lower()
        row_is_later_phase = phase_is_later_than_i(ws.cell(r, 6).value)
        if row_is_later_phase and not score_all_phases:
            ws.cell(r, 4).value = "N/A"
            continue

        avg = None if (row_scope_is_future and not score_future_scope) else explicit_summary_score(item)
        if avg is None and not row_scope_is_future and not is_company_wide:
            avg = implicit_summary_score(dim.strip(), computed)
        ws.cell(r, 4).value = avg


def fill_tech_debt(wb, data: dict[str, Any]) -> None:
    ws = wb["Tech Debt Catalog"]
    items = data.get("tech_debt", []) or []
    for idx, item in enumerate(items[:25], start=8):
        ws.cell(idx, 3).value = text(item.get("category"))
        ws.cell(idx, 4).value = text(item.get("dimension"))
        ws.cell(idx, 5).value = text(item.get("detail"))


EVIDENCE_REF_RE = re.compile(r"(?P<path>(?:[A-Za-z0-9_. -]+/)*docs/assessment/[A-Za-z0-9_.@+ -]+\.md)(?::(?P<line>\d+))?")


def json_texts(data: Any) -> list[str]:
    if isinstance(data, str):
        return [data]
    if isinstance(data, dict):
        out: list[str] = []
        for v in data.values():
            out.extend(json_texts(v))
        return out
    if isinstance(data, list):
        out = []
        for v in data:
            out.extend(json_texts(v))
        return out
    return []


def normalize_ref_path(ref: str) -> str:
    return ref.strip().lstrip("./")


def copy_evidence_files(evidence_root: Path, evidence_dir: Path, data: dict[str, Any]) -> tuple[dict[str, Path], Path | None]:
    """Copy/update docs/assessment evidence files and build an index."""
    if not evidence_root.exists():
        return {}, None

    evidence_dir.mkdir(parents=True, exist_ok=True)
    copied: dict[str, Path] = {}

    # Copy all summary/assessment markdown evidence under any docs/assessment folder.
    for src in sorted(evidence_root.glob("**/docs/assessment/*.md")):
        if not src.is_file():
            continue
        rel = src.relative_to(evidence_root)
        dst = evidence_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied[rel.as_posix()] = dst

    refs: list[tuple[str, str | None]] = []
    seen = set()
    for s in json_texts(data):
        for m in EVIDENCE_REF_RE.finditer(s):
            ref = normalize_ref_path(m.group("path"))
            line = m.group("line")
            key = (ref, line)
            if key not in seen:
                seen.add(key)
                refs.append(key)

    index = evidence_dir / "EVIDENCE_INDEX.md"
    lines = [
        "# AI Readiness Diagnostic Evidence Index",
        "",
        "This folder is copied/updated from `docs/assessment` evidence in the assessed repo tree.",
        "Workbook cells hyperlink here or to copied evidence files. Line numbers below refer to original markdown/source citations when present.",
        "",
        "## Evidence References Used in Workbook",
        "",
    ]
    if refs:
        for ref, line in refs:
            copied_path = copied.get(ref)
            copied_rel = copied_path.relative_to(evidence_dir).as_posix() if copied_path else "not copied (reference may be source-code evidence, not assessment markdown)"
            suffix = f":{line}" if line else ""
            lines.append(f"- `{ref}{suffix}` -> `{copied_rel}`")
    else:
        lines.append("- No `docs/assessment/*.md` references found in fill JSON.")

    lines.extend(["", "## Copied Assessment Files", ""])
    for rel in sorted(copied):
        lines.append(f"- [{rel}]({rel})")
    index.write_text("\n".join(lines) + "\n")
    return copied, index


def first_evidence_link(cell_text: Any, copied: dict[str, Path], evidence_dir: Path, workbook_path: Path) -> str | None:
    s = str(cell_text or "")
    for m in EVIDENCE_REF_RE.finditer(s):
        ref = normalize_ref_path(m.group("path"))
        dst = copied.get(ref)
        if dst:
            return Path(dst).relative_to(workbook_path.parent).as_posix()
    index = evidence_dir / "EVIDENCE_INDEX.md"
    if index.exists():
        return index.relative_to(workbook_path.parent).as_posix()
    return None


def link_cell(cell, target: str | None) -> None:
    # openpyxl can set a blank cell's visible value to the hyperlink target;
    # only link cells that already have a real displayed value.
    if target and cell.value not in (None, ""):
        cell.hyperlink = target


def link_workbook_evidence(wb, workbook_path: Path, evidence_dir: Path, copied: dict[str, Path]) -> None:
    """Add hyperlinks to evidence-bearing detail cells without changing styling/layout."""
    if not evidence_dir.exists():
        return

    # Keep the Summary tab executive-only. Evidence links/details live in the
    # Assessment, Remediation, Tech Debt, and evidence index artifacts.

    ws = wb["Assessment"]
    for r in range(8, ws.max_row + 1):
        c = ws.cell(r, EDITABLE_COLUMNS["Assessment"]["context"])
        link_cell(c, first_evidence_link(c.value, copied, evidence_dir, workbook_path))

    ws = wb["Remediation & Recommnedations"]
    for r in range(8, ws.max_row + 1):
        c = ws.cell(r, EDITABLE_COLUMNS["Remediation & Recommnedations"]["recommendation"])
        link_cell(c, first_evidence_link(c.value, copied, evidence_dir, workbook_path))

    ws = wb["Tech Debt Catalog"]
    for r in range(8, 33):
        c = ws.cell(r, EDITABLE_COLUMNS["Tech Debt Catalog"]["detail"])
        link_cell(c, first_evidence_link(c.value, copied, evidence_dir, workbook_path))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input-json", required=True, type=Path)
    ap.add_argument("--output-dir", required=True, type=Path)
    ap.add_argument("--output-name", default=None)
    ap.add_argument("--template", type=Path, default=TEMPLATE, required=TEMPLATE is None)
    ap.add_argument("--evidence-root", type=Path, default=Path.cwd(), help="Repo/root containing docs/assessment evidence files")
    ap.add_argument("--no-copy-evidence", action="store_true", help="Do not copy/link docs/assessment evidence files")
    ap.add_argument("--score-future-scope", action="store_true", help="Allow Summary scores on rows marked Future scope")
    ap.add_argument("--score-all-phases", action="store_true", help="Allow Summary scores on Phase II/III rows; default marks them N/A")
    args = ap.parse_args()

    if not args.template or not args.template.exists():
        print(f"ERROR: template not found: {args.template}", file=sys.stderr)
        return 2
    data = json.loads(args.input_json.read_text())
    args.output_dir.mkdir(parents=True, exist_ok=True)
    out_name = args.output_name or f"AI_Readiness_Diagnostic_{data.get('company','Assessment')}.xlsx"
    if not out_name.lower().endswith(".xlsx"):
        out_name += ".xlsx"
    out_path = args.output_dir / safe_name(out_name)

    shutil.copy2(args.template, out_path)
    wb = load_workbook(out_path)
    before = {ws.title: sheet_signature(ws) for ws in wb.worksheets}

    fill_headers(wb, data)
    fill_assessment(wb, data)
    fill_recommendations(wb, data)
    fill_scorecard(
        wb,
        data,
        score_future_scope=args.score_future_scope,
        score_all_phases=args.score_all_phases,
    )
    fill_tech_debt(wb, data)

    copied: dict[str, Path] = {}
    evidence_index: Path | None = None
    evidence_dir = out_path.with_suffix("")
    evidence_dir = evidence_dir.parent / f"{evidence_dir.name}_evidence"
    if not args.no_copy_evidence:
        copied, evidence_index = copy_evidence_files(args.evidence_root, evidence_dir, data)
        link_workbook_evidence(wb, out_path, evidence_dir, copied)

    wb.save(out_path)

    # Reload and validate styles/layout after save.
    wb2 = load_workbook(out_path)
    errors = validate_signatures(before, wb2)
    if errors:
        print("ERROR: workbook layout/style validation failed:", file=sys.stderr)
        for e in errors[:20]:
            print(f"- {e}", file=sys.stderr)
        return 3

    print(f"WROTE {out_path}")
    if not args.no_copy_evidence:
        print(f"EVIDENCE {evidence_dir} ({len(copied)} copied files)")
        if evidence_index:
            print(f"EVIDENCE_INDEX {evidence_index}")
    print("VALIDATION OK: workbook layout/style/formulas preserved except intended cell values and evidence hyperlinks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
