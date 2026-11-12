"""Fetch every indicator in indicators/*.json and write tidy CSVs to data/.

Output format (one file per indicator, data/<id>.csv):

    year,geo,series,value

* geo uses NUTS codes: DE for Germany, DE1..DEG for the 16 Länder. Finer
  levels (NUTS 3 = Kreise, AGS = Gemeinden) can be added later with the same
  column, so the site never needs restructuring for them.
* series is the key the indicator's "series" map labels in both languages.

Standard library only, so it runs anywhere (locally, GitHub Actions).

Usage:
    python pipeline/fetch.py                # every indicator
    python pipeline/fetch.py electricity-mix population   # selected ones
    python pipeline/fetch.py --source owid_github         # one source type
"""

from __future__ import annotations

import csv
import io
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDICATORS = ROOT / "indicators"
DATA = ROOT / "data"

LAENDER = ["DE1", "DE2", "DE3", "DE4", "DE5", "DE6", "DE7", "DE8",
           "DE9", "DEA", "DEB", "DEC", "DED", "DEE", "DEF", "DEG"]

USER_AGENT = "de-in-numbers data pipeline (open-source, non-commercial)"

OWID_DATASETS = {
    "energy": "https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv",
    "co2": "https://raw.githubusercontent.com/owid/co2-data/master/owid-co2-data.csv",
}

EUROSTAT_API = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"


def http_get(url: str, retries: int = 3) -> bytes:
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read()
        except Exception as exc:  # network errors, HTTP errors
            last = exc
            time.sleep(2 ** attempt)
    raise RuntimeError(f"GET {url} failed: {last}")


# ---------------------------------------------------------------- OWID

_owid_cache: dict[str, list[dict]] = {}


def fetch_owid_github(ind: dict) -> list[tuple]:
    spec = ind["fetch"]
    name = spec["dataset"]
    if name not in _owid_cache:
        text = http_get(OWID_DATASETS[name]).decode("utf-8")
        _owid_cache[name] = [r for r in csv.DictReader(io.StringIO(text))
                             if r["iso_code"] == "DEU"]
    # "combine" sums several source columns into one series, e.g. to fold
    # small categories into "Other" and keep charts at <= 8 series.
    combine = spec.get("combine", {})
    rows = []
    for r in _owid_cache[name]:
        year = int(r["year"])
        if year < spec.get("from_year", 0):
            continue
        for key in ind["series"]:
            cols = combine.get(key, [key])
            vals = [r.get(c) for c in cols]
            if all(v not in (None, "") for v in vals):
                rows.append((year, "DE", key, sum(float(v) for v in vals)))
    return rows


# ---------------------------------------------------------------- Eurostat

def parse_jsonstat(doc: dict) -> list[dict]:
    """Flatten a JSON-stat 2.0 dataset into dicts of {dim: code, 'value': v}."""
    dims = doc["id"]
    sizes = doc["size"]
    codes = []
    for d in dims:
        index = doc["dimension"][d]["category"]["index"]
        by_pos = sorted(index.items(), key=lambda kv: kv[1])
        codes.append([c for c, _ in by_pos])
    out = []
    values = doc.get("value", {})
    if isinstance(values, list):  # JSON-stat allows a dense array too
        values = {i: v for i, v in enumerate(values)}
    for flat, value in values.items():
        flat = int(flat)
        coords = {}
        for d, size, cs in zip(reversed(dims), reversed(sizes), reversed(codes)):
            coords[d] = cs[flat % size]
            flat //= size
        coords["value"] = value
        out.append(coords)
    return out


def fetch_eurostat(ind: dict) -> list[tuple]:
    spec = ind["fetch"]
    geos = ["DE"] + (LAENDER if spec.get("geo") == "laender" else [])
    params = [("format", "JSON"), ("lang", "EN")]
    params += [("geo", g) for g in geos]
    for k, v in spec.get("filters", {}).items():
        params.append((k, v))
    params += [(spec["series_dim"], s) for s in spec["series_values"]]
    url = EUROSTAT_API + spec["dataset"] + "?" + urllib.parse.urlencode(params)
    doc = json.loads(http_get(url))
    rows = []
    for rec in parse_jsonstat(doc):
        if rec["value"] is None:
            continue
        time_code = rec["time"]
        if not time_code[:4].isdigit() or len(time_code) != 4:
            continue  # annual data only for now
        rows.append((int(time_code), rec["geo"], rec[spec["series_dim"]], float(rec["value"])))
    return rows


FETCHERS = {
    "owid_github": fetch_owid_github,
    "eurostat": fetch_eurostat,
}


# ---------------------------------------------------------------- main

def load_indicators() -> list[dict]:
    out = []
    for path in sorted(INDICATORS.glob("*.json")):
        topic = json.loads(path.read_text(encoding="utf-8"))
        for ind in topic["indicators"]:
            ind["topic"] = topic["topic"]["id"]
            out.append(ind)
    return out


def write_csv(ind_id: str, rows: list[tuple]) -> None:
    rows = sorted(set(rows), key=lambda r: (r[1], r[2], r[0]))
    DATA.mkdir(exist_ok=True)
    with open(DATA / f"{ind_id}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["year", "geo", "series", "value"])
        for year, geo, series, value in rows:
            w.writerow([year, geo, series, f"{value:.6g}"])


def main(argv: list[str]) -> int:
    only_source = None
    if "--source" in argv:
        i = argv.index("--source")
        only_source = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    wanted = set(argv)

    failures = []
    status = {}
    for ind in load_indicators():
        if wanted and ind["id"] not in wanted:
            continue
        src = ind["fetch"]["type"]
        if only_source and src != only_source:
            continue
        try:
            rows = FETCHERS[src](ind)
            if not rows:
                raise RuntimeError("no rows returned")
            write_csv(ind["id"], rows)
            years = [r[0] for r in rows]
            status[ind["id"]] = {"ok": True, "rows": len(rows), "years": [min(years), max(years)]}
            print(f"ok    {ind['id']:40s} {len(rows):5d} rows  {min(years)}–{max(years)}")
        except Exception as exc:
            failures.append(ind["id"])
            status[ind["id"]] = {"ok": False, "error": str(exc)[:300]}
            print(f"FAIL  {ind['id']:40s} {exc}", file=sys.stderr)

    # Keep a record of when each indicator was last refreshed successfully.
    status_path = DATA / "_status.json"
    previous = json.loads(status_path.read_text()) if status_path.exists() else {}
    today = time.strftime("%Y-%m-%d")
    for k, v in status.items():
        if v["ok"]:
            previous[k] = {"updated": today, "rows": v["rows"], "years": v["years"]}
        else:
            previous.setdefault(k, {})["last_error"] = v["error"]
    DATA.mkdir(exist_ok=True)
    status_path.write_text(json.dumps(previous, indent=2, sort_keys=True) + "\n")

    if failures:
        print(f"\n{len(failures)} indicator(s) failed: {', '.join(failures)}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
