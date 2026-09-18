# Deployment Guide — EGI Library System

Frontend → **Vercel** · Backend → **Render** · PostgreSQL → **Supabase**

The code is already prepared: the frontend reads the backend address from a
`VITE_API_URL` environment variable, the backend connects through
`DATABASE_URL` when it exists (falling back to your local `.env`), and
uploaded files are stored under `UPLOAD_DIR`.

**Plan for this deployment:** Render **Starter** (paid, ~$7/month) for the
backend, Supabase **Free** for the database, Vercel **Free** for the
frontend. Render's free tier has no persistent disk and sleeps after 15
minutes idle, which would delete every uploaded PDF and make the first
request take a minute — the Starter tier fixes both and needs no code
changes.

---

## 0. Clean up the repository (do this first)

The repo currently has ~2.7 GB of duplicate test PDFs staged. GitHub will
reject the push. From `C:\Users\HP\Desktop\librery system`:

```
git rm -r --cached db back-end/uploades library_dump.sql "back-end/New RTF Text.rtf"
git add .gitignore
git commit -m "Stop tracking bulk content and DB dumps"
git count-objects -vH
```

If `size-pack` comes back in the gigabytes, those files are already in
history and untracking them now won't shrink the push. Start clean instead:
delete the `.git` folder, then `git init` with the new `.gitignore` already
in place.

Then create an empty repository on github.com and:

```
git remote add origin https://github.com/YOUR-USERNAME/egi-library.git
git branch -M main
git push -u origin main
```

> `.gitignore` keeps `back-end/.env` out of the repository. It was never
> committed — only `.env.example` is tracked. Good.

---

## 1. Supabase — database

1. Sign up at https://supabase.com and create a new project. Save the
   database password it shows you; it appears only once.
2. Wait for the project to finish provisioning (~2 minutes).

### 1a. Get the right connection string

Project Settings → Database → Connection string. **Use the "Session pooler"
string, not the direct connection.**

The direct connection (`db.<ref>.supabase.co:5432`) is IPv6-only on the free
plan and Render cannot reach it. The session pooler is IPv4 on every plan
and is the one intended for long-running servers like ours:

```
postgresql://postgres.<PROJECT-REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres
```

Do not use the transaction pooler on port 6543 — it's for serverless
functions and doesn't support prepared statements.

### 1b. Import your local data

On your PC:

```
migrate-db.bat
```

and paste the session pooler string when it asks. (Or run `pg_dump` and
`psql` by hand — see the script for the exact commands.)

### 1c. Lock down the REST API — don't skip this

Supabase automatically exposes every table in the `public` schema through a
REST API, and tables imported with `psql` arrive with Row Level Security
**disabled** and default grants to the `anon` role. That means anyone
holding your project's anon key — which is public by design — could read
your `users` table, password hashes included.

Your backend connects as `postgres`, which bypasses RLS, so turning it on
breaks nothing. In the Supabase SQL editor:

```sql
alter table users              enable row level security;
alter table books              enable row level security;
alter table approval_requests  enable row level security;
alter table payments           enable row level security;
alter table audit_logs         enable row level security;
alter table notifications      enable row level security;
alter table system_settings    enable row level security;
```

No policies means deny-all, which is exactly right here — only the Express
backend touches this database.

Afterwards, check Database → Advisors. It should report no "RLS disabled in
public" warnings.

---

## 2. Render — backend

1. Sign up at https://render.com (log in with GitHub).
2. New → **Web Service** → connect your repository.
3. Settings:
   - **Root Directory** = `back-end`
   - **Build Command** = `npm install`
   - **Start Command** = `npm start`
   - **Instance Type** = **Starter** (not Free — see the note at the top)
4. Environment → add:
   - `DATABASE_URL` = the Supabase **session pooler** string from step 1a
   - `UPLOAD_DIR` = `/data/uploades`
5. Deploy. Render sets `PORT` itself and `server.js` already reads it.

### 2a. Attach a disk for uploaded PDFs

Render's filesystem is wiped on every deploy and every restart, so files in
`back-end/uploades/` would vanish. On the service:

1. Disks → **Add Disk**
2. **Mount Path** = `/data/uploades` (must match `UPLOAD_DIR` above)
3. **Size** = 1 GB is plenty to start

Redeploy. Uploads now survive restarts.

Your existing local PDFs aren't copied up automatically — re-upload the ones
you actually need through the app once everything is live. Most of what's in
`back-end/uploades` now is test data.

### 2b. Check the logs

You should see:

```
DATABASE_URL seen by app: postgresql://postgres.xxxx:****@aws-0-....pooler.supabase.com:5432/postgres
Server application successfully running on port 10000
Connected to the Database
Connected to PostgreSQL at: ...
```

If `DATABASE_URL` prints `NOT SET`, the variable didn't reach the process —
that's a Render settings problem, not a code problem.

Copy the service URL, e.g. `https://egi-library-backend.onrender.com`.

---

## 3. Vercel — frontend

1. Sign up at https://vercel.com (log in with GitHub).
2. Add New → Project → import your repository.
3. **Root Directory** = `front-end`. Framework preset: **Vite**
   (auto-detected; build `npm run build`, output **`dist`**).
4. Environment Variables → add:
   - `VITE_API_URL` = your Render backend URL, no trailing slash
5. Deploy. Your app is live at `https://your-project.vercel.app`.

---

## 4. Test

Open the Vercel URL and run one full flow: log in as admin → add a record
with a PDF → log in as a User → request a download → accept it as the
checker → pay → download.

If the frontend can't reach the backend, the usual cause is a wrong or
missing `VITE_API_URL`. After changing it, redeploy the frontend
(Vercel → Deployments → Redeploy).

---

## 5. Before real users touch this

The application currently has **no authentication**. Every endpoint trusts a
`userId` and `role` sent by the browser, and the logged-in user is just a
`localStorage` object anyone can edit. Specifically:

- `POST /api/auth/verify-account` + `POST /api/auth/reset-password` let
  anyone change the admin password with two unauthenticated requests.
- `PUT /api/users/:id/role` lets anyone make themselves an admin.
- `/uploades` serves every PDF with no check, so the approval and payment
  gates can be walked around entirely.
- `ensureAdminAccount()` creates `admin` / `Admin@1234` on boot, and that
  password is published in this repository.

Fix these before the URL is shared outside a controlled demo: issue a JWT at
login, add `requireAuth` / `requireRole` middleware to every `/api` route,
take `userId` from the token instead of the request body, lock CORS to the
Vercel origin, remove the `/uploades` static mount, and move the bootstrap
admin password into an environment variable.

---

## Local development — nothing changes

`npm start` in `front-end` still talks to `http://localhost:5000`;
the backend still reads `back-end/.env`.
