#!/usr/bin/env python3
"""
Sync Balkan Medical Journal archive and papers from the original source.

Outputs:
  - js/data/archive-issues.js
  - js/data/articles.js
  - js/data/volumes/vol*-*.json
  - js/data/articles/<id>.html
  - js/data/articles/<id>.js
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


BASE_URL = "https://balkanmedicaljournal.org/"
ARCHIVE_URL = urllib.parse.urljoin(BASE_URL, "archive.php")
ARTICLES_IN_PRESS_URL = urllib.parse.urljoin(BASE_URL, "content.php?id=46")
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"


class _TagStripper(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: List[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def get_text(self) -> str:
        return "".join(self.parts)


def strip_tags(value: str) -> str:
    parser = _TagStripper()
    parser.feed(value)
    parser.close()
    return parser.get_text()


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def html_to_text(value: str) -> str:
    return normalize_space(html.unescape(strip_tags(value)))


def fetch_url(url: str, timeout: float = 30.0, retries: int = 3, delay: float = 0.5) -> str:
    last_err: Optional[Exception] = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read()
            return body.decode("utf-8", errors="ignore")
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            if attempt < retries:
                time.sleep(delay * attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_err}")


def fetch_binary(url: str, timeout: float = 45.0, retries: int = 3, delay: float = 0.5) -> bytes:
    last_err: Optional[Exception] = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            if attempt < retries:
                time.sleep(delay * attempt)
    raise RuntimeError(f"Failed to fetch binary {url}: {last_err}")


def urljoin(path_or_url: str) -> str:
    return urllib.parse.urljoin(BASE_URL, path_or_url)


DIV_TOKEN_RE = re.compile(r"<div\b|</div>", re.IGNORECASE)


def extract_balanced_div(source: str, div_start_idx: int) -> Optional[str]:
    open_tag_end = source.find(">", div_start_idx)
    if open_tag_end == -1:
        return None
    depth = 1
    scan_idx = open_tag_end + 1
    while True:
        m = DIV_TOKEN_RE.search(source, scan_idx)
        if not m:
            return None
        token = m.group(0).lower()
        if token.startswith("</"):
            depth -= 1
            if depth == 0:
                return source[div_start_idx : m.end()]
        else:
            depth += 1
        scan_idx = m.end()


def inner_div_html(div_html: str) -> str:
    start = div_html.find(">")
    end = div_html.lower().rfind("</div>")
    if start == -1 or end == -1 or end <= start:
        return ""
    return div_html[start + 1 : end]


def extract_div_blocks_with_class(source: str, class_token: str) -> List[str]:
    blocks: List[str] = []
    token_re = re.compile(
        r"<div\b[^>]*class\s*=\s*([\"'])(?:(?!(?:\1)).)*\b"
        + re.escape(class_token)
        + r"\b(?:(?!(?:\1)).)*\1[^>]*>",
        re.IGNORECASE | re.DOTALL,
    )
    for m in token_re.finditer(source):
        block = extract_balanced_div(source, m.start())
        if block:
            blocks.append(block)
    return blocks


def parse_meta(content: str, meta_name: str) -> str:
    pat = re.compile(
        r"<meta[^>]+name\s*=\s*['\"]"
        + re.escape(meta_name)
        + r"['\"][^>]*content\s*=\s*['\"]([^'\"]*)['\"]",
        re.IGNORECASE,
    )
    m = pat.search(content)
    return html.unescape(m.group(1).strip()) if m else ""


@dataclass
class ArchiveIssueRef:
    year_label: str
    issue_label: str
    source_id: str
    source_href: str
    source_url: str


@dataclass
class IssuePaper:
    article_id: int
    type_label: str
    title: str
    authors_text: str
    doi: str
    pages: str
    abstract_url: str
    text_url: str
    pdf_url: str
    issue_source_id: str
    year: Optional[int]
    volume: Optional[int]
    issue: str
    order: int


def parse_archive_page(archive_html: str) -> List[ArchiveIssueRef]:
    refs: List[ArchiveIssueRef] = []
    panel_re = re.compile(
        r"<div class=\"panel-heading\">\s*([^<]+?)\s*</div>\s*<div class=\"panel-body\">\s*<ul class=\"list-group\">\s*(.*?)\s*</ul>",
        re.IGNORECASE | re.DOTALL,
    )
    item_re = re.compile(r"<a[^>]*href='([^']+)'[^>]*>([^<]+)</a>", re.IGNORECASE | re.DOTALL)
    for pm in panel_re.finditer(archive_html):
        year_label = normalize_space(html.unescape(pm.group(1)))
        body = pm.group(2)
        for im in item_re.finditer(body):
            href = html.unescape(im.group(1).strip())
            issue_label = normalize_space(html.unescape(im.group(2)))
            sid = re.search(r"id=(\d+)", href)
            if not sid:
                continue
            source_id = sid.group(1)
            refs.append(
                ArchiveIssueRef(
                    year_label=year_label,
                    issue_label=issue_label,
                    source_id=source_id,
                    source_href=href,
                    source_url=urljoin(href),
                )
            )
    return refs


def parse_issue_context(issue_html: str) -> Tuple[Optional[int], Optional[int], str]:
    m = re.search(
        r"(\d{4})\s*,\s*Volume\s*([0-9]+)\s*,\s*Issue\s*([^<\n\r]+)",
        issue_html,
        re.IGNORECASE,
    )
    if not m:
        return None, None, ""
    year = int(m.group(1))
    volume = int(m.group(2))
    issue = normalize_space(html.unescape(m.group(3)))
    return year, volume, issue


def parse_issue_page(issue_html: str, issue_source_id: str) -> List[IssuePaper]:
    year, volume, issue_token = parse_issue_context(issue_html)

    papers: List[IssuePaper] = []
    forms = re.findall(
        r"<form[^>]*action=\"selected_abstracts\.php\?id=\d+\"[^>]*>(.*?)</form>",
        issue_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    order = 0
    for form_body in forms:
        type_blocks = extract_div_blocks_with_class(form_body, "makale-tur-baslik-alani")
        type_label = html_to_text(inner_div_html(type_blocks[0])) if type_blocks else "Article"
        if not type_label:
            type_label = "Article"

        for bm in re.finditer(
            r"<div class=\"makale-basligi\">(.*?)(?:<hr>|</form>)",
            form_body,
            flags=re.IGNORECASE | re.DOTALL,
        ):
            order += 1
            block = bm.group(1)
            id_match = re.search(r"ARTICLE\[(\d+)\]", block)
            if not id_match:
                continue
            article_id = int(id_match.group(1))

            title_match = re.search(
                r"<a[^>]*href=\"([^\"]*)\"[^>]*class=\"article_title\"[^>]*>\s*(.*?)\s*</a>",
                block,
                flags=re.IGNORECASE | re.DOTALL,
            )
            if title_match:
                title_href = html.unescape(title_match.group(1).strip())
                title = normalize_space(html.unescape(strip_tags(title_match.group(2))))
            else:
                title_href = ""
                title = ""

            if not title:
                continue

            pages_match = re.search(r"<b>Pages</b></i>\s*:\s*([^<]+)", block, flags=re.IGNORECASE)
            pages = normalize_space(html.unescape(pages_match.group(1))) if pages_match else ""

            doi_match = re.search(r"<b>DOI</b></i>\s*:\s*([^<]+)", block, flags=re.IGNORECASE)
            doi = normalize_space(html.unescape(doi_match.group(1))) if doi_match else ""

            auth_match = re.search(
                r"<span class=\"article_authors\">\s*(.*?)\s*</span>",
                block,
                flags=re.IGNORECASE | re.DOTALL,
            )
            authors_text = normalize_space(html.unescape(strip_tags(auth_match.group(1)))) if auth_match else ""

            links = [
                html.unescape(h.strip())
                for h in re.findall(r"href=\"([^\"]+)\"", block, flags=re.IGNORECASE)
            ]
            abstract_url = ""
            text_url = ""
            pdf_url = ""
            for link in links:
                low = link.lower()
                if not abstract_url and "abstract.php" in low:
                    abstract_url = urljoin(link)
                if not text_url and "text.php" in low:
                    text_url = urljoin(link)
                if not pdf_url and "pdf.php" in low:
                    pdf_url = urljoin(link)

            if not abstract_url and title_href and "abstract.php" in title_href.lower():
                abstract_url = urljoin(title_href)

            papers.append(
                IssuePaper(
                    article_id=article_id,
                    type_label=type_label,
                    title=title,
                    authors_text=authors_text,
                    doi=doi,
                    pages=pages,
                    abstract_url=abstract_url,
                    text_url=text_url,
                    pdf_url=pdf_url,
                    issue_source_id=issue_source_id,
                    year=year,
                    volume=volume,
                    issue=issue_token,
                    order=order,
                )
            )
    return papers


def pick_content_block(html_doc: str) -> str:
    blocks = extract_div_blocks_with_class(html_doc, "makale-ozet")
    best_html = ""
    best_score = -1
    for block in blocks:
        inner = inner_div_html(block)
        text = html_to_text(inner)
        if not text:
            continue
        if "Full Text PDF" in text and "How to Cite" in text:
            continue
        score = len(text)
        if "Viewed" in text and "Downloaded" in text:
            score -= 500
        if score > best_score:
            best_score = score
            best_html = inner.strip()
    return best_html


def parse_viewed_downloaded(html_doc: str) -> Tuple[int, int]:
    viewed = 0
    downloaded = 0
    vm = re.search(r"<strong>\s*Viewed\s*</strong>\s*:\s*([0-9,]+)", html_doc, flags=re.IGNORECASE)
    dm = re.search(r"<strong>\s*Downloaded\s*</strong>\s*:\s*([0-9,]+)", html_doc, flags=re.IGNORECASE)
    if vm:
        viewed = int(vm.group(1).replace(",", ""))
    if dm:
        downloaded = int(dm.group(1).replace(",", ""))
    return viewed, downloaded


def parse_authors(authors_text: str) -> List[Dict[str, str]]:
    if not authors_text:
        return []
    parts = [normalize_space(p) for p in authors_text.split(",")]
    names = [p for p in parts if p]
    return [{"name": n, "affiliation": "", "orcid": ""} for n in names]


def parse_authors_from_abstract(abstract_html: str, fallback_authors_text: str) -> List[Dict[str, str]]:
    fallback = parse_authors(fallback_authors_text)
    if not abstract_html:
        return fallback

    author_blocks = extract_div_blocks_with_class(abstract_html, "makale-hakem")
    if not author_blocks:
        return fallback

    author_inner = inner_div_html(author_blocks[0])
    if not author_inner:
        return fallback

    # Keep author-affiliation indices before tag stripping.
    author_marked = re.sub(r"<sup[^>]*>\s*([^<]+)\s*</sup>", r"[[\1]]", author_inner, flags=re.IGNORECASE)
    author_text = normalize_space(html.unescape(strip_tags(author_marked)))
    author_text = normalize_space(author_text.replace("<", " ").replace(">", " "))
    if not author_text:
        return fallback

    def split_author_entries(value: str) -> List[str]:
        entries: List[str] = []
        buf: List[str] = []
        marker_depth = 0
        i = 0
        while i < len(value):
            two = value[i : i + 2]
            if two == "[[":
                marker_depth += 1
                buf.append(two)
                i += 2
                continue
            if two == "]]" and marker_depth > 0:
                marker_depth -= 1
                buf.append(two)
                i += 2
                continue
            ch = value[i]
            if ch == "," and marker_depth == 0:
                entry = normalize_space("".join(buf))
                if entry:
                    entries.append(entry)
                buf = []
            else:
                buf.append(ch)
            i += 1
        tail = normalize_space("".join(buf))
        if tail:
            entries.append(tail)
        return entries

    parsed_authors: List[Tuple[str, List[str]]] = []
    for part in split_author_entries(author_text):
        m = re.match(r"^(.*?)\s*\[\[([^\]]+)\]\]\s*(?:<)?\s*$", part)
        if m:
            name = normalize_space(m.group(1))
            indices = [
                normalize_space(tok).strip("*")
                for tok in re.split(r"[,/;&]+", m.group(2))
                if normalize_space(tok)
            ]
        else:
            name = normalize_space(re.sub(r"\[\[[^\]]+\]\]", "", part).replace("<", " ").replace(">", " "))
            indices = []
        if name:
            parsed_authors.append((name, indices))

    if not parsed_authors:
        return fallback

    affiliation_map: Dict[str, str] = {}
    default_affiliation = ""
    aff_blocks = extract_div_blocks_with_class(abstract_html, "makale-kurum")
    if aff_blocks:
        aff_inner = inner_div_html(aff_blocks[0])
        aff_inner = re.sub(r"(?i)<br\s*/?>", "\n", aff_inner)
        aff_marked = re.sub(r"<sup[^>]*>\s*([^<]+)\s*</sup>", r"@@\1@@", aff_inner, flags=re.IGNORECASE)
        aff_text = html.unescape(strip_tags(aff_marked))
        aff_text = aff_text.replace("\r", "")
        aff_text = re.sub(r"[ \t]+", " ", aff_text)
        aff_text = re.sub(r"\n+", "\n", aff_text).strip()

        if "@@" in aff_text:
            for idx, body in re.findall(r"@@([^@]+)@@\s*([^@]+?)(?=(?:@@[^@]+@@)|$)", aff_text, flags=re.DOTALL):
                key = normalize_space(idx).strip("*")
                value = normalize_space(re.sub(r"</?[a-zA-Z0-9_-]*$", "", body))
                if key and value:
                    affiliation_map[key] = value
        else:
            default_affiliation = normalize_space(re.sub(r"</?[a-zA-Z0-9_-]*$", "", aff_text))

    out: List[Dict[str, str]] = []
    for name, indices in parsed_authors:
        selected = []
        for idx in indices:
            if idx in affiliation_map:
                selected.append(affiliation_map[idx])
        # De-duplicate while preserving order.
        dedup_selected = list(dict.fromkeys([s for s in selected if s]))
        affiliation = "; ".join(dedup_selected) if dedup_selected else default_affiliation
        out.append({"name": name, "affiliation": affiliation, "orcid": ""})

    return out if out else fallback


def safe_json_js(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, indent=2)


def issue_label_to_volume_issue(issue_label: str) -> Tuple[Optional[int], Optional[str]]:
    vmatch = re.search(r"Volume\s+([0-9]+)", issue_label, flags=re.IGNORECASE)
    volume = int(vmatch.group(1)) if vmatch else None
    imatch = re.search(r"Issue\s+(.+)$", issue_label, flags=re.IGNORECASE)
    issue_token = normalize_space(imatch.group(1)) if imatch else None
    return volume, issue_token


def load_articles_index_from_js(articles_index_file: Path) -> List[Dict[str, object]]:
    if not articles_index_file.exists():
        return []
    content = articles_index_file.read_text(encoding="utf-8")
    m = re.search(r"window\.ARTICLES\s*=\s*(\[.*\]);\s*$", content, flags=re.DOTALL)
    if not m:
        return []
    try:
        parsed = json.loads(m.group(1))
    except Exception:  # noqa: BLE001
        return []
    if isinstance(parsed, list):
        return parsed
    return []


def write_articles_in_press_snapshot(
    repo_root: Path,
    workers: int = 8,
    articles_index: Optional[List[Dict[str, object]]] = None,
) -> int:
    data_dir = repo_root / "js" / "data"
    aip_file = data_dir / "articles-in-press.js"
    articles_index_file = data_dir / "articles.js"
    article_payload_dir = data_dir / "articles"
    article_payload_dir.mkdir(parents=True, exist_ok=True)

    if articles_index is None:
        articles_index = load_articles_index_from_js(articles_index_file)

    local_article_ids = {int(a.get("id")) for a in articles_index if a.get("id") is not None}

    print("Fetching Articles in Press page...")
    aip_html = fetch_url(ARTICLES_IN_PRESS_URL)
    aip_papers = parse_issue_page(aip_html, "46")

    ordered_papers: List[IssuePaper] = []
    seen_ids: set[int] = set()
    for p in aip_papers:
        if p.article_id in seen_ids:
            continue
        seen_ids.add(p.article_id)
        ordered_papers.append(p)

    abstract_cache: Dict[int, str] = {}
    text_cache: Dict[int, str] = {}
    abstract_jobs = [(p.article_id, p.abstract_url) for p in ordered_papers if p.abstract_url]
    text_jobs = [(p.article_id, p.text_url) for p in ordered_papers if p.text_url]

    if abstract_jobs:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
            futures = {ex.submit(fetch_url, url): aid for aid, url in abstract_jobs}
            for fut in concurrent.futures.as_completed(futures):
                aid = futures[fut]
                try:
                    abstract_cache[aid] = fut.result()
                except Exception:  # noqa: BLE001
                    abstract_cache[aid] = ""

    if text_jobs:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
            futures = {ex.submit(fetch_url, url): aid for aid, url in text_jobs}
            for fut in concurrent.futures.as_completed(futures):
                aid = futures[fut]
                try:
                    text_cache[aid] = fut.result()
                except Exception:  # noqa: BLE001
                    text_cache[aid] = ""

    aip_entries: List[Dict[str, object]] = []
    fulltext_payloads: Dict[int, str] = {}
    for order, p in enumerate(ordered_papers):
        abs_html = abstract_cache.get(p.article_id, "")
        txt_html = text_cache.get(p.article_id, "")
        abstract_html = pick_content_block(abs_html) if abs_html else ""
        abstract_text = html_to_text(abstract_html)
        full_text_html = pick_content_block(txt_html) if txt_html else ""
        full_text_plain = html_to_text(full_text_html)
        has_full_text_body = bool(full_text_plain and len(full_text_plain) > 80)
        source_text_url = p.text_url or urljoin(f"text.php?lang=en&id={p.article_id}")
        has_full_text = has_full_text_body
        fulltext_payloads[p.article_id] = full_text_html if has_full_text_body else ""
        c_title = parse_meta(abs_html, "citation_title") if abs_html else ""
        c_doi = parse_meta(abs_html, "citation_doi") if abs_html else ""
        c_volume = parse_meta(abs_html, "citation_volume") if abs_html else ""
        c_issue = parse_meta(abs_html, "citation_issue") if abs_html else ""
        c_pub_date = parse_meta(abs_html, "citation_publication_date") if abs_html else ""
        viewed, downloaded = parse_viewed_downloaded(abs_html or txt_html)
        local_exists = p.article_id in local_article_ids
        source_abstract_url = p.abstract_url or urljoin(f"abstract.php?id={p.article_id}")
        volume_val: Optional[int] = p.volume
        if c_volume and c_volume.isdigit():
            volume_val = int(c_volume)
        issue_val = c_issue or p.issue or ""

        aip_entries.append(
            {
                "id": p.article_id,
                "order": order,
                "type": p.type_label,
                "title": c_title or p.title,
                "authors": parse_authors_from_abstract(abs_html, p.authors_text),
                "abstract": abstract_text,
                "abstractHtml": abstract_html,
                "previewText": abstract_text[:360] if abstract_text else "",
                "doi": c_doi or p.doi,
                "published": c_pub_date,
                "volume": volume_val,
                "issue": issue_val,
                "pages": p.pages,
                "views": viewed,
                "downloads": downloaded,
                "hasFullText": has_full_text,
                "sourceAbstractUrl": source_abstract_url,
                "sourceTextUrl": source_text_url,
                "sourcePdfUrl": p.pdf_url,
                "localArticleAvailable": local_exists,
                "localArticleUrl": f"article.html?id={p.article_id}&source=aip" if local_exists else "",
                "aheadOfPrint": True,
            }
        )

    for aid, payload_html in fulltext_payloads.items():
        html_path = article_payload_dir / f"{aid}.html"
        js_path = article_payload_dir / f"{aid}.js"
        html_path.write_text(payload_html, encoding="utf-8")
        js_content = (
            "window._articleFullText = window._articleFullText || {};\n"
            f"window._articleFullText[{aid}] = {json.dumps(payload_html, ensure_ascii=False)};\n"
        )
        js_path.write_text(js_content, encoding="utf-8")

    header = (
        "/**\n"
        " * Balkan Medical Journal — Articles in Press Data\n"
        " * Source sync from https://balkanmedicaljournal.org/content.php?id=46\n"
        f" * Snapshot date: {dt.date.today().isoformat()}\n"
        " */\n"
    )
    js = header + "window.ARTICLES_IN_PRESS = " + safe_json_js(aip_entries) + ";\n"
    aip_file.write_text(js, encoding="utf-8")
    print(f"Writing {aip_file} ({len(aip_entries)} items)...")
    non_empty_payloads = sum(1 for payload in fulltext_payloads.values() if payload.strip())
    print(
        f"Writing AIP full-text payloads ({len(fulltext_payloads)} items, "
        f"{non_empty_payloads} with full-text body)..."
    )
    return len(aip_entries)


def sync(repo_root: Path, workers: int = 8, mirror_pdfs: bool = False) -> None:
    data_dir = repo_root / "js" / "data"
    archive_file = data_dir / "archive-issues.js"
    articles_index_file = data_dir / "articles.js"
    volumes_dir = data_dir / "volumes"
    article_payload_dir = data_dir / "articles"
    pdf_dir = data_dir / "pdfs"
    scripts_dir = repo_root / "scripts"

    scripts_dir.mkdir(parents=True, exist_ok=True)
    volumes_dir.mkdir(parents=True, exist_ok=True)
    article_payload_dir.mkdir(parents=True, exist_ok=True)
    pdf_dir.mkdir(parents=True, exist_ok=True)

    print("Fetching archive page...")
    archive_html = fetch_url(ARCHIVE_URL)
    issue_refs = parse_archive_page(archive_html)
    print(f"Archive issues discovered: {len(issue_refs)}")

    issue_html_by_id: Dict[str, str] = {}
    print("Fetching all issue pages...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(fetch_url, ref.source_url): ref for ref in issue_refs}
        for fut in concurrent.futures.as_completed(futures):
            ref = futures[fut]
            issue_html_by_id[ref.source_id] = fut.result()

    issue_papers_map: Dict[str, List[IssuePaper]] = {}
    all_papers_in_order: List[IssuePaper] = []
    for ref in issue_refs:
        papers = parse_issue_page(issue_html_by_id[ref.source_id], ref.source_id)
        issue_papers_map[ref.source_id] = papers
        all_papers_in_order.extend(papers)

    print(f"Issue paper entries parsed: {len(all_papers_in_order)}")

    # Keep first occurrence by ID (latest issue order from archive order)
    unique: Dict[int, IssuePaper] = {}
    for p in all_papers_in_order:
        if p.article_id not in unique:
            unique[p.article_id] = p
    unique_papers = list(unique.values())
    print(f"Unique papers: {len(unique_papers)}")

    # Fetch abstract/text pages.
    abstract_cache: Dict[int, str] = {}
    text_cache: Dict[int, str] = {}

    abstract_jobs = [(p.article_id, p.abstract_url) for p in unique_papers if p.abstract_url]
    text_jobs = [(p.article_id, p.text_url) for p in unique_papers if p.text_url]

    print(f"Fetching abstract pages: {len(abstract_jobs)}")
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(fetch_url, url): aid for aid, url in abstract_jobs}
        for fut in concurrent.futures.as_completed(futures):
            aid = futures[fut]
            abstract_cache[aid] = fut.result()

    print(f"Fetching full-text pages: {len(text_jobs)}")
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(fetch_url, url): aid for aid, url in text_jobs}
        for fut in concurrent.futures.as_completed(futures):
            aid = futures[fut]
            text_cache[aid] = fut.result()

    # Build article index.
    articles: List[Dict[str, object]] = []
    fulltext_payloads: Dict[int, str] = {}
    for p in unique_papers:
        abs_html = abstract_cache.get(p.article_id, "")
        txt_html = text_cache.get(p.article_id, "")

        abstract_html = pick_content_block(abs_html) if abs_html else ""
        abstract_text = html_to_text(abstract_html)

        full_text_html = pick_content_block(txt_html) if txt_html else ""
        full_text_plain = html_to_text(full_text_html)
        has_full_text = bool(full_text_plain and len(full_text_plain) > 80)

        if has_full_text:
            fulltext_payloads[p.article_id] = full_text_html

        c_title = parse_meta(abs_html, "citation_title") if abs_html else ""
        c_volume = parse_meta(abs_html, "citation_volume") if abs_html else ""
        c_issue = parse_meta(abs_html, "citation_issue") if abs_html else ""
        c_doi = parse_meta(abs_html, "citation_doi") if abs_html else ""

        volume_val = p.volume
        if c_volume and c_volume.isdigit():
            volume_val = int(c_volume)

        issue_val = p.issue or ""
        if c_issue:
            issue_val = c_issue

        viewed, downloaded = parse_viewed_downloaded(abs_html or txt_html)

        preview = abstract_text or full_text_plain[:360]

        # For years where only year is available from source issue page.
        published = ""
        if p.year:
            published = f"{p.year}-01-01"

        article = {
            "id": p.article_id,
            "type": p.type_label,
            "title": c_title or p.title,
            "authors": parse_authors_from_abstract(abs_html, p.authors_text),
            "abstract": abstract_text,
            "abstractHtml": abstract_html,
            "previewText": preview,
            "keywords": [],
            "doi": c_doi or p.doi,
            "received": "",
            "accepted": "",
            "published": published,
            "volume": volume_val,
            "issue": issue_val,
            "pages": p.pages,
            "views": viewed,
            "downloads": downloaded,
            "citations": 0,
            "featured": False,
            "imageCorner": p.type_label.lower() == "clinical image",
            "hasFullText": has_full_text,
            "sourceIssueId": p.issue_source_id,
            "sourceArticleId": str(p.article_id),
            "sourceAbstractUrl": p.abstract_url,
            "sourceTextUrl": p.text_url,
            "sourcePdfUrl": p.pdf_url,
            "localPdfUrl": "",
            "pdfUrl": p.pdf_url,
        }
        articles.append(article)

    # Preserve archive-first paper order.
    articles.sort(
        key=lambda a: (
            int(next((i for i, p in enumerate(all_papers_in_order) if p.article_id == a["id"]), 10_000_000)),
        )
    )

    # Resolve local PDF URLs if mirrored files already exist.
    for a in articles:
        local_pdf_rel = f"js/data/pdfs/{a['id']}.pdf"
        local_pdf_path = repo_root / local_pdf_rel
        if local_pdf_path.exists() and local_pdf_path.stat().st_size > 0:
            a["localPdfUrl"] = local_pdf_rel
            a["pdfUrl"] = local_pdf_rel

    if mirror_pdfs:
        print("Mirroring PDF files...")

        def _download_pdf(article: Dict[str, object]) -> Tuple[int, bool, str]:
            aid = int(article["id"])
            src = str(article.get("sourcePdfUrl") or "")
            if not src:
                return aid, False, "no_source_pdf"

            out_path = pdf_dir / f"{aid}.pdf"
            if out_path.exists() and out_path.stat().st_size > 0:
                return aid, True, "cached"

            try:
                payload = fetch_binary(src)
            except Exception as exc:  # noqa: BLE001
                return aid, False, f"fetch_error:{exc}"

            if len(payload) < 256 or b"%PDF" not in payload[:1024]:
                return aid, False, "invalid_pdf_payload"

            out_path.write_bytes(payload)
            return aid, True, "downloaded"

        ok = 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
            futures = [ex.submit(_download_pdf, a) for a in articles]
            for fut in concurrent.futures.as_completed(futures):
                aid, success, _status = fut.result()
                if success:
                    ok += 1
                    local_pdf_rel = f"js/data/pdfs/{aid}.pdf"
                    for a in articles:
                        if int(a["id"]) == aid:
                            a["localPdfUrl"] = local_pdf_rel
                            a["pdfUrl"] = local_pdf_rel
                            break
        print(f"PDFs mirrored: {ok}")

    # Write articles.js
    print(f"Writing {articles_index_file} ({len(articles)} papers)...")
    articles_header = (
        "/**\n"
        " * Balkan Medical Journal — Articles Data\n"
        " * Source sync from https://balkanmedicaljournal.org\n"
        f" * Snapshot date: {dt.date.today().isoformat()}\n"
        " */\n"
    )
    articles_js = articles_header + "window.ARTICLES = " + safe_json_js(articles) + ";\n"
    articles_index_file.write_text(articles_js, encoding="utf-8")

    # Rewrite volume files from grouped articles.
    for vol_file in volumes_dir.glob("vol*.json"):
        vol_file.unlink()
    grouped: Dict[Tuple[str, str], List[Dict[str, object]]] = {}
    for a in articles:
        vol = a.get("volume")
        issue = a.get("issue")
        if vol in (None, "") or issue in (None, ""):
            continue
        key = (str(vol), str(issue))
        grouped.setdefault(key, []).append(a)
    for (vol, issue), arr in grouped.items():
        out_name = f"vol{vol}-{issue}.json"
        (volumes_dir / out_name).write_text(json.dumps(arr, ensure_ascii=False, indent=2), encoding="utf-8")

    # Rewrite per-article full text payload files.
    for f in article_payload_dir.glob("*.js"):
        if f.name[:-3].isdigit():
            f.unlink()
    for f in article_payload_dir.glob("*.html"):
        if f.name[:-5].isdigit():
            f.unlink()

    for aid, payload_html in fulltext_payloads.items():
        html_path = article_payload_dir / f"{aid}.html"
        js_path = article_payload_dir / f"{aid}.js"
        html_path.write_text(payload_html, encoding="utf-8")
        js_content = (
            "window._articleFullText = window._articleFullText || {};\n"
            f"window._articleFullText[{aid}] = {json.dumps(payload_html, ensure_ascii=False)};\n"
        )
        js_path.write_text(js_content, encoding="utf-8")

    # Rebuild archive issues with true local counts.
    issue_count_map: Dict[str, int] = {sid: len(issue_papers_map.get(sid, [])) for sid in issue_papers_map}
    archive_entries: List[Dict[str, object]] = []
    for ref in issue_refs:
        volume_guess, issue_guess = issue_label_to_volume_issue(ref.issue_label)
        papers = issue_papers_map.get(ref.source_id, [])
        issue_context_year, issue_context_volume, issue_context_issue = parse_issue_context(issue_html_by_id[ref.source_id])

        volume_val = issue_context_volume if issue_context_volume is not None else volume_guess
        issue_val = issue_context_issue if issue_context_issue else issue_guess

        if not archive_entries or archive_entries[-1]["year"] != ref.year_label:
            archive_entries.append({"year": ref.year_label, "volume": volume_val, "issues": []})

        archive_entries[-1]["issues"].append(
            {
                "label": ref.issue_label,
                "sourceId": ref.source_id,
                "sourceUrl": ref.source_url,
                "volume": volume_val,
                "issue": issue_val,
                "articleCount": issue_count_map.get(ref.source_id, 0),
                "hasLocalData": bool(papers),
            }
        )

    print(f"Writing {archive_file} ({len(archive_entries)} year groups)...")
    archive_header = (
        "/**\n"
        " * Balkan Medical Journal — Archive Issues Data\n"
        " * Source sync from https://balkanmedicaljournal.org/archive.php\n"
        f" * Snapshot date: {dt.date.today().isoformat()}\n"
        " */\n"
    )
    archive_js = archive_header + "window.ARCHIVE_ISSUES = " + safe_json_js(archive_entries) + ";\n"
    archive_file.write_text(archive_js, encoding="utf-8")

    aip_count = write_articles_in_press_snapshot(repo_root=repo_root, workers=workers, articles_index=articles)

    print("Done.")
    print(f"Full-text payloads written: {len(fulltext_payloads)}")
    print(f"Volume files written: {len(grouped)}")
    print(f"Articles in Press entries written: {aip_count}")


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Sync BMJ archive + papers from source website.")
    parser.add_argument("--repo", default=".", help="Repository root path")
    parser.add_argument("--workers", type=int, default=8, help="Network worker count")
    parser.add_argument("--mirror-pdfs", action="store_true", help="Download and mirror paper PDFs locally")
    parser.add_argument("--aip-only", action="store_true", help="Sync only Articles in Press data snapshot")
    args = parser.parse_args(list(argv) if argv is not None else None)

    repo_root = Path(args.repo).resolve()
    try:
        if args.aip_only:
            write_articles_in_press_snapshot(repo_root=repo_root, workers=max(1, args.workers))
        else:
            sync(repo_root=repo_root, workers=max(1, args.workers), mirror_pdfs=args.mirror_pdfs)
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
