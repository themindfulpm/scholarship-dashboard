"""SQLite database utilities for a Scholarship Tracker tool.

This module creates and manages a local SQLite database file named
"database.db" with tables for scholarships, essays, and tailored essay
variants.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional


DB_PATH = Path(__file__).with_name("database.db")

VALID_COUNTRIES = {"US", "Canada"}
VALID_CURRENCIES = {"USD", "CAD"}
VALID_SCHOLARSHIP_STATUSES = {
    "Not Started",
    "In Progress",
    "Submitted",
    "Awarded",
    "Rejected",
}
VALID_NOMINATION_STATUSES = {
    "Not Requested",
    "Requested",
    "Approved",
    "Submitted",
}


def _get_connection() -> sqlite3.Connection:
    """Create a SQLite connection with dictionary-like row access."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def _row_to_dict(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    return dict(row)


def _rows_to_dicts(rows: List[sqlite3.Row]) -> List[Dict[str, Any]]:
    return [dict(row) for row in rows]


def _word_count(text: Optional[str]) -> int:
    if not text:
        return 0
    return len(text.split())


def _column_exists(conn: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(row[1] == column_name for row in rows)


def _ensure_schema_migrations(conn: sqlite3.Connection) -> None:
    """Backfill new columns/tables for existing databases."""
    if not _column_exists(conn, "scholarships", "scholarship_min_gpa"):
        conn.execute("ALTER TABLE scholarships ADD COLUMN scholarship_min_gpa REAL")
    if not _column_exists(conn, "scholarships", "is_eligible"):
        conn.execute(
            "ALTER TABLE scholarships ADD COLUMN is_eligible INTEGER CHECK (is_eligible IN (0, 1))"
        )


def init_db() -> Dict[str, Any]:
    """Initialize the SQLite schema in database.db.

    Returns:
        A status dictionary with success flag and message/error.
    """
    try:
        with _get_connection() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS scholarships (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    target_school TEXT,
                    country TEXT NOT NULL CHECK (country IN ('US', 'Canada')),
                    award_amount REAL,
                    currency TEXT NOT NULL CHECK (currency IN ('USD', 'CAD')),
                    scholarship_min_gpa REAL,
                    is_eligible INTEGER CHECK (is_eligible IN (0, 1)),
                    application_deadline TEXT,
                    status TEXT NOT NULL DEFAULT 'Not Started'
                        CHECK (status IN ('Not Started', 'In Progress', 'Submitted', 'Awarded', 'Rejected')),
                    requires_hs_nomination INTEGER NOT NULL DEFAULT 0
                        CHECK (requires_hs_nomination IN (0, 1)),
                    nomination_deadline TEXT,
                    nomination_status TEXT NOT NULL DEFAULT 'Not Requested'
                        CHECK (nomination_status IN ('Not Requested', 'Requested', 'Approved', 'Submitted')),
                    essay_required INTEGER NOT NULL DEFAULT 0
                        CHECK (essay_required IN (0, 1)),
                    notes TEXT
                );

                CREATE TABLE IF NOT EXISTS essays (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    core_topic TEXT,
                    master_text TEXT NOT NULL,
                    word_count INTEGER NOT NULL DEFAULT 0,
                    file_path TEXT
                );

                CREATE TABLE IF NOT EXISTS essay_variants (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    essay_id INTEGER NOT NULL,
                    scholarship_id INTEGER NOT NULL,
                    tailored_prompt TEXT,
                    tailored_text TEXT NOT NULL,
                    word_count INTEGER NOT NULL DEFAULT 0,
                    target_word_limit INTEGER,
                    FOREIGN KEY (essay_id) REFERENCES essays(id) ON DELETE CASCADE,
                    FOREIGN KEY (scholarship_id) REFERENCES scholarships(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_scholarships_country ON scholarships(country);
                CREATE INDEX IF NOT EXISTS idx_scholarships_status ON scholarships(status);
                CREATE INDEX IF NOT EXISTS idx_scholarships_nomination ON scholarships(requires_hs_nomination);
                CREATE INDEX IF NOT EXISTS idx_variants_essay_id ON essay_variants(essay_id);
                CREATE INDEX IF NOT EXISTS idx_variants_scholarship_id ON essay_variants(scholarship_id);
                """
            )
            _ensure_schema_migrations(conn)
        return {"success": True, "message": "Database initialized", "db_path": str(DB_PATH)}
    except sqlite3.Error as exc:
        return {"success": False, "error": f"Database initialization failed: {exc}"}


def add_scholarship(data_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Insert a scholarship row.

    Required keys in data_dict: title, country, currency.
    """
    required_fields = ["title", "country", "currency"]
    missing = [field for field in required_fields if field not in data_dict]
    if missing:
        return {"success": False, "error": f"Missing required fields: {', '.join(missing)}"}

    country = data_dict.get("country")
    currency = data_dict.get("currency")
    status = data_dict.get("status", "Not Started")
    nomination_status = data_dict.get("nomination_status", "Not Requested")

    if country not in VALID_COUNTRIES:
        return {"success": False, "error": f"Invalid country: {country}"}
    if currency not in VALID_CURRENCIES:
        return {"success": False, "error": f"Invalid currency: {currency}"}
    if status not in VALID_SCHOLARSHIP_STATUSES:
        return {"success": False, "error": f"Invalid status: {status}"}
    if nomination_status not in VALID_NOMINATION_STATUSES:
        return {"success": False, "error": f"Invalid nomination_status: {nomination_status}"}

    try:
        with _get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO scholarships (
                    title, target_school, country, award_amount, currency, scholarship_min_gpa, is_eligible,
                    application_deadline, status, requires_hs_nomination,
                    nomination_deadline, nomination_status, essay_required, notes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    data_dict.get("title"),
                    data_dict.get("target_school"),
                    country,
                    data_dict.get("award_amount"),
                    currency,
                    data_dict.get("scholarship_min_gpa"),
                    (
                        int(bool(data_dict.get("is_eligible")))
                        if data_dict.get("is_eligible") is not None
                        else None
                    ),
                    data_dict.get("application_deadline"),
                    status,
                    int(bool(data_dict.get("requires_hs_nomination", False))),
                    data_dict.get("nomination_deadline"),
                    nomination_status,
                    int(bool(data_dict.get("essay_required", False))),
                    data_dict.get("notes"),
                ),
            )
            scholarship_id = cursor.lastrowid
            row = conn.execute(
                "SELECT * FROM scholarships WHERE id = ?",
                (scholarship_id,),
            ).fetchone()
        return {"success": True, "data": _row_to_dict(row)}
    except sqlite3.Error as exc:
        return {"success": False, "error": f"Failed to add scholarship: {exc}"}


def get_scholarships(
    country_filter: Optional[str] = None,
    status_filter: Optional[str] = None,
    nomination_only: bool = False,
) -> Dict[str, Any]:
    """Fetch scholarships with optional filters."""
    if country_filter and country_filter not in VALID_COUNTRIES:
        return {"success": False, "error": f"Invalid country_filter: {country_filter}"}
    if status_filter and status_filter not in VALID_SCHOLARSHIP_STATUSES:
        return {"success": False, "error": f"Invalid status_filter: {status_filter}"}

    query = "SELECT * FROM scholarships"
    conditions: List[str] = []
    params: List[Any] = []

    if country_filter:
        conditions.append("country = ?")
        params.append(country_filter)
    if status_filter:
        conditions.append("status = ?")
        params.append(status_filter)
    if nomination_only:
        conditions.append("requires_hs_nomination = 1")

    if conditions:
        query += " WHERE " + " AND ".join(conditions)

    query += " ORDER BY application_deadline ASC, id ASC"

    try:
        with _get_connection() as conn:
            rows = conn.execute(query, params).fetchall()
        return {"success": True, "data": _rows_to_dicts(rows)}
    except sqlite3.Error as exc:
        return {"success": False, "error": f"Failed to get scholarships: {exc}"}


def update_nomination_status(scholarship_id: int, new_status: str) -> Dict[str, Any]:
    """Update nomination_status for a scholarship."""
    if new_status not in VALID_NOMINATION_STATUSES:
        return {"success": False, "error": f"Invalid nomination status: {new_status}"}

    try:
        with _get_connection() as conn:
            cursor = conn.execute(
                """
                UPDATE scholarships
                SET nomination_status = ?
                WHERE id = ?
                """,
                (new_status, scholarship_id),
            )
            if cursor.rowcount == 0:
                return {"success": False, "error": f"Scholarship id {scholarship_id} not found"}

            row = conn.execute(
                "SELECT * FROM scholarships WHERE id = ?",
                (scholarship_id,),
            ).fetchone()
        return {"success": True, "data": _row_to_dict(row)}
    except sqlite3.Error as exc:
        return {"success": False, "error": f"Failed to update nomination status: {exc}"}


def add_essay(title: str, topic: str, text: str) -> Dict[str, Any]:
    """Insert a master essay entry."""
    if not title or not text:
        return {"success": False, "error": "Both title and text are required"}

    wc = _word_count(text)
    try:
        with _get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO essays (title, core_topic, master_text, word_count)
                VALUES (?, ?, ?, ?)
                """,
                (title, topic, text, wc),
            )
            essay_id = cursor.lastrowid
            row = conn.execute("SELECT * FROM essays WHERE id = ?", (essay_id,)).fetchone()
        return {"success": True, "data": _row_to_dict(row)}
    except sqlite3.Error as exc:
        return {"success": False, "error": f"Failed to add essay: {exc}"}


def link_essay_variant(
    essay_id: int,
    scholarship_id: int,
    prompt: str,
    text: str,
) -> Dict[str, Any]:
    """Create a tailored essay variant linked to an essay and scholarship."""
    if not text:
        return {"success": False, "error": "Variant text is required"}

    wc = _word_count(text)

    try:
        with _get_connection() as conn:
            essay_exists = conn.execute("SELECT 1 FROM essays WHERE id = ?", (essay_id,)).fetchone()
            if essay_exists is None:
                return {"success": False, "error": f"Essay id {essay_id} not found"}

            scholarship_exists = conn.execute(
                "SELECT 1 FROM scholarships WHERE id = ?",
                (scholarship_id,),
            ).fetchone()
            if scholarship_exists is None:
                return {"success": False, "error": f"Scholarship id {scholarship_id} not found"}

            cursor = conn.execute(
                """
                INSERT INTO essay_variants (
                    essay_id, scholarship_id, tailored_prompt, tailored_text, word_count, target_word_limit
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (essay_id, scholarship_id, prompt, text, wc, None),
            )
            variant_id = cursor.lastrowid
            row = conn.execute(
                "SELECT * FROM essay_variants WHERE id = ?",
                (variant_id,),
            ).fetchone()
        return {"success": True, "data": _row_to_dict(row)}
    except sqlite3.Error as exc:
        return {"success": False, "error": f"Failed to link essay variant: {exc}"}


if __name__ == "__main__":
    result = init_db()
    print(result)