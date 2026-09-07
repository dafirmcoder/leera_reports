# Leera End-of-Unit Reports — PWA

A Progressive Web App (installable, offline-capable) for recording **end-of-unit
test marks** and generating **parent reports** — with **multiple classes,
multiple teachers, roles and bulk report downloads**.

Built with **React + TypeScript + Vite**, runs on **Supabase** (database + auth),
deployed **free on Vercel**.

---

## Roles & permissions

| Role | Can do |
|---|---|
| **Director** | Read-only view of the whole school |
| **Head of School** | Read-only academic view + **create accounts (invite)**, **assign roles**, **change school settings**, manage classes & subjects |
| **Curriculum Coordinator** | Read-only + **assign roles** |
| **Homeroom Teacher** | Own class: **add students**, **add marks**, **download reports**, **assign subject teachers** |
| **Subject Teacher** | **Add marks** + reports for their assigned subjects/classes |
| **Pending** | No access until an admin assigns a role |

## Features

- **Students** — class roster with auto student numbers (per class).
- **Marks** — create a unit test (subject, topic, date, max mark) per class and
  type each student's score; saved automatically as you type. Subject teachers
  only see their own subjects.
- **Reports** — the tabulated report (`Subject | Unit / Topic | Date | Score |
  Out of (Max) | Mark %`, subject-average rows, blank rows between subjects,
  overall average, school + Cambridge logos, green footer pinned to the bottom).
  Print / Save as PDF for one student, or **bulk download**: every student's
  report as **individual PDFs** — either packaged as one **ZIP** (extracts into
  a folder of PDFs, works on every browser) or written **straight into a folder
  you pick** (`Save to folder`, Chrome/Edge desktop).
- **Classes** — create classes, set homeroom teachers, assign subject teachers.
- **People** — list staff, assign roles, invite new teachers (Head of School).
- **Settings** — school details, footer, logos, subject list.
- **PWA** — installable on phones/desktops; app shell cached for offline launch.
- **Demo mode** — when Supabase isn't configured, the app runs fully in the
  browser with sample data and a **role picker** on the login screen.

---

## 1. Run locally

```bash
cd leera-reports
npm install
npm run dev        # http://localhost:5173  (demo mode with role picker)
```

---

## 2. Set up Supabase (database + login)

1. Create a free project at <https://supabase.com>.
2. **SQL Editor → New query** → paste [`supabase/schema.sql`](supabase/schema.sql)
   → **Run**. This creates the tables, Row Level Security for every role, and a
   bootstrap trigger: the **first user to sign up becomes Head of School** and
   gets a school; later sign-ups are **Pending** until an admin assigns a role.
3. (Optional) run [`supabase/seed_subjects.sql`](supabase/seed_subjects.sql).
4. Copy your **Project URL** and **anon key** (Project Settings → API) into
   `.env.local` (see `.env.example`).
5. **Auth**: Authentication → Providers → Email — keep email enabled. For quick
   testing disable "Confirm email".
6. **Deploy the invite function** (needed for "create accounts" in the app):

   ```bash
   npm i -g supabase
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   supabase functions deploy invite-user
   ```

   (Without it, teachers can still **self-register** — they appear as *Pending*
   and the Head of School assigns their role in the People screen.)
7. Restart `npm run dev` — the role picker disappears and data persists in
   Supabase.

---

## 3. Deploy to Vercel (free)

1. Push this folder to GitHub.
2. Vercel → **Add New → Project** → import the repo.
3. Add these Vercel environment variables for the Production environment:
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (the legacy
  `VITE_SUPABASE_ANON_KEY` is also supported). Vercel's Supabase integration
  names `SUPABASE_URL` and `SUPABASE_ANON_KEY` are also accepted.

  Do not expose `SUPABASE_SERVICE_ROLE_KEY` or any `service_role` secret in a
  `VITE_` variable. Those keys bypass RLS and belong only in Supabase Edge
  Function secrets.
   (Settings → Environment Variables).
4. **Deploy** — done.

> Supabase Edge Functions (the invite flow) run on Supabase, not Vercel, so this
> stays a purely static deployment.

---

## 4. Using the PWA on a phone

- Open the deployed URL → **Add to Home Screen**
  (Android: Chrome → *Install app*; iOS: Share → *Add to Home Screen*).
- The app opens full-screen and launches offline; **data needs internet**
  (Supabase).

---

## 5. Android app (APK download)

An installable `.apk` is a thin wrapper that opens the deployed site in a
full-screen, app-like window (no browser address bar) and is delivered from the
site itself: a **Download APK for Android** button appears automatically on the
login screen whenever `public/leera-reports.apk` is present.

**Build it (one command, any machine with Java 17 + internet):**

```bash
npx pwabuilder@latest https://YOUR-DEPLOYED-URL.vercel.app -l debug -d android
```

(It auto-discovers the PWA manifest at `https://YOUR-DEPLOYED-URL.vercel.app/manifest.webmanifest`.)
This downloads the Android SDK and produces
`android/app/build/outputs/apk/debug/app-debug.apk`.
Rename and drop it into `public/` so it ships with the next deploy:

```bash
cp android/app/build/outputs/apk/debug/app-debug.apk public/leera-reports.apk
```

For a production-signed APK (recommended once the URL is final), see
`docs/android-apk.md`.

> Note: the APK is a convenience wrapper around the PWA. It needs internet, and
> it inherits the PWA's look and behaviour (login, roles, reports, bulk PDFs).

---

## Project structure

```text
src/
  lib/
    supabase.ts        # Supabase client (null in demo mode)
    auth.ts            # sign in/up/out + demo personas
    api.ts             # picks Supabase or demo backend
    api.supabase.ts    # real backend (PostgREST)
    api.demo.ts        # localStorage backend, seeded multi-class data
    permissions.ts     # role -> capability map + nav tabs
    report.ts          # report-building logic (mirrors the Excel VBA)
    pdf.ts             # per-student PDF + ZIP + save-to-folder bulk export
    types.ts           # shared types
  context/AuthContext.tsx    # user + profile (role)
  context/SchoolContext.tsx  # school, classes, subjects, selected class
  components/AppShell.tsx, ClassPicker.tsx, ReportSheet.tsx
  pages/  Login, PendingApproval, Students, Marks, ScoreEntry,
          Reports, ReportView, Settings, People, Classes
supabase/
  schema.sql            # tables + RLS + bootstrap trigger (run once)
  seed_subjects.sql     # optional subject list
  functions/invite-user # "create account" edge function (service role)
docs/
  android-apk.md        # APK build + signing runbook
```

## Data model

`schools` · `profiles` (role) · `classes` (homeroom teacher) ·
`class_subject_teachers` (subject-teacher assignments) · `subjects` ·
`students` (per class) · `unit_tests` (per class) · `scores` — all guarded by
Row Level Security derived from the signed-in user's role.
