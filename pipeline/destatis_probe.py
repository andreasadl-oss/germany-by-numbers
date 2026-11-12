"""Read-only probe of the Destatis GENESIS API, run by .github/workflows/destatis-probe.yml.

Checks the login, searches the catalogue and prints the first lines of
candidate tables, so table codes and column names can be chosen from real
output. Writes nothing. Prints no credentials.

Usage: python pipeline/destatis_probe.py [search terms...] [--table CODE ...]
"""

from __future__ import annotations

import csv
import io
import json
import zipfile
import os
import sys
import urllib.parse
import urllib.request

API = "https://genesis.destatis.de/genesisWS/rest/2020/"


def call(method: str, **params) -> bytes:
    token = os.environ.get("DESTATIS_TOKEN", "")
    user = token or os.environ.get("DESTATIS_USER", "")
    password = "" if token else os.environ.get("DESTATIS_PASSWORD", "")
    params.setdefault("language", "de")
    req = urllib.request.Request(
        API + method,
        data=urllib.parse.urlencode(params).encode(),
        headers={"username": user, "password": password,
                 "Content-Type": "application/x-www-form-urlencoded",
                 "User-Agent": "germany-by-numbers data pipeline"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}: {e.read()[:600]!r}".encode()


def main(argv: list[str]) -> None:
    has = [k for k in ("DESTATIS_TOKEN", "DESTATIS_USER", "DESTATIS_PASSWORD") if os.environ.get(k)]
    print("credentials present:", has or "none")
    print("logincheck:", call("helloworld/logincheck")[:300].decode("utf-8", "replace"))

    tables = []
    if "--table" in argv:
        i = argv.index("--table")
        argv, tables = argv[:i], [t for t in argv[i + 1:] if t != "--table"]

    for term in argv:
        print(f"\n=== find tables: {term}")
        raw = call("find/find", term=term, category="tables", pagelength="40")
        try:
            doc = json.loads(raw)
            for t in doc.get("Tables") or []:
                print(f"  {t.get('Code')}  {t.get('Content', '').replace(chr(10), ' ')[:160]}  [{t.get('Time', '')}]")
            if not doc.get("Tables"):
                print("  ", str(doc.get("Status"))[:300])
        except ValueError:
            print("  ", raw[:400])

    for code in tables:
        print(f"\n=== tablefile {code} (ffcsv)")
        raw = call("data/tablefile", name=code, area="all", compress="false", format="ffcsv")
        if raw[:2] == b"PK":  # GENESIS answers with a zip even when compress=false
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                raw = z.read(z.namelist()[0])
        text = raw.decode("utf-8-sig", "replace")
        lines = text.splitlines()
        print(f"  {len(lines)} lines")
        for line in lines[:6]:
            print("  ", line[:400])
        rows = list(csv.reader(io.StringIO(text), delimiter=";"))
        if len(rows) > 1:
            head = rows[0]
            for i, col in enumerate(head):
                vals = sorted({r[i] for r in rows[1:] if i < len(r)})
                if 1 < len(vals) <= 80 or col.endswith("_label") or "label" in col:
                    print(f"  column {col}: {len(vals)} values: {vals[:80]}")

if __name__ == "__main__":
    main(sys.argv[1:])
