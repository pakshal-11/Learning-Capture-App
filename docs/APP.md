# App guide (Phase 2: web + Android)

One Expo (React Native) codebase in `apps/app`: the web app / PWA, and the Android APK. Phase 2a is the shared app;
Phase 2b (below) adds voice, screenshot reading, reminders, sharing and the floating button.

## Run it

```bash
pnpm install
# apps/app/.env (git-ignored) needs:
#   EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
#   EXPO_PUBLIC_SUPABASE_ANON_KEY=<publishable key>      (public by design)
#   EXPO_PUBLIC_DEV_PASSWORD_LOGIN=0                      (1 only for local testing)
pnpm --filter @learning-log/app web          # dev server on http://localhost:8081
pnpm --filter @learning-log/app export:web   # production build in apps/app/dist (with PWA tags)
```

Never ship a build with `EXPO_PUBLIC_DEV_PASSWORD_LOGIN=1`; it shows a password form meant for local testing.

## Before email sign-in works (one-time, in the Supabase dashboard)

Sign-in emails a numeric code, but Supabase's default emails only contain a link. Authentication > Emails (Templates):
edit both **Confirm signup** and **Magic Link** so the body contains `{{ .Token }}`, for example:

```html
<h2>Your Learning Log code</h2>
<p>Enter this code in the app:</p>
<h1>{{ .Token }}</h1>
<p>It expires in an hour. If you didn't ask for it, ignore this email.</p>
```

Your project sends 8-digit codes (the app accepts 6 to 10). Supabase's built-in email sender allows only a few emails per hour;
set up a free custom SMTP (Resend or Brevo) before inviting testers.

## How it works

- **Local first.** Every action (capture, edit, review) is applied on the device immediately and queued in an outbox
  (`src/lib/store.ts`). The sync engine (`src/lib/sync.ts`) sends the queue in order when online (on start, when the app comes
  to the foreground, when the network returns, every 30 s), then pulls server changes.
- **Storage.** IndexedDB on web (localStorage fallback), AsyncStorage on Android. Data is stored per user and wiped on sign-out.
- **Conflicts.** Last write wins per entry for text; the server always wins for review state, unless a review is still waiting
  to be sent. Reviews are append-only events, replayed idempotently by id.
- **Offline.** Capture, browse, search, entry detail and review (self-graded) work offline. AI organising, AI grading and
  "I'm stuck" need a connection; when AI is unavailable (offline, daily limit, monthly cap) the app says so plainly and offers
  self-grading or "save for later".
- **Routing.** `app/_layout.tsx` sends signed-out users to sign-in, new users to onboarding (profile + 18+ confirmation +
  consent), everyone else to the tabs.

Screens: Sign-in, Onboarding, Home (due + streak), Capture, Preview/Edit, Review, I'm stuck, Browse/search/filter,
Entry detail, Settings (profile, reminders, theme, sync, export, delete account), Admin (admins only), Privacy notice.
Light and dark themes follow the device (or the user's choice in Settings).

## Tests

```bash
pnpm test                  # 25 core tests + 31 app tests (merge/outbox, offline sync engine, service worker + push, calendar file)
pnpm typecheck
pnpm test:integration      # backend, against the real dev project (see TESTING.md)
```

## Phase 2b: capture extras, reminders, sharing

| Feature | Android app | Web / PWA / desktop |
|---|---|---|
| Voice | In-app **Speak** button (Google speech service, permission asked on first use) | No in-app mic (browsers send audio to a cloud service). Use the keyboard mic, or Win+H on Windows |
| Screenshot to text | Google ML Kit on the device: English and Hindi/Marathi | tesseract.js in the browser; the language file downloads on first use |
| Reminders | Expo Push Service (needs Firebase, see below) | Web Push (VAPID keys; iPhone only after Add to Home Screen) |
| Add to calendar | `.ics` through the Android share sheet | `.ics` download |
| Share into the app | Share > Learning Log (text, links, pictures) | PWA share target (`/capture?title=&text=&url=`) once installed |
| Quick-capture button | Floating + over other apps (Settings > Quick capture button) | n/a |
| Google sign-in | Via Supabase | Via Supabase |

Where the code is: `src/lib/{ocr,voice,push,calendar,ics,googleSignIn,ShareReceiver}` (the `.web.ts` variants are the browser versions),
`modules/floating-bubble` (Kotlin, a local Expo module), `public/sw.js` (push handlers), `app.json` + `app.config.js` (permissions, plugins).

### One-time setup for each feature

**Web push reminders**
1. `node scripts/make-vapid-keys.mjs --set-secrets` creates the key pair (kept in `.vapid.json`, git-ignored) and stores both halves in Supabase secrets.
2. Put the printed public key in `apps/app/.env` as `EXPO_PUBLIC_VAPID_PUBLIC_KEY` (and as a repository variable for hosted builds).
3. `supabase functions deploy dispatch-reminders`.

**Android reminders** (Expo Push Service delivers through Google's FCM)
1. Create a free Firebase project, add an Android app with id `in.co.bananaclub.learninglog`, download `google-services.json`.
2. Put it at `apps/app/google-services.json` (git-ignored), and for GitHub builds store `base64 google-services.json` as the secret `GOOGLE_SERVICES_JSON_BASE64`.
3. Create a free Expo account and project (`npx eas-cli init`), put its id in the repository variable `EAS_PROJECT_ID`, and upload the Firebase "FCM V1" service-account key under the project's credentials on expo.dev.

**Google sign-in**
1. Google Cloud console > APIs & Services > Credentials > OAuth client (type: Web). Authorised redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
2. Supabase > Authentication > Sign In / Providers > Google: paste the client id and secret.
3. Supabase > Authentication > URL Configuration > Redirect URLs: add your web address and `learninglog://auth-callback`.
4. Set `EXPO_PUBLIC_GOOGLE_SIGNIN=1` (in `.env`, and as a repository variable for builds).

### Building the Android app

GitHub > Actions > **Build Android APK** > Run workflow. First set the repository variables `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY` (Settings > Secrets and variables > Actions > Variables). The APK appears under the run's Artifacts.
It is signed with Expo's default debug key, which is fine for a test build (every build uses the same key, so updates install over each other).
The native code (speech, ML Kit, share intent, the bubble) cannot be compiled on a machine without the Android SDK, so the first run
of this workflow is the first real compile of it.

## Known limits

- Never compiled or run on an Android device yet (this machine has no Android SDK). The web side is tested; the Android side is written
  against the libraries' documented APIs and is checked by a local `expo prebuild` and type-checking only.
- Web push, the offline service worker and the PWA share target were tested by simulation only; check them in a real Chrome/Safari install.
- ML Kit reads Latin and Devanagari scripts only; in other languages the screenshot button works only on the web app (tesseract).
- A PWA share that arrives while signed out loses its text (the sign-in page doesn't carry it).
- The bubble is not restarted after a phone reboot; turn it on again in Settings.

## Never run `supabase config push`

It copies the local `supabase/config.toml` over the remote project's auth settings (confirmation, OTP length, rate limits, MFA).
`config.toml` is now kept in sync with the real project, but change auth settings in the dashboard instead.
