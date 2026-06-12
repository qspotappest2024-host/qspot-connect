# QSpot Web (GitHub Pages)

Static site for QSpot Premium subscription purchase and management.
Purchase happens via Stripe Checkout (hosted by Stripe); all server logic lives
in Supabase Edge Functions. **No secrets belong in this repo** — only the
Supabase anon key and the Stripe publishable key (both public by design).

## Files

| File | Purpose |
|---|---|
| `index.html` | Landing page (link Premium, future privacy policy / account deletion) |
| `premium.html` | Login + plan selection → `create-checkout-session` → Stripe Checkout |
| `premium-success.html` | Post-checkout confirmation |
| `account.html` | Manage membership: status, plan switch, keep-yearly, card update, cancel |
| `config.js` | **Fill in** anon key + Stripe publishable key before deploying |
| `CNAME` | Custom domain for GitHub Pages (`qspotmarketplace.com`) |

## Deploy

1. Create a GitHub repo (e.g. `qspot-web`), copy this folder's contents to its root, push.
2. Repo → Settings → Pages → Deploy from branch → `main` / root.
3. Custom domain: `qspotmarketplace.com` (the CNAME file handles this) + enforce HTTPS.
4. Porkbun DNS for qspotmarketplace.com:
   - A records on apex `@`: 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153
   - CNAME on `www` → `<your-github-username>.github.io`
5. Fill in `config.js`.

## Supabase configuration (one-time)

- Auth → URL Configuration → Redirect URLs: add
  `https://qspotmarketplace.com/premium.html`, `https://qspotmarketplace.com/account.html`
  (and the same paths under `https://www.qspotmarketplace.com` and your
  `https://<user>.github.io/<repo>` URL if testing pre-DNS).
- Edge Functions called from this site (CORS allows qspotmarketplace.com):
  `create-checkout-session`, `create-subscription` (not used by web but shares CORS),
  `switch-subscription-plan`, `cancel-subscription`, `cancel-scheduled-downgrade`,
  `create-setup-intent`.
- For pre-DNS testing from `*.github.io`:
  `supabase secrets set EXTRA_WEB_ORIGIN=https://<user>.github.io`

## Stripe configuration

- `stripe-subscription-webhook` endpoint must include the
  `checkout.session.completed` event.
