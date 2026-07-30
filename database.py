"""Compatibility database module for the Streamlit app.

This module exposes the core scholarship tracker functions from
`scholarship_db.py` and adds read helpers used by the dashboard.
"""

from __future__ import annotations

import sqlite3
from typing import Any, Dict, List

from scholarship_db import (  # re-exported core API
    DB_PATH,
    add_essay,
    add_scholarship,
    get_scholarships,
    init_db,
    link_essay_variant,
    update_nomination_status,
)


def _connect() -> sqlite3.Connection:
    init_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def has_scholarships() -> Dict[str, Any]:
    """Return whether the scholarships table contains at least one row."""
    try:
        with _connect() as conn:
            row = conn.execute("SELECT 1 FROM scholarships LIMIT 1").fetchone()
        return {"success": True, "data": bool(row)}
    except sqlite3.Error as exc:
        return {"success": False, "error": f"Failed to check scholarship existence: {exc}"}


def get_student_profile() -> Dict[str, Any]:
    """Return the single-row student profile if it exists."""
    try:
        with _connect() as conn:
            row = conn.execute("SELECT * FROM student_profile WHERE id = 1").fetchone()
        return {"success": True, "data": dict(row) if row else None}
    except sqlite3.Error as exc:
        return {"success": False, "error": f"Failed to fetch student profile: {exc}"}


def backfill_application_urls() -> Dict[str, Any]:
    """Populate blank application_url values from the stored Source URL note when possible."""
    try:
        updated = 0
        with _connect() as conn:
            rows = conn.execute(
                """
                SELECT id, application_url, notes
                FROM scholarships
                WHERE application_url IS NULL OR TRIM(application_url) = ''
                """
            ).fetchall()

            for row in rows:
                notes = row["notes"] or ""
                source_url = ""
                for line in notes.splitlines():
                    if line.startswith("Source URL:"):
                        source_url = line.split("Source URL:", 1)[1].strip()
                        break
                if source_url:
                    conn.execute(
                        "UPDATE scholarships SET application_url = ? WHERE id = ?",
                        (source_url, row["id"]),
                    )
                    updated += 1
        return {"success": True, "updated": updated}
    except sqlite3.Error as exc:
        return {"success": False, "error": f"Failed to backfill application URLs: {exc}"}


def cleanup_public_listicle_rows() -> Dict[str, Any]:
    """Delete obvious listicle/directory public rows from previous broad scans."""
    try:
        with _connect() as conn:
            cursor = conn.execute(
                """
                DELETE FROM scholarships
                WHERE target_school = 'Public scholarship'
                  AND (
                    LOWER(title) LIKE '%top %'
                    OR LOWER(title) LIKE '%best %'
                    OR LOWER(title) LIKE '%list of%'
                    OR LOWER(title) LIKE '%by major%'
                    OR LOWER(title) LIKE '%by state%'
                    OR LOWER(title) LIKE '%scholarships in %'
                    OR LOWER(title) LIKE '%scholarships for %'
                    OR LOWER(title) LIKE '%directory%'
                                        OR LOWER(title) IN ('unigo scholarships', 'bold.org scholarships', 'fastweb scholarships', 'submit your scholarship')
                    OR LOWER(application_url) LIKE '%bold.org/apply%'
                    OR LOWER(application_url) LIKE '%scholarship-search%'
                    OR LOWER(application_url) LIKE '%new-login%'
                    OR LOWER(application_url) LIKE '%list-your-scholarship%'
                    OR LOWER(application_url) LIKE '%submit-your-scholarship%'
                                        OR LOWER(application_url) LIKE '%/contact-us/submitting-or-editing-a-scholarship%'
                                        OR (application_deadline IS NOT NULL AND TRIM(application_deadline) <> '' AND application_deadline < DATE('now'))
                  )
                """
            )
        return {"success": True, "deleted": cursor.rowcount}
    except sqlite3.Error as exc:
        return {"success": False, "error": f"Failed to cleanup public listicle rows: {exc}"}


def get_essays() -> Dict[str, Any]:
    """Return all master essays as a list of dicts."""
    try:
        with _connect() as conn:
            rows = conn.execute(
                """
                SELECT id, title, core_topic, master_text, word_count, file_path
                FROM essays
                ORDER BY id DESC
                """
            ).fetchall()
        return {"success": True, "data": [dict(row) for row in rows]}
    except sqlite3.Error as exc:
        return {"success": False, "error": f"Failed to fetch essays: {exc}"}


