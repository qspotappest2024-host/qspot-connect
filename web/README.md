# QSpot Web — Premium subscription pages

Static pages for QSpot Premium purchase and management. Lives in the
`qspot-connect` repo as the `web/` folder and is served at
**https://www.qspotmarketplace.com/web/** by the existing GitHub Actions deploy
workflow. Purchase happens via Stripe Checkout (hosted by Stripe); all server
logic lives in Supabase Edge Functions. **No secrets belong in this repo** —
only the Supabase anon key and the Stripe publishable key (both public by design).

## Files

| File | Live URL | Purpose |
|---|---|---|
| `premium.html` | /web/premium.html | Login + plan selection → `create-checkout-session` → Stripe Checkout |
| `premium-success.html` | /web/premium-success.html | Post-checkout confirmation |
| `account.html` | /web/account.html | Manage: status, plan switch, keep-yearly, card update, cancel |
| `index.html` | /web/ | Mini landing (optional — safe to delete) |
| `config.js` | — | Anon key + Stripe publishable key (placeholders; injected by deploy.yml or filled manually) |
| `qspot.js` / `qspot.css` | — | Shared helpers / styles |

`CNAME` and `.nojekyll` in this folder are NOT needed in the qspot-connect repo
(the custom domain is set in Pages settings; `.nojekyll` is added by the workflow).
They only matter if this folder is ever deployed as its own standalone Pages repo.

## deploy.yml requirement

The qspot-connect workflow must copy this folder into the published artifact.
In the "Assemble site" step, alongside the `.well-known` and `stripe` blocks:

```yaml
          # Preserve QSpot Premium subscription pages (served at /web/)
          if [ -d "web" ]; then
            cp -r web _site/
            echo "✓ Copied web/"
          fi
```

Optional (mirrors the MapTiler pattern — inject keys from GitHub Secrets instead
of committing them in config.js):

```yaml
      - name: Inject web subscription keys
        env:
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          STRIPE_PUBLISHABLE_KEY: ${{ secrets.STRIPE_PUBLISHABLE_KEY }}
        run: |
          sed -i "s|PASTE_YOUR_SUPABASE_ANON_KEY_HERE|${SUPABASE_ANON_KEY}|g" web/config.js
          sed -i "s|PASTE_YOUR_STRIPE_PUBLISHABLE_KEY_HERE|${STRIPE_PUBLISHABLE_KEY}|g" web/config.js
```

(Place the inject step BEFORE "Assemble site". Both values are public-by-design,
so committing them directly in config.js is also acceptable.)

## Supabase configuration (one-time)

- Auth → URL Configuration → Redirect URLs:
  `https://www.qspotmarketplace.com/web/premium.html`
  `https://www.qspotmarketplace.com/web/account.html`
  (+ the `https://www.qspotmarketplace.com/...` variants if www resolves)
- Edge Function CORS already allows `qspotmarketplace.com` (+ optional
  `EXTRA_WEB_ORIGIN` secret for other origins).
- `create-checkout-session` success/cancel URLs default to
  `https://www.qspotmarketplace.com/web/...`. Override with:
  `supabase secrets set WEB_BASE_URL=...` if the pages move.

## Stripe configuration

- The `stripe-subscription-webhook` endpoint must include the
  `checkout.session.completed` event.

## Verify after deploy

1. https://www.qspotmarketplace.com/web/premium.html loads with plan cards
2. https://www.qspotmarketplace.com/web/config.js shows real (non-placeholder) values
3. Test checkout with card 4242 4242 4242 4242 (Stripe test mode)
