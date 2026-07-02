# Gemini Live API Key Setup — Auto-Fix Guide

## ⚠️ Current Status
- **Gemini Live is ENABLED on production** (build `3df6ae8`)
- **API Key is INVALID** — Google Cloud rejected it: `code=1008: invalid authentication credentials`
- **Email gate is OPEN** — any logged-in user can attempt Gemini

## 🔴 What Went Wrong
The key from `Desktop/voice-ai-harness/template/.env` is either:
- **Expired/revoked**
- **From a project without Generative Language API enabled**
- **From a project without billing active**
- **From a different Google Cloud account**

## ✅ How to Fix (5 minutes)

### Step 1: Open Google Cloud Console
1. Go to https://console.cloud.google.com
2. **Sign in with the Google account you want to use for Gemini**
3. Create or select an existing Google Cloud project

### Step 2: Enable Generative Language API
1. Go to **APIs & Services → Library**
2. Search for **"Generative Language API"**
3. Click it, then click **ENABLE**

### Step 3: Enable Billing
1. Go to **Billing**
2. Link a billing account to this project
3. **Billing must be active** (even for free-tier usage)

### Step 4: Create API Key
1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → API Key**
3. Copy the new key (looks like `AIzaSyD...`)
4. ⚠️ **SAVE IT SOMEWHERE SAFE** — you'll need it in 30 seconds

### Step 5: Add to Render
1. Go to **https://dashboard.render.com/web/srv-d8ktvpbeo5us73asj7i0/env**
2. Click **Edit**
3. Find the row with `GEMINI_API_KEY`
4. **Replace the value** with your new key from Step 4
5. Click **Save, rebuild, and deploy**
6. Wait ~2 min for Render to restart

### Step 6: Test
1. Put on **headphones**
2. Go to **https://bpo-combat-arena.vercel.app**
3. Start an interview
4. **Listen:** Does the voice sound human? Can you interrupt her? Can she cut you off?
5. If **YES** → Gemini is working. If **NO** → key is still bad.

## 🆘 If It Still Doesn't Work
- Check the **Render logs** (Dashboard → Logs) for `[geminiLive]` errors
- If you see `code=1008` again → key is still invalid (wrong project / no billing)
- If you see `code=401` → key is invalid format
- If you see `code=403` → API not enabled or billing not active

## 📌 Quick Checklist
- [ ] Google Cloud project created/selected
- [ ] Generative Language API **ENABLED**
- [ ] Billing account **LINKED** and **ACTIVE**
- [ ] API Key **CREATED** and **COPIED**
- [ ] Render `GEMINI_API_KEY` **UPDATED** with new key
- [ ] Render deploy **COMPLETE**
- [ ] Headphones on, tested, voice is **HUMAN**

---

**That's it.** Once you have a valid key, Gemini will work. The code is ready — it just needs the credentials.
