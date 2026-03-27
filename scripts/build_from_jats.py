#!/usr/bin/env python3
"""
Build articles.js from JATS XML files.

Usage:
  python scripts/build_from_jats.py                          # dry-run (prints summary)
  python scripts/build_from_jats.py --write                  # writes to articles.js
  python scripts/build_from_jats.py --xml-dir path/to/xmls   # custom XML directory
  python scripts/build_from_jats.py --merge                  # merge with existing articles.js
                                                              #   (preserves pmid, views, etc.)

The script scans all .xml files (recursively) under the XML directory,
parses JATS article metadata, and produces the window.ARTICLES array
used by the website.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
ARTICLES_JS = ROOT / "js" / "data" / "articles.js"
DEFAULT_XML_DIR = ROOT / "Balkan_Med_J_Jats-xml"

# ── helpers ──────────────────────────────────────────────────────────────────

def _text(el: Optional[ET.Element]) -> str:
    """Return the full inner text of an element (including children), stripped."""
    if el is None:
        return ""
    return "".join(el.itertext()).strip()


def _inner_xml(el: Optional[ET.Element]) -> str:
    """Return inner XML of an element as a string (for abstractHtml)."""
    if el is None:
        return ""
    # Serialize the element, then strip the outer tag
    raw = ET.tostring(el, encoding="unicode", method="xml")
    # Remove the outer wrapper tag
    raw = re.sub(r"^<[^>]+>", "", raw, count=1)
    raw = re.sub(r"</[^>]+>\s*$", "", raw, count=1)
    return raw.strip()


def _strip_tags(html: str) -> str:
    """Remove XML/HTML tags, collapse whitespace."""
    text = re.sub(r"<[^>]+>", "", html)
    return re.sub(r"\s+", " ", text).strip()


def _date_str(date_el: Optional[ET.Element]) -> str:
    """Convert a JATS <date> or <pub-date> element to YYYY-MM-DD."""
    if date_el is None:
        return ""
    year = _text(date_el.find("year"))
    month = _text(date_el.find("month"))
    day = _text(date_el.find("day"))
    if not year:
        return ""
    parts = [year]
    if month:
        parts.append(month.zfill(2))
        if day:
            parts.append(day.zfill(2))
        else:
            parts.append("01")
    else:
        parts.extend(["01", "01"])
    return "-".join(parts)


def _generate_id(doi: str, volume: int, fpage: str) -> int:
    """Generate a stable numeric ID from DOI (or volume+page as fallback)."""
    seed = doi if doi else f"v{volume}p{fpage}"
    # Use last 5 digits of md5 hash → range 10000–99999
    h = hashlib.md5(seed.encode()).hexdigest()
    return int(h[:8], 16) % 90000 + 10000


# ── JATS XML parser ─────────────────────────────────────────────────────────

def parse_jats(xml_path: Path) -> Optional[Dict[str, Any]]:
    """Parse a single JATS XML file and return an article dict."""
    try:
        tree = ET.parse(xml_path)
    except ET.ParseError as exc:
        print(f"  [WARN] XML parse error in {xml_path.name}: {exc}", file=sys.stderr)
        return None

    root = tree.getroot()

    # Namespace handling: strip namespaces for simpler queries
    for el in root.iter():
        if el.tag and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
        for attr_key in list(el.attrib):
            if "}" in attr_key:
                new_key = attr_key.split("}", 1)[1]
                el.attrib[new_key] = el.attrib.pop(attr_key)

    front = root.find(".//front")
    if front is None:
        print(f"  [WARN] No <front> in {xml_path.name}", file=sys.stderr)
        return None

    meta = front.find("article-meta")
    if meta is None:
        print(f"  [WARN] No <article-meta> in {xml_path.name}", file=sys.stderr)
        return None

    # ── DOI ──
    doi = ""
    for aid in meta.findall("article-id"):
        if aid.get("pub-id-type") == "doi":
            doi = (aid.text or "").strip()
            break

    # ── Article type / category ──
    article_type = ""
    subj = meta.find(".//subj-group[@subj-group-type='heading']/subject")
    if subj is not None:
        article_type = _text(subj)
    if not article_type:
        # Fallback: use article-type attribute from <article>
        at = root.get("article-type", "")
        type_map = {
            "research-article": "Original Article",
            "editorial": "Editorial",
            "review-article": "Invited Review",
            "brief-report": "Brief Report",
            "letter": "Scientific Letter",
            "case-report": "Case Report",
            "other": "Other",
        }
        article_type = type_map.get(at, at.replace("-", " ").title())

    # ── Title ──
    title = _text(meta.find(".//article-title"))

    # ── Authors & affiliations ──
    aff_map: Dict[str, str] = {}
    for aff_el in meta.findall(".//aff"):
        aff_id = aff_el.get("id", "")
        # Get text but strip the <label> prefix
        label_el = aff_el.find("label")
        label_text = _text(label_el) if label_el is not None else ""
        full_text = _text(aff_el)
        # Remove the label number from the start
        if label_text and full_text.startswith(label_text):
            full_text = full_text[len(label_text):].strip()
        aff_map[aff_id] = full_text

    authors: List[Dict[str, str]] = []
    for contrib in meta.findall(".//contrib"):
        if contrib.get("contrib-type") != "author":
            continue
        name_el = contrib.find("name")
        if name_el is None:
            continue
        surname = _text(name_el.find("surname"))
        given = _text(name_el.find("given-names"))
        full_name = f"{given} {surname}".strip()

        # ORCID
        orcid = ""
        orcid_el = contrib.find("contrib-id[@contrib-id-type='orcid']")
        if orcid_el is not None:
            orcid = (orcid_el.text or "").strip()

        # Affiliation(s)
        affiliations = []
        for xref in contrib.findall("xref"):
            if xref.get("ref-type") == "aff":
                rid = xref.get("rid", "")
                if rid in aff_map:
                    affiliations.append(aff_map[rid])
        affiliation = "; ".join(affiliations)

        authors.append({
            "name": full_name,
            "affiliation": affiliation,
            "orcid": orcid,
        })

    # ── Abstract ──
    abstract_text = ""
    abstract_html = ""
    abstract_el = meta.find("abstract")

    if abstract_el is not None:
        sections = abstract_el.findall("sec")
        if sections:
            # Structured abstract (Background, Aims, Methods, Results, Conclusion)
            text_parts = []
            html_parts = ['<div class="col-lg-12 col-md-12 col-sm-12 col-xs-12">',
                          "<h4>Abstract</h4>"]
            for sec in sections:
                sec_title = _text(sec.find("title"))
                sec_body = _text(sec.find("p"))
                if sec_title:
                    text_parts.append(f"{sec_title}: {sec_body}")
                    html_parts.append(f"<p><strong>{sec_title}:</strong> {sec_body}</p>")
                else:
                    text_parts.append(sec_body)
                    html_parts.append(f"<p>{sec_body}</p>")
            html_parts.append("</div>")
            abstract_text = " ".join(text_parts)
            abstract_html = "\n".join(html_parts)
        else:
            # Simple (non-structured) abstract
            paras = abstract_el.findall("p")
            if paras:
                abstract_text = " ".join(_text(p) for p in paras)
                html_inner = "".join(f"<p>{_text(p)}</p>" for p in paras)
            else:
                abstract_text = _text(abstract_el)
                html_inner = f"<p>{abstract_text}</p>"
            abstract_html = (
                '<div class="col-lg-12 col-md-12 col-sm-12 col-xs-12">'
                f"<h4>Abstract</h4>\n{html_inner}\n</div>"
            )

    # ── Keywords ──
    keywords: List[str] = []
    # Find English keyword group first, fallback to any
    kwd_group = None
    for kg in meta.findall("kwd-group"):
        lang = kg.get("lang") or kg.get("{http://www.w3.org/XML/1998/namespace}lang", "")
        if lang == "en":
            kwd_group = kg
            break
    if kwd_group is None:
        kwd_group = meta.find("kwd-group")
    if kwd_group is not None:
        keywords = [_text(k) for k in kwd_group.findall("kwd") if _text(k)]

    # ── Dates ──
    # Published date: prefer date-type="pub", fallback to "collection"
    published = ""
    for pd in meta.findall("pub-date"):
        if pd.get("date-type") == "pub":
            published = _date_str(pd)
            break
    if not published:
        for pd in meta.findall("pub-date"):
            if pd.get("date-type") == "collection":
                published = _date_str(pd)
                break

    received = ""
    accepted = ""
    history = meta.find("history")
    if history is not None:
        for d in history.findall("date"):
            if d.get("date-type") == "received":
                received = _date_str(d)
            elif d.get("date-type") == "accepted":
                accepted = _date_str(d)

    # ── Volume / Issue / Pages ──
    volume_text = _text(meta.find("volume"))
    volume = int(volume_text) if volume_text.isdigit() else 0
    issue = _text(meta.find("issue"))
    fpage = _text(meta.find("fpage"))
    lpage = _text(meta.find("lpage"))
    pages = f"{fpage}-{lpage}" if fpage and lpage else fpage

    # ── Body text for previewText (first ~350 chars) ──
    preview_text = abstract_text
    if not preview_text:
        body = root.find(".//body")
        if body is not None:
            full_body = _text(body)
            preview_text = full_body[:350]

    # ── Build article dict ──
    article_id = _generate_id(doi, volume, fpage)

    return {
        "id": article_id,
        "type": article_type,
        "title": title,
        "authors": authors,
        "abstract": abstract_text,
        "abstractHtml": abstract_html,
        "previewText": preview_text,
        "keywords": keywords,
        "doi": doi,
        "received": received,
        "accepted": accepted,
        "published": published,
        "volume": volume,
        "issue": issue,
        "pages": pages,
        "views": 0,
        "downloads": 0,
        "citations": 0,
        "featured": False,
        "imageCorner": False,
        "hasFullText": True,
        "sourceIssueId": "",
        "sourceArticleId": "",
        "sourceAbstractUrl": "",
        "sourceTextUrl": "",
        "sourcePdfUrl": "",
        "localPdfUrl": "",
        "pdfUrl": "",
        "pmid": "",
        # internal: xml source for logging
        "_xmlFile": xml_path.name,
    }


# ── Merge with existing articles.js ─────────────────────────────────────────

def parse_existing_articles(path: Path) -> List[Dict[str, Any]]:
    """Read the existing articles.js and return the list."""
    text = path.read_text(encoding="utf-8")
    body = re.sub(r"/\*[\s\S]*?\*/", "", text)
    body = re.sub(r"window\.ARTICLES\s*=\s*", "", body, count=1)
    body = body.rstrip().rstrip(";")
    return json.loads(body)


def merge_articles(
    jats_articles: List[Dict[str, Any]],
    existing: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Merge JATS-parsed articles with existing articles.js data.
    - Matches by DOI
    - Preserves: id, pmid, views, downloads, citations, featured, imageCorner,
                 sourceIssueId, sourceArticleId, source*Url, *PdfUrl
    - Updates: title, authors, abstract, dates, pages from JATS (authoritative source)
    - Keeps existing articles that have no matching JATS XML (older issues)
    """
    existing_by_doi: Dict[str, Dict[str, Any]] = {}
    for art in existing:
        if art.get("doi"):
            existing_by_doi[art["doi"]] = art

    merged: List[Dict[str, Any]] = []
    jats_dois: set = set()

    for jart in jats_articles:
        doi = jart["doi"]
        jats_dois.add(doi)

        if doi and doi in existing_by_doi:
            old = existing_by_doi[doi]
            # Preserve fields from existing
            preserve_fields = [
                "id", "pmid", "views", "downloads", "citations",
                "featured", "imageCorner",
                "sourceIssueId", "sourceArticleId",
                "sourceAbstractUrl", "sourceTextUrl", "sourcePdfUrl",
                "localPdfUrl", "pdfUrl",
            ]
            for f in preserve_fields:
                if f in old and old[f]:
                    jart[f] = old[f]
        merged.append(jart)

    # Keep existing articles not in JATS set
    for art in existing:
        doi = art.get("doi", "")
        if not doi or doi not in jats_dois:
            merged.append(art)

    return merged


