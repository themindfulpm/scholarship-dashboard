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
