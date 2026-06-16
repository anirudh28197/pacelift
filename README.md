# Fitness Tracker

A personal web app for tracking strength training and runs, with weekly/monthly analytics, BMI trends, and rule-based recommendations. Installable on Android (and iOS) like an app via "Add to Home Screen".

Sections:

- **Strength** — log sets × reps × weight per exercise, organized by muscle group (Chest, Back, Biceps, Triceps, Shoulders)
- **Runs** — live GPS tracking (Speed / Recovery / Long runs) plus manual entry
- **Analytics** — weekly & monthly summaries, exercise progress charts, run trends, BMI/weight trend
- **Tips** — rule-based recommendations based on your logged data

No build step — plain HTML/CSS/JS, using Supabase for storage and auth.

## 1. Create a free Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (free tier is plenty).
2. Click **New project**. Pick any name/region and set a database password.
3. Once the project is ready, open **SQL Editor** → **New query**.
4. Paste the contents of [`supabase-setup.sql`](./supabase-setup.sql) and click **Run**. This creates all the tables (`profile`, `custom_exercises`, `lift_sets`, `runs`, `body_weight_logs`) and the access policies that keep your data private.

## 2. Create your login

This app has a single personal account — there's no public sign-up page.

1. In Supabase, go to **Authentication** → **Users**.
2. Click **Add user** → **Create new user**.
3. Enter your email and a password, and make sure **Auto Confirm User** is checked.
4. You'll use this email/password to log in to the app.

## 3. Get your API credentials

1. In Supabase, go to **Project Settings** → **API**.
2. Copy the **Project URL** and the **anon / public** key.
3. Open [`config.js`](./config.js) and paste them in:

```js
export const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

The anon key is designed to be public/client-side — that's expected. Your data stays private because of the row-level security policies created in step 1.

## 4. Test it locally

Browsers block ES modules and `fetch` from `file://` pages, so serve the folder over HTTP. From inside `fitness-tracker/`:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser, log in, and try logging a lift, adding a run, and checking the Analytics and Tips tabs.

## 5. Deploy so you can use it on your phone

Easiest option — **Netlify Drop**:

1. Go to https://app.netlify.com/drop
2. Drag the entire `fitness-tracker` folder onto the page.
3. Netlify gives you a live URL (e.g. `https://random-name-123.netlify.app`).

> If Netlify enables "Site protection" on the new site, turn it off in **Site settings → General → Visitor access**, otherwise you'll be blocked by a password prompt before reaching the login screen.

Since this is a personal app with login-protected data, it's fine to share or reuse this URL — only your account can read/write your data.

## 6. Install it on your Android phone

1. Open your deployed URL in **Chrome** on your phone.
2. Log in once.
3. Tap the **⋮** menu → **Add to Home screen** (or you may see an automatic "Install app" prompt).
4. The app now opens full-screen from your home screen like a native app.

## Notes

- **GPS tracking** works while the app tab is open and your screen is on. If your screen locks mid-run, tracking can pause — use the **manual entry** form to fix up the distance/duration afterwards, or just log runs manually.
- **Re-deploying after changes**: edit files locally, then drag the `fitness-tracker` folder onto [Netlify Drop](https://app.netlify.com/drop) again to update the live site (no auto-sync).
- **Default exercises** are defined in `js/exercises.js` — edit that list if you want to change the starting exercises per muscle group. You can also add custom exercises directly in the app.
- If you ever need to wipe your data, use the Supabase **Table Editor** to delete rows from `lift_sets`, `runs`, or `body_weight_logs`.
