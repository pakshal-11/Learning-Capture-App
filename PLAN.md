# Learning Log: Build Plan (STEP 1)

Status: **draft for your approval. No code written.**
Date: 2026-10-30. Test build for 50-100 users. Target cost: near zero.

---

## 0. Summary of the approach

- One TypeScript monorepo (pnpm workspaces). One Expo app builds Android and web/PWA. Tauri wraps the web build for desktop.
- Supabase holds everything server-side: Postgres + pgvector, Auth, Edge Functions, `pg_cron`.
- **Every AI call goes through an Edge Function.** The function checks the per-user and global caps, calls `claude-haiku-5-5`, validates the JSON, and logs usage. The Anthropic key lives only in Edge Function secrets.
- Spaced-repetition logic is one pure TS module in `packages/core`. The same file runs in Edge Functions and on the client, and is unit-tested.
- **Local-first capture.** Notes are written to local storage with a client-generated UUID, then pushed through an outbox when online. Capture never waits for the network or the AI.

### Where "free" really stops
| Item | Reality |
|---|---|
| Supabase free | Free, but the project **pauses after 7 days of inactivity**, and there are no automatic backups. Secondary sources disagree on storage numbers (500 MB vs 1 GB). I'll check the dashboard and pricing page in Phase 0. |
| Anthropic API | **Not free.** It is pay-as-you-go. "Near zero" means a small prepaid balance plus our caps. I'll set a hard spend limit in the Anthropic console as a second backstop behind our own cap. |
| Embeddings | Free: `gte-small` runs inside Edge Functions (see risk R5). |
| Email OTP | Supabase's default SMTP is limited to a handful of emails per hour, so 50-100 testers need a free custom SMTP (Resend or Brevo free tier). |
| Hosting, CI, builds | Cloudflare Pages, GitHub Actions and GitHub Releases are free. Vercel Hobby is non-commercial only, so I recommend Cloudflare Pages. |
| Store releases | Not in scope. An Apple developer account is $99/yr, so **iOS = PWA only**. |

---

## 1. Architecture

```
 Clients (Expo RN app: Android + web/PWA;  Tauri shell = web build + tray + hotkey)
  |  local store (SQLite on Android, IndexedDB on web/desktop)  + outbox queue
  |  supabase-js (user JWT)  ------------------------------+
  v                                                         v
 Supabase Postgres (RLS on every table)            Edge Functions (Deno)
  profiles / entries / reviews / ...   <-- user-JWT   structure-note, grade-answer,
  pgvector (384-d) + FTS                client          next-question, find-stuck,
  pg_cron: reminders, embed queue                       stuck-feedback, embed-entry,
  usage_log, app_config                                 dispatch-reminders, health,
                                                        export-data, delete-account,
                                                        admin-usage, register-push
                                                            |
                                          +-----------------+----------------+
                                          v                                  v
                                  Anthropic API                       Expo Push / Web Push
                              (claude-haiku-5-5)                      (FCM-backed, free)
```

### Request path for every AI function
1. Verify the JWT. Run DB reads **with the user's JWT**, so RLS applies.
2. Call `reserve_ai_call(user, action)`. This is one atomic SQL function that checks the user's daily cap and the global monthly cap and reserves a slot. If either cap is hit, return a friendly `{ unavailable: true, reason }`.
3. Build a short prompt: cached static system instructions, then the user profile line, then only the relevant entries.
4. Call Haiku with a forced single-tool schema so the output is structured JSON. Validate with zod, and retry once on invalid output.
5. Write `usage_log` (tokens in/out, cached tokens, estimated cost) using the service role. Clients cannot write to `usage_log`.
6. Return the result.

Cost is computed from a small `ai_pricing` row in `app_config`, so a price change is a data edit, not a deploy. I'll pull the current Haiku 5.5 prices from the Anthropic docs in Phase 1 rather than hardcode them from memory.

### AI jobs
| Job | Function | Input to model | Notes |
|---|---|---|---|
| Structure note | `structure-note` | raw text + profile line | Returns topic, key_idea, recall_question, apply_it, category. The user previews and edits before saving. |
| Question variants | `next-question` | one entry | Cheaper path: `grade-answer` also returns the *next* question variant, which is stored on the entry. Normal review therefore costs **1 call, not 2**. |
| Grade answer | `grade-answer` | question + entry + user answer | Returns Correct/Partly/Missed, feedback, correct answer. The Edge Function then runs the shared SRS function and updates the schedule. |
| I'm stuck | `find-stuck` | problem text + ≤8 candidate entries (title + key idea only) | Retrieval is described in section 4. Haiku picks 1-3 or says "nothing relevant". |

