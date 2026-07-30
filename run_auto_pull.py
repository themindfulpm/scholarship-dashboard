"""Headless rules-based scholarship auto-pull runner (no AI required)."""

from __future__ import annotations

import json

import database as db
import scraper
from source_config import AUTO_PULL_CRITERIA, SOURCE_CATALOG


def run_auto_pull() -> dict:
    scan_result = scraper.scan_scholarship_sources(
        sources=SOURCE_CATALOG,
        required_keywords=AUTO_PULL_CRITERIA["required_keywords"],
        country_filter=AUTO_PULL_CRITERIA["countries"],
    )
    if not scan_result.get("success"):
        return scan_result

    inserted = 0
    updated = 0
    failures = []

    for match in scan_result.get("matches", []):
        notes = (
            f"Indicator hits: {', '.join(match.get('indicator_hits', [])) or 'none'}\n"
            f"Auto nomination hits: {', '.join(match.get('auto_nomination_hits', [])) or 'none'}\n"
            f"Matched required keywords: {', '.join(match.get('matched_required_keywords', [])) or 'none'}\n"
            f"Excerpt: {match.get('matched_excerpt', '')}"
        )
        upsert_result = db.upsert_scraped_scholarship(
            source_url=match["url"],
            school=match["school"],
            country=match["country"],
            requires_hs_nomination=match["requires_hs_nomination"],
            notes=notes,
        )
        if not upsert_result.get("success"):
            failures.append(
                {
                    "school": match.get("school"),
                    "url": match.get("url"),
                    "error": upsert_result.get("error", "Unknown upsert error"),
                }
            )
            continue

        if upsert_result.get("action") == "inserted":
            inserted += 1
        else:
            updated += 1

    return {
        "success": True,
        "scanned_count": scan_result.get("scanned_count", 0),
        "matched_count": scan_result.get("matched_count", 0),
        "inserted": inserted,
        "updated": updated,
        "scan_failures": scan_result.get("failures", []),
        "skipped_sources": scan_result.get("skipped_sources", []),
        "save_failures": failures,
    }


if __name__ == "__main__":
    result = run_auto_pull()
    print(json.dumps(result, indent=2))
