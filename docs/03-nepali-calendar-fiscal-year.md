# 03 — Nepali Calendar (BS) & Fiscal Year

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. Do not copy or share without written permission. See [LICENSE](../LICENSE).

## 1. Principle
- The database stores **one canonical date per field: AD (Gregorian) `DATE`**.
- BS (Bikram Sambat) is computed for display and accepted for input.
- BS month lengths vary year to year (29–32 days) and **cannot be calculated by formula** — the system uses a lookup table of days per month for BS 2000–2100, stored in table `bs_calendar` (seeded from a maintained open-source dataset and verifiable by admin).

## 2. Display
- Company setting: **Primary calendar** = BS or AD. Both are always shown, e.g. `2083-06-16 BS (02 Oct 2026)`.
- Date pickers have a BS/AD toggle; typing in either converts live.
- Reports show both dates in headers ("For the period Shrawan 1, 2083 to Ashwin 31, 2083 (17 Jul 2026 – 17 Oct 2026)" — exact AD equivalents always taken from the table).
- Nepali month names: Baishakh, Jestha, Ashadh, Shrawan, Bhadra, Ashwin, Kartik, Mangsir, Poush, Magh, Falgun, Chaitra. Devanagari digits optional (v2).
- Amount in words: English (Lakh/Crore option for NPR, Million for AUD) and Nepali (v2).

## 3. Fiscal year
| Company country | Default FY | Label |
|---|---|---|
| Nepal | Shrawan 1 – Ashadh last day (BS) | `2083/84` |
| Australia | 1 July – 30 June | `FY2026-27` |
| Other | Admin-defined start month (AD or BS) | Configurable |

- FY boundaries are stored as AD start/end dates in `fiscal_years`, derived from BS for Nepal companies.
- **Periods:** 12 monthly periods per FY. For Nepal FY, periods follow BS months (Shrawan … Ashadh); for AD FY, calendar months. Optional 13th "adjustment period" for year-end audit adjustments (same last date, separate period flag).
- Every document number series resets per FY.

## 4. Conversion service
- `DateService.toBS(adDate) → {year, month, day}` and `toAD(bsYear, bsMonth, bsDay)`.
- Implemented once in a shared package used by both backend and frontend; unit tested against known reference dates.
- Out-of-range dates (outside table) are rejected with a clear error.

## 5. Edge cases
- Validation of BS day > days in that month → error.
- Reports by "month" respect the company's primary calendar (BS months for Nepal).
- Due dates and aging computed on AD days (accurate day counts), displayed in both.
