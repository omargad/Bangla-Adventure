#!/usr/bin/env python3
"""Build docs/content-review-worksheet.xlsx from docs/content-review-worksheet.csv.

The CSV is the source: one row per shipped topic and lesson, with the columns
Type, ID, Title (English), Title (Bangla), Category or band, Source, Has quiz,
Has video, Reviewer, Date reviewed, Decision and Notes. The last four are for
the reviewers to fill in. Run this after changing the CSV:

    python3 scripts/build-content-review-workbook.py

It needs openpyxl (pip install openpyxl).
"""
import csv
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.page import PageMargins

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs" / "content-review-worksheet.csv"
TARGET = ROOT / "docs" / "content-review-worksheet.xlsx"
COLUMNS = ["Type", "ID", "Title (English)", "Title (Bangla)", "Category or band", "Source",
           "Has quiz", "Has video", "Reviewer", "Date reviewed", "Decision", "Notes"]
FILL_IN = ["Reviewer", "Date reviewed", "Decision", "Notes"]
TYPES = ("Topic", "Lesson")
DECISIONS = ("Approve", "Send back")

FONT = "Arial"
HEAD_FILL = PatternFill("solid", fgColor="1F4E46")
FILL_HEAD_FILL = PatternFill("solid", fgColor="8A6D00")
FILL_IN_FILL = PatternFill("solid", fgColor="FFF4CC")
TOPIC_FILL = PatternFill("solid", fgColor="F3F8F6")
THIN = Side(style="thin", color="C9D3D0")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WIDTHS = {
    "Type": 8, "ID": 18, "Title (English)": 24, "Title (Bangla)": 22, "Category or band": 18,
    "Source": 44, "Has quiz": 10, "Has video": 30, "Reviewer": 14, "Date reviewed": 11,
    "Decision": 11, "Notes": 28,
}


def read_rows():
    # utf-8-sig: the CSV starts with a byte order mark so that Excel shows the Bangla correctly.
    with SOURCE.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != COLUMNS:
            sys.exit(f"{SOURCE.name}: expected columns {COLUMNS}, found {reader.fieldnames}")
        rows = list(reader)
    seen = set()
    for number, row in enumerate(rows, start=2):
        if row["Type"] not in TYPES:
            sys.exit(f"{SOURCE.name} line {number}: Type must be Topic or Lesson, found {row['Type']!r}")
        if not row["ID"].strip() or not row["Title (English)"].strip():
            sys.exit(f"{SOURCE.name} line {number}: ID and Title (English) are required")
        if (row["Type"], row["ID"]) in seen:
            sys.exit(f"{SOURCE.name} line {number}: {row['Type']} {row['ID']} is listed twice")
        seen.add((row["Type"], row["ID"]))
        if row["Decision"] and row["Decision"] not in DECISIONS:
            sys.exit(f"{SOURCE.name} line {number}: Decision must be empty, Approve or Send back, found {row['Decision']!r}")
    return rows


def build(rows):
    book = Workbook()
    sheet = book.active
    sheet.title = "Content review"
    last = get_column_letter(len(COLUMNS))
    topics = sum(row["Type"] == "Topic" for row in rows)
    lessons = sum(row["Type"] == "Lesson" for row in rows)

    sheet["A1"] = "Bangla Adventures — Content review worksheet"
    sheet["A1"].font = Font(name=FONT, size=14, bold=True, color="1F4E46")
    sheet.merge_cells(f"A1:{last}1")
    sheet["A2"] = (f"The {topics} topics and {lessons} lessons that a new installation holds back until an "
                   "administrator approves them. A lesson's video needs its own decision in the app: "
                   "write it in Notes. How to review each item is in docs/CONTENT_REVIEW_PACK.md.")
    sheet["A2"].font = Font(name=FONT, size=10, italic=True, color="444444")
    sheet["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    sheet.merge_cells(f"A2:{last}2")
    sheet.row_dimensions[2].height = 28
    sheet["A3"] = "Fill in the shaded columns: Reviewer, Date reviewed, Decision (Approve or Send back) and Notes."
    sheet["A3"].font = Font(name=FONT, size=10, bold=True, color="8A6D00")
    sheet["A3"].fill = FILL_IN_FILL
    sheet.merge_cells(f"A3:{last}3")
    sheet["A4"] = "Source: docs/content-review-worksheet.csv in the project repository."
    sheet["A4"].font = Font(name=FONT, size=9, color="666666")
    sheet.merge_cells(f"A4:{last}4")

    header = 6
    for index, title in enumerate(COLUMNS, start=1):
        cell = sheet.cell(row=header, column=index, value=title)
        cell.font = Font(name=FONT, size=10, bold=True, color="FFFFFF")
        cell.fill = FILL_HEAD_FILL if title in FILL_IN else HEAD_FILL
        cell.border = BOX
        cell.alignment = Alignment(wrap_text=True, vertical="center")
    sheet.row_dimensions[header].height = 30

    for line, row in enumerate(rows, start=header + 1):
        for index, title in enumerate(COLUMNS, start=1):
            cell = sheet.cell(row=line, column=index, value=row[title] or None)
            cell.border = BOX
            cell.alignment = Alignment(wrap_text=True, vertical="top")
            if title in FILL_IN:
                cell.font = Font(name=FONT, size=10)
                cell.fill = FILL_IN_FILL
            else:
                cell.font = Font(name=FONT, size=9 if title in ("Source", "Has video") else 10,
                                 bold=title == "Title (English)",
                                 color="444444" if title in ("Source", "Has video") else "000000")
                if row["Type"] == "Topic":
                    cell.fill = TOPIC_FILL

    first, final = header + 1, header + len(rows)
    decision = get_column_letter(COLUMNS.index("Decision") + 1)
    choice = DataValidation(type="list", formula1='"' + ",".join(DECISIONS) + '"', allow_blank=True,
                            error="Choose Approve or Send back.", errorTitle="Decision")
    choice.add(f"{decision}{first}:{decision}{final}")
    sheet.add_data_validation(choice)

    for index, title in enumerate(COLUMNS, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = WIDTHS[title]
    sheet.freeze_panes = f"D{first}"
    sheet.auto_filter.ref = f"A{header}:{last}{final}"
    sheet.print_title_rows = f"{header}:{header}"
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_margins = PageMargins(left=0.3, right=0.3, top=0.5, bottom=0.5)
    sheet.oddFooter.center.text = "Page &P of &N"
    book.properties.title = "Bangla Adventures — Content review worksheet"
    book.properties.creator = "Bangla Adventures project team"
    return book


if __name__ == "__main__":
    rows = read_rows()
    build(rows).save(TARGET)
    print(f"Wrote {TARGET.relative_to(ROOT)} with {len(rows)} items.")