Untrusted text (notes, pasted content, problem descriptions) is always wrapped in delimiters and labelled as data in the system prompt. The model has no tools except the output schema, so a prompt-injection can at worst produce a bad answer for that user's own data.

**Prompt caching:** I'll add `cache_control` on the static instructions. Caching has a minimum prompt length per model, and our prompts are intentionally short, so it may not trigger. I'll check the minimum for Haiku 5.5 and report the real cached-token numbers from `usage_log`. I won't pad prompts just to hit the cache.

---

## 2. Data model

All tables: `user_id uuid references auth.users on delete cascade`, RLS enabled.

| Table | Key columns |
|---|---|
| `profiles` | id (= auth uid), role_type (student/professional), field_of_study, year, profession, industry, role, experience_level, goals[], interests[], language, reminder_times (time[]), timezone, is_adult_confirmed, consent_version, consent_at, is_admin, streak_current, streak_best, last_review_date |
| `entries` | id (**client-generated uuid**), user_id, source_type (text/url/screenshot/voice), source_url, raw_text, topic, key_idea, recall_question, next_question, apply_it, category, structure_state (raw/structured), status (New/Reviewing/Mastered), next_review, times_reviewed, streak_correct, last_result, learned_at, embedding vector(384), fts tsvector (generated), client_updated_at, updated_at, deleted_at (soft delete for sync) |
| `reviews` | id, entry_id, user_id, question_shown, user_answer, grade, feedback, correct_answer, interval_days, reviewed_at. **Append-only event log**, so merges are trivial. |
| `problem_queries` | id, user_id, query_text, candidate_ids[], result jsonb, created_at |
| `feedback` | id, user_id, query_id, entry_id, rating (helped/partly/didnt) |
| `usage_log` | id, user_id, action, model, tokens_in, tokens_out, tokens_cached, est_cost_usd, created_at. Service-role insert only. Users can read their own rows. |

**Support tables I'm adding (needed, not in your list):**
- `app_config`: global monthly cap, per-user daily cap, pricing, kill switch.
- `push_subscriptions`: Expo token or web-push endpoint per device.
- `reminder_log`: avoids double-sending a reminder on the same day.

**Schema-only (created, RLS enabled, no user policies, so they are inert):**
- `shared_entries`: cleaned text, `consent` flag, profile tags, embedding vector, quality score.
- `sources`: for web enrichment.
- `media`: for future video.

### RLS approach
- `select/insert/update/delete` policies use `user_id = (select auth.uid())` on every user table. The `select` wrapper makes it a cached initplan.
- `with check` clauses stop a user inserting rows under someone else's id.
- Service role is used only for these jobs: writing `usage_log`, the push dispatcher, cron jobs, delete-account, and the admin RPC.
- Admin view = a `SECURITY DEFINER` RPC that checks `profiles.is_admin`, plus a `/admin` route that only shows for admins.
- **pgTAP tests prove isolation.** User A cannot read, update or delete User B's rows in any table, and the schema-only tables are unreachable.

### Scheduling rules (`packages/core/srs.ts`)
Plain function `applyResult(state, result, now) -> newState`. These are my readings of your rules; please confirm them in the questions below.

| Result | Effect |
|---|---|
| Correct | `streak_correct += 1`. Interval = [1, 3, 7, 14, 30][min(streak_correct, 5) - 1] days. At streak 5, status = Mastered and `next_review = null` (leaves the due queue; stays searchable and eligible for "I'm stuck"). |
| Partly | Due in 2 days. Streak neither advances nor resets. |
| Missed | Due next day. `streak_correct = 0`. Status back to Reviewing. |

Tests cover: each transition, boundary at 5, reset after Missed, Partly in the middle of a streak, timezone/day-rollover, and streak counting.

---

## 3. Capture, offline and sync

