"""Seed script for Scholarship Dashboard initial data.

This script:
1) Seeds/updates the student profile.
2) Seeds initial target-school scholarships.
3) Purges University of Toronto records and replaces them with George Brown College.
4) Recomputes GPA-based eligibility flags.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import database


STUDENT_MAJOR = "Construction Management"
STUDENT_GPA = 3.22
TARGET_INTAKE = "Fall 2027"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(database.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def _ensure_student_profile_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS student_profile (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            major TEXT NOT NULL,
            unweighted_gpa REAL NOT NULL,
            target_intake TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )


def _purge_university_of_toronto(conn: sqlite3.Connection) -> int:
    cursor = conn.execute(
        """
        DELETE FROM scholarships
        WHERE target_school LIKE ?
           OR title LIKE ?
           OR notes LIKE ?
        """,
        ("%University of Toronto%", "%University of Toronto%", "%University of Toronto%"),
    )
    return cursor.rowcount


def _ensure_scholarship_gpa_columns(conn: sqlite3.Connection) -> None:
    columns = conn.execute("PRAGMA table_info(scholarships)").fetchall()
    names = {row[1] for row in columns}
    if "scholarship_min_gpa" not in names:
        conn.execute("ALTER TABLE scholarships ADD COLUMN scholarship_min_gpa REAL")
    if "is_eligible" not in names:
        conn.execute("ALTER TABLE scholarships ADD COLUMN is_eligible INTEGER CHECK (is_eligible IN (0, 1))")


def _calculate_eligibility(student_gpa: float, scholarship_min_gpa: Optional[float]) -> Optional[int]:
    if scholarship_min_gpa is None:
        return None
    return int(student_gpa >= scholarship_min_gpa)


def _upsert_scholarship(seed: Dict[str, Any], student_gpa: float) -> Dict[str, Any]:
    title = seed["title"]
    target_school = seed["target_school"]
    scholarship_min_gpa = seed.get("scholarship_min_gpa")
    is_eligible = _calculate_eligibility(student_gpa, scholarship_min_gpa)

    with _connect() as conn:
        existing = conn.execute(
            """
            SELECT id FROM scholarships
            WHERE title = ? AND target_school = ?
            """,
            (title, target_school),
        ).fetchone()

        payload = {
            "title": title,
            "target_school": target_school,
            "country": seed["country"],
            "award_amount": seed.get("award_amount", 0.0),
            "currency": seed["currency"],
            "scholarship_min_gpa": scholarship_min_gpa,
            "is_eligible": is_eligible,
            "application_deadline": seed.get("application_deadline"),
            "status": seed.get("status", "Not Started"),
            "requires_hs_nomination": bool(seed.get("requires_hs_nomination", False)),
            "nomination_deadline": seed.get("nomination_deadline"),
            "nomination_status": seed.get("nomination_status", "Not Requested"),
            "essay_required": bool(seed.get("essay_required", True)),
            "notes": seed.get("notes", ""),
        }

        if existing is None:
            return database.add_scholarship(payload)

        conn.execute(
            """
            UPDATE scholarships
            SET
                country = ?,
                award_amount = ?,
                currency = ?,
                scholarship_min_gpa = ?,
                is_eligible = ?,
                application_deadline = ?,
                status = ?,
                requires_hs_nomination = ?,
                nomination_deadline = ?,
                nomination_status = ?,
                essay_required = ?,
                notes = ?
            WHERE id = ?
            """,
            (
                payload["country"],
                payload["award_amount"],
                payload["currency"],
                payload["scholarship_min_gpa"],
                payload["is_eligible"],
                payload["application_deadline"],
                payload["status"],
                int(payload["requires_hs_nomination"]),
                payload["nomination_deadline"],
                payload["nomination_status"],
                int(payload["essay_required"]),
                payload["notes"],
                existing["id"],
            ),
        )

        row = conn.execute("SELECT * FROM scholarships WHERE id = ?", (existing["id"],)).fetchone()
    return {"success": True, "data": dict(row)}


def _refresh_eligibility_flags(student_gpa: float) -> int:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, scholarship_min_gpa
            FROM scholarships
            """
        ).fetchall()

        updates = 0
        for row in rows:
            min_gpa = row["scholarship_min_gpa"]
            eligibility = _calculate_eligibility(student_gpa, min_gpa)
            conn.execute(
                "UPDATE scholarships SET is_eligible = ? WHERE id = ?",
                (eligibility, row["id"]),
            )
            updates += 1
    return updates


def seed_student_profile() -> Dict[str, Any]:
    """Insert or update the one-row student profile (id=1)."""
    init_result = database.init_db()
    if not init_result.get("success"):
        return {"success": False, "error": init_result.get("error", "DB init failed")}

    try:
        with _connect() as conn:
            _ensure_student_profile_table(conn)
            _ensure_scholarship_gpa_columns(conn)

            conn.execute(
                """
                INSERT INTO student_profile (id, major, unweighted_gpa, target_intake, updated_at)
                VALUES (1, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    major = excluded.major,
                    unweighted_gpa = excluded.unweighted_gpa,
                    target_intake = excluded.target_intake,
                    updated_at = excluded.updated_at
                """,
                (
                    STUDENT_MAJOR,
                    STUDENT_GPA,
                    TARGET_INTAKE,
                    datetime.now(timezone.utc).isoformat(timespec="seconds"),
                ),
            )

            row = conn.execute("SELECT * FROM student_profile WHERE id = 1").fetchone()

        return {"success": True, "data": dict(row)}
    except sqlite3.Error as exc:
        return {"success": False, "error": f"Failed to seed student profile: {exc}"}


