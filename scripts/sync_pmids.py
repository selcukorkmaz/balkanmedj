#!/usr/bin/env python3
"""
Fetch PubMed IDs (PMIDs) for articles in articles.js using NCBI E-utilities.

Usage:
  python scripts/sync_pmids.py                  # dry-run (prints matches)
  python scripts/sync_pmids.py --write          # updates js/data/articles.js
  python scripts/sync_pmids.py --email you@ex   # recommended by NCBI

NCBI asks that you provide an email for E-utilities usage.
Rate limit: 3 requests/second (without API key).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ARTICLES_JS = Path(__file__).resolve().parent.parent / "js" / "data" / "articles.js"

ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
RATE_LIMIT = 0.34  # ~3 requests/second


def parse_articles_js(path: Path) -> list[dict]:
    """Read window.ARTICLES = [...] and return the list."""
    text = path.read_text(encoding="utf-8")
    # Strip leading comment block and assignment
    body = re.sub(r"/\*[\s\S]*?\*/", "", text)
    body = re.sub(r"window\.ARTICLES\s*=\s*", "", body, count=1)
    body = body.rstrip().rstrip(";")
    return json.loads(body)


def lookup_pmid(doi: str, email: str | None = None) -> str | None:
    """Query NCBI esearch for a PMID given a DOI."""
    params = {
        "db": "pubmed",
        "retmode": "json",
        "term": f"{doi}[doi]",
    }
    if email:
        params["email"] = email

    url = f"{ESEARCH_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "BalkanMedJ-PMID-Sync/1.0"})

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        id_list = data.get("esearchresult", {}).get("idlist", [])
        if id_list:
            return id_list[0]
    except Exception as exc:
        print(f"  [ERROR] {doi}: {exc}", file=sys.stderr)
    return None


def write_articles_js(path: Path, articles: list[dict]) -> None:
    """Write articles back to js/data/articles.js."""
    header = (
        "/**\n"
        " * Balkan Medical Journal — Articles Data\n"
        " * Source sync from https://balkanmedicaljournal.org\n"
        f" * PMID sync date: {time.strftime('%Y-%m-%d')}\n"
        " */\n"
    )
    body = json.dumps(articles, indent=2, ensure_ascii=False)
    path.write_text(header + "window.ARTICLES = " + body + ";\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync PMIDs from NCBI for articles.js")
    parser.add_argument("--write", action="store_true", help="Write results back to articles.js")
    parser.add_argument("--email", type=str, default=None, help="Email for NCBI E-utilities (recommended)")
    args = parser.parse_args()

    articles = parse_articles_js(ARTICLES_JS)

    # Collect articles that have a DOI but no PMID yet
    to_lookup = [(i, a) for i, a in enumerate(articles) if a.get("doi") and not a.get("pmid")]
    already = sum(1 for a in articles if a.get("pmid"))

    print(f"Total articles: {len(articles)}")
    print(f"Already have PMID: {already}")
    print(f"Have DOI, need PMID lookup: {len(to_lookup)}")
    print()

    if not to_lookup:
        print("Nothing to do.")
        return

    found = 0
    not_found = 0

    for idx, (i, article) in enumerate(to_lookup, 1):
        doi = article["doi"]
        pmid = lookup_pmid(doi, email=args.email)

        if pmid:
            articles[i]["pmid"] = pmid
            found += 1
            print(f"  [{idx}/{len(to_lookup)}] {doi} -> PMID {pmid}")
        else:
            not_found += 1
            if idx <= 20 or idx % 100 == 0:
                print(f"  [{idx}/{len(to_lookup)}] {doi} -> not found")

        time.sleep(RATE_LIMIT)

    print()
    print(f"Found: {found}")
    print(f"Not found: {not_found}")

    if args.write and found > 0:
        write_articles_js(ARTICLES_JS, articles)
        print(f"\nUpdated {ARTICLES_JS}")
    elif found > 0:
        print("\nDry run — use --write to save results to articles.js")


if __name__ == "__main__":
    main()