def get_essay_variants() -> Dict[str, Any]:
    """Return essay variants joined to essay and scholarship titles."""
    try:
        with _connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    ev.id,
                    ev.essay_id,
                    e.title AS essay_title,
                    ev.scholarship_id,
                    s.title AS scholarship_title,
                    ev.tailored_prompt,
                    ev.tailored_text,
                    ev.word_count,
                    ev.target_word_limit
                FROM essay_variants ev
                JOIN essays e ON e.id = ev.essay_id
                JOIN scholarships s ON s.id = ev.scholarship_id
                ORDER BY ev.id DESC
                """
            ).fetchall()
        return {"success": True, "data": [dict(row) for row in rows]}
    except sqlite3.Error as exc:
        return {"success": False, "error": f"Failed to fetch essay variants: {exc}"}


def set_variant_target_word_limit(variant_id: int, target_word_limit: int) -> Dict[str, Any]:
    """Update a variant's target word limit."""
    try:
        with _connect() as conn:
            cursor = conn.execute(
                """
                UPDATE essay_variants
                SET target_word_limit = ?
                WHERE id = ?
                """,
                (target_word_limit, variant_id),
            )
            if cursor.rowcount == 0:
                return {"success": False, "error": f"Variant id {variant_id} not found"}
        return {"success": True}
    except sqlite3.Error as exc:
        return {"success": False, "error": f"Failed to update target word limit: {exc}"}


def upsert_scraped_scholarship(
    *,
    source_url: str,
    school: str,
    country: str,
    requires_hs_nomination: bool,
    notes: str,
    application_url: str = "",
    application_deadline: str | None = None,
    scholarship_min_gpa: float | None = None,
    student_gpa: float | None = None,
    title: str = "",
    target_school: str = "",
) -> Dict[str, Any]:
    """Insert or update a scraped scholarship draft using source URL as natural key."""
    currency = "CAD" if country == "Canada" else "USD"
    title_value = title.strip() or f"{school} scholarship opportunity"
    target_school_value = target_school.strip() or school
    is_eligible = None
    if scholarship_min_gpa is not None and student_gpa is not None:
        try:
            is_eligible = int(float(student_gpa) >= float(scholarship_min_gpa))
        except (TypeError, ValueError):
            is_eligible = None

    try:
        with _connect() as conn:
            existing = conn.execute(
                """
                SELECT id FROM scholarships
                WHERE target_school = ?
                  AND notes LIKE ?
                LIMIT 1
                """,
                (target_school_value, f"%Source URL: {source_url}%"),
            ).fetchone()

            normalized_notes = f"Source URL: {source_url}\n{notes}".strip()

            if existing is None:
                cursor = conn.execute(
                    """
                    INSERT INTO scholarships (
                        title,
                        target_school,
                        country,
                        award_amount,
                        currency,
                        scholarship_min_gpa,
                        is_eligible,
                        application_url,
                        application_deadline,
                        status,
                        requires_hs_nomination,
                        nomination_status,
                        essay_required,
                        notes
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        title_value,
                        target_school_value,
                        country,
                        0,
                        currency,
                        scholarship_min_gpa,
                        is_eligible,
                        application_url.strip() or source_url,
                        application_deadline,
                        "Not Started",
                        int(requires_hs_nomination),
                        "Not Requested",
                        1,
                        normalized_notes,
                    ),
                )
                row = conn.execute(
                    "SELECT * FROM scholarships WHERE id = ?",
                    (cursor.lastrowid,),
                ).fetchone()
                return {"success": True, "action": "inserted", "data": dict(row)}

            conn.execute(
                """
                UPDATE scholarships
                SET
                    title = ?,
                    target_school = ?,
                    scholarship_min_gpa = ?,
                    is_eligible = ?,
                    application_url = ?,
                    application_deadline = ?,
                    requires_hs_nomination = ?,
                    notes = ?
                WHERE id = ?
                """,
                (
                    title_value,
                    target_school_value,
                    scholarship_min_gpa,
                    is_eligible,
                    application_url.strip() or source_url,
                    application_deadline,
                    int(requires_hs_nomination),
                    normalized_notes,
                    existing["id"],
                ),
            )
            row = conn.execute(
                "SELECT * FROM scholarships WHERE id = ?",
                (existing["id"],),
            ).fetchone()
            return {"success": True, "action": "updated", "data": dict(row)}
    except sqlite3.Error as exc:
        return {"success": False, "error": f"Failed to upsert scraped scholarship: {exc}"}
