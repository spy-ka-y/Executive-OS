"""
Pull REAL fiscal-year financials for 10 public companies straight from SEC EDGAR.

For each ticker we record, per fiscal year (most recent 5 FYs):
  - Revenue        (us-gaap revenue concepts, first that resolves per company)
  - Profit         (us-gaap:OperatingIncomeLoss  — operating income)
  - Profit_Margin  (Profit / Revenue, as a percentage)

It deliberately does NOT include Customer_Concentration_% — that figure is
disclosed inconsistently across these companies (clean structured data for some,
prose-only for others, genuinely absent for some like CROX) and must never be
fabricated. Concentration is researched separately and recorded by hand in
ExecutiveOS_Real_Concentration_Findings.xlsx.

Source: SEC EDGAR XBRL "company concept" API (data.sec.gov). These are the exact
values from each company's 10-K filings, so the numbers are objective.

Usage:  py data/seed/sec_real_data_fetcher.py
        (pip install requests pandas openpyxl  if missing)
"""
from __future__ import annotations

import sys
import time
import pathlib
from typing import Optional

import requests
import pandas as pd

HERE = pathlib.Path(__file__).resolve().parent
OUT_XLSX = HERE / "ExecutiveOS_Real_Financials.xlsx"

# SEC requires a descriptive User-Agent with contact info; unidentified traffic
# gets throttled/blocked. (See https://www.sec.gov/os/webmaster-faq#developers)
HEADERS = {"User-Agent": "ExecutiveOS-research somyasoni2007@gmail.com"}

TICKERS = ["CROX", "LEVI", "COLM", "UAA", "YETI", "NWL", "HELE", "ELF", "GPRO", "SONO"]

N_YEARS = 5  # most recent 5 fiscal years

# Revenue is reported under different us-gaap tags depending on filer/era. Try in
# order; first concept that returns annual data for a company wins.
REVENUE_CONCEPTS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
]
PROFIT_CONCEPT = "OperatingIncomeLoss"  # operating income (per user spec)

TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
CONCEPT_URL = "https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/us-gaap/{concept}.json"


def _get(url: str) -> Optional[dict]:
    for attempt in range(3):
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            if attempt == 2:
                print(f"  ! request failed: {url}\n    {e}")
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


def load_ticker_cik_map() -> dict[str, str]:
    data = _get(TICKERS_URL)
    if not data:
        sys.exit("Could not load SEC ticker->CIK map.")
    out: dict[str, str] = {}
    for row in data.values():
        out[row["ticker"].upper()] = str(row["cik_str"]).zfill(10)
    return out


# year -> (filed_date, value, concept) for the chosen datapoint of a fiscal year
YearFacts = dict[int, tuple[str, float, str]]


def annual_facts(cik: str, concept: str) -> YearFacts:
    """Return {fiscal_year: (filed, value, concept)} for full-year 10-K datapoints.

    A fiscal year is identified by the *period-end* calendar year (NOT EDGAR's
    `fy` label — one 10-K reports several years' figures all under the same `fy`).
    Keeps only ~1-year periods from 10-Ks, and when a year appears in multiple
    filings (comparatives / restatements) keeps the most recently FILED value.
    """
    data = _get(CONCEPT_URL.format(cik=cik, concept=concept))
    if not data:
        return {}
    units = data.get("units", {}).get("USD", [])
    chosen: YearFacts = {}
    for f in units:
        if f.get("form") != "10-K" or f.get("fp") != "FY":
            continue
        start, end = f.get("start"), f.get("end")
        if not start or not end:
            continue
        end_ts = pd.Timestamp(end)
        days = (end_ts - pd.Timestamp(start)).days
        if not (350 <= days <= 380):  # full fiscal year only, not a quarter/stub
            continue
        # Fiscal year = calendar year the period ends in, EXCEPT 52/53-week
        # filers whose year ends in early January (e.g. YETI FY2025 ends
        # 2026-01-03) — those are labelled by the prior year, matching how the
        # company names the fiscal year.
        year = end_ts.year - 1 if end_ts.month == 1 else end_ts.year
        filed = f.get("filed", "")
        prev = chosen.get(year)
        if prev is None or filed >= prev[0]:
            chosen[year] = (filed, float(f["val"]), concept)
    return chosen


def merge_concepts(cik: str, concepts: list[str]) -> YearFacts:
    """Merge several us-gaap concepts (e.g. revenue reported under different tags
    across eras), keeping the most recently filed datapoint per fiscal year."""
    merged: YearFacts = {}
    for c in concepts:
        for year, (filed, val, concept) in annual_facts(cik, c).items():
            prev = merged.get(year)
            if prev is None or filed > prev[0]:
                merged[year] = (filed, val, concept)
        time.sleep(0.2)
    return merged


def fetch_company(ticker: str, cik: str) -> pd.DataFrame:
    revenue = merge_concepts(cik, REVENUE_CONCEPTS)
    profit = merge_concepts(cik, [PROFIT_CONCEPT])

    years = sorted(set(revenue) & set(profit), reverse=True)[:N_YEARS]
    rows = []
    for fy in years:
        rev = revenue[fy][1]
        op = profit[fy][1]
        margin = (op / rev * 100.0) if rev else None
        rows.append(
            {
                "Ticker": ticker,
                "Fiscal_Year": fy,
                "Revenue": round(rev, 2),
                "Profit": round(op, 2),  # operating income
                "Profit_Margin": round(margin, 2) if margin is not None else None,
                "Revenue_Concept": revenue[fy][2],
            }
        )
    tags = sorted({revenue[fy][2] for fy in years})
    print(
        f"  {ticker} (CIK {cik}): {len(rows)} FY rows "
        f"[{years[-1] if years else '-'}-{years[0] if years else '-'}], "
        f"revenue tag(s)={tags}"
    )
    return pd.DataFrame(rows)


def main() -> None:
    print("Loading SEC ticker->CIK map…")
    cik_map = load_ticker_cik_map()

    frames = []
    for t in TICKERS:
        cik = cik_map.get(t.upper())
        if not cik:
            print(f"  ! {t}: no CIK found in SEC map — skipping")
            continue
        frames.append(fetch_company(t, cik))
        time.sleep(0.3)  # be polite to data.sec.gov

    if not frames:
        sys.exit("No data fetched.")
    df = pd.concat(frames, ignore_index=True)
    df = df.sort_values(["Ticker", "Fiscal_Year"], ascending=[True, False]).reset_index(drop=True)

    df.to_excel(OUT_XLSX, index=False)

    n_companies = df["Ticker"].nunique()
    print(f"\nWrote {OUT_XLSX.name}: {len(df)} rows across {n_companies} companies.")
    if n_companies != len(TICKERS):
        missing = sorted(set(TICKERS) - set(df["Ticker"]))
        print(f"  ! WARNING: missing companies: {missing}")


if __name__ == "__main__":
    main()
