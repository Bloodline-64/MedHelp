# Scan & Help

A mobile-first camera scanner and everyday assistant that explains what it sees and tells you what to do next. Point it at an injury, a letter, a medicine label, a plant, a bill or almost anything and Gemini vision returns a clear result: what is visible, what to do, warning signs, and confidence. You can also open **Ask** and type, dictate or photograph a question to get a direct answer.

It is a **static PWA** — no backend. Deploy it to Cloudflare Workers (static assets), open it on a phone, and add it to the home screen.

## What it can do

| Mode | What you get |
| --- | --- |
| **Smart scan** | Detects what the photo shows and picks the right kind of help automatically |
| **Injury / skin** | What is visibly apparent, safe first-aid steps, red flags, urgency level |
| **Text & reading** | Verbatim transcription, plain-language explanation, action points |
| **Document** | Letters, bills, forms: who sent it, dates, amounts, deadlines, checklist |
| **Medicine label** | Name, strength, directions, warnings, expiry — with a strong "confirm with a pharmacist" guard |
| **Object / plant / food** | Identification, useful facts, toxicity and safety warnings |
| **Ask** | Any question, with or without a photo: a direct answer that keeps the conversation context |

Every result includes:

- **Urgency banner** — emergency / urgent / soon / self-care / unknown
- **What I can see** — visible findings only, no invented details
- **What to do** — numbered, practical next steps
- **Get help urgently if** — red flags (shown first for injuries and medicine)
- **Text found** — full transcription for documents and labels
- **Confidence** — high / medium / low, with honesty about blurry photos
- **Follow-up chat** — ask questions about the scan you just took
- **Ask station** — ask anything with or without a photo, keep context across follow-ups, and save any answer to History
- **Voice** — dictate a question in supported browsers, and hear answers read aloud
- **History** — last 40 scans and answers saved privately in the browser, searchable
- **Appearance** — light, dark or follow your device, chosen in Settings and remembered on the device
- **Adaptive layout** — phones get a compact touch layout, tablets get multi-column history and a floating result dialog, and desktops get a navigation rail plus two-column scan and ask screens
- **Cloud sync** — keep scans, answers, settings and the Gemini API key in step across devices through your own encrypted Supabase row
- **Email / file backup** — optional EmailJS copy, plus download and restore a JSON file
- **Copy / share** — send a plain-text summary anywhere

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build:

```bash
npm run build      # type-check + static build into dist/
npm run preview    # http://localhost:4175
```

Camera access works on `localhost`. On a phone over the LAN, camera requires HTTPS — use the Cloudflare deployment or a tunnel.

## Set up AI (one minute)

1. Open the app → **Settings**.
2. Create a free key at <https://aistudio.google.com/apikey>.
3. Paste the key, keep `gemini-3.6-flash`, press **Save settings**, then **Test connection**.
4. Optional: press **Find models** to list every Gemini model the key can use.

The key is stored in `localStorage` in this browser only. It is sent directly to Google's OpenAI-compatible endpoint (`generativelanguage.googleapis.com`). There is no Scan & Help server and no analytics. Do not configure a key on a shared computer.

Without a key, the app still works as an offline text scanner: local Tesseract OCR reads text on the device and saves it to history. Injury, object and medicine modes need AI vision, and the **Ask** station needs an AI key.

## Ask anything

Open **Ask** in the bottom bar. Type a question, paste an image with Ctrl+V, or attach a photo. The assistant answers in plain language and keeps earlier turns in context, so you can follow up without repeating yourself.

- **Dictate** — the microphone button uses the browser's speech recognition (Chrome and Edge on most devices). It fills the text box; check the wording before sending.
- **Read aloud** — every answer has a Read button that uses the browser's built-in speech synthesis. Press Stop to cancel.
- **Save** — save any answer to History. Saved answers sync and back up with scans.
- **Clear** — the trash icon removes the conversation from this browser.
- The last 40 messages are kept in `localStorage`. The API key and privacy rules are the same as scanning.

## Cloud sync with Supabase (recommended)

