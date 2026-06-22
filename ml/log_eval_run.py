"""
Shared eval-run logger for the ExecutiveOS model pipeline.

Records each model evaluation so accuracy is trackable over retrains:
  - ALWAYS appends a line to ml/eval_runs.jsonl (local audit trail).
  - If SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are available (env or repo .env),
    inserts a row into the Supabase `model_eval_runs` table via PostgREST.
    (No supabase-py dependency — uses urllib.)

Table columns: model_name, run_date, accuracy, metric_type, notes.
"""
from __future__ import annotations

import datetime as _dt
import json
import pathlib
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
JSONL = ROOT / "ml" / "eval_runs.jsonl"


def _load_dotenv() -> dict[str, str]:
    env: dict[str, str] = {}
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def log_eval_run(model_name: str, accuracy: float, metric_type: str, notes: str = "") -> None:
    import os

    row = {
        "model_name": model_name,
        "run_date": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "accuracy": float(accuracy),
        "metric_type": metric_type,
        "notes": notes,
    }

    # 1) Local audit trail (always).
    with JSONL.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row) + "\n")
    print(f"[eval-log] appended to {JSONL.name}: {model_name} {metric_type}={accuracy}")

    # 2) Supabase (best-effort, only if a service-role key is available).
    env = {**_load_dotenv(), **os.environ}
    url = env.get("SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("[eval-log] Supabase skipped (no SUPABASE_SERVICE_ROLE_KEY).")
        return
    try:
        req = urllib.request.Request(
            f"{url.rstrip('/')}/rest/v1/model_eval_runs",
            data=json.dumps(row).encode("utf-8"),
            method="POST",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            print(f"[eval-log] Supabase insert ok ({resp.status}).")
    except urllib.error.HTTPError as e:
        print(f"[eval-log] Supabase insert failed: {e.code} {e.read().decode(errors='ignore')[:200]}")
    except Exception as e:  # noqa: BLE001
        print(f"[eval-log] Supabase insert error: {e}")
