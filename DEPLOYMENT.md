# Deployment Guide — EGI Library System (Vercel / Render / Supabase)

> **Deploying to Bluehost? Use [BLUEHOST-DEPLOYMENT.md](BLUEHOST-DEPLOYMENT.md)
> instead.** This file describes the three-host free-tier setup. It still
> works, and Appendix B of the Bluehost guide falls back to the Render half of
> it, but the two are different deployments — don't follow both.

Frontend → **Vercel** · Backend → **Render** · Database + files → **Supabase**

All three on permanently free tiers. No card required.

**What "free" costs you:** Render's free service sleeps after 15 minutes with
no traffic, so the first visit after a quiet spell takes 30–60 seconds while it
wakes up. Open the site yourself a minute before showing it to anyone. Nothing
expires and nothing is deleted — it just sleeps.

**Free tier limits:** 500 MB database, 1 GB file storage, 5 GB bandwidth per
month, 50 MB maximum per uploaded file. The current database dump is 105 KB.

---

## 0. Push to GitHub

The repo is already cleaned up (the 2.7 GB of duplicate test PDFs under `db/`
are untracked) and the remote is already set. From
`C:\Users\HP\Desktop\librery system`:

```
cd back-end
npm install
cd ..
git add -A
git commit -m "Supabase Storage for uploads"
git push -u origin main
```

`npm install` first, so `package-lock.json` matches the dependencies Render
will install.

---

## 1. Supabase — database and file storage

1. Sign up at https://supabase.com and create a new project. **Save the
   database password it shows you** — it appears once.
2. Wait ~2 minutes for provisioning.

### 1a. Connection string

Project Settings → Database → Connection string. **Use the "Session pooler"
string, not the direct connection.**

The direct connection (`db.<ref>.supabase.co:5432`) is IPv6-only on the free
plan and Render cannot reach it. The session pooler is IPv4 on every plan and
is the one meant for long-running servers:

```
postgresql://postgres.<PROJECT-REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres
```

Don't use the transaction pooler on port 6543 — that's for serverless.

### 1b. Import the data

On your PC, run `migrate-db.bat` and paste the session pooler string when it
asks.

### 1c. Create the storage bucket

Storage → New bucket:

- **Name:** `documents` (must match `SUPABASE_BUCKET` below)
- **Public bucket:** **OFF**

Keep it private. The backend reads it with the service-role key and hands out
links that expire after 10 minutes, so a leaked URL stops working. A public
bucket would put every PDF back on the open internet and make the payment gate
meaningless again.

### 1d. Get the service-role key

Project Settings → API → `service_role` key. This key bypasses all access
rules — it goes in Render's environment only. **Never put it in the frontend
or commit it.**

### 1e. Lock down the REST API — don't skip this

Supabase exposes every table in the `public` schema through a REST API, and
tables imported with `psql` arrive with Row Level Security **disabled** and
default grants to the `anon` role. Anyone with your project's anon key — which
is public by design — could read your `users` table, password hashes included.

The backend connects as `postgres` and bypasses RLS, so this breaks nothing.
In the SQL editor:

```sql
alter table users              enable row level security;
alter table books              enable row level security;
alter table approval_requests  enable row level security;
alter table payments           enable row level security;
alter table audit_logs         enable row level security;
alter table notifications      enable row level security;
alter table system_settings    enable row level security;
```

No policies means deny-all, which is right — only the backend touches this
database. Afterwards check Database → Advisors; it should report no "RLS
disabled in public" warnings.

---

## 2. Render — backend

1. Sign up at https://render.com (log in with GitHub).
2. New → **Web Service** → connect your repository.
3. Settings:
   - **Root Directory** = `back-end`
   - **Build Command** = `npm install`
   - **Start Command** = `npm start`
   - **Instance Type** = **Free**
4. Environment → add four variables:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Supabase **session pooler** string from 1a |
   | `SUPABASE_URL` | `https://<PROJECT-REF>.supabase.co` (Settings → API) |
   | `SUPABASE_SERVICE_ROLE_KEY` | the service-role key from 1d |
   | `SUPABASE_BUCKET` | `documents` |

5. Deploy. Render sets `PORT` itself and `server.js` already reads it.

`SUPABASE_URL` is also the switch that puts file storage into remote mode. If
it's missing, the app silently falls back to writing files to Render's disk,
which is wiped on every restart — so if uploads keep disappearing, that
variable is why.

### 2a. Check the logs

You should see:

```
File storage: Supabase bucket "documents"
DATABASE_URL seen by app: postgresql://postgres.xxxx:****@aws-0-....pooler.supabase.com:5432/postgres
Server application successfully running on port 10000
Connected to the Database
```

If the first line says "local disk", `SUPABASE_URL` didn't reach the process.
If `DATABASE_URL` prints `NOT SET`, same problem with that variable.

Copy the service URL, e.g. `https://egi-library-backend.onrender.com`.

---

## 3. Vercel — frontend

1. Sign up at https://vercel.com (log in with GitHub).
2. Add New → Project → import your repository.
3. **Root Directory** = `front-end`. Framework preset: **Vite**
   (build `npm run build`, output **`dist`**).
4. Environment Variables → `VITE_API_URL` = your Render backend URL, no
   trailing slash.
5. Deploy.

---

## 4. Test

Open the Vercel URL and run one full flow: log in as admin → add a record with
a PDF → log in as a User → request a download → accept it as the checker →
pay → download. Then open a document in the preview modal.

The first request will be slow if Render has gone to sleep. That's expected.

**Your existing PDFs are not migrated.** Files in `back-end/uploades` live on
your PC; the new upload path writes to Supabase. Records in the imported
database still point at those old filenames, so their download and preview
will 404 until you re-upload the document through the app. Most of what's in
that folder is test data anyway — and `building-management-system.zip` is
85 MB, over the 50 MB free-tier limit, so it can't go up at all.

---

## 5. Before real users touch this

The application has **no authentication**. Every endpoint trusts a `userId`
and `role` sent by the browser, and the logged-in user is just a
`localStorage` object anyone can edit:

- `POST /api/auth/verify-account` + `POST /api/auth/reset-password` let anyone
  change the admin password with two unauthenticated requests.
- `PUT /api/users/:id/role` lets anyone make themselves an admin.
- `ensureAdminAccount()` creates `admin` / `Admin@1234` on boot, and that
  password is published in this repository.

Fix before the URL is shared outside a controlled demo: issue a JWT at login,
add `requireAuth` / `requireRole` middleware to every `/api` route, take
`userId` from the token instead of the request body, lock CORS to the Vercel
origin, and move the bootstrap admin password into an environment variable.

(The old `/uploades` hole — every PDF readable by anyone who knew the
filename — is closed: in Supabase mode that route isn't mounted, and files are
reached only through signed links that expire.)

---

## Local development — nothing changes

Leave `SUPABASE_URL` out of `back-end/.env` and the app uses the local
`uploades/` folder and your local Postgres exactly as before. `npm start` in
`front-end` still talks to `http://localhost:5000`.
