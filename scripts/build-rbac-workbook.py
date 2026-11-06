#!/usr/bin/env python3
"""Build docs/RBAC.xlsx from docs/RBAC.csv.

The CSV is the source: columns Group, Feature, Student, Parent, Teacher,
Administrator, Notes, with Yes or No in the four role columns. Run this after
changing the CSV:

    python3 scripts/build-rbac-workbook.py

It needs openpyxl (pip install openpyxl).
"""
import csv
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.page import PageMargins

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs" / "RBAC.csv"
TARGET = ROOT / "docs" / "RBAC.xlsx"
ROLES = ["Student", "Parent", "Teacher", "Administrator"]
COLUMNS = ["Feature", *ROLES, "Notes"]

FONT = "Arial"
GREEN, RED = "1E7B34", "B42318"
YES_FILL = PatternFill("solid", fgColor="E8F5EC")
NO_FILL = PatternFill("solid", fgColor="FDECEC")
HEAD_FILL = PatternFill("solid", fgColor="1F4E46")
GROUP_FILL = PatternFill("solid", fgColor="DCE9E5")
THIN = Side(style="thin", color="C9D3D0")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def read_rows():
    with SOURCE.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        expected = ["Group", "Feature", *ROLES, "Notes"]
        if reader.fieldnames != expected:
            sys.exit(f"{SOURCE.name}: expected columns {expected}, found {reader.fieldnames}")
        rows = list(reader)
    for number, row in enumerate(rows, start=2):
        for role in ROLES:
            if row[role] not in ("Yes", "No"):
                sys.exit(f"{SOURCE.name} line {number}: {role} must be Yes or No, found {row[role]!r}")
        if not row["Group"].strip() or not row["Feature"].strip():
            sys.exit(f"{SOURCE.name} line {number}: Group and Feature are required")
    return rows


def build(rows):
    book = Workbook()
    sheet = book.active
    sheet.title = "RBAC"
    last = get_letter(len(COLUMNS))

    sheet["A1"] = "Bangla Adventures — Role-based access control (RBAC)"
    sheet["A1"].font = Font(name=FONT, size=14, bold=True, color="1F4E46")
    sheet.merge_cells(f"A1:{last}1")
    sheet["A2"] = ("Who can do what. ✓ = can do it, ✗ = cannot. Notes say when a right is limited, "
                   "for example to a teacher's own classes or a parent's linked children. "
                   "Signed-out visitors can only open the welcome, safety and sign-in pages.")
    sheet["A2"].font = Font(name=FONT, size=10, italic=True, color="444444")
    sheet["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    sheet.merge_cells(f"A2:{last}2")
    sheet.row_dimensions[2].height = 30
    sheet["A3"] = "Source: docs/RBAC.csv and docs/ACCESS_CONTROL.md in the project repository."
    sheet["A3"].font = Font(name=FONT, size=9, color="666666")
    sheet.merge_cells(f"A3:{last}3")

    header = 5
    for index, title in enumerate(COLUMNS, start=1):
        cell = sheet.cell(row=header, column=index, value=title)
        cell.font = Font(name=FONT, size=11, bold=True, color="FFFFFF")
        cell.fill = HEAD_FILL
        cell.border = BOX
        cell.alignment = Alignment(horizontal="left" if title in ("Feature", "Notes") else "center", vertical="center")
    sheet.row_dimensions[header].height = 22

    line = header
    group = None
    for row in rows:
        if row["Group"] != group:
            group = row["Group"]
            line += 1
            cell = sheet.cell(row=line, column=1, value=group)
            cell.font = Font(name=FONT, size=11, bold=True, color="1F4E46")
            for column in range(1, len(COLUMNS) + 1):
                sheet.cell(row=line, column=column).fill = GROUP_FILL
                sheet.cell(row=line, column=column).border = BOX
            sheet.merge_cells(start_row=line, start_column=1, end_row=line, end_column=len(COLUMNS))
        line += 1
        feature = sheet.cell(row=line, column=1, value=row["Feature"])
        feature.font = Font(name=FONT, size=10)
        feature.alignment = Alignment(wrap_text=True, vertical="top")
        feature.border = BOX
        for offset, role in enumerate(ROLES, start=2):
            allowed = row[role] == "Yes"
            cell = sheet.cell(row=line, column=offset, value="✓" if allowed else "✗")
            cell.font = Font(name=FONT, size=12, bold=True, color=GREEN if allowed else RED)
            cell.fill = YES_FILL if allowed else NO_FILL
            cell.alignment = Alignment(horizontal="center", vertical="top")
            cell.border = BOX
        notes = sheet.cell(row=line, column=len(COLUMNS), value=row["Notes"] or None)
        notes.font = Font(name=FONT, size=9, color="444444")
        notes.alignment = Alignment(wrap_text=True, vertical="top")
        notes.border = BOX

    widths = {"Feature": 46, "Notes": 58, "Administrator": 16}
    for index, title in enumerate(COLUMNS, start=1):
        sheet.column_dimensions[get_letter(index)].width = widths.get(title, 13)
    sheet.freeze_panes = f"B{header + 1}"
    sheet.print_title_rows = f"{header}:{header}"
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_margins = PageMargins(left=0.4, right=0.4, top=0.5, bottom=0.5)
    sheet.oddFooter.center.text = "Page &P of &N"
    book.properties.title = "Bangla Adventures — RBAC"
    book.properties.creator = "Bangla Adventures project team"
    return book


def get_letter(index):
    from openpyxl.utils import get_column_letter
    return get_column_letter(index)


if __name__ == "__main__":
    rows = read_rows()
    build(rows).save(TARGET)
    print(f"Wrote {TARGET.relative_to(ROOT)} with {len(rows)} features.")
