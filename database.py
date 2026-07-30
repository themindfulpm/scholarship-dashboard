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
    title: str = "",
    target_school: str = "",
) -> Dict[str, Any]:
    """Insert or update a scraped scholarship draft using source URL as natural key."""
    currency = "CAD" if country == "Canada" else "USD"
    title_value = title.strip() or f"{school} scholarship opportunity"
    target_school_value = target_school.strip() or school

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
                        application_url,
                        status,
                        requires_hs_nomination,
                        nomination_status,
                        essay_required,
                        notes
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        title_value,
                        target_school_value,
                        country,
                        0,
                        currency,
                        application_url.strip() or source_url,
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
                    application_url = ?,
                    requires_hs_nomination = ?,
                    notes = ?
                WHERE id = ?
                """,
                (
                    title_value,
                    target_school_value,
                    application_url.strip() or source_url,
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
