# Organizer

A premium, Apple-style **To-do · Lists · Notes** app. Works as a responsive web app (installable PWA) and can be packaged as an Android APK. Data syncs in real time across devices via **Firebase**, with full **offline** support. Hosted on **GitHub Pages** at [organizer.rohan-dhanawade.de](https://organizer.rohan-dhanawade.de).

- **To-do** — a checklist with add/edit/complete/delete, completed section
- **Lists** — multiple named lists as collapsible dropdown cards, each with color-coded checkable items (e.g. Groceries)
- **Notes** — Google Keep-style masonry of colored, pinnable notes with an editor sheet
- **Google Sign-In**, private per-user data, real-time + offline sync

---

## Tech stack

React 18 · TypeScript · Vite · Tailwind CSS · Framer Motion · Firebase (Auth + Firestore) · vite-plugin-pwa

---

## 1. Local development

```bash
npm install
cp .env.example .env   # then fill in your Firebase keys (see below)
npm run dev
```

Open the printed localhost URL. Without Firebase keys the app shows a friendly "configure Firebase" screen.

---

## 2. Firebase setup

1. Create a project at <https://console.firebase.google.com>.
2. **Build → Authentication → Sign-in method →** enable **Google**.
3. **Build → Firestore Database →** create a database (Production mode).
4. **Project Settings → General → Your apps →** add a **Web app**, copy the config values into `.env`:

   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```

5. **Authentication → Settings → Authorized domains →** add `organizer.rohan-dhanawade.de` (and `localhost` is there by default).
6. Publish the security rules (below).

### Firestore security rules

Rules live in [`firestore.rules`](firestore.rules) — each user can only access their own `users/{uid}/**`. Publish them by pasting into the Firebase console (Firestore → Rules), or via CLI:

```bash
npm i -g firebase-tools
firebase login
firebase deploy --only firestore:rules --project <your-project-id>
```

### Data model

```
users/{uid}/todos/{id}                 { text, done, order, createdAt }
users/{uid}/lists/{id}                  { title, color, expanded, order, createdAt }
users/{uid}/lists/{id}/items/{itemId}   { text, checked, order }
users/{uid}/notes/{id}                  { title, body, color, pinned, updatedAt }
```

---

## 3. Deploy to GitHub Pages (custom domain)

Deployment is automated by [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) on every push to `main`.

1. Create a GitHub repo named **`organizer`** and push this code.
2. **Repo → Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Repo → Settings → Secrets and variables → Actions →** add the six `VITE_FIREBASE_*` secrets (same values as `.env`). These are injected at build time.
4. **DNS:** at your domain registrar add a **CNAME** record:
   `organizer` → `<your-github-username>.github.io`
   (The [`public/CNAME`](public/CNAME) file tells Pages to serve the custom domain; enable "Enforce HTTPS" in Pages settings once the cert is issued.)
5. Push to `main` — the Action builds and deploys. Live at `https://organizer.rohan-dhanawade.de`.

`public/404.html` provides the SPA fallback so deep links / refreshes resolve correctly on GitHub Pages.

---

## 4. Android APK (PWA → Trusted Web Activity)

The APK is a thin **TWA** wrapper around the live site, built with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap).

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://organizer.rohan-dhanawade.de/manifest.webmanifest
# accept defaults; package id: de.rohan_dhanawade.organizer
bubblewrap build
```

This produces `app-release-signed.apk` (and an `.aab` for Play Store).

**Digital Asset Links (removes the browser URL bar):**

1. Bubblewrap prints your signing key's **SHA-256 fingerprint** (also get it via
   `keytool -list -v -keystore android.keystore`).
2. Paste it into [`public/.well-known/assetlinks.json`](public/.well-known/assetlinks.json), replacing `REPLACE_WITH_YOUR_APK_SIGNING_KEY_SHA256_FINGERPRINT`.
3. Commit + redeploy so it's served at
   `https://organizer.rohan-dhanawade.de/.well-known/assetlinks.json`.
4. Reinstall the APK — the address bar disappears and it behaves as a native app.

> Because it's a TWA, the APK always reflects the deployed site — no rebuild needed for content/UI changes, only for icon/package/domain changes.

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run preview` | Preview the production build locally |
| `node scripts/gen-icons.mjs` | Regenerate PNG app icons from `public/favicon.svg` |
