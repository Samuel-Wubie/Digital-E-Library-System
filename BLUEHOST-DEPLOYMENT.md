# Deployment Guide — EGI Library System on Bluehost

Everything on one Bluehost account, one domain. One Node process serves both
the React app and the API, so there is no second host, no CORS, and nothing to
keep in sync.

**Read step 0 first.** It takes thirty seconds and decides whether the rest of
this guide applies to your account.

---

## 0. Check what your account can actually do

Bluehost sells several kinds of hosting and they are not equally capable. This
app needs Node.js running as a long-lived process, which the cheapest shared
plans do not offer.

Log in to Bluehost → **Hosting** → **cPanel** (or **Advanced** in the newer
panel). Look through the sections for these two tiles:

| Tile | What it means |
|---|---|
| **Setup Node.js App** | You can run the backend. Follow this whole guide. |
| **PostgreSQL Databases** | The database can live here too. |

Then match your account to one of these three:

**A — Both tiles present.** The normal path. Do steps 1 through 7.

**B — "Setup Node.js App" present, PostgreSQL absent.** The app runs on
Bluehost, the database lives elsewhere for free. Do every step, but replace
step 2 with **Appendix A**.

**C — No "Setup Node.js App" tile.** Bluehost cannot run this backend. Shared
plans without the Node selector run PHP only, and there is no workaround worth
having — the suggestions you will find online about running Node on a spare
port behind a CGI script break on every restart and are against most shared
hosting terms. Your options are in **Appendix B**.

If you cannot tell which tile is which, Bluehost's 24/7 chat will answer
"does my plan include the Node.js app selector and PostgreSQL?" in about a
minute. That is a faster answer than guessing.

---

## 1. Build the frontend on your PC

Bluehost runs the built files, not the source. Build locally and upload the
result — building on a shared host is slow and often runs out of memory.

```
cd "C:\Users\HP\Desktop\librery system\front-end"
npm install
npm run build
```

That writes `front-end/dist`. It reads `front-end/.env.production`, which sets
`VITE_API_URL` to empty on purpose: every API call becomes a relative path like
`/api/books`, so the build works on whatever domain you put it on and keeps
working if the domain changes.

Then delete `dist/.htaccess` from the build. It ships for the fallback setup in
Appendix B and would conflict with the one cPanel writes for the Node app.

---

## 2. Create the database

cPanel → **PostgreSQL Databases**.

1. **Create a database.** Name it `library`. cPanel prefixes it with your
   account name, so it becomes something like `youracct_library`. Write down
   the full prefixed name.
2. **Create a user** with a strong password. It is also prefixed:
   `youracct_libuser`. Write down the password.
3. **Add the user to the database** and grant **ALL PRIVILEGES**.

### Import your data

cPanel → **phpPgAdmin** → select your database → **SQL** tab → upload
`library_dump.sql.sql`.

Two things to expect:

- An error about `transaction_timeout` being an unrecognized parameter. Ignore
  it. Your dump was made by a newer PostgreSQL than Bluehost runs (they are on
  13.x), and that line is a setting, not data. Everything after it imports.
- If phpPgAdmin times out on the upload, use SSH instead — cPanel → **Terminal**
  or an SSH session — after uploading the file with File Manager:

  ```
  psql -U youracct_libuser -d youracct_library -f ~/library_dump.sql.sql
  ```

Afterwards, confirm the data arrived:

```
psql -U youracct_libuser -d youracct_library -c "\dt"
psql -U youracct_libuser -d youracct_library -c "SELECT count(*) FROM books;"
```

You should see 13 tables.

---

## 3. Upload the application

cPanel → **File Manager**. Create a folder in your home directory — *not* in
`public_html` — called `library`:

```
/home/youracct/library/
```

Outside `public_html` on purpose: anything inside `public_html` is served
directly by Apache as a file. Your `.env` holds the database password, and a
misconfigured Node app would let anyone fetch `yourdomain.com/.env` and read
it. Passenger runs the app from wherever it lives, so there is no reason to
take that risk.

Upload into it:

```
/home/youracct/library/
├── server.js
├── db.js
├── storage.js
├── make-admin.js
├── package.json
├── package-lock.json
└── public/            ← the CONTENTS of front-end/dist
```

