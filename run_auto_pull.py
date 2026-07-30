"""Headless rules-based scholarship auto-pull runner (no AI required)."""

from __future__ import annotations

import json

import database as db
import scraper
from source_config import (
    AUTO_PULL_CRITERIA,
    PUBLIC_SEARCH_CRITERIA,
    PUBLIC_SOURCE_CATALOG,
    SOURCE_CATALOG,
)


def _save_matches(matches: list[dict], *, public_target: bool = False) -> dict:
    inserted = 0
    updated = 0
    failures = []

    for match in matches:
        notes = (
            ("Public source scan\n" if public_target else "")
            + f"Indicator hits: {', '.join(match.get('indicator_hits', [])) or 'none'}\n"
            + f"Auto nomination hits: {', '.join(match.get('auto_nomination_hits', [])) or 'none'}\n"
            + f"Matched required keywords: {', '.join(match.get('matched_required_keywords', [])) or 'none'}\n"
            + f"Opportunity quality score: {match.get('quality_score', 0)}\n"
            + f"Application deadline: {match.get('application_deadline') or 'unknown'}\n"
            + f"Minimum GPA requirement: {match.get('scholarship_min_gpa') if match.get('scholarship_min_gpa') is not None else 'unknown'}\n"
            + f"Excerpt: {match.get('matched_excerpt', '')}"
        )
        upsert_result = db.upsert_scraped_scholarship(
            source_url=match["url"],
            school=match["school"],
            country=match["country"],
            requires_hs_nomination=match["requires_hs_nomination"],
            application_url=match.get("application_url", match["url"]),
            application_deadline=match.get("application_deadline"),
            scholarship_min_gpa=match.get("scholarship_min_gpa"),
            student_gpa=float(AUTO_PULL_CRITERIA["unweighted_gpa"]),
            title=match.get("page_title", "") or match.get("school", "Scholarship opportunity"),
            target_school="Public scholarship" if public_target else match.get("page_title", "") or match["school"],
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

    return {"inserted": inserted, "updated": updated, "failures": failures}


def run_auto_pull() -> dict:
    school_scan_result = scraper.scan_scholarship_sources(
        sources=SOURCE_CATALOG,
        required_keywords=AUTO_PULL_CRITERIA["required_keywords"],
        country_filter=AUTO_PULL_CRITERIA["countries"],
        student_gpa=float(AUTO_PULL_CRITERIA["unweighted_gpa"]),
    )
    public_scan_result = scraper.scan_scholarship_sources(
        sources=PUBLIC_SOURCE_CATALOG,
        required_keywords=(
            PUBLIC_SEARCH_CRITERIA["public_keywords"]
            + PUBLIC_SEARCH_CRITERIA["major_keywords"]
            + PUBLIC_SEARCH_CRITERIA["audience_keywords"]
        ),
        country_filter=PUBLIC_SEARCH_CRITERIA["countries"],
        student_gpa=float(AUTO_PULL_CRITERIA["unweighted_gpa"]),
    )

    if not school_scan_result.get("success"):
        return school_scan_result
    if not public_scan_result.get("success"):
        return public_scan_result

    school_save_stats = _save_matches(school_scan_result.get("matches", []), public_target=False)
    public_save_stats = _save_matches(public_scan_result.get("matches", []), public_target=True)

    return {
        "success": True,
        "scanned_count": school_scan_result.get("scanned_count", 0) + public_scan_result.get("scanned_count", 0),
        "matched_count": school_scan_result.get("matched_count", 0) + public_scan_result.get("matched_count", 0),
        "inserted": school_save_stats["inserted"] + public_save_stats["inserted"],
        "updated": school_save_stats["updated"] + public_save_stats["updated"],
        "scan_failures": school_scan_result.get("failures", []) + public_scan_result.get("failures", []),
        "skipped_sources": school_scan_result.get("skipped_sources", []) + public_scan_result.get("skipped_sources", []),
        "save_failures": school_save_stats["failures"] + public_save_stats["failures"],
    }


if __name__ == "__main__":
    result = run_auto_pull()
    print(json.dumps(result, indent=2))
