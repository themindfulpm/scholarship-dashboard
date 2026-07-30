"""Web scraping and RSS parsing helpers for scholarship tracking.

This module provides:
- scrape_scholarship_page(url, country)
- check_nomination_alerts(database_path)
"""

from __future__ import annotations

import sqlite3
from datetime import datetime
from email.utils import parsedate_to_datetime
from urllib.parse import urljoin
from typing import Any, Dict, List, Optional

import feedparser
import requests
from bs4 import BeautifulSoup


REQUEST_TIMEOUT_SECONDS = 20

INDICATOR_KEYWORDS = [
    "school nomination",
    "nomination deadline",
    "international entrance award",
    "early action",
]

AUTO_NOMINATION_KEYWORDS = [
    "counselor nomination",
    "school endorsement",
]


def _safe_text_from_html(html: str) -> str:
    """Extract readable text from HTML with tag fallback safety."""
    soup = BeautifulSoup(html, "html.parser")
    # Prefer visible content blocks first, then full document fallback.
    candidates = soup.select("main, article, section")
    if candidates:
        joined = " ".join(block.get_text(" ", strip=True) for block in candidates)
        if joined.strip():
            return joined
    return soup.get_text(" ", strip=True)


def _parse_possible_datetime(value: Optional[str]) -> Optional[datetime]:
    """Best-effort parsing for date strings from DB or feeds."""
    if not value:
        return None

    raw = value.strip()
    if not raw:
        return None

    # Common structured formats first.
    formats = [
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%d-%m-%Y",
        "%m/%d/%Y",
        "%b %d, %Y",
        "%B %d, %Y",
        "%b %Y",
        "%B %Y",
    ]
    for fmt in formats:
        try:
            parsed = datetime.strptime(raw, fmt)
            if fmt in {"%b %Y", "%B %Y"}:
                # If only month and year are provided, assume first day.
                return parsed.replace(day=1)
            return parsed
        except ValueError:
            continue

    # RFC2822/HTTP-style date strings.
    try:
        return parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None


def _find_keyword_hits(text: str, keywords: List[str]) -> List[str]:
    text_l = text.lower()
    return [kw for kw in keywords if kw in text_l]


def _extract_page_title(soup: BeautifulSoup, feed_entries: List[Any]) -> str:
    if feed_entries:
        first_entry = feed_entries[0]
        title = str(getattr(first_entry, "title", "") or "").strip()
        if title:
            return title
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
        if title:
            return title
    return ""


def _extract_application_link(soup: BeautifulSoup, base_url: str) -> Dict[str, str]:
    keyword_boosts = [
        "apply",
        "application",
        "apply now",
        "application form",
        "submit",
        "portal",
        "scholarship application",
        "award application",
        "open application",
        "apply here",
    ]

    candidates: List[Dict[str, str]] = []
    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href", "")).strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue

        absolute_url = urljoin(base_url, href)
        anchor_text = " ".join(anchor.get_text(" ", strip=True).split())
        link_text_l = anchor_text.lower()
        href_l = href.lower()

        score = 0
        if any(keyword in link_text_l for keyword in keyword_boosts):
            score += 3
        if any(keyword in href_l for keyword in keyword_boosts):
            score += 2
        if "scholar" in link_text_l or "scholar" in href_l:
            score += 1

        if score > 0:
            candidates.append(
                {
                    "application_url": absolute_url,
                    "application_link_text": anchor_text,
                    "score": str(score),
                }
            )

    if candidates:
        candidates.sort(key=lambda item: int(item.get("score", "0")), reverse=True)
        best = candidates[0]
        return {
            "application_url": best["application_url"],
            "application_link_text": best["application_link_text"],
        }

    return {
        "application_url": base_url,
        "application_link_text": "Source page",
    }