- **Capture flow:** type, paste, voice (on-device STT) or screenshot (on-device OCR). The result goes to local storage in under a second as `structure_state = raw`. Then, if online, `structure-note` runs and the user previews and edits. If offline, the note waits, and the user gets a "Structure now" prompt when back online.
- **Outbox:** a queue of pending writes. It flushes on app start, on regaining connectivity, and on a timer, with exponential backoff.
- **Conflicts:** last-write-wins per row, using `client_updated_at`. Reviews are append-only, so they never conflict. Soft deletes propagate.
- **Idempotency:** client-generated UUIDs mean a retried push can't create duplicates.
- **Offline limits (v1):** capture, browse, search (local text), entry detail **and review (self-graded)** work offline. Structuring, AI grading and "I'm stuck" need the network, because they need the AI.
- **Offline review (self-grade):** with no connection, the review screen shows the stored question, the user thinks or types an answer, taps "Show answer", then marks themselves Correct / Partly / Missed. The shared SRS module runs on the device and writes a `reviews` event with `grade_source = 'self'`. Offline uses the stored `recall_question` / `next_question`, so no AI is needed. On reconnect, the outbox replays review events in order through an idempotent `apply_review` RPC (keyed by review id), which re-runs the same SRS function server-side so both sides agree. Online, the default stays AI grading; self-grade is also offered as a manual override if the AI is unavailable (cap hit or error).
- **Storage by platform:** `expo-sqlite` on Android. On web/desktop I'll use IndexedDB behind the same small interface, because `expo-sqlite` web support is still experimental. A thin `LocalStore` interface keeps both swappable.

### Quick-capture entry points
| Platform | Mechanism |
|---|---|
| Android | Floating bubble (native Kotlin module, details in R1), plus an Android share target for text/URL/image. |
| Desktop | Tauri tray icon + global-shortcut plugin opening a small always-on-top capture window. |
| Web/iOS | In-app capture button; PWA Web Share Target where the browser supports it (Chrome/Android; limited on iOS). |

---

## 4. "I'm stuck" retrieval

