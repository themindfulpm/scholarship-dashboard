# Deployment Package: Streamlit Cloud + Render

This project is now configured for deployment with either Streamlit Community Cloud or Render.

## Included files

- `streamlit_app.py` -> deployment entrypoint
- `requirements.txt` -> Python dependencies
- `runtime.txt` -> Python runtime for Streamlit Cloud
- `render.yaml` -> Render Blueprint config

## Option A: Streamlit Community Cloud

1. Push this repo to GitHub.
2. Go to Streamlit Community Cloud and click **New app**.
3. Select repository + branch.
4. Set **Main file path** to `streamlit_app.py`.
5. Deploy.

If your app needs a pre-seeded DB, run locally first:

```bash
python seed_data.py
```

Then commit `database.db` if you want that initial state in the deployment image.

## Option B: Render (Blueprint)

1. Push this repo to GitHub.
2. In Render, choose **New +** -> **Blueprint**.
3. Connect repository and select this project.
4. Render detects `render.yaml` and creates the service automatically.

Manual settings if needed:

- Build command: `pip install -r requirements.txt`
- Start command: `streamlit run streamlit_app.py --server.address 0.0.0.0 --server.port $PORT --server.headless true`

## Data persistence note (important)

This app uses `database.db` (SQLite). On cloud hosts, local file storage may reset after redeploy/restart unless persistent disk is configured.

Recommended for production:

- Move from SQLite to a managed database (Postgres/Supabase), or
- Configure persistent disk on host and point DB path there.

## Local smoke test before deploy

```bash
python -m streamlit run streamlit_app.py
```
