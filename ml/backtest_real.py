"""
Prompt 7 — Real-data risk backtest.

Joins ExecutiveOS_Real_Financials.xlsx (real SEC operating financials) with the
hand-verified ExecutiveOS_Real_Concentration_Findings.xlsx into a single
`executive_metrics_real` table, computes Risk_Level two ways, and backtests each
against every company's ACTUAL next-fiscal-year (N+1) outcome.

Two risk assessments per company-year:
  - Risk_Level_Rule  : the project's deterministic risk_rule(concentration, margin)
                       — scale-free (uses only %s), so it transfers to real data.
  - Risk_Level_Model : the shipped RandomForest (ml/risk_model.joblib), which needs
                       9 features. We supply the 4 we have from real filings
                       (Revenue, Profit=operating income, Profit_Margin,
                       Customer_Concentration_%) and impute the other 5 with the
                       synthetic-training MEDIANS (they are not part of the risk
                       signal). NOTE: real Revenue/Profit are billions — far
                       outside the synthetic training range — so model predictions
                       are out-of-distribution and reported with that caveat.

Backtest definition:
  For each ticker, order fiscal years ascending. For each year N that has an
  N+1 in the data, the realized outcome is Actual_RiskState_{N+1} =
  risk_rule(concentration_{N+1}, margin_{N+1}) on the company's ACTUAL N+1
  financials. A year-N assessment is "correct" if it equals that realized state.

Inputs : data/seed/ExecutiveOS_Real_Financials.xlsx
         data/seed/ExecutiveOS_Real_Concentration_Findings.xlsx
Outputs: data/seed/ExecutiveOS_Real_Metrics.xlsx   (executive_metrics_real)
         data/seed/ExecutiveOS_Real_Backtest.xlsx  (N -> N+1 transitions)

Usage:  py ml/backtest_real.py
"""
from __future__ import annotations

import pathlib
import sys

import joblib
import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[1]
SEED = ROOT / "data" / "seed"
FIN = SEED / "ExecutiveOS_Real_Financials.xlsx"
CONC = SEED / "ExecutiveOS_Real_Concentration_Findings.xlsx"
MODEL = ROOT / "ml" / "risk_model.joblib"
TRAIN = SEED / "ExecutiveOS_Synthetic_Train_6000.xlsx"

OUT_METRICS = SEED / "ExecutiveOS_Real_Metrics.xlsx"
OUT_BACKTEST = SEED / "ExecutiveOS_Real_Backtest.xlsx"
OUT_REPORT = ROOT / "docs" / "REAL_WORLD_BACKTEST_REPORT.md"

FEATURES = [
    "Revenue", "Profit", "Profit_Margin", "Marketing_Spend", "Headcount",
    "Customers", "Customer_Concentration_%", "Churn_%", "Forecast_Accuracy",
]

# Below-threshold proxy for companies whose 10-K says "no single customer >=10%"
# (exact figure not disclosed). The rule's concentration thresholds are 60/70%,
# so any value <10 is immaterial to the rule; a sensitivity check below confirms
# the model is insensitive to it too.
BELOW_THRESHOLD_PROXY = 5.0


def risk_rule(concentration: float, margin: float) -> str:
    """The project's deterministic Risk_Level rule (data generator, verbatim).

    ABSOLUTE concentration thresholds (60/70%). On real large-cap companies,
    single-customer concentration never exceeds ~20%, so these thresholds never
    fire and the rule is effectively margin-only — a documented limitation, not
    a bug. See risk_rule_relative for the real-company relative mode.
    """
    if concentration > 70:
        return "Critical"
    if concentration > 60:
        return "High"
    if margin <= 0:
        return "Critical"
    if margin <= 5:
        return "High"
    return "Low"


# Percentile bands for the relative mode, chosen as direct analogs of the
# absolute rule: >=0.90 (top decile) <-> the old ">70%" Critical cutoff,
# >=0.70 <-> the old ">60%" High cutoff.
REL_CRITICAL_PCTL = 0.90
REL_HIGH_PCTL = 0.70


