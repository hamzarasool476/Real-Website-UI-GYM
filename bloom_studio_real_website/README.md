# Bloom Studio — Real Website Starter

Bloom Studio is a responsive women's fitness website using HTML, CSS, Bootstrap 5, vanilla JavaScript, and Supabase Auth + PostgreSQL. It preserves the original blush-pink dashboard while adding real accounts, database-backed classes, bookings, cancellation, and an admin class manager.

## Files
- `index.html` — dashboard and auth/admin modals
- `styles.css` — responsive UI and animations
- `script.js` — Supabase authentication, class loading, booking, cancellation, and admin UI
- `config.js` — public Supabase URL and anon/publishable key placeholders
- `supabase/schema.sql` — database tables, RLS policies, booking RPCs, triggers, and starter classes
- `DEPLOYMENT.md` — full setup and deployment guide

## 1. Create Supabase project
1. Create a project at https://supabase.com/dashboard.
2. Open **SQL Editor** and run the entire `supabase/schema.sql` file.
3. Open **Project Settings → API** (or the API Keys page). Copy the Project URL and the public anon/publishable key.
4. Paste those values into `config.js`:
   - `supabaseUrl`: `https://YOUR_PROJECT_REF.supabase.co`
   - `supabaseAnonKey`: your public anon/publishable key
5. Do **not** use `service_role` or any secret key in `config.js`. Browser apps are public clients; the RLS policies in the schema protect data.

## 2. Authentication settings
In Supabase Dashboard → Authentication → URL Configuration:
- For local testing, add `http://localhost:5500` to Site URL or Redirect URLs.
- For production, set Site URL to your deployed domain and add that domain to Redirect URLs.
- Enable email/password authentication. If email confirmations are enabled, new members must verify their email before signing in.
- Set up SMTP for reliable production verification and password-reset emails; the default test mailer is limited.

## 3. Run locally
Use a local static server rather than opening the file with `file://`, especially for auth redirects. Examples:
- VS Code: install **Live Server**, right-click `index.html`, choose **Open with Live Server**.
- Python: from this folder run `python -m http.server 5500`, then open `http://localhost:5500`.

The app will continue to show the original static cards before configuration; live login and booking features require valid Supabase credentials and the SQL schema.

## 4. Promote the first administrator
1. Sign up through the site and verify the email if required.
2. In Supabase Dashboard → SQL Editor, run the following with your own email:
```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'YOUR_EMAIL');
```
3. Refresh the website and sign in again. The admin dashboard should appear.
The site never allows a public user to choose their own role; the database policies are the enforcement boundary.

## 5. Deploy with Netlify (easy option)
1. Create a Git repository and commit the project files.
2. Sign in at https://app.netlify.com/ and choose **Add new site → Import an existing project**.
3. Select the repository. This is a static site, so set build command to blank and publish directory to the repository root (`.`).
4. Deploy. Add your custom domain under **Domain management** if desired.
5. In Supabase Authentication → URL Configuration, set the production site URL to the Netlify URL and add the production URL to allowed redirects.
6. Update `config.js` in your repo with your project's public URL/key and redeploy.

Alternative: drag-and-drop the project folder into Netlify Drop for a quick demo, then configure the Supabase redirect URLs. A Git-based deploy is better for updates.

## Real functionality included
- Email/password sign-up and sign-in
- Supabase session persistence and sign-out
- Password-reset email request
- Member profiles created via a database trigger
- Active class list read from PostgreSQL
- Bookings saved to PostgreSQL via `book_class()` RPC
- Capacity enforcement and duplicate booking protection in a transaction
- Member-only booking visibility and cancellation via RPC
- Admin-only class create, publish/hide, and full class list
- RLS on profiles, classes, and bookings

## Prototype features still local-only
The hydration tracker and workout/weekly-goal counters currently run in browser memory. They reset on refresh and are not medical or verified activity data. To persist them, add a `member_metrics` table and RLS-protected APIs. Trainer management, membership billing, attendance check-in, recurring class schedules, and payment integration are not yet implemented. This starter intentionally does not collect payment information.

## Security and production checklist
- Keep `service_role` / secret keys server-side only; never place them in `config.js`.
- RLS is enabled on all app tables. Review policies before expanding the schema.
- Configure SMTP and production auth redirects.
- Use HTTPS hosting and a custom domain for production.
- Test signup, email verification, password reset, booking capacity, cancellation, and admin-only operations with separate member/admin accounts.
- Consider adding rate limits, monitoring, privacy policy, terms, backups, and a clear cancellation policy before accepting real members.
