# Real-World Backtest Report

**Does an elevated risk tier in fiscal year N actually precede a real revenue decline or margin compression in year N+1?** Computed from real SEC EDGAR financials (operating income / revenue) for 10 public companies joined with hand-verified 10-K customer-concentration findings.

> ⚠️ **Directional pilot, not a statistically powered study.** N = 10 companies (40 year-over-year transitions, not independent). Treat these as directional signal only. These numbers are kept entirely separate from the synthetic held-out eval accuracy and must never be blended into one figure.

## Headline (tiers from the deterministic rule)

**Revenue decline — the clean signal.** Elevated (High/Critical) calls were followed by a next-year revenue decline 11/12 (92%) of the time vs only 10/28 (36%) for Low calls — a **+56%** difference in the directionally expected direction. On this pilot, an elevated tier meaningfully precedes real revenue decline.

**Margin compression — signal is INVERTED, reported honestly.** Elevated 8/12 (67%) vs Low 23/28 (82%): Low calls compressed *more* often. This is expected and not a contradiction — the rule already fires on thin/negative margin, so elevated companies are *already at the floor* (little room left to compress, and some mean-revert up), while healthy high-margin Low companies have the most room to fall. Margin compression is therefore a poor discriminator here; revenue decline is the informative outcome.

**Combined (decline OR compression):** elevated 11/12 (92%) vs low 24/28 (86%) — nearly equal, *because* the inverted margin-compression term cancels the revenue-decline signal. We deliberately do NOT headline this combined number; it would hide the real result.

Model-tier (RandomForest; near-identical to the rule): elevated→revenue-decline 12/13 (92%) vs low 9/27 (33%).

## Per-company-year: tier at N vs actual outcome at N+1

| Ticker | FY N | Tier (rule) | FY N+1 | Revenue Δ | Margin Δ (pp) | Revenue decline | Margin compression |
|---|---|---|---|---|---|---|---|
| COLM | 2021 | Low | 2022 | +10.8% | -3.1 | — no | ✓ yes |
| COLM | 2022 | Low | 2023 | +0.7% | -2.5 | — no | ✓ yes |
| COLM | 2023 | Low | 2024 | -3.4% | -0.9 | ✓ yes | ✓ yes |
| COLM | 2024 | Low | 2025 | +0.8% | -1.9 | — no | ✓ yes |
| CROX | 2021 | Low | 2022 | +53.7% | -5.6 | — no | ✓ yes |
| CROX | 2022 | Low | 2023 | +11.5% | +2.2 | — no | — no |
| CROX | 2023 | Low | 2024 | +3.5% | -1.3 | — no | ✓ yes |
| CROX | 2024 | Low | 2025 | -1.5% | -21.2 | ✓ yes | ✓ yes |
| ELF | 2022 | Low | 2023 | +47.6% | +4.2 | — no | — no |
| ELF | 2023 | Low | 2024 | +76.9% | +2.9 | — no | — no |
| ELF | 2024 | Low | 2025 | +28.3% | -2.6 | — no | ✓ yes |
| ELF | 2025 | Low | 2026 | +24.6% | -7.5 | — no | ✓ yes |
| GPRO | 2021 | Low | 2022 | -5.8% | -6.2 | ✓ yes | ✓ yes |
| GPRO | 2022 | High | 2023 | -8.1% | -11.1 | ✓ yes | ✓ yes |
| GPRO | 2023 | Critical | 2024 | -20.3% | -9.3 | ✓ yes | ✓ yes |
| GPRO | 2024 | Critical | 2025 | -18.7% | +4.1 | ✓ yes | — no |
| HELE | 2022 | Low | 2023 | -6.8% | -2.0 | ✓ yes | ✓ yes |
| HELE | 2023 | Low | 2024 | -3.3% | +2.8 | ✓ yes | — no |
| HELE | 2024 | Low | 2025 | -4.9% | -5.5 | ✓ yes | ✓ yes |
| HELE | 2025 | Low | 2026 | -6.4% | -51.3 | ✓ yes | ✓ yes |
| LEVI | 2021 | Low | 2022 | +7.0% | -1.4 | — no | ✓ yes |
| LEVI | 2022 | Low | 2023 | -5.3% | -4.4 | ✓ yes | ✓ yes |
| LEVI | 2023 | Low | 2024 | +3.2% | -1.7 | — no | ✓ yes |
| LEVI | 2024 | High | 2025 | +4.1% | +6.4 | — no | — no |
| NWL | 2021 | Low | 2022 | -10.7% | -6.3 | ✓ yes | ✓ yes |
| NWL | 2022 | High | 2023 | -14.0% | -4.3 | ✓ yes | ✓ yes |
| NWL | 2023 | Critical | 2024 | -6.8% | +1.9 | ✓ yes | — no |
| NWL | 2024 | High | 2025 | -5.0% | -0.3 | ✓ yes | ✓ yes |
| SONO | 2021 | Low | 2022 | +2.1% | -3.9 | — no | ✓ yes |
| SONO | 2022 | Low | 2023 | -5.5% | -6.3 | ✓ yes | ✓ yes |
| SONO | 2023 | Critical | 2024 | -8.3% | -1.9 | ✓ yes | ✓ yes |
| SONO | 2024 | Critical | 2025 | -4.9% | -0.3 | ✓ yes | ✓ yes |
| UAA | 2021 | Low | 2023 *(gap)* | +3.9% | -3.9 | — no | ✓ yes |
| UAA | 2023 | High | 2024 | -3.4% | -0.4 | ✓ yes | ✓ yes |
| UAA | 2024 | High | 2025 | -9.4% | -7.6 | ✓ yes | ✓ yes |
| UAA | 2025 | Critical | 2026 | -3.8% | +0.3 | ✓ yes | — no |
| YETI | 2021 | Low | 2022 | +13.1% | -11.6 | — no | ✓ yes |
| YETI | 2022 | Low | 2023 | +4.0% | +5.7 | — no | — no |
| YETI | 2023 | Low | 2024 | +10.3% | -0.2 | — no | ✓ yes |
| YETI | 2024 | Low | 2025 | +2.1% | -2.0 | — no | ✓ yes |

*Δ = change from year N to N+1. `(gap)` marks a transition that crosses a missing fiscal year (UAA's Dec→Mar fiscal-year-end change).*

## Caveats

- **Small sample:** 10 companies / 40 transitions; not independent and not powered for significance. Directional only.
- **Current-state classifier, not a forecaster:** the rule scores the company's *current* state; this tests whether that state persists/worsens next year, not a true forward prediction.
- **Concentration barely moves the tier on real data** (it never trips the absolute 60/70% thresholds); see [REAL_DATA_BACKTEST.md](./REAL_DATA_BACKTEST.md).
- **Model tiers are out-of-distribution** on real-scale revenue, so the model essentially echoes the rule here.
