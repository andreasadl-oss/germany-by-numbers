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
import urllib.error
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

# Eurostat's "DE" means West Germany before 1991. Only unified Germany is shown.
UNIFIED_FROM = 1991

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
    try:
        doc = json.loads(http_get(url))
    except RuntimeError as exc:
        raise RuntimeError(f"{exc} | {eurostat_error(url)}") from None
    rows = []
    for rec in parse_jsonstat(doc):
        if rec["value"] is None:
            continue
        time_code = rec["time"]
        if not time_code[:4].isdigit() or len(time_code) != 4:
            continue  # annual data only for now
        if int(time_code) < spec.get("from_year", UNIFIED_FROM):
            continue
        rows.append((int(time_code), rec["geo"], rec[spec["series_dim"]], float(rec["value"])))
    # Guard: one value per (year, geo, series). More means a dimension is unfiltered.
    keys = [r[:3] for r in rows]
    if len(keys) != len(set(keys)):
        open_dims = [
            f"{d}: {doc['dimension'][d]['category'].get('label', {})}"
            for d, n in zip(doc["id"], doc["size"])
            if n > 1 and d not in ("time", "geo", spec["series_dim"])
        ]
        raise RuntimeError(f"ambiguous result: several values per year; filter these dimensions: {open_dims}")
    return rows


def eurostat_error(url: str) -> str:
    """Eurostat explains a bad query in the error body; surface it in the log."""
    try:
        urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=60)
        return ""
    except urllib.error.HTTPError as e:
        return e.read().decode("utf-8", "replace")[:400]
    except Exception as e:
        return str(e)


# ---------------------------------------------------------------- Bundeswahlleiterin

# Column headers of btw_ab49_datenbank_ergebnisse.csv -> NUTS codes.
LAND_CODES = {
    "Deutschland": "DE", "Baden-Württemberg": "DE1", "Bayern": "DE2", "Berlin": "DE3",
    "Brandenburg": "DE4", "Bremen": "DE5", "Hamburg": "DE6", "Hessen": "DE7",
    "Mecklenburg-Vorpommern": "DE8", "Niedersachsen": "DE9", "Nordrhein-Westfalen": "DEA",
    "Rheinland-Pfalz": "DEB", "Saarland": "DEC", "Sachsen": "DED", "Sachsen-Anhalt": "DEE",
    "Schleswig-Holstein": "DEF", "Thüringen": "DEG",
}

_bwl_cache: dict[str, dict] = {}


def german_number(cell: str) -> float | None:
    """'60.510.631 ' -> 60510631.0; '82,5' -> 82.5; '–' or '' -> None."""
    cell = cell.strip()
    if cell in ("", "–", "-", "."):
        return None
    return float(cell.replace(".", "").replace(",", "."))


def load_bundestag_results(url: str) -> dict:
    """Parse the Bundeswahlleiterin's results-since-1949 table.

    Returns {(row label, year, geo, vote): count}, where vote is "Erststimmen"
    or "Zweitstimmen" and count is the absolute number ("Anzahl" columns only).
    Row labels are parties as named today (PDS is "Die Linke", NPD is "HEIMAT")
    plus Wahlberechtigte, Wählende and "gültige Stimmen/Sitze insgesamt".
    """
    if url in _bwl_cache:
        return _bwl_cache[url]
    text = http_get(url).decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(text), delimiter=";"))
    head = next(i for i, r in enumerate(rows) if r and r[0] == "Merkmal/Partei")
    lands, votes, kinds = rows[head], rows[head + 1], rows[head + 2]
    cols = []
    for j in range(3, len(lands)):
        land = lands[j].replace("\n", "").strip()
        if land in LAND_CODES and kinds[j].strip() == "Anzahl" and votes[j].strip() in ("Erststimmen", "Zweitstimmen"):
            cols.append((j, LAND_CODES[land], votes[j].strip()))
    if len({c[1] for c in cols}) != 17:
        raise RuntimeError(f"unexpected table layout: found {len(cols)} count columns")
    out = {}
    for r in rows[head + 3:]:
        if len(r) < 4 or not r[1].strip().isdigit():
            continue
        label, year = r[0].strip(), int(r[1])
        for j, geo, vote in cols:
            v = german_number(r[j]) if j < len(r) else None
            if v is not None:
                out[(label, year, geo, vote)] = v
    _bwl_cache[url] = out
    return out


def fetch_bundeswahlleiterin(ind: dict) -> list[tuple]:
    spec = ind["fetch"]
    data = load_bundestag_results(spec["url"])
    geos = ["DE"] + (LAENDER if ind.get("geo") == "laender" else [])
    years = sorted({k[1] for k in data if k[1] >= spec.get("from_year", UNIFIED_FROM)})
    rows = []
    for year in years:
        for geo in geos:
            get = lambda label, vote="Zweitstimmen": data.get((label, year, geo, vote))
            if spec["measure"] == "turnout":
                voters, electorate = get("Wählende"), get("Wahlberechtigte")
                if voters and electorate:
                    rows.append((year, geo, "turnout", 100 * voters / electorate))
            elif spec["measure"] == "second_vote_share":
                valid = get("gültige Stimmen/Sitze insgesamt")
                if not valid:
                    continue
                named = 0.0
                for key, parties in spec["parties"].items():
                    votes = [get(p) for p in parties]
                    if any(v is not None for v in votes):
                        share = 100 * sum(v or 0 for v in votes) / valid
                        named += share
                        rows.append((year, geo, key, share))
                if "other" in ind["series"]:
                    rows.append((year, geo, "other", 100 - named))
            else:
                raise RuntimeError(f"unknown measure {spec['measure']}")
    return rows