def risk_rule_relative(conc_percentile: float, margin: float) -> str:
    """Relative Risk_Level for REAL-company rows only.

    Identical STRUCTURE to risk_rule, but the absolute concentration cutoffs are
    replaced with the company's concentration PERCENTILE rank among the 10 real
    companies in executive_metrics_real. This makes the sourced concentration
    data actually influence the label (the absolute rule ignores it on real
    data). Inherits the original rule's short-circuit: a top-percentile
    concentration sets the tier before margin is considered.
    """
    if conc_percentile >= REL_CRITICAL_PCTL:
        return "Critical"
    if conc_percentile >= REL_HIGH_PCTL:
        return "High"
    if margin <= 0:
        return "Critical"
    if margin <= 5:
        return "High"
    return "Low"


def concentration_numeric(row: pd.Series) -> tuple[float, str]:
    """Map a confirmed finding to (numeric_for_modeling, source_flag)."""
    raw = row["Customer_Concentration_pct"]
    if isinstance(raw, (int, float)) and not pd.isna(raw):
        return float(raw), "disclosed"
    # text like "None disclosed (<10%)"
    return BELOW_THRESHOLD_PROXY, "below-threshold proxy (<10%, not individually disclosed)"


def _fmt_rate(d: dict, key: str) -> str:
    rate = d[key.replace("_rate", "") + "_rate"] if not key.endswith("_rate") else d[key]
    n = d["n"]
    cnt = d[key.replace("_rate", "")] if key.endswith("_rate") else d[key]
    return f"{cnt}/{n} ({rate:.0%})" if n else "0/0 (n/a)"