Do **not** upload `node_modules` — it is large, slow to upload, and may contain
binaries built for Windows. Step 4 installs it on the server.

Do **not** upload `.env` from your PC. Step 5 sets the real values.

The `public/` folder is where `server.js` looks for the frontend build. Put the
contents of `dist` in there — `index.html` should sit at
`/home/youracct/library/public/index.html`, not one folder deeper.

Uploading a zip and using File Manager's **Extract** is far faster than
uploading hundreds of files individually.

---

## 4. Create the Node.js app

cPanel → **Setup Node.js App** → **Create Application**.

| Field | Value |
|---|---|
| Node.js version | the highest offered (18 or above is required) |
| Application mode | **Production** |
| Application root | `library` |
| Application URL | your domain, or a subdomain |
| Application startup file | `server.js` |

Click **Create**, then **Run NPM Install** on the same page.

Leave the port alone. Passenger assigns one and passes it in as `PORT`;
`server.js` already reads it.

---

## 5. Set the environment variables

Still on the Node.js app page, add these under **Environment variables**:

| Key | Value |
|---|---|
| `DB_USER` | `youracct_libuser` |
| `DB_PASSWORD` | the password from step 2 |
| `DB_HOST` | `localhost` |
| `DB_PORT` | `5432` |
| `DB_NAME` | `youracct_library` |
| `ADMIN_BOOTSTRAP_PASSWORD` | a strong password you choose |

`ADMIN_BOOTSTRAP_PASSWORD` is not optional. Without it the app creates its
`admin` account with a password that is written in this repository's source
code, and your admin console is open to anyone who has seen it.

Do not set `SUPABASE_URL`. Bluehost has a normal persistent disk, so uploads go
to `library/uploades/` and stay there. That variable would switch file storage
to a remote bucket you do not have.

Do not set `SERVE_UPLOADS_STATIC`. It exists for local development and would
make every stored PDF downloadable by anyone who knows its filename.

Then **Restart** the app.

---

## 6. Check the log

Node.js app page → **Logs** (or `~/logs/`). A healthy boot looks like:

```
File storage: local disk (set SUPABASE_URL to use Supabase Storage)
DATABASE_URL seen by app: NOT SET
Database SSL: off
Serving frontend from: /home/youracct/library/public
Server application successfully running on port 31415
Connected to the Database ✅
Connected to PostgreSQL at: 2026-...
Admin console account present: admin
```

Line by line, if it does not:

| Line | Problem |
|---|---|
| `No frontend build found` | `public/index.html` is missing, or nested one folder too deep. You will get JSON from the API but no website. |
| `Database SSL: on` | `DB_HOST` is not `localhost`. Bluehost's PostgreSQL has no SSL and will refuse the connection. |
| `The server does not support SSL connections` | Same cause. Fix `DB_HOST`, or set `DB_SSL=false`. |
| `password authentication failed` | Wrong password, or you forgot to add the user to the database with ALL PRIVILEGES in step 2. |
| `relation "users" does not exist` | The app is connected, but the import in step 2 did not land. |
| `WARNING: ADMIN_BOOTSTRAP_PASSWORD is not set` | Go back to step 5. Do this before sharing the URL. |

---

## 7. Test

Open your domain and walk one full path:

1. Log in as `admin` with the password you set.
2. Add a record with a PDF attached.
3. Log out, log in as a User, request a download.
4. Accept it as the checker, pay, download.
5. Open a document in the preview modal.
6. **Refresh the page while on a dashboard route.** If that 404s, the SPA
   fallback is not working — check the log line from step 6.
7. In a private window, while logged out, try
   `yourdomain.com/uploades/somefile.pdf`. It must return 404.

**Your existing PDFs are not uploaded.** Files in `back-end/uploades` are on
your PC. The imported database still has rows pointing at those filenames, so
their download and preview will 404 until the file exists on the server. You
can either upload that folder's contents into `/home/youracct/library/uploades/`
with File Manager — the filenames must match exactly — or re-add the documents
through the app. Note that `building-management-system.zip` is 85 MB and the
app refuses uploads over 50 MB, so that one needs the File Manager route.

---

## 8. Before real users touch this