# ---------------------------------------------------------------- Destatis GENESIS

GENESIS_API = "https://genesis.destatis.de/genesisWS/rest/2020/"


def genesis_table(name: str, startyear: int) -> list[dict]:
    """Download a GENESIS table as flat CSV ("ffcsv") and return its rows.

    Each row becomes {variable code: attribute label, ..., "year", "value", "unit"},
    e.g. {"GES": "Insgesamt", "TODUR1": "Diabetes mellitus", "year": 2024, ...}.
    Needs DESTATIS_TOKEN (or DESTATIS_USER and DESTATIS_PASSWORD), see
    docs/DESTATIS_SETUP.md.
    """
    import os
    import zipfile

    token = os.environ.get("DESTATIS_TOKEN", "")
    user = token or os.environ.get("DESTATIS_USER", "")
    if not user:
        raise RuntimeError("no Destatis credentials (DESTATIS_TOKEN not set)")
    password = "" if token else os.environ.get("DESTATIS_PASSWORD", "")
    body = urllib.parse.urlencode({
        "name": name, "area": "all", "compress": "false", "format": "ffcsv",
        "startyear": str(startyear), "language": "de",
    }).encode()
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(
                GENESIS_API + "data/tablefile", data=body,
                headers={"username": user, "password": password, "User-Agent": USER_AGENT,
                         "Content-Type": "application/x-www-form-urlencoded"})
            with urllib.request.urlopen(req, timeout=300) as resp:
                raw = resp.read()
            break
        except Exception as exc:
            last = exc
            time.sleep(2 ** attempt)
    else:
        raise RuntimeError(f"GENESIS {name} failed: {last}")
    if raw[:2] == b"PK":  # GENESIS zips the file even with compress=false
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            raw = z.read(z.namelist()[0])
    text = raw.decode("utf-8-sig")
    if text.lstrip().startswith("{"):  # an error or status message, not data
        status = json.loads(text).get("Status", {})
        raise RuntimeError(f"GENESIS {name}: {status.get('Code')} {status.get('Content')}")
    out = []
    for r in csv.DictReader(io.StringIO(text), delimiter=";"):
        if not r.get("time", "").isdigit() or r.get("value") in (None, "", "-", ".", "...", "x"):
            continue
        row = {"year": int(r["time"]), "unit": r.get("value_unit", "")}
        try:
            row["value"] = float(r["value"].replace(",", "."))
        except ValueError:
            continue
        i = 1
        while f"{i}_variable_code" in r:
            row[r[f"{i}_variable_code"]] = r[f"{i}_variable_attribute_label"]
            i += 1
        out.append(row)
    return out


def fetch_destatis(ind: dict) -> list[tuple]:
    """Series are picked by attribute label, so the spec reads like the table:

    "series_var": "STEUA1", "series": {"wage": ["Lohnsteuer"], ...},
    "filters": {"GES": "Insgesamt"}, "total": "Steuereinnahmen insgesamt"
    (the "other" series is total minus the named ones), "scale": 1e-6.
    """
    spec = ind["fetch"]
    rows = genesis_table(spec["table"], spec.get("from_year", UNIFIED_FROM))
    rows = [r for r in rows if all(r.get(k) == v for k, v in spec.get("filters", {}).items())]
    var = spec["series_var"]
    labels_seen = {r.get(var) for r in rows}
    wanted = [l for ls in spec["series"].values() for l in ls] + ([spec["total"]] if "total" in spec else [])
    missing = [l for l in wanted if l not in labels_seen]
    if missing:
        raise RuntimeError(f"labels not in {spec['table']}/{var}: {missing}; available: {sorted(l for l in labels_seen if l)}")
    scale = spec.get("scale", 1)
    by_year: dict[int, dict[str, float]] = {}
    for r in rows:
        by_year.setdefault(r["year"], {})[r[var]] = r["value"]
    out = []
    for year, vals in sorted(by_year.items()):
        named = 0.0
        for key, labels in spec["series"].items():
            if any(l in vals for l in labels):
                v = sum(vals.get(l, 0) for l in labels)
                named += v
                out.append((year, "DE", key, v * scale))
        if "total" in spec and spec["total"] in vals:
            out.append((year, "DE", "other", (vals[spec["total"]] - named) * scale))
    return out


FETCHERS = {
    "owid_github": fetch_owid_github,
    "eurostat": fetch_eurostat,
    "bundeswahlleiterin": fetch_bundeswahlleiterin,
    "destatis": fetch_destatis,
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
            w.writerow([year, geo, series, f"{value:.10g}"])


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
            status[ind["id"]] = {"ok": False, "error": str(exc)[:800]}
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