Keep the same scans, answers, settings and Gemini API key on your phone, tablet and computer. The app talks directly to a free [Supabase](https://supabase.com) project that you own — there is still no Scan & Help backend.

Everything leaves the browser as the same gzipped, AES-GCM encrypted `SHB1:` payload used by file backups, so Supabase only stores an unreadable blob. The passphrase never leaves the device unless you tick **Remember the passphrase**. Without it, nobody — including Supabase — can read your scans, answers or API key.

What syncs:

- every saved scan and answer, including thumbnails
- the Gemini API key, model, endpoint and vision setting
- the email backup settings

### One-time setup

1. Create a free project at <https://supabase.com/dashboard>.
2. In **Project Settings → API**, copy the **Project URL** and the **publishable / anon key**.
3. Open **SQL Editor → New query**, paste this SQL and press **Run**:

   ```sql
   create table if not exists public.sync_state (
     user_id uuid primary key references auth.users(id) on delete cascade,
     payload text not null,
     updated_at timestamptz not null default now(),
     device text
   );

   alter table public.sync_state enable row level security;

   drop policy if exists "read own sync" on public.sync_state;
   drop policy if exists "insert own sync" on public.sync_state;
   drop policy if exists "update own sync" on public.sync_state;
   drop policy if exists "delete own sync" on public.sync_state;

   create policy "read own sync" on public.sync_state
     for select using (auth.uid() = user_id);
   create policy "insert own sync" on public.sync_state
     for insert with check (auth.uid() = user_id);
   create policy "update own sync" on public.sync_state
     for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
   create policy "delete own sync" on public.sync_state
     for delete using (auth.uid() = user_id);
   ```

4. Optional but simplest: **Authentication → Sign In / Providers → Email** and turn off **Confirm email**, so a new account works immediately. If you leave it on, open the confirmation link first.
5. In Scan & Help → **Settings → Cloud sync**, paste the URL and key, create an account, choose a passphrase and press **Sync now**.

### Day to day

- **Sync now** (in Settings, or the refresh icon in the History header) pulls changes from your other devices, merges them, then uploads the result — so no scan is overwritten.
- **Sync automatically** uploads after each scan or saved answer and checks for changes when the app opens or returns to view.
- Row-level security means each account can only read and write its own row.
- To set up a new device: install the app, enter the same project URL and anon key, sign in with the same email and password, enter the same passphrase, then press **Sync now**.

## Email backup (optional)

The app can also email itself a complete backup. A static site cannot send mail on its own, so this uses your own free [EmailJS](https://www.emailjs.com) account.

The backup contains:

- every saved scan and answer (title, transcription, summary, findings, advice, red flags)
- the Gemini API key, model, endpoint and vision setting
- the email backup settings themselves

Photos are not emailed (the EmailJS free plan caps a message at 50 KB); the text history and settings are.

### One-time EmailJS setup

1. Create a free account at <https://www.emailjs.com> and connect Gmail, Outlook or another service. Copy its **Service ID**.
2. Create an email template:
   - **To Email**: `{{to_email}}`
   - **Subject**: `Scan & Help backup {{exported_at}}`
   - **Content**: `<div style="white-space:pre-wrap">{{message}}</div>`
   - Copy its **Template ID**.
3. Copy the **Public Key** from the EmailJS account page.
4. In Scan & Help → **Settings → Email a backup instead**, paste the email address, Service ID, Template ID and Public Key, choose a passphrase, then press **Send backup now**.

Tick **Send automatically after every scan or saved answer** to keep the mailbox up to date. Each scan or saved answer sends one email (free plan: 200 a month), and the passphrase is kept for the browser session only — enter it again after reopening the app.

### Restore

Settings → **Cloud sync → Restore from a file or backup code** (or the same panel in the email card): paste the `SHB1:…` code from the email or load a downloaded `.json`, enter the passphrase, then choose **Merge** (keep scans made on this device) or **Replace**. The Gemini key and settings are restored along with the history.

### Without EmailJS

Use **Download file** for a full JSON backup, including thumbnails; the restore panel accepts it. The send icon in the **History** header appears once EmailJS is configured.

Backups are compressed and encrypted in the browser with AES-GCM and PBKDF2 (150,000 iterations). If you turn encryption off, the email contains your API key in plain text — keep that message private.

## Deploy to Cloudflare

The app is deployed as a **static-assets Worker** (`wrangler.toml` → `[assets] directory = "./dist"`), which is what Cloudflare's Git build runs by default (`npx wrangler deploy`).

### Option A — Wrangler (fastest)

```bash
npm install
npx wrangler login
npm run deploy
```

`npm run deploy` builds the app and uploads `dist/` to a project named `scan-and-help`. The first run creates the project and prints the public URL. Subsequent runs publish a new deployment.

If you want a different project name, edit the `deploy` script in `package.json` and `name` in `wrangler.toml`.

### Option B — Git integration

1. Push this folder to GitHub/GitLab.
2. Cloudflare dashboard → **Workers & Pages → Create → connect your Git repository**.
3. Build command: `npm run build`
4. Build output directory: `dist`
5. Deploy command: `npx wrangler deploy`

The build output must be `dist`, which is where the `[assets]` block points. Every push to the branch then publishes automatically.

If your project shows a classic **Pages** build form instead (no deploy command field), select `dist` as the output directory and leave the deploy command empty.

> Do not create the project as Cloudflare **Pages** and then run `npx wrangler deploy`. Wrangler rejects a Pages config (`pages_build_output_dir`) for Workers deploys, which is what caused `Missing entry-point to Worker script or to assets directory`. Pick one product and keep the config and the deploy command aligned.

### Cloudflare settings included

- `public/_headers` sets `Permissions-Policy: camera=(self)`, `nosniff`, frame and referrer protection.
- `public/manifest.webmanifest` + `public/sw.js` make it installable and offline-capable after the first visit.
- The service worker caches the app shell and hashed assets at runtime; API calls and Tesseract CDN downloads are never cached.

## Safety and limits

- **Not a medical device.** Injury and medicine results are general information, not diagnosis or prescription. Emergency symptoms → call your local emergency number.
- **Plants, mushrooms and wild food** are never identified with certainty. Do not eat anything based on a photo.
- **AI can misread text.** Check names, amounts, dates and deadlines against the original.
- Photos are downscaled in the browser before upload. Results, answers and thumbnails stay in `localStorage`; clearing site data removes them unless cloud sync or a file backup keeps a copy.
- **Voice input** uses the browser's speech recognition and may send audio to your browser vendor. **Read aloud** uses the browser's built-in speech synthesis and does not upload anything.
- Cloud sync uploads one encrypted row per account to your own Supabase project. The passphrase exists only on your devices.
- The offline text fallback downloads Tesseract.js from jsDelivr/unpkg the first time it is used. It runs in your browser. If you keep a Gemini key configured on this device, only use the fallback if you trust that CDN.
- Animal bites, deep or gaping wounds, uncontrolled bleeding, confusion, breathing trouble and eye injuries always need professional care.

## Project layout

```
src/
  App.tsx                 tab shell, install prompt, history state
  screens/ScanScreen.tsx  camera, upload, paste, scan flow, follow-up chat
  screens/AskScreen.tsx   ask-anything chat, photos, voice input/output, save answers
  screens/HistoryScreen.tsx
  screens/SettingsScreen.tsx
  components/ResultCard.tsx
  components/SyncCard.tsx       Email (EmailJS) backup card
  components/CloudSyncCard.tsx  Supabase sync card
  components/Icon.tsx
  components/Toast.tsx
  lib/ai.ts               Gemini client, prompts, JSON parsing, thumbnails
  lib/ask.ts              local Ask conversation storage
  lib/ocr.ts              offline Tesseract fallback
  lib/history.ts          local history (max 40)
  lib/backup.ts           encryption, EmailJS, file backup/restore
  lib/supabase.ts         Supabase auth + encrypted cloud sync
  lib/useAI.ts            live AI settings state
  types.ts                scan modes, result types, disclaimers
public/
  manifest.webmanifest, sw.js, icons, _headers
```

Built with React 18 + TypeScript + Vite. No UI framework and no backend of our own; optional sync uses your own Supabase project.