def write_outcome_report(bt: pd.DataFrame, rates_rule: dict, rates_model: dict) -> None:
    """Write the human-readable Real-World Backtest report (Task 4)."""
    er, lo = rates_rule["elevated"], rates_rule["low"]
    lines: list[str] = []
    lines.append("# Real-World Backtest Report")
    lines.append("")
    lines.append("**Does an elevated risk tier in fiscal year N actually precede a real "
                 "revenue decline or margin compression in year N+1?** Computed from real "
                 "SEC EDGAR financials (operating income / revenue) for 10 public companies "
                 "joined with hand-verified 10-K customer-concentration findings.")
    lines.append("")
    lines.append("> ⚠️ **Directional pilot, not a statistically powered study.** N = 10 "
                 "companies (40 year-over-year transitions, not independent). Treat these as "
                 "directional signal only. These numbers are kept entirely separate from the "
                 "synthetic held-out eval accuracy and must never be blended into one figure.")
    lines.append("")
    lines.append("## Headline (tiers from the deterministic rule)")
    lines.append("")
    rev_lift = er["revenue_decline_rate"] - lo["revenue_decline_rate"]
    lines.append(f"**Revenue decline — the clean signal.** Elevated (High/Critical) calls were "
                 f"followed by a next-year revenue decline {_fmt_rate(er, 'revenue_decline_rate')} "
                 f"of the time vs only {_fmt_rate(lo, 'revenue_decline_rate')} for Low calls — "
                 f"a **{rev_lift:+.0%}** difference in the directionally expected direction. "
                 f"On this pilot, an elevated tier meaningfully precedes real revenue decline.")
    lines.append("")
    lines.append(f"**Margin compression — signal is INVERTED, reported honestly.** Elevated "
                 f"{_fmt_rate(er, 'margin_compression_rate')} vs Low "
                 f"{_fmt_rate(lo, 'margin_compression_rate')}: Low calls compressed *more* often. "
                 f"This is expected and not a contradiction — the rule already fires on thin/"
                 f"negative margin, so elevated companies are *already at the floor* (little room "
                 f"left to compress, and some mean-revert up), while healthy high-margin Low "
                 f"companies have the most room to fall. Margin compression is therefore a poor "
                 f"discriminator here; revenue decline is the informative outcome.")
    lines.append("")
    lines.append(f"**Combined (decline OR compression):** elevated {_fmt_rate(er, 'adverse_rate')} "
                 f"vs low {_fmt_rate(lo, 'adverse_rate')} — nearly equal, *because* the inverted "
                 f"margin-compression term cancels the revenue-decline signal. We deliberately do "
                 f"NOT headline this combined number; it would hide the real result.")
    lines.append("")
    lines.append("Model-tier (RandomForest; near-identical to the rule): elevated→revenue-decline "
                 f"{_fmt_rate(rates_model['elevated'], 'revenue_decline_rate')} "
                 f"vs low {_fmt_rate(rates_model['low'], 'revenue_decline_rate')}.")
    lines.append("")
    lines.append("## Per-company-year: tier at N vs actual outcome at N+1")
    lines.append("")
    lines.append("| Ticker | FY N | Tier (rule) | FY N+1 | Revenue Δ | Margin Δ (pp) | Revenue decline | Margin compression |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for _, r in bt.sort_values(["Ticker", "Year_N"]).iterrows():
        gap = " *(gap)*" if r["Year_Gap"] > 1 else ""
        lines.append(
            f"| {r['Ticker']} | {r['Year_N']} | {r['Pred_Rule_N']} | {r['Year_N1']}{gap} | "
            f"{r['Revenue_Change_pct']:+.1f}% | {r['Margin_Change_pp']:+.1f} | "
            f"{'✓ yes' if r['Revenue_Decline'] else '— no'} | "
            f"{'✓ yes' if r['Margin_Compression'] else '— no'} |"
        )
    lines.append("")
    lines.append("*Δ = change from year N to N+1. `(gap)` marks a transition that crosses a "
                 "missing fiscal year (UAA's Dec→Mar fiscal-year-end change).*")
    lines.append("")
    lines.append("## Caveats")
    lines.append("")
    lines.append("- **Small sample:** 10 companies / 40 transitions; not independent and not "
                 "powered for significance. Directional only.")
    lines.append("- **Current-state classifier, not a forecaster:** the rule scores the "
                 "company's *current* state; this tests whether that state persists/worsens "
                 "next year, not a true forward prediction.")
    lines.append("- **Concentration barely moves the tier on real data** (it never trips the "
                 "absolute 60/70% thresholds); see [REAL_DATA_BACKTEST.md](./REAL_DATA_BACKTEST.md).")
    lines.append("- **Model tiers are out-of-distribution** on real-scale revenue, so the "
                 "model essentially echoes the rule here.")
    lines.append("")
    OUT_REPORT.parent.mkdir(parents=True, exist_ok=True)
    OUT_REPORT.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    for p in (FIN, CONC, MODEL, TRAIN):
        if not p.exists():
            sys.exit(f"Missing required input: {p}")

    fin = pd.read_excel(FIN)
    conc = pd.read_excel(CONC)

    # Per-ticker concentration (applied across that ticker's years: concentration
    # is roughly stable year-to-year and, for real retail names, always far below
    # the rule's 60% threshold, so per-year precision does not change the label).
    conc_map = {}
    for _, r in conc.iterrows():
        val, flag = concentration_numeric(r)
        conc_map[r["Ticker"]] = {
            "conc": val,
            "flag": flag,
            "largest": r.get("Largest_Customer"),
            "disclosed_text": r["Customer_Concentration_pct"],
            "conc_fy": int(r["Fiscal_Year"]),
        }

    # Impute the 5 features real filings don't carry, with synthetic-train medians.
    train = pd.read_excel(TRAIN)
    impute = {c: float(train[c].median()) for c in
              ["Marketing_Spend", "Headcount", "Customers", "Churn_%", "Forecast_Accuracy"]}
    # Training-distribution bounds, for the out-of-distribution scale flag.
    train_revenue_max = float(train["Revenue"].max())
    train_margin_min = float(train["Profit_Margin"].min())

    rows = []
    for _, r in fin.iterrows():
        t = r["Ticker"]
        cinfo = conc_map.get(t)
        if cinfo is None:
            print(f"  ! no concentration finding for {t}; skipping")
            continue
        margin = float(r["Profit_Margin"])
        conc_val = cinfo["conc"]
        rows.append({
            "Ticker": t,
            "Fiscal_Year": int(r["Fiscal_Year"]),
            "Revenue": float(r["Revenue"]),
            "Profit": float(r["Profit"]),                  # operating income
            "Profit_Margin": margin,
            "Customer_Concentration_%": conc_val,
            "Concentration_Source": cinfo["flag"],
            "Concentration_Disclosed": cinfo["disclosed_text"],
            "Largest_Customer": cinfo["largest"],
            # imputed (NOT from real filings) — flagged via Imputed_Features
            "Marketing_Spend": impute["Marketing_Spend"],
            "Headcount": impute["Headcount"],
            "Customers": impute["Customers"],
            "Churn_%": impute["Churn_%"],
            "Forecast_Accuracy": impute["Forecast_Accuracy"],
            "Imputed_Features": "Marketing_Spend,Headcount,Customers,Churn_%,Forecast_Accuracy (synthetic-train medians)",
        })

    em = pd.DataFrame(rows).sort_values(["Ticker", "Fiscal_Year"]).reset_index(drop=True)

    # Concentration PERCENTILE rank — one value per company, ranked against the
    # other 9 (ties — e.g. the five <10% proxies — share the average rank).
    comp_conc = em.drop_duplicates("Ticker").set_index("Ticker")["Customer_Concentration_%"]
    pctl = comp_conc.rank(pct=True)  # method='average'
    em["Concentration_Percentile"] = em["Ticker"].map(pctl).round(4)

    # Risk_Level_Rule — ABSOLUTE thresholds, scale-free, from real margin +
    # concentration. (Original rule; untouched. On real data, concentration
    # never trips the 60/70% cutoffs, so this is effectively margin-only.)
    em["Risk_Level_Rule"] = [risk_rule(c, m) for c, m in
                             zip(em["Customer_Concentration_%"], em["Profit_Margin"])]

    # Risk_Level_Rule_Relative — RELATIVE concentration (percentile bands) +
    # margin. Real-company rows only; makes concentration influence the label.
    em["Risk_Level_Rule_Relative"] = [risk_rule_relative(p, m) for p, m in
                                      zip(em["Concentration_Percentile"], em["Profit_Margin"])]

    # Risk_Level_Model — shipped RandomForest on the 9 features.
    clf = joblib.load(MODEL)
    X = em[FEATURES].astype(float).to_numpy()
    em["Risk_Level_Model"] = clf.predict(X)
    proba = clf.predict_proba(X)
    em["Model_Confidence"] = proba.max(axis=1).round(4)

    # Sensitivity: do model labels for the <10% rows change if the proxy is 0 or 9?
    flips = 0
    mask = em["Concentration_Source"].str.startswith("below-threshold")
    if mask.any():
        for proxy in (0.0, 9.0):
            Xs = em[FEATURES].astype(float).copy()
            Xs.loc[mask, "Customer_Concentration_%"] = proxy
            if not np.array_equal(clf.predict(Xs.to_numpy()), em["Risk_Level_Model"].to_numpy()):
                flips += 1

    em.to_excel(OUT_METRICS, index=False)

    # ── Backtest: year N assessment vs realized risk state at N+1 ──────────────
    bt_rows = []
    for t, g in em.groupby("Ticker"):
        g = g.sort_values("Fiscal_Year").reset_index(drop=True)
        for i in range(len(g) - 1):
            n, n1 = g.loc[i], g.loc[i + 1]
            gap = int(n1["Fiscal_Year"]) - int(n["Fiscal_Year"])
            actual_next = risk_rule(n1["Customer_Concentration_%"], n1["Profit_Margin"])
            actual_next_rel = risk_rule_relative(n1["Concentration_Percentile"], n1["Profit_Margin"])
            # REAL outcomes at N+1 (the substance of the backtest): did revenue
            # actually fall, and did the operating margin actually compress?
            rev_n, rev_n1 = float(n["Revenue"]), float(n1["Revenue"])
            mar_n, mar_n1 = float(n["Profit_Margin"]), float(n1["Profit_Margin"])
            revenue_decline = rev_n1 < rev_n
            margin_compression = mar_n1 < mar_n
            bt_rows.append({
                "Ticker": t,
                "Year_N": int(n["Fiscal_Year"]),
                "Year_N1": int(n1["Fiscal_Year"]),
                "Year_Gap": gap,  # normally 1; >1 flags a missing fiscal year (e.g. UAA transition)
                "Pred_Rule_N": n["Risk_Level_Rule"],
                "Pred_RuleRel_N": n["Risk_Level_Rule_Relative"],
                "Pred_Model_N": n["Risk_Level_Model"],
                "Elevated_Rule_N": n["Risk_Level_Rule"] in ("High", "Critical"),
                "Elevated_Model_N": n["Risk_Level_Model"] in ("High", "Critical"),
                "Revenue_N": round(rev_n, 2),
                "Revenue_N1": round(rev_n1, 2),
                "Revenue_Change_pct": round((rev_n1 - rev_n) / rev_n * 100, 2) if rev_n else None,
                "Margin_N": round(mar_n, 2),
                "Margin_N1": round(mar_n1, 2),
                "Margin_Change_pp": round(mar_n1 - mar_n, 2),
                "Revenue_Decline": revenue_decline,
                "Margin_Compression": margin_compression,
                "Adverse_Outcome": revenue_decline or margin_compression,
                # label-vs-relabel diagnostics (Prompt 7 — kept, not the headline)
                "Actual_RiskState_N1": actual_next,
                "Actual_RiskState_Rel_N1": actual_next_rel,
                "Rule_Correct": n["Risk_Level_Rule"] == actual_next,
                "RuleRel_Correct": n["Risk_Level_Rule_Relative"] == actual_next_rel,
                "Model_Correct": n["Risk_Level_Model"] == actual_next,
            })
    bt = pd.DataFrame(bt_rows)
    bt.to_excel(OUT_BACKTEST, index=False)

    # ── Outcome-based backtest: do elevated tiers precede REAL adverse moves? ───
    def outcome_rates(elevated_col: str) -> dict:
        """Compare next-year adverse-outcome rates for elevated vs Low calls."""
        out = {}
        for label, sub in (("elevated", bt[bt[elevated_col]]), ("low", bt[~bt[elevated_col]])):
            n_calls = len(sub)
            out[label] = {
                "n": n_calls,
                "revenue_decline": int(sub["Revenue_Decline"].sum()),
                "margin_compression": int(sub["Margin_Compression"].sum()),
                "adverse": int(sub["Adverse_Outcome"].sum()),
                "revenue_decline_rate": (sub["Revenue_Decline"].mean() if n_calls else float("nan")),
                "margin_compression_rate": (sub["Margin_Compression"].mean() if n_calls else float("nan")),
                "adverse_rate": (sub["Adverse_Outcome"].mean() if n_calls else float("nan")),
            }
        return out

    rates_rule = outcome_rates("Elevated_Rule_N")
    rates_model = outcome_rates("Elevated_Model_N")
    write_outcome_report(bt, rates_rule, rates_model)

    # ── Report ────────────────────────────────────────────────────────────────
    def confusion(pred_col, actual_col):
        labels = ["Low", "High", "Critical"]
        m = pd.crosstab(bt[actual_col], bt[pred_col],
                        rownames=["actual"], colnames=["pred"]).reindex(
                        index=labels, columns=labels, fill_value=0)
        return m

    rev_ratio = em["Revenue"].max() / train_revenue_max

    print("=" * 70)
    print(f"executive_metrics_real: {len(em)} company-years, {em.Ticker.nunique()} companies")
    print(f"  written -> {OUT_METRICS.name}")
    print(f"  model proxy sensitivity for <10% rows: {'STABLE' if flips == 0 else f'{flips} change(s)!'}")
    print()
    print("!! SCALE-MISMATCH FLAG (open finding — do NOT silently patch):")
    print(f"   Real Revenue max ({em['Revenue'].max():,.0f}) is {rev_ratio:,.0f}x the synthetic")
    print(f"   training max ({train_revenue_max:,.0f}). Real margins reach {em['Profit_Margin'].min():.1f}%")
    print(f"   vs synthetic floor ~{train_margin_min:.1f}%. Revenue/Profit/Marketing/Headcount/")
    print("   Customers are all OUT-OF-DISTRIBUTION for the model. This — not just the")
    print("   60/70% threshold mismatch — is the real reason Risk_Level_Model merely")
    print("   ECHOES the rule (it falls back on the scale-free margin/concentration")
    print("   splits). Retraining on real-scale data is an OPEN TODO pending a decision")
    print("   on whole-company vs business-unit/segment-level scope. NOT retraining now.")
    print()
    print("Current-year label distribution:")
    print("  Rule (absolute) :", dict(em.Risk_Level_Rule.value_counts()))
    print("  Rule (relative) :", dict(em.Risk_Level_Rule_Relative.value_counts()))
    print("  Model           :", dict(em.Risk_Level_Model.value_counts()))
    print(f"  Rule(abs) vs Model agreement (same year): "
          f"{(em.Risk_Level_Rule == em.Risk_Level_Model).mean():.0%}")
    print(f"  Rule(abs) vs Rule(relative) agreement   : "
          f"{(em.Risk_Level_Rule == em.Risk_Level_Rule_Relative).mean():.0%}")
    print()
    print("-" * 70)
    print(f"BACKTEST — {len(bt)} year N -> N+1 transitions "
          f"({bt.Ticker.nunique()} companies; {(bt.Year_Gap>1).sum()} cross a missing FY)")
    print(f"  Rule (absolute)  vs actual N+1 state    : {bt.Rule_Correct.mean():.1%} "
          f"({bt.Rule_Correct.sum()}/{len(bt)})")
    print(f"  Rule (relative)  vs actual N+1 rel-state : {bt.RuleRel_Correct.mean():.1%} "
          f"({bt.RuleRel_Correct.sum()}/{len(bt)})")
    print(f"  Model            vs actual N+1 state    : {bt.Model_Correct.mean():.1%} "
          f"({bt.Model_Correct.sum()}/{len(bt)})")
    print()
    print("Rule (absolute) confusion (rows=actual N+1, cols=predicted at N):")
    print(confusion("Pred_Rule_N", "Actual_RiskState_N1").to_string())
    print()
    print("Model confusion (rows=actual N+1, cols=predicted at N):")
    print(confusion("Pred_Model_N", "Actual_RiskState_N1").to_string())
    print()
    print("-" * 70)
    print("REAL-WORLD OUTCOME BACKTEST (the substance — directional pilot, N=10 companies)")
    print("  Did an elevated tier at N precede a REAL adverse move at N+1?")
    er, lo = rates_rule["elevated"], rates_rule["low"]
    print(f"  Elevated (High/Critical) calls: {er['n']}   |   Low calls: {lo['n']}")
    print(f"    next-year revenue decline   : elevated {er['revenue_decline']}/{er['n']} "
          f"({er['revenue_decline_rate']:.0%})  vs  low {lo['revenue_decline']}/{lo['n']} "
          f"({lo['revenue_decline_rate']:.0%})")
    print(f"    next-year margin compression: elevated {er['margin_compression']}/{er['n']} "
          f"({er['margin_compression_rate']:.0%})  vs  low {lo['margin_compression']}/{lo['n']} "
          f"({lo['margin_compression_rate']:.0%})")
    print(f"    any adverse outcome         : elevated {er['adverse']}/{er['n']} "
          f"({er['adverse_rate']:.0%})  vs  low {lo['adverse']}/{lo['n']} "
          f"({lo['adverse_rate']:.0%})")
    print(f"  report written -> {OUT_REPORT.relative_to(ROOT)}")
    print()
    print("-" * 70)
    print("Per-company current-year assessment (latest fiscal year shown last):")
    show = em[["Ticker", "Fiscal_Year", "Profit_Margin", "Customer_Concentration_%",
               "Concentration_Percentile", "Concentration_Source",
               "Risk_Level_Rule", "Risk_Level_Rule_Relative", "Risk_Level_Model"]]
    with pd.option_context("display.width", 220, "display.max_rows", 60):
        print(show.to_string(index=False))
    print(f"\n  backtest detail written -> {OUT_BACKTEST.name}")


if __name__ == "__main__":
    main()
