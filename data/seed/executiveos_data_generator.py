"""
ExecutiveOS Synthetic Data Generator
-------------------------------------
Generates training/eval data matching the ExecutiveOS schema, with genuine
learnable signal baked in (not random labels) so a model trained on this
data can realistically clear a >90% target instead of memorizing noise.

Two targets are wired with real structure:
  1. Risk_Level   -> deterministic rule on Customer_Concentration_% + Profit_Margin,
                      with configurable label noise (so 100% isn't trivially reachable
                      and the model has to learn real boundaries).
  2. Revenue      -> function of trend + monthly seasonality + Marketing_Spend +
                      Customers - Churn_%, by Region/Category, plus noise.
     "Forecast accuracy" = 1 - MAPE on held-out Revenue predictions.

Usage:
    python executiveos_data_generator.py --rows 6000 --seed 42 --out train.xlsx
    python executiveos_data_generator.py --rows 1500 --seed 99 --out test.xlsx --label-noise 0.06
"""

import argparse
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

REGION_COUNTRY = {
    "North America": ["USA", "Canada"],
    "Europe": ["Germany", "UK", "France"],
    "APAC": ["Singapore", "India", "Japan"],
    "LATAM": ["Brazil", "Mexico"],
    "Middle East": ["UAE", "Saudi Arabia"],
}
CATEGORIES = ["Electronics", "Clothing", "Sports", "Home", "Beauty"]
BUSINESS_UNITS = ["Retail", "Marketplace", "Direct", "Enterprise"]
INITIATIVES_BY_RISK = {
    "Low": ["Regional Expansion", "SKU Launch", "Sales Acceleration"],
    "High": ["Margin Defense Program", "Customer Diversification", "Pricing Optimization"],
    "Critical": ["Customer Diversification", "Margin Defense Program", "Forecast Upgrade"],
}
OWNER_BY_INITIATIVE = {
    "Regional Expansion": "COO", "SKU Launch": "CMO", "Sales Acceleration": "CRO",
    "Margin Defense Program": "CFO", "Customer Diversification": "CRO",
    "Pricing Optimization": "CFO", "Forecast Upgrade": "CEO",
}
STATUSES = ["Planned", "In Progress", "Completed", "Blocked"]

CATEGORY_BASE_MARGIN = {"Electronics": 14, "Clothing": 18, "Sports": 19, "Home": 16, "Beauty": 27}
CATEGORY_BASE_REVENUE = {"Electronics": 900_000, "Clothing": 480_000, "Sports": 520_000,
                          "Home": 430_000, "Beauty": 380_000}
SEASONAL_FACTOR = {1: .92, 2: .90, 3: .97, 4: 1.0, 5: 1.02, 6: 1.0,
                    7: .95, 8: .93, 9: 1.0, 10: 1.05, 11: 1.18, 12: 1.30}


def risk_rule(concentration, margin):
    if concentration > 70:
        return "Critical"
    if concentration > 60:
        return "High"
    if margin <= 0:
        return "Critical"
    if margin <= 5:
        return "High"
    return "Low"


def generate(n_rows, seed=42, label_noise=0.05, start_date="2024-01-01"):
    rng = np.random.default_rng(seed)
    regions = list(REGION_COUNTRY.keys())

    region = rng.choice(regions, n_rows)
    country = [rng.choice(REGION_COUNTRY[r]) for r in region]
    category = rng.choice(CATEGORIES, n_rows)
    business_unit = rng.choice(BUSINESS_UNITS, n_rows)

    base_date = datetime.strptime(start_date, "%Y-%m-%d")
    day_offsets = np.sort(rng.integers(0, 730, n_rows))
    dates = [base_date + timedelta(days=int(d)) for d in day_offsets]
    week_idx = day_offsets / 7.0
    month = np.array([d.month for d in dates])
    season = np.array([SEASONAL_FACTOR[m] for m in month])

    marketing_spend = rng.lognormal(10.5, 0.5, n_rows).clip(2_000, 200_000)
    customers = rng.lognormal(8.3, 0.6, n_rows).clip(100, 25_000).astype(int)
    churn = rng.beta(2, 10, n_rows) * 20  # 0-20%
    concentration = rng.beta(2, 3, n_rows) * 100  # 0-100%

    base_rev = np.array([CATEGORY_BASE_REVENUE[c] for c in category])
    trend = 1 + 0.0025 * week_idx  # ~+0.25%/week growth
    revenue = (base_rev * trend * season
               + marketing_spend * 3.1
               + customers * 12
               - churn * 4_000
               + rng.normal(0, 25_000, n_rows))
    revenue = revenue.clip(50_000, None).round(2)

    base_margin = np.array([CATEGORY_BASE_MARGIN[c] for c in category])
    margin = (base_margin - churn * 0.6 + rng.normal(0, 4, n_rows)).round(2)
    profit = (revenue * margin / 100).round(2)

    headcount = (customers / rng.uniform(20, 60, n_rows)).astype(int).clip(10, None)
    forecast_accuracy = (88 - churn * 0.4 + rng.normal(0, 6, n_rows)).clip(40, 99).round(0).astype(int)

    risk_level = np.array([risk_rule(c, m) for c, m in zip(concentration, margin)])
    if label_noise > 0:
        flip_mask = rng.random(n_rows) < label_noise
        choices = np.array(["Low", "High", "Critical"])
        risk_level[flip_mask] = rng.choice(choices, flip_mask.sum())

    initiative = np.array([rng.choice(INITIATIVES_BY_RISK[r]) for r in risk_level])
    owner = np.array([OWNER_BY_INITIATIVE[i] for i in initiative])
    status = rng.choice(STATUSES, n_rows)

    df = pd.DataFrame({
        "Date": [d.strftime("%Y-%m-%d") for d in dates],
        "Region": region, "Country": country,
        "Business_Unit": business_unit, "Category": category,
        "Revenue": revenue, "Profit": profit, "Profit_Margin": margin,
        "Marketing_Spend": marketing_spend.round(2), "Headcount": headcount,
        "Customers": customers, "Customer_Concentration_%": concentration.round(2),
        "Churn_%": churn.round(2), "Forecast_Accuracy": forecast_accuracy,
        "Risk_Level": risk_level, "Initiative": initiative,
        "Owner": owner, "Status": status,
    })
    return df.sort_values("Date").reset_index(drop=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--rows", type=int, default=6000)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--label-noise", type=float, default=0.05)
    p.add_argument("--out", type=str, default="executiveos_synthetic.xlsx")
    args = p.parse_args()

    df = generate(args.rows, seed=args.seed, label_noise=args.label_noise)
    df.to_excel(args.out, index=False, sheet_name="ExecutiveOS_Synthetic")
    print(f"Wrote {len(df)} rows -> {args.out}")
