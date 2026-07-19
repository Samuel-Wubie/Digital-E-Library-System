# Deployment Guide — EGI Library System

Frontend → **Vercel** · Backend + PostgreSQL → **Railway**

The code is already prepared: the frontend reads the backend address from a
`VITE_API_URL` environment variable, and the backend connects to the database
through `DATABASE_URL` when it exists (falling back to your local `.env`).

---

## 0. Push the project to GitHub (once)

```
cd "C:\Users\HP\Desktop\librery system"
git add .
git commit -m "Prepare for deployment"
```

Create an empty repository on github.com, then:

```
git remote add origin https://github.com/YOUR-USERNAME/egi-library.git
git push -u origin main
```

> The new `.gitignore` keeps `back-end/.env` (your database password) out of
> the repository. If you committed it in the past, change that password.

---

## 1. Railway — database

1. Sign up at https://railway.app (log in with GitHub).
2. New Project → **Deploy PostgreSQL**. A database service appears.
3. Copy its **DATABASE_URL** (Variables tab → `DATABASE_URL`).

**Import your local data** into it. On your PC (adjust the URL):

```
pg_dump -U postgres -d library_db --no-owner --no-acl > library_dump.sql
psql "PASTE-RAILWAY-DATABASE_URL-HERE" < library_dump.sql
```

(`pg_dump`/`psql` come with your PostgreSQL installation. Alternatively use
pgAdmin's Backup/Restore against the Railway connection details.)

## 2. Railway — backend

1. In the same project: New → **GitHub Repo** → pick your repository.
2. Service Settings → **Root Directory** = `back-end`.
   Build/start are automatic (`npm install`, `npm start`).
3. Variables tab → add:
   - `DATABASE_URL` → click "Add Reference" and pick the Postgres service's
     DATABASE_URL (or paste it).
4. Settings → Networking → **Generate Domain**. Note the URL, e.g.
   `https://egi-library-backend.up.railway.app`.
5. Check the deploy logs: you should see
   `Server application successfully running on port ...` and
   `Connected to the Database`.

### 2b. Uploaded PDFs — attach a Volume (required)

Railway's disk is wiped on every redeploy, so files saved in
`back-end/uploades/` would vanish. Fix it once:

1. Right-click your backend service → **Attach Volume**.
   Set **Mount Path** to `/data/uploades`.
2. In the backend service's Variables, add:
   `UPLOAD_DIR` = `/data/uploades`
   (the server reads this and stores/serves all PDFs from the volume).
3. Redeploy. New uploads now survive restarts and redeploys.

Your EXISTING local PDFs also need to get up there once. Easiest path:
after everything is live, re-upload important documents through the app.
(Bulk copy is possible with `railway run` / `scp`-style tooling later.)

## 3. Vercel — frontend

1. Sign up at https://vercel.com (log in with GitHub).
2. Add New → Project → import your repository.
3. **Root Directory** = `front-end`. Framework preset: **Vite**
   (auto-detected; build `npm run build`, output `build`).
4. Environment Variables → add:
   - `VITE_API_URL` = your Railway backend URL
     (e.g. `https://egi-library-backend.up.railway.app` — no trailing slash)
5. Deploy. Your app is live at `https://your-project.vercel.app`.

## 4. Test

Open the Vercel URL, log in as admin, and run one full flow (submit a
request → accept → download). If the frontend can't reach the backend, the
usual cause is a wrong/missing `VITE_API_URL` — after changing it, redeploy
the frontend (Vercel → Deployments → Redeploy).

## Local development — nothing changes

`npm start` in front-end still talks to `http://localhost:5000`;
the backend still reads `back-end/.env`.
