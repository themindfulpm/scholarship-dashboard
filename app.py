from __future__ import annotations

from datetime import date
from typing import Dict, List, Optional

import pandas as pd
import streamlit as st

import database as db


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
            date_columns = ["application_deadline", "nomination_deadline"]
            for col in date_columns:
                if col in table_df.columns:
                    table_df[col] = table_df[col].fillna("")

            styled = _highlight_urgent_nomination_rows(table_df)
            st.dataframe(styled, width="stretch", hide_index=True)
            st.caption("Rows in red indicate HS nomination deadlines within 30 days.")

        with st.form("add_scholarship_form", clear_on_submit=True):
            st.markdown("### Add Scholarship")
            c1, c2 = st.columns(2)
            with c1:
                title = st.text_input("Scholarship Title *")
                target_school = st.text_input("Target School")
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
