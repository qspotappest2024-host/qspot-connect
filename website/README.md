# QSpot Marketing Website

A lightweight static marketing website for QSpot — the peer-to-peer marketplace app.

## Pages

- **index.html** — Landing page with hero, features, how-it-works, and download CTAs
- **map.html** — Interactive map showing all live spots (read-only, from Supabase)
- **about.html** — About/mission page with contact form

## Tech Stack

| Layer | Technology | Cost |
|-------|-----------|------|
| Hosting | GitHub Pages | Free |
| Maps | MapLibre GL JS + MapTiler | Free (100k loads/month) |
| Data | Supabase PostgREST (read-only, anon key + RLS) | Free tier |
| Styling | Custom CSS (no frameworks) | Free |

## Setup Instructions

### 1. Get a MapTiler API Key (free)

1. Go to [cloud.maptiler.com](https://cloud.maptiler.com/) and create a free account
2. Create a new API key (the free tier gives you 100,000 map loads per month)
3. Open `js/config.js` and replace `YOUR_MAPTILER_API_KEY_HERE` with your key:

```js
MAPTILER_API_KEY: 'your-actual-key-here',
```

### 2. Deploy to GitHub Pages

**Option A: Deploy from this repo (recommended)**

1. Push the `website/` folder to your GitHub repo
2. Go to repo **Settings → Pages**
3. Under "Source", select **Deploy from a branch**
4. Set branch to `main` and folder to `/website`
5. Click Save — your site will be live at `https://<username>.github.io/<repo>/`

**Option B: Standalone repo**

1. Create a new GitHub repo (e.g., `qspot-website`)
2. Copy the contents of this `website/` folder into the repo root
3. Push to GitHub
4. Go to repo **Settings → Pages → Deploy from a branch → main / root**
5. Site goes live at `https://<username>.github.io/qspot-website/`

**Option C: Custom domain**

1. Follow Option A or B above
2. In **Settings → Pages**, enter your custom domain (e.g., `www.qspot.app`)
3. Add a `CNAME` file in the website root containing your domain
4. Configure DNS at your registrar:
   - CNAME record: `www` → `<username>.github.io`
   - A records for apex domain: GitHub's IPs (see [GitHub docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site))

### 3. Configure App Store Links

When your app is published, update the links in `js/config.js`:

```js
APP_STORE_URL: 'https://apps.apple.com/app/qspot/id...',
PLAY_STORE_URL: 'https://play.google.com/store/apps/details?id=com.qspot.qspot',
```

## File Structure

```
website/
├── index.html          # Home / landing page
├── map.html            # Live map page
├── about.html          # About + contact page
├── css/
│   └── style.css       # All styles (branding, layout, responsive)
├── js/
│   ├── config.js       # API keys and configuration (edit this!)
│   ├── app.js          # Shared JS (nav, utilities)
│   └── map.js          # MapLibre + Supabase spot fetching
├── assets/             # Images, icons (add your own)
└── README.md           # This file
```

## How the Live Map Works

1. `map.js` makes a REST API call to your Supabase `spots` table
2. Supabase RLS policy `spots_select_anon_live_only` ensures only active, available spots are returned
3. Spots are rendered as purple markers on a MapLibre GL map
4. Clicking a marker shows a popup with the spot's name, category, price, and rating
5. Users see a "View in App" button — they can't book or interact on the website

**Security:** The anon key in `config.js` is safe to expose publicly. Your RLS policies enforce read-only access to active spots only. Anonymous users cannot insert, update, or delete anything.

## Upgrading Later

This website is intentionally simple — here's how to grow it:

| Upgrade | How |
|---------|-----|
| **Custom domain** | Add CNAME file, configure DNS |
| **SEO** | Add sitemap.xml, robots.txt, structured data |
| **Analytics** | Add Google Analytics or Plausible (privacy-friendly) |
| **Blog** | Add a `/blog` folder with markdown → HTML, or switch to a static site generator (Hugo, Astro) |
| **Contact form** | Wire up to [Formspree](https://formspree.io/) (free tier) or a Supabase Edge Function |
| **Framework migration** | Move to Astro, Next.js, or SvelteKit when you need dynamic features |
| **Spot detail pages** | Add `spot.html?id=xxx` with deep linking to the app |
| **App Store badges** | Replace text buttons with official Apple/Google badge images |
| **Images/branding** | Add logo, screenshots, and promotional images to `assets/` |

## Cost Summary

| Service | Free Tier | Paid If Needed |
|---------|-----------|----------------|
| GitHub Pages | Free (100GB bandwidth/month) | N/A |
| MapTiler | 100k map loads/month | $25/mo for 500k |
| Supabase | 500MB DB, 50k API requests/month | $25/mo for more |
| **Total** | **$0/month** | ~$25-50/mo at scale |