# ── Output ───────────────────────────────────────────────────────────────────

def write_articles_js(path: Path, articles: List[Dict[str, Any]]) -> None:
    """Write articles to js/data/articles.js."""
    # Remove internal fields
    clean = []
    for art in articles:
        a = {k: v for k, v in art.items() if not k.startswith("_")}
        clean.append(a)

    # Sort: by volume desc, then by fpage asc
    def sort_key(a: dict) -> tuple:
        vol = a.get("volume", 0) if isinstance(a.get("volume"), int) else 0
        pages = a.get("pages", "")
        fpage = pages.split("-")[0] if pages else "9999"
        try:
            fpage_int = int(fpage)
        except ValueError:
            fpage_int = 9999
        return (-vol, -int(a.get("issue", "0") or "0"), fpage_int)

    clean.sort(key=sort_key)

    header = (
        "/**\n"
        " * Balkan Medical Journal — Articles Data\n"
        " * Source sync from JATS XML\n"
        f" * Build date: {time.strftime('%Y-%m-%d')}\n"
        " */\n"
    )
    body = json.dumps(clean, indent=2, ensure_ascii=False)
    path.write_text(header + "window.ARTICLES = " + body + ";\n", encoding="utf-8")


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Build articles.js from JATS XML files")
    parser.add_argument("--write", action="store_true", help="Write output to articles.js")
    parser.add_argument("--merge", action="store_true",
                        help="Merge with existing articles.js (preserves pmid, views, etc.)")
    parser.add_argument("--xml-dir", type=str, default=str(DEFAULT_XML_DIR),
                        help="Directory containing JATS XML files")
    args = parser.parse_args()

    xml_dir = Path(args.xml_dir)
    if not xml_dir.is_dir():
        print(f"ERROR: XML directory not found: {xml_dir}", file=sys.stderr)
        sys.exit(1)

    # Find all XML files
    xml_files = sorted(xml_dir.rglob("*.xml"))
    print(f"Found {len(xml_files)} XML files in {xml_dir}")

    # Parse each
    articles: List[Dict[str, Any]] = []
    errors = 0
    for xf in xml_files:
        art = parse_jats(xf)
        if art:
            articles.append(art)
        else:
            errors += 1

    print(f"Parsed: {len(articles)} articles ({errors} errors)")

    # Merge with existing if requested
    if args.merge and ARTICLES_JS.exists():
        existing = parse_existing_articles(ARTICLES_JS)
        print(f"Existing articles.js: {len(existing)} articles")
        articles = merge_articles(articles, existing)
        print(f"After merge: {len(articles)} articles")

    # Summary
    by_type: Dict[str, int] = {}
    by_vol: Dict[int, int] = {}
    for a in articles:
        t = a.get("type", "Unknown")
        by_type[t] = by_type.get(t, 0) + 1
        v = a.get("volume") or 0
        by_vol[v] = by_vol.get(v, 0) + 1

    print("\nBy type:")
    for t, c in sorted(by_type.items()):
        print(f"  {t}: {c}")

    print("\nBy volume:")
    for v, c in sorted(by_vol.items()):
        print(f"  Vol {v}: {c}")

    # Sample output
    if articles:
        print(f"\nSample article: {articles[0].get('title', '')[:80]}")
        print(f"  DOI: {articles[0].get('doi', '')}")
        print(f"  Authors: {len(articles[0].get('authors', []))}")
        print(f"  Abstract: {len(articles[0].get('abstract', ''))} chars")

    if args.write:
        write_articles_js(ARTICLES_JS, articles)
        print(f"\nWritten to {ARTICLES_JS}")
    else:
        print("\nDry run — use --write to save to articles.js")


if __name__ == "__main__":
    main()
