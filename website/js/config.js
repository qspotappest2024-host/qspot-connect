/**
 * QSpot Website Configuration
 *
 * SETUP INSTRUCTIONS:
 * 1. Replace MAPTILER_API_KEY with your free MapTiler key from https://cloud.maptiler.com/
 * 2. The Supabase anon key below is read-only (enforced by RLS policies)
 * 3. For production, consider moving these to environment variables in your CI/CD
 */

const QSPOT_CONFIG = {
    // Supabase (read-only anon access — RLS enforces spots_select_anon_live_only)
    SUPABASE_URL: 'https://lrvrmcmuhkdqhtxoumij.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxydnJtY211aGtkcWh0eG91bWlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzODkxMDAsImV4cCI6MjEwMzk2NTEwMH0.yJNgqqo_reBzb_2CSHr6G03HL4-9wqqrmQSlqL4rQF4',

    // MapTiler — Sign up free at https://cloud.maptiler.com/ (100k map loads/month free)
    // Used only when USE_FREE_TILES is false; the deploy workflow injects the real key
    MAPTILER_API_KEY: 'YOUR_MAPTILER_API_KEY_HERE',

    // ── SITE MAP PROVIDER ─────────────────────────────────────────────────
    // USE_FREE_TILES true: the site map uses OpenFreeMap vector tiles. This is
    // the provider the site runs on. OpenFreeMap is a free public service with
    // no API key and no SLA, and uses the same MapLibre GL JS engine as the
    // MapTiler path, so markers and popups work identically.
    // USE_FREE_TILES false: the site map uses MapTiler and needs the real
    // MapTiler key above (injected at deploy time).
    USE_FREE_TILES: true,   // true = OpenFreeMap (current); false = MapTiler

    // Map defaults
    MAP_DEFAULT_CENTER: [-96.34, 56.13], // Centre of Canada
    MAP_DEFAULT_ZOOM: 4,
    MAP_STYLE: 'streets-v2', // MapTiler style name

    // App store links (update when published)
    APP_STORE_URL: '#',
    PLAY_STORE_URL: '#',

    // Contact
    CONTACT_EMAIL: 'admin@qspotmarketplace.com',
};
