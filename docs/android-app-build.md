# Ship OMNI-PERFORM as a native Android app (voice works for everyone)

**Why:** The mic can never work inside the Facebook/Messenger in-app browser (Meta blocks it).
A native Android app holds the phone's microphone permission itself, so voice works every time,
no matter where the user came from. This wraps the **existing** live app — no rewrite.

The app is a "Trusted Web Activity" (TWA): it runs your real site (bpo-combat-arena.vercel.app)
inside Chrome's engine, full-screen, with native mic access.

---

## One-time setup (≈20 min, $0)

### 1. Generate the Android package with PWABuilder (free)
1. Go to **https://www.pwabuilder.com**
2. Enter your URL: `https://bpo-combat-arena.vercel.app` → **Start**
3. It scores your PWA (manifest + service worker are already in place) → click **Package for stores**
4. Choose **Android** → **Generate Package**
5. In the options, set **Package ID** to exactly:
   ```
   app.omniperform.arena
   ```
   ⚠️ It MUST match this — it's already wired into `/.well-known/assetlinks.json`. If you change it,
   change it in that file too (see step 3).
6. Download the ZIP. It contains:
   - `app-release-signed.apk`  ← the installable app
   - `app-release-bundle.aab`  ← for Google Play
   - `signing-key-info.txt` (or similar) ← **keep this safe**, it has your signing key + password
   - `assetlinks.json` ← the real one, with your key's fingerprint

### 2. Get the fingerprint
Open the `assetlinks.json` that PWABuilder gave you (or `signing-key-info.txt`). Copy the
`sha256_cert_fingerprints` value — a long `AB:CD:EF:...` string.

### 3. Put the fingerprint into this repo and redeploy
1. Open `client/public/.well-known/assetlinks.json`
2. Replace `REPLACE_WITH_SHA256_FINGERPRINT_FROM_PWABUILDER` with the fingerprint from step 2
3. Commit + push to `main` → Vercel redeploys. Verify it's live:
   ```
   https://bpo-combat-arena.vercel.app/.well-known/assetlinks.json
   ```
   (should show your fingerprint, not the placeholder)

This binds the app to your domain so it launches clean (no browser address bar) and is verified as yours.

---

## Test BEFORE you distribute (do not skip)
1. Send `app-release-signed.apk` to a real Android phone (WhatsApp/Telegram to yourself or Abdélrahman).
2. On the phone: tap the APK → allow "install from this source" → install → open.
3. **Grant the microphone permission** when it asks.
4. Start an interview and **talk**. Confirm the mic actually works and the interviewer hears you.

Only once voice is confirmed on a real phone do you share it widely.

---

## Distribute
- **Direct APK (fastest, $0):** host `app-release-signed.apk` (e.g. on your site or a Drive link) and
  post it in your Facebook/WhatsApp groups: *"Install the app for voice — [link]."* No store review.
- **Google Play (wider reach, $25 one-time):** upload the `.aab` at https://play.google.com/console.
  Takes a few days to review the first time.

---

## Notes
- **iOS** is a separate, smaller step for Egypt: users can "Add to Home Screen" from Safari today
  (mic works in that standalone mode). A full App Store app needs Apple's $99/yr developer account.
- The web app + the "Open in Chrome" card stay live as the safety net for anyone who taps a link
  before installing the app.
- Runtime cost stays **$0** — the app is still just your Vercel + Render backend; the wrapper adds nothing.