def scrape_scholarship_page(
    url: str,
    country: str,
    custom_keywords: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Fetch and parse scholarship content from HTML or RSS.

    Args:
        url: Target page or RSS feed URL.
        country: "US" or "Canada".

    Returns:
        Dictionary containing fetch/parse status and keyword findings.
    """
    if country not in {"US", "Canada"}:
        return {"success": False, "error": f"Invalid country: {country}"}

    result: Dict[str, Any] = {
        "success": False,
        "url": url,
        "country": country,
        "source_type": None,
        "requires_hs_nomination": False,
        "indicator_hits": [],
        "auto_nomination_hits": [],
        "custom_keyword_hits": [],
        "page_title": "",
        "application_url": "",
        "application_link_text": "",
        "matched_excerpt": "",
        "notes": "",
    }

    try:
        response = requests.get(
            url,
            timeout=REQUEST_TIMEOUT_SECONDS,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/127.0.0.0 Safari/537.36"
                )
            },
        )
    except requests.RequestException as exc:
        result["error"] = f"Request failed (possible block/network issue): {exc}"
        result["notes"] = "Try retrying later, using a browser session, or checking robots/site protection."
        return result

    if response.status_code >= 400:
        result["error"] = f"HTTP error {response.status_code} while fetching page"
        result["notes"] = "Site may be blocking automated traffic or URL may be unavailable."
        return result

    content_type = (response.headers.get("Content-Type") or "").lower()
    body = response.text or ""

    final_url = str(getattr(response, "url", "") or "")
    if "404" in final_url.lower():
        result["error"] = f"Soft 404 detected at {final_url}"
        result["notes"] = "Source URL appears to redirect to a not-found page."
        return result

    aggregated_text = ""
    source_type = "html"

    # Try RSS/Atom first when indicated or when feedparser can parse entries.
    feed = feedparser.parse(body)
    feed_entries = getattr(feed, "entries", [])
    is_feed_like = "xml" in content_type or "rss" in content_type or "atom" in content_type

    if is_feed_like or feed_entries:
        source_type = "rss"
        parts: List[str] = []
        try:
            for entry in feed_entries:
                parts.append(str(getattr(entry, "title", "")))
                parts.append(str(getattr(entry, "summary", "")))
                parts.append(str(getattr(entry, "description", "")))
        except Exception:
            # Fallback: keep going with what was extracted.
            pass

        aggregated_text = " ".join(part for part in parts if part).strip()

        # Missing tags or empty feed body fallback to HTML extraction.
        if not aggregated_text:
            source_type = "html"
            aggregated_text = _safe_text_from_html(body)
    else:
        aggregated_text = _safe_text_from_html(body)

    soup = BeautifulSoup(body, "html.parser")
    page_title = _extract_page_title(soup, feed_entries)
    app_link = _extract_application_link(soup, final_url or url)

    if not aggregated_text:
        result["error"] = "No parseable text found (missing tags or empty response body)."
        result["notes"] = "Page structure may be script-rendered; try alternate source URLs/RSS endpoints."
        result["source_type"] = source_type
        return result

    indicator_hits = _find_keyword_hits(aggregated_text, INDICATOR_KEYWORDS)
    auto_nomination_hits = _find_keyword_hits(aggregated_text, AUTO_NOMINATION_KEYWORDS)
    custom_keyword_hits = _find_keyword_hits(aggregated_text, custom_keywords or [])
    requires_hs_nomination = bool(auto_nomination_hits)

    # Store a short excerpt around first hit for quick review.
    excerpt = ""
    first_hit = (auto_nomination_hits + indicator_hits)[0] if (auto_nomination_hits or indicator_hits) else None
    if first_hit:
        text_l = aggregated_text.lower()
        idx = text_l.find(first_hit)
        if idx >= 0:
            start = max(0, idx - 120)
            end = min(len(aggregated_text), idx + len(first_hit) + 180)
            excerpt = aggregated_text[start:end].strip()

    result.update(
        {
            "success": True,
            "source_type": source_type,
            "requires_hs_nomination": requires_hs_nomination,
            "indicator_hits": indicator_hits,
            "auto_nomination_hits": auto_nomination_hits,
            "custom_keyword_hits": custom_keyword_hits,
            "page_title": page_title,
            "application_url": app_link.get("application_url", final_url or url),
            "application_link_text": app_link.get("application_link_text", "Source page"),
            "matched_excerpt": excerpt,
            "notes": (
                "Auto nomination set to True due to counselor/school endorsement keyword."
                if requires_hs_nomination
                else "No auto-nomination trigger keywords detected."
            ),
        }
    )
    return result


def check_nomination_alerts(database_path: str) -> Dict[str, Any]:
    """Build urgency-sorted alerts for scholarships requiring HS nomination.

    Alerts are sorted by days remaining (ascending), then by nomination deadline.
    """
    query = """
        SELECT
            id,
            title,
            target_school,
            country,
            nomination_deadline,
            nomination_status,
            application_deadline,
            status,
            requires_hs_nomination
        FROM scholarships
        WHERE requires_hs_nomination = 1
    """

    alerts: List[Dict[str, Any]] = []
    parsing_issues: List[Dict[str, Any]] = []
    now = datetime.now()

    try:
        conn = sqlite3.connect(database_path)
        conn.row_factory = sqlite3.Row
    except sqlite3.Error as exc:
        return {
            "success": False,
            "error": f"Failed to connect to database: {exc}",
            "alerts": [],
        }

    try:
        rows = conn.execute(query).fetchall()
    except sqlite3.Error as exc:
        conn.close()
        return {
            "success": False,
            "error": f"Failed to query scholarships: {exc}",
            "alerts": [],
        }
    finally:
        conn.close()

    for row in rows:
        record = dict(row)
        deadline_raw = record.get("nomination_deadline")
        parsed_deadline = _parse_possible_datetime(deadline_raw)

        if parsed_deadline is None:
            parsing_issues.append(
                {
                    "scholarship_id": record.get("id"),
                    "title": record.get("title"),
                    "issue": "Missing/unparseable nomination_deadline",
                    "nomination_deadline": deadline_raw,
                }
            )
            continue

        days_remaining = (parsed_deadline.date() - now.date()).days

        alert_level = "on-track"
        if days_remaining < 0:
            alert_level = "overdue"
        elif days_remaining <= 30:
            alert_level = "critical"
        elif days_remaining <= 90:
            alert_level = "high"
        elif days_remaining <= 180:
            alert_level = "medium"

        alerts.append(
            {
                "scholarship_id": record.get("id"),
                "title": record.get("title"),
                "target_school": record.get("target_school"),
                "country": record.get("country"),
                "nomination_status": record.get("nomination_status"),
                "nomination_deadline": parsed_deadline.strftime("%Y-%m-%d"),
                "days_remaining": days_remaining,
                "application_status": record.get("status"),
                "application_deadline": record.get("application_deadline"),
                "alert_level": alert_level,
                "notify_counselor": days_remaining <= 180,
            }
        )

    alerts.sort(key=lambda a: (a["days_remaining"], a["nomination_deadline"]))

    return {
        "success": True,
        "alerts": alerts,
        "count": len(alerts),
        "parsing_issues": parsing_issues,
        "notes": "Alerts are urgency-sorted so counselors can be notified ahead of deadlines.",
    }


def scan_scholarship_sources(
    sources: List[Dict[str, Any]],
    required_keywords: Optional[List[str]] = None,
    country_filter: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Scan configured school sources and return matched opportunities.

    Args:
        sources: List of dictionaries with keys: school, country, url.
        required_keywords: Optional keyword list; if set, at least one must match.
        country_filter: Optional list like ["US", "Canada"].
    """
    required_keywords = [kw.strip().lower() for kw in (required_keywords or []) if kw.strip()]
    allowed_countries = set(country_filter or ["US", "Canada"])

    scanned_count = 0
    matched_count = 0
    matches: List[Dict[str, Any]] = []
    failures: List[Dict[str, Any]] = []
    skipped_sources: List[Dict[str, Any]] = []

    for source in sources:
        school = source.get("school", "")
        country = source.get("country", "")
        url = source.get("url", "")
        urls = source.get("urls") or ([url] if url else [])
        enabled = bool(source.get("enabled", True))

        if not enabled:
            skipped_sources.append(
                {
                    "school": school,
                    "country": country,
                    "reason": "disabled in source_config",
                }
            )
            continue

        if country not in allowed_countries:
            continue
        if not urls:
            failures.append({"school": school, "url": url, "error": "Missing URL"})
            continue

        scanned_count += 1
        scrape_result: Optional[Dict[str, Any]] = None
        resolved_url = ""
        attempted: List[Dict[str, str]] = []

        for candidate_url in urls:
            current_result = scrape_scholarship_page(
                candidate_url,
                country,
                custom_keywords=required_keywords,
            )
            if current_result.get("success"):
                scrape_result = current_result
                resolved_url = candidate_url
                break

            attempted.append(
                {
                    "url": candidate_url,
                    "error": current_result.get("error", "Unknown scraping error"),
                }
            )

        if not scrape_result:
            failures.append(
                {
                    "school": school,
                    "url": url,
                    "error": "All fallback URLs failed",
                    "attempts": attempted,
                }
            )
            continue

        hit_pool = [
            *scrape_result.get("indicator_hits", []),
            *scrape_result.get("auto_nomination_hits", []),
            *scrape_result.get("custom_keyword_hits", []),
        ]
        hit_pool_l = [item.lower() for item in hit_pool]

        passes_keyword_gate = True
        matched_required_keywords: List[str] = []
        if required_keywords:
            matched_required_keywords = [kw for kw in required_keywords if kw in hit_pool_l]
            passes_keyword_gate = bool(matched_required_keywords)

        if not passes_keyword_gate:
            continue

        matched_count += 1
        matches.append(
            {
                "school": school,
                "country": country,
                "url": resolved_url or url,
                "requires_hs_nomination": bool(scrape_result.get("requires_hs_nomination", False)),
                "indicator_hits": scrape_result.get("indicator_hits", []),
                "auto_nomination_hits": scrape_result.get("auto_nomination_hits", []),
                "matched_required_keywords": matched_required_keywords,
                "matched_excerpt": scrape_result.get("matched_excerpt", ""),
                "source_type": scrape_result.get("source_type"),
            }
        )

    return {
        "success": True,
        "scanned_count": scanned_count,
        "matched_count": matched_count,
        "matches": matches,
        "failures": failures,
        "skipped_sources": skipped_sources,
    }