1. Embed the problem text with `gte-small`, using the built-in `Supabase.ai.Session` in an Edge Function.
2. Run `match_entries(query_embedding, k=8)` as the user, so RLS scopes it to their own entries. Union with a Postgres full-text top-5 (hybrid), then dedupe.
3. Send ≤8 candidates (topic + key idea) to Haiku. It picks 1-3 and explains why each applies and how to use it. "Nothing relevant" is a valid, explicit output, and the prompt forbids forcing a match.
4. Show feedback buttons (Helped / Partly / Didn't help) and store them in `feedback`.

Embedding generation for new entries: a trigger enqueues a job, and `pg_cron` calls `embed-entry` in batches. Supabase documents this pattern as [Automatic embeddings](https://supabase.com/docs/guides/ai/automatic-embeddings.md), and I'll follow it.

**Verification status:** I confirmed the built-in `gte-small` API exists and is documented ([launch post](https://supabase.com/blog/ai-inference-now-available-in-supabase-edge-functions.md)). All sources I found are from 2024, and I found no 2026 confirmation and no deprecation notice. **I'll run a 20-line spike in Phase 0 against a real free-tier project** before building on it. If the spike fails, the fallback you specified applies: Postgres FTS + Haiku re-rank. The retrieval function is behind a single interface, so the swap is contained.

---

## 5. Reminders

- Each user has a timezone and one or more reminder times.
- `pg_cron` runs every 5 minutes and calls `dispatch-reminders`. It finds users whose reminder time fell in the last window, who have due entries, and who weren't already notified today (`reminder_log`).
- Android: `expo-notifications` + the **Expo Push Service**, which delivers through FCM and is free. It still needs a Firebase project and `google-services.json`. Tapping the notification deep-links to `/review`.
- Web/PWA: standard Web Push (VAPID keys + service worker). On iOS this only works once the PWA is added to the Home Screen (iOS 16.4+).
- Desktop: local scheduled notifications while the app is running in the tray. Web push in the Tauri webview is unreliable on Windows, so I won't depend on it.
- "Add to calendar": a client-generated `.ics` file for the entry's next review date. No OAuth.

---

## 6. Cost controls

- `reserve_ai_call()` enforces the per-user daily cap and the global monthly cap, atomically, before every call.
- Default proposals: **30 AI calls per user per day** and a **global cap of $10/month** (you set the real numbers; see questions). The Anthropic console limit is the hard backstop.
- When the global cap trips, the app shows a friendly "AI features temporarily unavailable" message. Capture, browse and local features keep working.
- Embedding calls are free (no cap needed) but rate-limited.
- Admin view: totals by day/action/user, tokens, and estimated cost vs cap.
- **Keep-alive:** a scheduled **GitHub Actions** workflow calls the `health` Edge Function daily, and that function runs a trivial query. I'm deliberately not relying on `pg_cron` alone, because in-database jobs may not count as project activity for the pause rule.
- Optional (recommended): weekly `pg_dump` to a private GitHub artifact, because the free tier has no backups.

---

## 7. Privacy and safety

- Pre-permission explainer screens before overlay, microphone and notification prompts. Each says what it's for and that nothing is read from other apps.
- No accessibility service, no usage-stats access, no screen capture API. Capture happens only when the user taps.
- Short privacy policy and consent screen. DPDP Act basics: clear notice of purpose, consent, withdrawal, access/export, erasure, a grievance contact, and disclosure that note text is sent to Anthropic for processing.
- DPDP needs verifiable parental consent for under-18s, so the test build will have an **18+ confirmation** (see questions).
- Entries are private by default. `export-data` returns all of the user's rows as JSON. `delete-account` deletes all user rows and the auth user.
- I'm not a lawyer. The policy text is a starting draft for you to have reviewed before wider release.

---

## 8. Screens

Onboarding (multi-step), Home (due today + streak), Capture, Preview/Edit, Review (question, answer, grade, feedback, next), I'm stuck, Browse/search/filter, Entry detail, Settings (reminders, data export, delete, privacy, theme), plus an Admin screen for admins only. Dark and light themes via tokens. Short, point-wise copy. UI language English in v1 (AI content follows the user's preferred language).

---

## 9. Folder structure

```
Learning Capture/
  PLAN.md
  package.json  pnpm-workspace.yaml  tsconfig.base.json
  apps/
    app/                      # Expo (Android + web/PWA)
      app/                    #   expo-router routes
      src/{features,components,lib,db,sync,theme}/
      modules/overlay/        #   Android native module (Kotlin): bubble + share
      plugins/                #   Expo config plugins
    desktop/                  # Tauri shell (src-tauri/: tray, hotkey, capture window)
  packages/
    core/                     # srs.ts (+tests), zod schemas, types, ics.ts
  supabase/
    config.toml  seed.sql
    migrations/               # schema, RLS, functions, cron
    functions/
      _shared/                #   auth, ai client, budget guard, cors, srs copy
      structure-note/ grade-answer/ next-question/ find-stuck/ stuck-feedback/
      embed-entry/ dispatch-reminders/ health/ export-data/ delete-account/
      admin-usage/ register-push/
    tests/{db,functions}/     # pgTAP RLS tests, Deno integration tests
  .github/workflows/          # ci, keepalive, build-apk, build-desktop, deploy-web
  docs/                       # README, TESTER_GUIDE, PRIVACY
```

`packages/core/srs.ts` is the source of truth. A small sync script copies it into `supabase/functions/_shared/`, and CI fails if they differ. This avoids Deno/Node import friction.

---

## 10. Phases and estimates

Estimates are focused build days, **excluding** your review time and account setup. Each phase ends with a summary, test steps, and a pause for your go-ahead.

| Phase | Scope | Est. |
|---|---|---|
| **0. Setup + spikes** | Monorepo scaffold, Supabase project, **embedding spike**, Haiku call spike with caching/usage numbers, cost model | 1-2 d |
| **1. Backend** | Migrations, RLS + pgTAP tests, all Edge Functions, SRS module + unit tests, caps/usage_log, keep-alive, export/delete, integration tests with a mocked Anthropic | 6-7 d |
| **2a. Web/mobile core** | Auth, onboarding, home, capture (text/URL), local store + outbox sync, preview/edit, review **(AI-graded online + self-graded offline)**, I'm stuck (text), browse/detail, settings, themes, PWA | 9-10 d |
| **2b. Native capture + reminders** | Android on-device voice STT, screenshot OCR (ML Kit on Android, `tesseract.js` on web/iOS PWA/desktop), push (Android + web), `.ics`, share target, **Android overlay bubble**, permission explainers | 6-8 d |
| **3. Desktop** | Tauri shell, tray, global hotkey, quick-capture window, local reminders, installer via GitHub Actions | 3-4 d |
| **4. Hardening + docs** | Admin view, privacy/consent text, README, tester guide, APK + desktop release builds, smoke test on real devices | 3-4 d |
| **Total** | | **~28-35 d** |

The uncertain items are R1 (overlay) and R5 (embeddings); the range reflects them.

---

## 11. Risks and assumptions

**R1. Android overlay bubble (highest risk).**
- Needs a custom native module, so **Expo Go won't work**: development builds only. The bubble is a `SYSTEM_ALERT_WINDOW` view hosted by a foreground service.
- Permission is granted manually in system settings ("Display over other apps"), so onboarding must walk the user there.
- Android 14/15 require a declared foreground-service type and restrict starting services from the background. Aggressive battery managers on Xiaomi/Oppo/Vivo/Samsung can kill the service, so the bubble may disappear on some phones.
- Play Store policy is strict on overlays, which is fine for sideloading but a later store-release concern.
- Tapping the bubble opens a small capture screen, not a full app launch. Cold start must stay under ~2s to meet the "under 10 seconds" goal.
- **Fallbacks I'll build in the same phase:** a persistent-notification quick-capture action and a share target, so capture works even where the bubble is killed.
- **Screenshot conflict:** capturing "the screen under the bubble" requires the MediaProjection API, which shows a system cast prompt and is close to screen recording (excluded). So screenshots come from the photo picker, share-sheet, or "latest screenshot", not live capture. See the questions.

**R2. Offline sync.** Last-write-wins is simple but can lose a concurrent edit made on two devices at once. Acceptable for a single-user notes app. Review and AI features are online-only in v1.

**R3. On-device voice and OCR.**
- Android: ML Kit text recognition and the system speech recognizer (on-device mode where the device has the language pack). Hindi and other Indian languages may not be available offline on every phone.
- Web and desktop have no ML Kit or Apple Vision. The browser Web Speech API sends audio to a cloud service in Chrome, so it is **not strictly on-device**, and it isn't reliable in Tauri webviews. For OCR I'd use `tesseract.js` (WASM, fully local). See the questions.
- iOS: PWA only, so no Apple Vision or native speech in this build.

**R4. Free-tier ceilings.** The 7-day pause (handled by keep-alive), no backups, storage and egress limits (secondary sources conflict on the exact numbers; [one overview](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/)). I'll verify against the real dashboard and pricing page in Phase 0 and report back. Edge Function CPU/wall-time limits matter for R5.

**R5. Supabase embeddings.**
- `gte-small` is 384-dimensional and mostly English. Retrieval for Hindi or other Indian-language notes may be weak. The hybrid FTS union and Haiku re-rank mitigate it, but I'd call this a known limitation.
- Cold-start latency and CPU limits for model load on the free tier are unverified. The Phase 0 spike decides this.
- Anthropic doesn't offer an embeddings model, so no alternative inside the same vendor.

**R6. Auth.**
- Default Supabase SMTP is rate-limited, so custom SMTP is required for OTP at this scale.
- Google sign-in on Android needs the signing key's SHA-1, so sideloaded APK builds must use one stable keystore. Desktop (Tauri) OAuth redirects are fiddly, so I'd do email OTP on desktop first.

**R7. Cost.** Per-user caps bound the worst case, but a pasted giant note could blow the token budget, so inputs are length-capped (for example 4,000 characters per note) before any call.

**R8. Build environment.** You're on Windows 11. The APK needs JDK + Android SDK (or EAS free builds, which are queue-limited), Tauri needs Rust + MSVC + WebView2, and local Supabase needs Docker Desktop. The macOS desktop installer needs a macOS CI runner. Default plan: GitHub Actions builds the APK and the Windows/macOS/Linux installers, and unsigned installers will show SmartScreen/Gatekeeper warnings. I'll document the click-through for testers.

**Assumptions:** testers are 18+; English UI; one device per user is the common case; no iOS native app; Expo Push Service is acceptable as the FCM path; the NOT-in-this-build list stays out (no web enrichment, cross-user learning, WhatsApp, or video).

---

## 12a. Decisions locked (your answers, round 1)

| # | Decision |
|---|---|
| Screenshots | Photo picker / share sheet / "latest screenshot". No live screen capture for now. |
| Pasted URLs | **Store the link as a reference only.** AI structures the text the user typed or pasted. The server never opens the link. Fetching and summarising pages is deferred to the web-enrichment phase (needs budget). |
| Partly | Streak unchanged; entry comes back in 2 days. |
| Mastered | After 5 Correct in a row, leaves the due queue. Stays searchable and usable in "I'm stuck". |
| "Helped" (I'm stuck) | Counts as one Correct review of that entry. "Partly" changes nothing. "Didn't help" is logged only. |
| Offline review | **In scope now:** self-graded (Correct / Partly / Missed) when offline. Synced later through the outbox. |
| Budget | $10/month global cap, 30 AI calls/user/day. |
| Voice and OCR | Voice: real on-device mic in the Android app; on iOS PWA, web and desktop, users use the device's own dictation (keyboard mic, Win+H). OCR: ML Kit on Android; `tesseract.js` (on-device) on iOS PWA, web and desktop. |
| iOS | PWA only (Add to Home Screen). No bubble; push needs Home Screen install on iOS 16.4+. |
| Repo / CI | **Private repo.** GitHub Actions builds the APK and the Windows installer. No macOS installer (Mac users use the web/PWA). A Linux installer can be added later cheaply. |
| Accounts / tools | You have none yet. I guide each setup just in time. Docker, Android Studio and Rust are not needed; GitHub Actions builds and runs DB tests. You need Node.js and Git on your PC (checked in Phase 0). |
| Defaults still applying | Email OTP (all) + Google sign-in (web/Android); 18+ confirmation; Expo Push Service; Cloudflare Pages; package id `in.co.bananaclub.learninglog`; scaffold in `Learning Capture/`. |

---

## 12. Original questions (answered above where listed; kept for reference)

Each has a recommended default. If you reply "approved, defaults are fine", I'll use them.

1. **Screenshots on Android:** OK to use photo picker / share-sheet / "latest screenshot" instead of live screen capture? *Default: yes.*
2. **Pasted URLs:** store the URL and the user's own note only, with no server-side page fetching (that's web enrichment, Phase 2, and an SSRF/cost risk)? *Default: yes, no fetching.*
3. **Sign-in:** Email OTP on all platforms; Google sign-in on web + Android only. OK? *Default: yes.*
4. **SRS semantics:** please confirm (a) Partly neither advances nor resets the streak, (b) Mastered entries leave the due queue (no further reviews unless reset), (c) "Helped" in I'm stuck counts as one Correct review of that entry, "Partly" changes nothing, "Didn't help" is logged only. *Default: all three as stated.*
5. **Offline review:** disabled in v1 because grading needs the AI. Is that acceptable, or do you want a self-grade fallback? *Default: disabled.*
6. **Budget numbers:** monthly global cap and per-user daily cap? *Default: $10 / month and 30 calls / user / day.*
7. **Age:** require an 18+ confirmation at sign-up for the test build (DPDP parental-consent rules)? *Default: yes.*
8. **Web/desktop voice and OCR:** OK to use `tesseract.js` for OCR, and the browser speech API for voice with a clear "may use the browser's cloud service" notice, or should voice and OCR be Android-only in this build? *Default: Android-only for voice and OCR; web/desktop get typed notes, paste, and clipboard-image OCR via tesseract.js in a later phase.*
9. **Push path:** Expo Push Service (FCM-backed, free) rather than calling FCM directly? *Default: Expo Push.*
10. **Hosting:** Cloudflare Pages for web. Will the GitHub repo be public or private? (This affects free CI minutes for macOS builds.) *Default: Cloudflare Pages, private repo.*
11. **Accounts I'll need you to create** (I'll give step-by-step instructions when we reach each one): Supabase project, Anthropic API key with a prepaid balance and spend limit, Firebase project, Google Cloud OAuth client, Cloudflare, GitHub, and a Resend or Brevo free SMTP account.
12. **Your machine:** is Docker Desktop installed? Do you have Android Studio / JDK and Rust, or should I rely on GitHub Actions for all builds? *Default: GitHub Actions builds the release artifacts; local dev uses the web build.*
13. **Identifiers:** app name "Learning Log", Android package `in.co.bananaclub.learninglog`. OK, or do you prefer another?
14. **Project folder:** I'll scaffold directly inside `Learning Capture/`. OK?

---

Sources used: [Supabase AI inference in Edge Functions](https://supabase.com/blog/ai-inference-now-available-in-supabase-edge-functions.md), [Supabase automatic embeddings](https://supabase.com/docs/guides/ai/automatic-embeddings.md), [Supabase free-plan overview](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/).