The application has **no authentication**, and this matters far more on a real
domain than it did in testing. Every endpoint trusts a `userId` and `role` sent
by the browser, and the logged-in user is a `localStorage` object anyone can
edit with the browser console:

- `POST /api/auth/verify-account` + `POST /api/auth/reset-password` let anyone
  change the admin password with two unauthenticated requests.
- `PUT /api/users/:id/role` lets anyone make themselves an admin.
- Any `userId` in a query string is taken at face value, including by the
  download and preview routes — the gate added in this deployment stops
  strangers, not a logged-in user who edits the number.

Fix before the URL is shared outside a controlled demo: issue a JWT at login,
add `requireAuth` / `requireRole` middleware to every `/api` route, take
`userId` from the token rather than the request body, and set `ALLOWED_ORIGINS`
if the frontend ever moves off this domain.

Also turn on **free SSL** (cPanel → SSL/TLS Status → Run AutoSSL) and force
HTTPS. Without it, every password on this site crosses the network in plain
text.

---

## Appendix A — database elsewhere (case B)

If Bluehost has no PostgreSQL, run the database on a free hosted plan and point
the app at it. [Supabase](https://supabase.com) and [Neon](https://neon.tech)
both have permanent free tiers.

1. Create a project and save the password it shows you once.
2. Take the connection string. On Supabase use the **Session pooler** string on
   port 5432 — the direct `db.<ref>.supabase.co` address is IPv6-only on the
   free plan, and the transaction pooler on 6543 is for serverless.
3. In step 5, instead of the five `DB_*` variables, set one:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the connection string |

   SSL turns on automatically for a remote host, which is what you want here.

4. Import the dump with `migrate-db.bat` on your PC, pasting that string.
5. On Supabase, enable row level security on every table, or its public REST
   API will serve your `users` table — password hashes included — to anyone
   with the anon key, which is public by design:

   ```sql
   alter table users             enable row level security;
   alter table books             enable row level security;
   alter table approval_requests enable row level security;
   alter table payments          enable row level security;
   alter table audit_logs        enable row level security;
   alter table notifications     enable row level security;
   alter table system_settings   enable row level security;
   ```

   No policies means deny-all, which is correct — only the backend, which
   connects as `postgres` and bypasses RLS, touches this database.

---

## Appendix B — no Node.js on your plan (case C)

Three ways out, cheapest first.

**1. Put the frontend on Bluehost, the backend on a free Node host.**
Your domain stays on Bluehost and looks the part; the API lives elsewhere.

- Upload the contents of `front-end/dist` into `public_html`, keeping the
  `.htaccess` this time — it does the SPA routing Apache otherwise gets wrong,
  and without it every page refresh 404s.
- Deploy `back-end/` to [Render](https://render.com) (free) with root directory
  `back-end`, build `npm install`, start `npm start`.
- Rebuild the frontend with `VITE_API_URL=https://your-app.onrender.com` in
  `front-end/.env.production`, then re-upload `dist`.
- On Render, set `ALLOWED_ORIGINS=https://yourdomain.com` so the API is not
  open to every website.
- Database goes to Supabase or Neon, per Appendix A.

The catch: Render's free tier sleeps after 15 minutes idle, so the first visit
after a quiet spell takes 30–60 seconds. Open the site yourself a minute before
showing it to anyone.

Render also wipes its filesystem on restart, so on that host you *do* need
Supabase Storage — set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
`SUPABASE_BUCKET=documents` there, with the bucket set to private.

**2. Upgrade to Bluehost VPS.** Root access, so Node and PostgreSQL both
install normally and the main guide applies. Costs money every month.

**3. Move to a host that includes Node on shared plans.** A2 Hosting and
Namecheap both ship the cPanel Node.js selector on shared tiers, usually for
less than a Bluehost VPS.

---

## Local development — unchanged

Nothing here affects your PC. Leave `back-end/.env` as it is and `npm run dev`
works exactly as before, against your local PostgreSQL and the local
`uploades/` folder.

Two notes:

- `config.js` now points at `http://localhost:5000` in dev and uses relative
  paths only in a production build, so the dev server is unaffected.
- If you relied on opening `http://localhost:5000/uploades/<file>` directly,
  that route is now off by default. Add `SERVE_UPLOADS_STATIC=true` to
  `back-end/.env` to bring it back locally. Never set it on the server.
