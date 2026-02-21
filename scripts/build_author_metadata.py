#!/usr/bin/env python3
"""Build precomputed author metadata from local article PDFs.

Output: js/data/author-metadata.js
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
ARTICLES_JS = ROOT / "js/data/articles.js"
OUTPUT_JS = ROOT / "js/data/author-metadata.js"


def parse_articles() -> list[dict]:
    text = ARTICLES_JS.read_text(encoding="utf-8")
    start = text.find("[")
    end = text.rfind("]")
    if start < 0 or end < 0:
        return []
    return json.loads(text[start : end + 1])


def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFD", value or "")
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = re.sub(r"\[\[[^\]]*\]\]", " ", value)
    value = re.sub(r"<[^>]*>", " ", value)
    value = value.lower()
    value = re.sub(r"[^a-z0-9\s]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def extract_pdf_text(pdf_path: Path) -> str:
    try:
        reader = PdfReader(str(pdf_path))
    except Exception:
        return ""
    chunks: list[str] = []
    max_pages = min(3, len(reader.pages))
    for idx in range(max_pages):
        try:
            chunks.append(reader.pages[idx].extract_text() or "")
        except Exception:
            continue
    text = "\n".join(chunks).replace("\u00a0", " ")
    return re.sub(r"[ \t]+", " ", text)


def extract_meta(text: str) -> dict:
    meta = {
        "correspondingName": "",
        "correspondingAffiliation": "",
        "email": "",
        "phone": "",
        "orcidByName": {},
        "orcidByInitials": {},
        "publicationHistory": {
            "received": "",
            "accepted": "",
            "availableOnlineDate": "",
            "publishedOnline": "",
            "publishedInIssue": "",
            "published": "",
        },
    }
    if not text:
        return meta

    stop_terms = (
        r"(?:e-?mail|email|received|accepted|available online date|doi|"
        r"orcid i?d?s? of the authors?|cite this article as|copyright)\s*:"
    )

    corr_match = re.search(
        r"Correspond(?:ing|ence)\s*author\s*:\s*(.+?)(?=" + stop_terms + r"|$)",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if corr_match:
        corr_line = " ".join(corr_match.group(1).split())
        if corr_line:
            parts = [item.strip() for item in corr_line.split(",") if item.strip()]
            if len(parts) > 1:
                meta["correspondingName"] = parts[0]
                meta["correspondingAffiliation"] = ", ".join(parts[1:])
            else:
                meta["correspondingName"] = corr_line

    email_label_match = re.search(
        r"(?:e-?mail|email)\s*:\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})",
        text,
        re.IGNORECASE,
    )
    if email_label_match:
        meta["email"] = email_label_match.group(1).strip()
    elif corr_match:
        # Accept nearby email only when a corresponding-author label exists.
        start = corr_match.end()
        nearby = text[start : start + 400]
        nearby_email = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", nearby, re.IGNORECASE)
        if nearby_email:
            meta["email"] = nearby_email.group(0).strip()

    phone_match = re.search(r"(?:Phone|Tel(?:ephone)?)\s*:\s*([+0-9()\-/\s]{6,})", text, re.IGNORECASE)
    if phone_match:
        meta["phone"] = " ".join(phone_match.group(1).split())

    marker = re.search(r"ORCID\s*i?D[s]?\s*of\s*the\s*authors?\s*:", text, re.IGNORECASE)
    if marker:
        tail = text[marker.end() : marker.end() + 900]
        stop_match = re.search(
            r"(?:Cite\s+this\s+article\s+as\s*:|Copyright|Available\s+at\s+www\.)",
            tail,
            re.IGNORECASE,
        )
        orcid_scope = tail[: stop_match.start()] if stop_match else tail
    else:
        orcid_scope = ""

    if orcid_scope:
        segments = [seg.strip() for seg in re.split(r"[;\u2022]", orcid_scope) if seg.strip()]
        id_pattern = re.compile(r"((?:\d{4}-){3}\d{3}[\dX])")

        def is_initials_token(token: str) -> bool:
            compact = re.sub(r"[\s.\-]", "", token)
            if not compact:
                return False
            if "." in token:
                return True
            if " " in token:
                return False
            return token.upper() == token and len(compact) <= 6

        for segment in segments:
            id_match = id_pattern.search(segment)
            if not id_match:
                continue
            orcid = id_match.group(1).strip()
            token = segment[: id_match.start()].strip(" ,:.-")
            token = " ".join(token.split())
            if not token or not orcid:
                continue

            if is_initials_token(token):
                initials = "".join(
                    ch
                    for ch in unicodedata.normalize("NFD", token).upper()
                    if "A" <= ch <= "Z"
                )
                if initials:
                    meta["orcidByInitials"][initials] = orcid
            else:
                name_key = normalize_name(token)
                if name_key:
                    meta["orcidByName"][name_key] = orcid

    label_union = (
        r"(?:Received|Accepted|Available\s*Online\s*Date|Published\s*online|"
        r"Published\s*in\s*issue|Published|DOI|ORCID|Copyright)"
    )
    header_text = text[:10000]

    def clean_date_value(value: str) -> str:
        value = " ".join((value or "").split()).strip()
        value = value.replace("•", " ")
        value = value.strip(" \t,;:.")
        return value

    def looks_like_date(value: str) -> bool:
        value = clean_date_value(value)
        if not value:
            return False
        if re.match(r"^\d{1,2}\.\d{1,2}\.\d{4}$", value):
            return True
        if re.match(r"^\d{4}-\d{2}-\d{2}$", value):
            return True
        if re.search(r"\b\d{4}\b", value) and re.search(
            r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
            r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b",
            value,
            re.IGNORECASE,
        ):
            return True
        return False

    def extract_labeled_date(label_pattern: str) -> str:
        match = re.search(
            r"(?:^|[\s\n])" + label_pattern + r"\s*:\s*(.+?)(?=" + label_union + r"\s*:|$)",
            header_text,
            re.IGNORECASE | re.DOTALL,
        )
        if not match:
            return ""
        value = clean_date_value(match.group(1))
        return value if looks_like_date(value) else ""

    meta["publicationHistory"]["received"] = extract_labeled_date(r"Received")
    meta["publicationHistory"]["accepted"] = extract_labeled_date(r"Accepted")
    meta["publicationHistory"]["availableOnlineDate"] = extract_labeled_date(r"Available\s*Online\s*Date")
    meta["publicationHistory"]["publishedOnline"] = extract_labeled_date(r"Published\s*online")
    meta["publicationHistory"]["publishedInIssue"] = extract_labeled_date(r"Published\s*in\s*issue")
    generic_published = extract_labeled_date(r"Published")
    if generic_published and not meta["publicationHistory"]["publishedOnline"] and not meta["publicationHistory"]["publishedInIssue"]:
        meta["publicationHistory"]["published"] = generic_published

    return meta


def has_metadata(meta: dict) -> bool:
    return any(
        [
            meta.get("correspondingName"),
            meta.get("correspondingAffiliation"),
            meta.get("email"),
            meta.get("phone"),
            meta.get("orcidByName"),
            meta.get("orcidByInitials"),
            (meta.get("publicationHistory") or {}).get("received"),
            (meta.get("publicationHistory") or {}).get("accepted"),
            (meta.get("publicationHistory") or {}).get("availableOnlineDate"),
            (meta.get("publicationHistory") or {}).get("publishedOnline"),
            (meta.get("publicationHistory") or {}).get("publishedInIssue"),
            (meta.get("publicationHistory") or {}).get("published"),
        ]
    )


def main() -> None:
    articles = parse_articles()
    output: dict[str, dict] = {}

    checked = 0
    for article in articles:
        local_pdf = str(article.get("localPdfUrl") or "").strip()
        if not local_pdf:
            continue
        pdf_path = ROOT / local_pdf
        if not pdf_path.exists():
            continue

        checked += 1
        text = extract_pdf_text(pdf_path)
        meta = extract_meta(text)
        if has_metadata(meta):
            output[str(article.get("id"))] = meta

    payload = (
        "/**\n"
        " * Balkan Medical Journal — Precomputed Author Metadata\n"
        " * Generated from local PDF files.\n"
        " */\n"
        "window.AUTHOR_METADATA = "
        + json.dumps(output, ensure_ascii=True, indent=2)
        + ";\n"
    )
    OUTPUT_JS.write_text(payload, encoding="utf-8")
    print(f"Checked PDFs: {checked}")
    print(f"Articles with extracted metadata: {len(output)}")
    print(f"Wrote: {OUTPUT_JS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
