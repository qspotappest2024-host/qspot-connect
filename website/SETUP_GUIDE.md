# QSpot Website — Deployment Setup Guide

Follow these steps **in order** to deploy the website to GitHub Pages with your
MapTiler API key kept secure (never committed to source code).

---

## Why the key is safe with this approach

Your MapTiler key lives in two places only:
1. **MapTiler dashboard** — where it's created and restricted by domain
2. **GitHub Secret** — encrypted, only injected into the build at deploy time

The `config.js` in your repo always contains the placeholder `YOUR_MAPTILER_API_KEY_HERE`.
The real key only exists in the deployed `_site/` artifact, which GitHub builds and serves
but which is never checked into your source tree.

---

## Step 1 — Restrict your MapTiler key to your domain

This is the most important security step. Even though the key is injected at build time,
it will appear in the deployed HTML source. Restricting it by domain means it won't
work if someone copies it and uses it from a different origin.

1. Go to [cloud.maptiler.com](https://cloud.maptiler.com/) and log in
2. Click your key → **Edit** (or click the key name)
3. Under **Allowed HTTP origins**, add:
   ```
   https://qspotappest2024-host.github.io
   ```
   If you have a custom domain (e.g. `www.qspot.app`), add that too:
   ```
   https://www.qspot.app
   ```
4. Save the key

After this, the key will silently fail if used from any other domain — preventing abuse.

---

## Step 2 — Add the key as a GitHub Secret

1. Open your `qspot-connect` repo on GitHub
2. Go to **Settings → Secrets and variables → Actions**
3. Click **New repository secret**
4. Set:
   - **Name:** `MAPTILER_API_KEY`
   - **Value:** your MapTiler key (the one shown in your dashboard)
5. Click **Add secret**

The secret is now encrypted. Even repo admins can't read it back — it can only be used
by GitHub Actions workflows.

---

## Step 3 — Configure GitHub Pages to use GitHub Actions

The deployment workflow uses the modern GitHub Actions Pages source (not the legacy
"Deploy from a branch" option).

1. In your `qspot-connect` repo, go to **Settings → Pages**
2. Under **Source**, select **GitHub Actions** (not "Deploy from a branch")
3. Save

---

## Step 4 — Push the website files to `qspot-connect`

Your `qspot-connect` repo currently has:
```
.well-known/          ← Android App Links (keep!)
stripe/               ← Stripe redirect pages (keep!)
.nojekyll
```

You need to add the website files alongside these. The GitHub Actions workflow handles
merging them at deploy time. Here's what to push:

```
.github/
  workflows/
    deploy.yml        ← The workflow file (from this guide)
website/
  index.html
  map.html
  about.html
  css/
    style.css
  js/
    config.js         ← Must contain placeholder, NOT your real key
    app.js
    map.js
.well-known/          ← Already in repo, leave as-is
stripe/               ← Already in repo, leave as-is
.nojekyll             ← Already in repo, leave as-is
```

### Option A: Using the terminal

```bash
# Clone your existing repo
git clone https://github.com/qspotappest2024-host/qspot-connect.git
cd qspot-connect

# Copy the website folder from your KMM project
cp -r /path/to/QSpotKMM/website ./website

# Copy the workflow file
mkdir -p .github/workflows
cp /path/to/QSpotKMM/website/.github/workflows/deploy.yml .github/workflows/deploy.yml

# Verify config.js still has placeholder (NOT your real key!)
grep "MAPTILER_API_KEY" website/js/config.js

# Commit and push
git add .github/ website/
git commit -m "Add QSpot website with Actions deployment"
git push origin main
```

### Option B: GitHub web UI (drag & drop)

1. On GitHub, click **Add file → Upload files** in your repo
2. Drag in the `website/` folder and the `.github/workflows/deploy.yml` file
3. Commit directly to `main`

---

## Step 5 — Verify the deployment

1. Go to your repo → **Actions** tab
2. You'll see a "Deploy QSpot Website" workflow running
3. Wait ~1-2 minutes for it to complete (green checkmark)
4. Visit `https://qspotappest2024-host.github.io/qspot-connect/`

Your site will have:
- `/` → QSpot landing page
- `/map.html` → Live map (MapLibre + MapTiler + Supabase)
- `/about.html` → About page
- `/.well-known/assetlinks.json` → Android App Links (preserved)
- `/stripe/refresh.html` → Stripe redirect (preserved)

---

## Step 6 — (Optional) Set up a custom domain

If you have a domain like `qspot.app`:

1. In repo **Settings → Pages**, enter your custom domain: `www.qspot.app`
2. Add a `CNAME` file to the website folder containing:
   ```
   www.qspot.app
   ```
3. At your DNS registrar, add:
   - `CNAME` record: `www` → `qspotappest2024-host.github.io`
   - For apex domain (`qspot.app`), add four `A` records pointing to GitHub's IPs:
     ```
     185.199.108.153
     185.199.109.153
     185.199.110.153
     185.199.111.153
     ```
4. Add `https://www.qspot.app` to your MapTiler allowed origins
5. GitHub auto-provisions an SSL certificate (takes ~15 min)

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Map shows "API key not configured" | Check the `MAPTILER_API_KEY` GitHub Secret is set correctly |
| Map tiles load but show error | Key may not be restricted to the right domain |
| `.well-known/assetlinks.json` returns 404 | Check the workflow copied `.well-known/` to `_site/` |
| Stripe redirect broken | Check `stripe/` folder was copied to `_site/` |
| Old "Deploy from branch" still active | Change Pages source to GitHub Actions in repo Settings |

---

## Checking the deployed key is working

After deployment, open `https://qspotappest2024-host.github.io/qspot-connect/map.html`
in your browser. Open DevTools → Network tab and look for requests to `api.maptiler.com`.
They should return 200. If you see 403, the key domain restriction may need updating.
