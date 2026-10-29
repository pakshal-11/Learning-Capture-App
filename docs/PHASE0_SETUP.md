# Phase 0: Setup and spikes (your steps)

Do these in order. Never paste secrets into chat. Type them only in your own terminal or the websites below.

## A. Accounts (about 20 minutes)

### 1. GitHub (private repo)
1. Sign in at github.com, click **New repository**.
2. Name: `learning-log`. Choose **Private**. Do not add a README or .gitignore.
3. Tell me the repo URL. I will give you the 3 commands to push the code.

### 2. Supabase (free)
1. Sign up at supabase.com (use GitHub sign-in).
2. **New project**: name `learning-log-dev`, pick a strong database password (save it in a password manager), **Region: South Asia (Mumbai)**, plan **Free**.
3. When ready, open **Project Settings > General** and copy the **Project ID** (a short code like `abcdefghijklmnop`). Share that with me. It is not secret.
4. Later we create a second project `learning-log-prod`. The free plan allows 2.

### 3. Anthropic API (small prepaid balance)
1. Go to console.anthropic.com and create an account.
2. **Billing**: add a card and buy the minimum credit. Turn **auto-reload OFF**.
3. **Limits**: set the monthly spend limit to **$10**.
4. **API keys**: create a key named `learning-log-dev`. Keep the page open until step B.

## B. Connect and run the spikes (about 15 minutes)

Open PowerShell in the project folder (`Learning Capture`).

```powershell
# 1. Log in and link (replace PROJECT_ID)
supabase login
supabase link --project-ref PROJECT_ID

# 2. Set secrets (replace the placeholders; the Anthropic key stays in your terminal only)
supabase secrets set SPIKE_SECRET=pick-any-random-string-here
supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key-here

# 3. Deploy the two test functions
supabase functions deploy spike-embed --no-verify-jwt
supabase functions deploy spike-haiku --no-verify-jwt
```

Then run each test (replace PROJECT_ID and the secret). Run the Haiku one **twice**, a few seconds apart, so we can see caching.

```powershell
curl.exe -s -H "x-spike-secret: pick-any-random-string-here" https://PROJECT_ID.supabase.co/functions/v1/spike-embed
curl.exe -s -H "x-spike-secret: pick-any-random-string-here" https://PROJECT_ID.supabase.co/functions/v1/spike-haiku
curl.exe -s -H "x-spike-secret: pick-any-random-string-here" https://PROJECT_ID.supabase.co/functions/v1/spike-haiku
```

Paste me the three outputs. They contain no secrets.

## C. What I am checking
- **Embeddings:** model loads on the free plan, vector size, cold vs warm speed, and whether Hindi text matches a Hindi/English query sensibly.
- **Haiku:** structured JSON works, real token counts, whether prompt caching kicks in, and real cost per call.

## D. Results (2026-10-30, project `jokxkupgapfuiqhwvosi`, Mumbai)

**Embeddings (`gte-small`, built-in): PASS**
- 384 dimensions. First call 121 ms, warm call 120 ms (no cold-start problem; within the 2 s CPU limit).
- English query vs English docs: relevant 0.873, irrelevant 0.720 (gap 0.153). Good.
- English query vs Hindi docs: relevant 0.812, irrelevant 0.754 (gap 0.058). Ranks correctly but weakly.
- Decision: keep built-in embeddings for retrieval. Hindi and other non-English notes get a weaker signal, so "I'm stuck" uses hybrid search (vectors + full-text) and Haiku re-ranking, as planned.

**Haiku 5.5 (`claude-haiku-5-5`): PASS**
- Forced tool schema returns valid structured JSON; quality is good.
- About 2.1 s per call. 284 uncached input tokens + 513 cached tokens + about 320 output tokens.
- Prompt caching works at 513 tokens: the second call read 513 tokens from cache.
- Cost: $0.000255 (first call, cache write) and $0.000193 (cached). At about $0.0002 per call, 100 users hitting the 30-call daily cap every day would cost roughly $18 a month, so the $10 global cap is a real safeguard and normal use will be far below it.

## E. Cleanup (done)
Both spike functions were deleted from Supabase and from the repo. `SPIKE_SECRET` is being removed.