def seed_initial_scholarships() -> Dict[str, Any]:
    """Seed target-school scholarships and purge University of Toronto records."""
    profile_result = seed_student_profile()
    if not profile_result.get("success"):
        return profile_result

    student_gpa = float(profile_result["data"]["unweighted_gpa"])

    try:
        with _connect() as conn:
            _ensure_scholarship_gpa_columns(conn)
            purged_count = _purge_university_of_toronto(conn)

        seeds: List[Dict[str, Any]] = [
            {
                "title": "Morgan State Institutional Merit",
                "target_school": "Morgan State University",
                "country": "US",
                "currency": "USD",
                "award_amount": 8000,
                "scholarship_min_gpa": 3.0,
                "notes": "Top Choice / HBCU | Major: Construction Management | Target Awards: Institutional Merit",
            },
            {
                "title": "Morgan State Departmental Construction Management Scholarship",
                "target_school": "Morgan State University",
                "country": "US",
                "currency": "USD",
                "award_amount": 3000,
                "scholarship_min_gpa": 3.0,
                "notes": "Major: Construction Management | Departmental award track",
            },
            {
                "title": "Kennesaw State Merit Scholarship",
                "target_school": "Kennesaw State University",
                "country": "US",
                "currency": "USD",
                "award_amount": 4000,
                "scholarship_min_gpa": 3.0,
                "notes": "In-State / Regional | Major: Construction Management",
            },
            {
                "title": "George Brown International Student Entrance Scholarship",
                "target_school": "George Brown College",
                "country": "Canada",
                "currency": "CAD",
                "award_amount": 5000,
                "scholarship_min_gpa": 3.0,
                "notes": (
                    "International / Toronto | Major: Honours Bachelor of Technology "
                    "(Construction Management) | Target Awards: International Student Entrance Scholarships"
                ),
            },
            {
                "title": "George Brown Angelo DelZotto School Award",
                "target_school": "George Brown College",
                "country": "Canada",
                "currency": "CAD",
                "award_amount": 3500,
                "scholarship_min_gpa": 3.0,
                "notes": (
                    "Major: Honours Bachelor of Technology (Construction Management) | "
                    "Target Awards: Angelo DelZotto School of Construction Management Awards"
                ),
            },
            {
                "title": "North Carolina A&T Merit Scholarship",
                "target_school": "North Carolina A&T State University",
                "country": "US",
                "currency": "USD",
                "award_amount": 6000,
                "scholarship_min_gpa": 3.0,
                "notes": "HBCU | Major: Construction Management",
            },
            {
                "title": "Florida A&M Merit Scholarship",
                "target_school": "Florida A&M University",
                "country": "US",
                "currency": "USD",
                "award_amount": 6000,
                "scholarship_min_gpa": 3.0,
                "notes": "HBCU | Major: Construction Management",
            },
            {
                "title": "Texas Southern Merit Scholarship",
                "target_school": "Texas Southern University",
                "country": "US",
                "currency": "USD",
                "award_amount": 5000,
                "scholarship_min_gpa": 2.8,
                "notes": "HBCU | Major: Construction Management",
            },
            {
                "title": "Wentworth Merit Scholarship",
                "target_school": "Wentworth Institute of Technology",
                "country": "US",
                "currency": "USD",
                "award_amount": 7000,
                "scholarship_min_gpa": 3.2,
                "notes": "Major: Construction Management",
            },
        ]

        failures: List[Dict[str, Any]] = []

        for item in seeds:
            result = _upsert_scholarship(item, student_gpa)
            if not result.get("success"):
                failures.append({"title": item["title"], "error": result.get("error")})
                continue

        # Recount based on current seed title/target combinations to provide deterministic stats.
        with _connect() as conn:
            seeded_rows = conn.execute(
                """
                SELECT title, target_school
                FROM scholarships
                WHERE (title, target_school) IN (
                    VALUES
                    ('Morgan State Institutional Merit', 'Morgan State University'),
                    ('Morgan State Departmental Construction Management Scholarship', 'Morgan State University'),
                    ('Kennesaw State Merit Scholarship', 'Kennesaw State University'),
                    ('George Brown International Student Entrance Scholarship', 'George Brown College'),
                    ('George Brown Angelo DelZotto School Award', 'George Brown College'),
                    ('North Carolina A&T Merit Scholarship', 'North Carolina A&T State University'),
                    ('Florida A&M Merit Scholarship', 'Florida A&M University'),
                    ('Texas Southern Merit Scholarship', 'Texas Southern University'),
                    ('Wentworth Merit Scholarship', 'Wentworth Institute of Technology')
                )
                """
            ).fetchall()
            seeded_count = len(seeded_rows)

        updates_applied = _refresh_eligibility_flags(student_gpa)

        return {
            "success": len(failures) == 0,
            "purged_university_of_toronto_records": purged_count,
            "seeded_records_present": seeded_count,
            "eligibility_rows_recomputed": updates_applied,
            "student_gpa": student_gpa,
            "failures": failures,
        }
    except sqlite3.Error as exc:
        return {"success": False, "error": f"Failed to seed scholarships: {exc}"}


if __name__ == "__main__":
    profile = seed_student_profile()
    print("seed_student_profile:", profile)

    scholarships = seed_initial_scholarships()
    print("seed_initial_scholarships:", scholarships)
