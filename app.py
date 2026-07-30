from __future__ import annotations

from datetime import date
from typing import Dict, List, Optional
from urllib.parse import urlparse

import pandas as pd
import streamlit as st

import database as db
import scraper
from seed_data import backfill_seed_application_urls, seed_initial_scholarships
from source_config import (
    AUTO_PULL_COUNTRIES,
    AUTO_PULL_CRITERIA,
    DEFAULT_AUTO_PULL_KEYWORDS,
    PUBLIC_SEARCH_CRITERIA,
    PUBLIC_SOURCE_CATALOG,
    SOURCE_CATALOG,
)


STATUS_OPTIONS = ["Not Started", "In Progress", "Submitted", "Awarded", "Rejected"]
NOMINATION_STATUS_OPTIONS = ["Not Requested", "Requested", "Approved", "Submitted"]
ELIGIBILITY_FILTER_OPTIONS = ["All", "Eligible", "Not Eligible", "Unknown"]


def _parse_date(value: Optional[str]) -> pd.Timestamp:
    if not value:
        return pd.NaT
    return pd.to_datetime(value, errors="coerce")


def _to_dataframe(records: List[Dict]) -> pd.DataFrame:
    if not records:
        return pd.DataFrame()
    df = pd.DataFrame(records)
    if "requires_hs_nomination" in df.columns:
        df["requires_hs_nomination"] = df["requires_hs_nomination"].astype(bool)
    if "essay_required" in df.columns:
        df["essay_required"] = df["essay_required"].astype(bool)
    return df


def _eligibility_label(value: object) -> str:
    if pd.isna(value):
        return "Unknown"
    try:
        return "Eligible" if int(value) == 1 else "Not Eligible"
    except (TypeError, ValueError):
        return "Unknown"


def _apply_eligibility_filter(df: pd.DataFrame, selection: str) -> pd.DataFrame:
    if df.empty or selection == "All" or "is_eligible" not in df.columns:
        return df
    labels = df["is_eligible"].apply(_eligibility_label)
    return df[labels == selection].copy()


def _compute_metrics(df: pd.DataFrame) -> Dict[str, str]:
    usd_total = 0.0
    cad_total = 0.0
    pending_nominations = 0
    next_deadline_label = "No deadlines"

    if df.empty:
        return {
            "totals": "USD $0 | CAD $0",
            "pending": "0",
            "next_deadline": next_deadline_label,
        }

    money_df = df.copy()
    money_df["award_amount"] = pd.to_numeric(money_df.get("award_amount"), errors="coerce").fillna(0)
    usd_total = float(money_df.loc[money_df["currency"] == "USD", "award_amount"].sum())
    cad_total = float(money_df.loc[money_df["currency"] == "CAD", "award_amount"].sum())

    nomination_mask = (
        money_df["requires_hs_nomination"].astype(bool)
        & (money_df["nomination_status"].fillna("Not Requested") != "Approved")
    )
    pending_nominations = int(nomination_mask.sum())

    deadline_candidates = []
    for _, row in money_df.iterrows():
        app_deadline = _parse_date(row.get("application_deadline"))
        nom_deadline = _parse_date(row.get("nomination_deadline"))
        if pd.notna(app_deadline):
            deadline_candidates.append((app_deadline, row.get("title", "Scholarship"), "Application"))
        if pd.notna(nom_deadline):
            deadline_candidates.append((nom_deadline, row.get("title", "Scholarship"), "Nomination"))

    if deadline_candidates:
        soonest = min(deadline_candidates, key=lambda item: item[0])
        next_deadline_label = f"{soonest[1]} ({soonest[2]}): {soonest[0].date()}"

    return {
        "totals": f"USD ${usd_total:,.0f} | CAD ${cad_total:,.0f}",
        "pending": str(pending_nominations),
        "next_deadline": next_deadline_label,
    }


