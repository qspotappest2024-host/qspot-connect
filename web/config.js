// QSpot web app configuration
// ─────────────────────────────────────────────────────────────────────────────
// Every value here is PUBLIC by design:
//  • SUPABASE_URL / SUPABASE_ANON_KEY — same values as secrets.properties
//    (the anon key is the public client key; RLS protects the data).
//  • STRIPE_PUBLISHABLE_KEY — pk_... key; publishable keys are safe to embed.
//    Use pk_test_... while testing, pk_live_... for production.
//  • GOOGLE_WEB_CLIENT_ID — the Google OAuth "Web application" client ID
//    (OAUTH_CLIENT_ID in secrets.properties). Its Authorized JavaScript origins
//    must list https://www.qspotmarketplace.com. Empty = OAuth redirect instead.
//  • APPLE_SERVICES_ID — Sign in with Apple Services ID. Its Return URLs must
//    list /web/premium.html and /web/account.html. Empty = OAuth redirect.
// Never put sk_..., whsec_..., or the service-role key in this repo.

window.QSPOT_CONFIG = {
  SUPABASE_URL: "https://lrvrmcmuhkdqhtxoumij.supabase.co",
  SUPABASE_ANON_KEY: "PASTE_YOUR_SUPABASE_ANON_KEY_HERE",
  STRIPE_PUBLISHABLE_KEY: "PASTE_YOUR_STRIPE_PUBLISHABLE_KEY_HERE",
  GOOGLE_WEB_CLIENT_ID: "127938416722-cuhvdkdifacv68udjqol93qqbj2iflal.apps.googleusercontent.com",
  APPLE_SERVICES_ID: "com.qspot.qspot.siwa",
};
