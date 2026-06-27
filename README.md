# Company Ops App

Two front-ends over one Supabase backend, hosted as static files on GitHub Pages.

- **`admin.html`** — super-user console: build groups, process incidents, manage checklists, upload documents, build procedure forms, grant roles.
- **`user.html`** — worker app: tick checklists (auto-saved), report incidents and track them, fill procedures, read documents.
- **`config.js`** — Supabase client + shared helpers (put your keys here).
- **`styles.css`** — shared design system.
- **`schema.sql`** — run once to create everything.

## 1. Supabase setup

1. Create a project at supabase.com.
2. Open **SQL Editor**, paste all of `schema.sql`, run it. This creates tables, the profile trigger, baseline Row Level Security, and seeds the three default groups plus the starter incident categories.
3. Open **Storage** → create a bucket named `documents`, set it **private** (the app serves files through short-lived signed URLs).
4. Copy your **Project URL** and **anon public key** from Project Settings → API into the top of `config.js`.

## 2. First admin

1. Open `user.html` (or `admin.html`) and create an account with your email.
2. Back in Supabase SQL Editor, promote yourself:
   ```sql
   update profiles set role = 'admin' where email = 'you@example.com';
   ```
3. Reload `admin.html`. From there you can promote others under **Settings → People & access**, no SQL needed.

## 3. Deploy to GitHub Pages

1. Push `admin.html`, `user.html`, `config.js`, `styles.css` to a repo.
2. Settings → Pages → deploy from the `main` branch, root folder.
3. Workers use `…/user.html`; admins use `…/admin.html`.

## Notes on what's solid vs. first-pass

- **Schema, auth, incident workflow, checklist auto-save, documents** — built to work end to end.
- **RLS policies** are a sensible baseline, not audited for production. Review the admin-write rules before real data goes in.
- **Procedure form-builder** covers short/long text, number, dropdown, checkbox. It's the piece most likely to grow (file-upload fields, conditional questions, required-on-checkbox), so it's written to extend.
- **PWA install + push + the 8pm reminder** aren't here yet — same path as your driving app (manifest + service worker on the static host, a Supabase Edge Function for the scheduled push).