def _highlight_urgent_nomination_rows(dataframe: pd.DataFrame) -> pd.io.formats.style.Styler:
    today = pd.Timestamp.today().normalize()

    def apply_row_style(row: pd.Series) -> List[str]:
        nom_deadline = _parse_date(row.get("nomination_deadline"))
        requires_nom = bool(row.get("requires_hs_nomination", False))
        if requires_nom and pd.notna(nom_deadline):
            days_left = (nom_deadline.normalize() - today).days
            if 0 <= days_left <= 30:
                return ["background-color: #ffd6d6; color: #8b0000; font-weight: 600"] * len(row)
        return [""] * len(row)

    return dataframe.style.apply(apply_row_style, axis=1)


def _draft_title_from_url(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc.replace("www.", "")
    if not host:
        return "Scraped Scholarship Opportunity"
    return f"{host} scholarship opportunity"


def _link_display_df(df: pd.DataFrame) -> pd.DataFrame:
    display_df = df.copy()
    if "application_url" in display_df.columns:
        display_df["application_url"] = display_df["application_url"].fillna("")
    return display_df


def main() -> None:
    st.set_page_config(
        page_title="Fall 2027 Scholarship & Application Engine (US & Canada)",
        layout="wide",
    )
    st.title("Fall 2027 Scholarship & Application Engine (US & Canada)")

    init_result = db.init_db()
    if not init_result.get("success"):
        st.error(f"Database initialization error: {init_result.get('error')}")
        st.stop()

    backfill_result = db.backfill_application_urls()
    if not backfill_result.get("success"):
        st.warning(
            f"Apply link backfill warning: {backfill_result.get('error', 'Unable to backfill application links.')}"
        )

    seed_link_backfill = backfill_seed_application_urls()
    if not seed_link_backfill.get("success"):
        st.warning(
            f"Seed apply link backfill warning: {seed_link_backfill.get('error', 'Unable to backfill seed links.')}"
        )

    if not st.session_state.get("startup_seed_checked"):
        st.session_state["startup_seed_checked"] = True
        scholarship_check = db.has_scholarships()
        needs_seed = (not scholarship_check.get("success")) or (not scholarship_check.get("data"))
        if needs_seed:
            seed_result = seed_initial_scholarships()
            if not seed_result.get("success"):
                seed_retry_result = seed_initial_scholarships()
                if seed_retry_result.get("success"):
                    st.toast("Seeded target schools and scholarships.")
                else:
                    st.warning("Startup seed warning: unable to seed scholarships.")
                    with st.expander("Startup seed details"):
                        st.write({
                            "first_attempt": seed_result,
                            "second_attempt": seed_retry_result,
                            "scholarship_check": scholarship_check,
                        })
            else:
                st.toast("Seeded target schools and scholarships.")

    st.sidebar.header("Filters")
    country_filter = st.sidebar.selectbox("Filter by Country", ["All", "US", "Canada"])
    status_filter = st.sidebar.selectbox(
        "Filter by Status",
        ["All", "Not Started", "In Progress", "Submitted"],
    )
    nomination_only = st.sidebar.checkbox("Show High School Nomination Required Only", value=False)
    eligibility_filter = st.sidebar.selectbox("Filter by Eligibility", ELIGIBILITY_FILTER_OPTIONS)

    scholarship_result = db.get_scholarships(
        country_filter=None if country_filter == "All" else country_filter,
        status_filter=None if status_filter == "All" else status_filter,
        nomination_only=nomination_only,
    )
    if not scholarship_result.get("success"):
        st.error(scholarship_result.get("error", "Unable to load scholarships"))
        st.stop()

    scholarships_df = _to_dataframe(scholarship_result.get("data", []))
    scholarships_df = _apply_eligibility_filter(scholarships_df, eligibility_filter)

    metrics = _compute_metrics(scholarships_df)
    m1, m2, m3 = st.columns(3)
    m1.metric("Total Potential Value (USD/CAD)", metrics["totals"])
    m2.metric("Pending HS Nominations", metrics["pending"])
    m3.metric("Next Approaching Target Deadline", metrics["next_deadline"])

    tab1, tab2, tab3 = st.tabs(
        [
            "Scholarship & Nomination Tracker",
            "US vs Canada Checklist",
            "Essay Bank & Prompt Adapter",
        ]
    )

    with tab1:
        st.subheader("Scholarship & Nomination Tracker")
        if scholarships_df.empty:
            st.info("No scholarships yet. Add your first one using the form below.")
        else:
            table_df = scholarships_df.copy()
            if "is_eligible" in table_df.columns:
                table_df["eligibility"] = table_df["is_eligible"].apply(_eligibility_label)
            table_df = _link_display_df(table_df)
            date_columns = ["application_deadline", "nomination_deadline"]
            for col in date_columns:
                if col in table_df.columns:
                    table_df[col] = table_df[col].fillna("")

            styled = _highlight_urgent_nomination_rows(table_df)
            st.dataframe(
                styled,
                width="stretch",
                hide_index=True,
                column_config={
                    "application_url": st.column_config.LinkColumn(
                        "Apply link",
                        display_text="Open application",
                    )
                },
            )
            st.caption("Rows in red indicate HS nomination deadlines within 30 days.")

        st.markdown("### Pull scholarship info from a school page or RSS")
        with st.form("scrape_scholarship_form", clear_on_submit=False):
            scrape_url = st.text_input("Scholarship page or RSS URL")
            scrape_country = st.selectbox("Source country", ["US", "Canada"], key="scrape_country")
            scrape_submit = st.form_submit_button("Analyze source")

        if scrape_submit and scrape_url.strip():
            scrape_result = scraper.scrape_scholarship_page(scrape_url.strip(), scrape_country)
            st.session_state["latest_scrape_result"] = scrape_result
            st.session_state["latest_scrape_url"] = scrape_url.strip()

        latest_scrape = st.session_state.get("latest_scrape_result")
        latest_scrape_url = st.session_state.get("latest_scrape_url", "")
        if latest_scrape:
            if latest_scrape.get("success"):
                st.success("Source analyzed successfully.")
                st.write(
                    {
                        "source_type": latest_scrape.get("source_type"),
                        "requires_hs_nomination": latest_scrape.get("requires_hs_nomination"),
                        "indicator_hits": latest_scrape.get("indicator_hits"),
                        "auto_nomination_hits": latest_scrape.get("auto_nomination_hits"),
                    }
                )
                if latest_scrape.get("matched_excerpt"):
                    st.caption(f"Matched excerpt: {latest_scrape['matched_excerpt']}")

                if st.button("Add as draft scholarship", key="add_scraped_draft"):
                    notes = (
                        f"Imported from source: {latest_scrape_url}\n"
                        f"Indicator hits: {', '.join(latest_scrape.get('indicator_hits', [])) or 'none'}\n"
                        f"Auto nomination hits: {', '.join(latest_scrape.get('auto_nomination_hits', [])) or 'none'}\n"
                        f"Excerpt: {latest_scrape.get('matched_excerpt', '')}"
                    )
                    payload = {
                        "title": latest_scrape.get("page_title") or _draft_title_from_url(latest_scrape_url),
                        "target_school": latest_scrape.get("page_title") or "Public scholarship",
                        "country": latest_scrape.get("country", "US"),
                        "award_amount": 0,
                        "currency": "CAD" if latest_scrape.get("country") == "Canada" else "USD",
                        "status": "Not Started",
                        "requires_hs_nomination": bool(latest_scrape.get("requires_hs_nomination", False)),
                        "nomination_status": "Not Requested",
                        "essay_required": True,
                        "application_url": latest_scrape.get("application_url", latest_scrape_url),
                        "notes": notes,
                    }
                    add_result = db.add_scholarship(payload)
                    if add_result.get("success"):
                        st.success("Draft scholarship added to tracker.")
                        st.rerun()
                    else:
                        st.error(add_result.get("error", "Could not add scraped draft."))
            else:
                st.error(latest_scrape.get("error", "Unable to analyze source URL."))

        st.markdown("### Automatic pull (rules-based, no AI)")
        configured_keywords = st.multiselect(
            "Match keywords",
            DEFAULT_AUTO_PULL_KEYWORDS,
            default=AUTO_PULL_CRITERIA["required_keywords"],
            key="auto_keywords",
        )
        configured_countries = st.multiselect(
            "Countries to scan",
            ["US", "Canada"],
            default=AUTO_PULL_COUNTRIES,
            key="auto_countries",
        )
        auto_save_matches = st.checkbox("Auto-save matches to tracker", value=True, key="auto_save_matches")

        if st.button("Run automatic scan", key="run_auto_scan"):
            scan_result = scraper.scan_scholarship_sources(
                sources=SOURCE_CATALOG,
                required_keywords=configured_keywords,
                country_filter=configured_countries,
            )
            st.session_state["latest_auto_scan"] = scan_result

            if scan_result.get("success") and auto_save_matches:
                inserted = 0
                updated = 0
                save_failures = []
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
                        application_url=match.get("application_url", match["url"]),
                        title=match.get("page_title", ""),
                        target_school=match.get("page_title", "") or match["school"],
                        notes=notes,
                    )
                    if not upsert_result.get("success"):
                        save_failures.append(
                            {
                                "school": match["school"],
                                "error": upsert_result.get("error", "Unknown upsert error"),
                            }
                        )
                        continue

                    if upsert_result.get("action") == "inserted":
                        inserted += 1
                    else:
                        updated += 1

                st.session_state["latest_auto_save_stats"] = {
                    "inserted": inserted,
                    "updated": updated,
                    "failures": save_failures,
                }
                st.rerun()

        latest_auto_scan = st.session_state.get("latest_auto_scan")
        if latest_auto_scan:
            if latest_auto_scan.get("success"):
                st.success(
                    f"Scanned {latest_auto_scan.get('scanned_count', 0)} sources; "
                    f"matched {latest_auto_scan.get('matched_count', 0)} opportunities."
                )
                match_rows = latest_auto_scan.get("matches", [])
                if match_rows:
                    display_rows = []
                    for item in match_rows:
                        display_rows.append(
                            {
                                "school": item.get("school"),
                                "country": item.get("country"),
                                "requires_hs_nomination": item.get("requires_hs_nomination"),
                                "matched_keywords": ", ".join(item.get("matched_required_keywords", [])) or "(none)",
                                "source_type": item.get("source_type"),
                                "url": item.get("url"),
                                "application_url": item.get("application_url", item.get("url")),
                            }
                        )
                    st.dataframe(
                        pd.DataFrame(display_rows),
                        width="stretch",
                        hide_index=True,
                        column_config={
                            "application_url": st.column_config.LinkColumn(
                                "Apply link",
                                display_text="Open application",
                            )
                        },
                    )

                failures = latest_auto_scan.get("failures", [])
                if failures:
                    with st.expander("Scan failures"):
                        failure_rows = []
                        for failure in failures:
                            attempts = failure.get("attempts", [])
                            attempts_text = " | ".join(
                                f"{a.get('url', '')} => {a.get('error', '')}" for a in attempts
                            )
                            failure_rows.append(
                                {
                                    "school": failure.get("school"),
                                    "url": failure.get("url"),
                                    "error": failure.get("error"),
                                    "attempts": attempts_text,
                                }
                            )
                        st.dataframe(pd.DataFrame(failure_rows), width="stretch", hide_index=True)

                skipped_sources = latest_auto_scan.get("skipped_sources", [])
                if skipped_sources:
                    with st.expander("Skipped sources"):
                        st.dataframe(pd.DataFrame(skipped_sources), width="stretch", hide_index=True)

                save_stats = st.session_state.get("latest_auto_save_stats")
                if save_stats:
                    st.caption(
                        f"Auto-save results: inserted {save_stats['inserted']}, "
                        f"updated {save_stats['updated']}, failures {len(save_stats['failures'])}."
                    )
                    if save_stats["failures"]:
                        with st.expander("Auto-save failures"):
                            st.dataframe(pd.DataFrame(save_stats["failures"]), width="stretch", hide_index=True)
            else:
                st.error("Automatic scan failed.")

        st.markdown("### Public scholarship search (not university-specific)")
        public_keywords = st.multiselect(
            "Public scholarship keywords",
            PUBLIC_SEARCH_CRITERIA["public_keywords"]
            + PUBLIC_SEARCH_CRITERIA["major_keywords"]
            + PUBLIC_SEARCH_CRITERIA["audience_keywords"],
            default=PUBLIC_SEARCH_CRITERIA["public_keywords"]
            + PUBLIC_SEARCH_CRITERIA["major_keywords"]
            + ["black", "african american", "black male", "male", "diversity", "minority"],
            key="public_keywords",
        )
        public_countries = st.multiselect(
            "Public scholarship countries",
            ["US", "Canada"],
            default=PUBLIC_SEARCH_CRITERIA["countries"],
            key="public_countries",
        )
        include_black_male = st.checkbox(
            "Include Black male / Black student focused criteria",
            value=True,
            key="include_black_male",
        )
        include_major_related = st.checkbox(
            "Include construction-management related criteria",
            value=True,
            key="include_major_related",
        )
        public_auto_save = st.checkbox("Auto-save public matches to tracker", value=True, key="public_auto_save")

        if st.button("Run public scholarship scan", key="run_public_scan"):
            final_public_keywords = list(public_keywords)
            if include_black_male:
                final_public_keywords.extend([
                    "black",
                    "african american",
                    "black male",
                    "male",
                    "men",
                    "diversity",
                    "minority",
                    "underrepresented",
                    "bipoc",
                ])
            if include_major_related:
                final_public_keywords.extend([
                    "construction management",
                    "construction",
                    "building science",
                    "civil engineering",
                    "project management",
                    "architecture",
                    "engineer",
                ])

            public_scan_result = scraper.scan_scholarship_sources(
                sources=PUBLIC_SOURCE_CATALOG,
                required_keywords=final_public_keywords,
                country_filter=public_countries,
            )
            st.session_state["latest_public_scan"] = public_scan_result

            if public_scan_result.get("success") and public_auto_save:
                inserted = 0
                updated = 0
                save_failures = []
                for match in public_scan_result.get("matches", []):
                    notes = (
                        f"Public source scan\n"
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
                        application_url=match.get("application_url", match["url"]),
                        title=match.get("page_title", "") or match.get("school", "Public scholarship"),
                        target_school="Public scholarship",
                        notes=notes,
                    )
                    if not upsert_result.get("success"):
                        save_failures.append(
                            {
                                "school": match["school"],
                                "error": upsert_result.get("error", "Unknown upsert error"),
                            }
                        )
                        continue

                    if upsert_result.get("action") == "inserted":
                        inserted += 1
                    else:
                        updated += 1

                st.session_state["latest_public_save_stats"] = {
                    "inserted": inserted,
                    "updated": updated,
                    "failures": save_failures,
                }
                st.rerun()

        latest_public_scan = st.session_state.get("latest_public_scan")
        if latest_public_scan:
            if latest_public_scan.get("success"):
                st.success(
                    f"Scanned {latest_public_scan.get('scanned_count', 0)} public sources; "
                    f"matched {latest_public_scan.get('matched_count', 0)} opportunities."
                )
                public_rows = []
                for item in latest_public_scan.get("matches", []):
                    public_rows.append(
                        {
                            "source": item.get("school"),
                            "country": item.get("country"),
                            "requires_hs_nomination": item.get("requires_hs_nomination"),
                            "matched_keywords": ", ".join(item.get("matched_required_keywords", [])) or "(none)",
                            "page_title": item.get("page_title", ""),
                            "application_url": item.get("application_url", item.get("url")),
                        }
                    )
                if public_rows:
                    st.dataframe(
                        pd.DataFrame(public_rows),
                        width="stretch",
                        hide_index=True,
                        column_config={
                            "application_url": st.column_config.LinkColumn(
                                "Apply link",
                                display_text="Open application",
                            )
                        },
                    )

                public_failures = latest_public_scan.get("failures", [])
                if public_failures:
                    with st.expander("Public scan failures"):
                        public_failure_rows = []
                        for failure in public_failures:
                            attempts = failure.get("attempts", [])
                            attempts_text = " | ".join(
                                f"{a.get('url', '')} => {a.get('error', '')}" for a in attempts
                            )
                            public_failure_rows.append(
                                {
                                    "source": failure.get("school"),
                                    "url": failure.get("url"),
                                    "error": failure.get("error"),
                                    "attempts": attempts_text,
                                }
                            )
                        st.dataframe(pd.DataFrame(public_failure_rows), width="stretch", hide_index=True)

                public_skipped = latest_public_scan.get("skipped_sources", [])
                if public_skipped:
                    with st.expander("Skipped public sources"):
                        st.dataframe(pd.DataFrame(public_skipped), width="stretch", hide_index=True)

                public_save_stats = st.session_state.get("latest_public_save_stats")
                if public_save_stats:
                    st.caption(
                        f"Public auto-save: inserted {public_save_stats['inserted']}, "
                        f"updated {public_save_stats['updated']}, failures {len(public_save_stats['failures'])}."
                    )
                    if public_save_stats["failures"]:
                        with st.expander("Public auto-save failures"):
                            st.dataframe(pd.DataFrame(public_save_stats["failures"]), width="stretch", hide_index=True)
            else:
                st.error("Public scholarship scan failed.")

        with st.form("add_scholarship_form", clear_on_submit=True):
            st.markdown("### Add Scholarship")
            c1, c2 = st.columns(2)
            with c1:
                title = st.text_input("Scholarship Title *")
                target_school = st.text_input("Target School")
                application_url = st.text_input("Application Link")
                country = st.radio("Country *", ["US", "Canada"], horizontal=True)
                currency = st.radio("Currency *", ["USD", "CAD"], horizontal=True)
                award_amount = st.number_input("Award Amount", min_value=0.0, step=500.0)
                app_deadline = st.date_input("Application Deadline", value=None)
            with c2:
                status = st.selectbox("Application Status", STATUS_OPTIONS, index=0)
                requires_nomination = st.checkbox("Requires High School Nomination", value=False)
                nomination_deadline = st.date_input(
                    "Nomination Deadline",
                    value=None,
                    disabled=not requires_nomination,
                    help="Use if the scholarship requires school endorsement or counselor nomination.",
                )
                nomination_status = st.selectbox("Nomination Status", NOMINATION_STATUS_OPTIONS, index=0)
                essay_required = st.checkbox("Essay Required", value=True)
                notes = st.text_area("Notes")

            submitted = st.form_submit_button("Add Scholarship")
            if submitted:
                app_deadline_str = app_deadline.isoformat() if isinstance(app_deadline, date) else None
                nom_deadline_str = (
                    nomination_deadline.isoformat()
                    if requires_nomination and isinstance(nomination_deadline, date)
                    else None
                )
                payload = {
                    "title": title,
                    "target_school": target_school,
                    "country": country,
                    "award_amount": award_amount,
                    "currency": currency,
                    "application_url": application_url,
                    "application_deadline": app_deadline_str,
                    "status": status,
                    "requires_hs_nomination": requires_nomination,
                    "nomination_deadline": nom_deadline_str,
                    "nomination_status": nomination_status,
                    "essay_required": essay_required,
                    "notes": notes,
                }
                result = db.add_scholarship(payload)
                if result.get("success"):
                    st.success("Scholarship added successfully.")
                    st.rerun()
                else:
                    st.error(result.get("error", "Failed to add scholarship."))

    with tab2:
        st.subheader("US vs Canada Checklist")
        st.info(
            "\n".join(
                [
                    "US Strategy:",
                    "- Complete FAFSA as early as possible once available.",
                    "- Prepare CSS Profile for schools that require it.",
                    "- Track each university's merit scholarship GPA/test cutoffs and priority deadlines.",
                    "",
                    "Canada Strategy:",
                    "- Track OUAC program codes and application windows.",
                    "- Monitor international entrance awards by institution and faculty.",
                    "- Confirm institution-specific nomination rules early and align counselor submissions with internal school timelines.",
                ]
            )
        )

    with tab3:
        st.subheader("Essay Bank & Prompt Adapter")

        left, right = st.columns(2)

        with left:
            with st.form("add_essay_form", clear_on_submit=True):
                st.markdown("### Add Master Essay")
                essay_title = st.text_input("Essay Title *")
                essay_topic = st.text_input("Core Topic")
                essay_text = st.text_area("Master Text *", height=200)
                add_essay_submitted = st.form_submit_button("Save Essay")
                if add_essay_submitted:
                    result = db.add_essay(essay_title, essay_topic, essay_text)
                    if result.get("success"):
                        st.success("Essay saved.")
                        st.rerun()
                    else:
                        st.error(result.get("error", "Failed to save essay."))

        essays_result = db.get_essays()
        all_essays = essays_result.get("data", []) if essays_result.get("success") else []
        scholarships_all_result = db.get_scholarships()
        all_scholarships = scholarships_all_result.get("data", []) if scholarships_all_result.get("success") else []

        with right:
            st.markdown("### Create Tailored Variant")
            if not all_essays or not all_scholarships:
                st.warning("Add at least one essay and one scholarship to create variants.")
            else:
                essay_options = {f"{item['id']} - {item['title']}": item["id"] for item in all_essays}
                scholarship_options = {
                    f"{item['id']} - {item['title']}": item["id"] for item in all_scholarships
                }
                with st.form("variant_form", clear_on_submit=True):
                    selected_essay_key = st.selectbox("Master Essay", list(essay_options.keys()))
                    selected_scholarship_key = st.selectbox(
                        "Scholarship",
                        list(scholarship_options.keys()),
                    )
                    prompt = st.text_area("Tailored Prompt")
                    variant_text = st.text_area("Tailored Text *", height=180)
                    target_word_limit = st.number_input(
                        "Target Word Limit",
                        min_value=0,
                        step=25,
                        value=0,
                    )
                    variant_submit = st.form_submit_button("Link Variant")
                    if variant_submit:
                        result = db.link_essay_variant(
                            essay_id=essay_options[selected_essay_key],
                            scholarship_id=scholarship_options[selected_scholarship_key],
                            prompt=prompt,
                            text=variant_text,
                        )
                        if result.get("success"):
                            if target_word_limit > 0:
                                db.set_variant_target_word_limit(
                                    result["data"]["id"],
                                    int(target_word_limit),
                                )
                            st.success("Variant linked successfully.")
                            st.rerun()
                        else:
                            st.error(result.get("error", "Failed to link variant."))

        st.markdown("### Essay Bank")
        if essays_result.get("success"):
            essays_df = _to_dataframe(all_essays)
            if essays_df.empty:
                st.caption("No essays in bank yet.")
            else:
                st.dataframe(
                    essays_df[["id", "title", "core_topic", "word_count", "file_path"]],
                    width="stretch",
                    hide_index=True,
                )
        else:
            st.error(essays_result.get("error", "Failed to load essays."))

        variants_result = db.get_essay_variants()
        st.markdown("### Prompt-Adapted Variants")
        if variants_result.get("success"):
            variants_df = _to_dataframe(variants_result.get("data", []))
            if variants_df.empty:
                st.caption("No variants yet.")
            else:
                st.dataframe(
                    variants_df[
                        [
                            "id",
                            "essay_title",
                            "scholarship_title",
                            "word_count",
                            "target_word_limit",
                            "tailored_prompt",
                        ]
                    ],
                    width="stretch",
                    hide_index=True,
                )
        else:
            st.error(variants_result.get("error", "Failed to load variants."))


if __name__ == "__main__":
    main()
