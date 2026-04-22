/**
 * QSpot Map — Debug Panel
 *
 * HOW TO USE:
 *   Add this line to map.html AFTER the other script tags:
 *     <script src="js/map-debug.js"></script>
 *
 *   Open your browser's DevTools console AND watch the on-screen panel.
 *   Remove (or comment out) this script tag before deploying to production.
 *
 * WHAT IT DOES:
 *   • Intercepts console.log / console.warn / console.error
 *   • Tracks every map lifecycle event (init → style load → fetch → markers)
 *   • Validates your config values (API key, Supabase URL, coordinates)
 *   • Tests the Supabase REST endpoint independently and shows the raw response
 *   • Shows coordinate stats for every spot returned
 *   • All info shown in a collapsible on-screen panel (bottom-right corner)
 */

(function () {
    'use strict';

    /* ── Timing reference ─────────────────────────────────────────────── */
    const T0 = performance.now();
    const ts = () => `+${(performance.now() - T0).toFixed(0)}ms`;

    /* ── Log storage ─────────────────────────────────────────────────── */
    const logs = [];

    function addLog(level, ...args) {
        const text = args.map(a => {
            if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
            if (typeof a === 'object') { try { return JSON.stringify(a, null, 2); } catch { return String(a); } }
            return String(a);
        }).join(' ');
        logs.push({ level, text, time: ts() });
        renderLogs();
    }

    /* ── Intercept console ───────────────────────────────────────────── */
    const _log   = console.log.bind(console);
    const _warn  = console.warn.bind(console);
    const _error = console.error.bind(console);

    console.log   = (...a) => { _log(...a);   addLog('log',   ...a); };
    console.warn  = (...a) => { _warn(...a);  addLog('warn',  ...a); };
    console.error = (...a) => { _error(...a); addLog('error', ...a); };

    window.addEventListener('error', e => addLog('error', `Uncaught: ${e.message} (${e.filename}:${e.lineno})`));
    window.addEventListener('unhandledrejection', e => addLog('error', `Unhandled promise: ${e.reason}`));

    /* ── Sections rendered in the panel ─────────────────────────────── */
    const sections = {
        config:    { title: '1 · Config check',       html: '' },
        supabase:  { title: '2 · Supabase fetch test', html: '' },
        mapEvents: { title: '3 · Map lifecycle',       html: '' },
        console:   { title: '4 · Console output',      html: '' },
    };

    /* ── Build the floating panel DOM ───────────────────────────────── */
    const panel = document.createElement('div');
    panel.id = 'qspot-debug-panel';
    Object.assign(panel.style, {
        position:       'fixed',
        bottom:         '16px',
        right:          '16px',
        width:          '360px',
        maxHeight:      '80vh',
        background:     '#111827',
        color:          '#d1fae5',
        fontFamily:     'monospace',
        fontSize:       '11px',
        lineHeight:     '1.55',
        borderRadius:   '10px',
        boxShadow:      '0 8px 32px rgba(0,0,0,0.55)',
        zIndex:         '99999',
        overflowY:      'auto',
        border:         '1px solid #374151',
        display:        'flex',
        flexDirection:  'column',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
        padding:        '8px 12px',
        background:     '#1f2937',
        borderRadius:   '10px 10px 0 0',
        fontWeight:     'bold',
        fontSize:       '12px',
        color:          '#a78bfa',
        cursor:         'pointer',
        userSelect:     'none',
        display:        'flex',
        justifyContent: 'space-between',
        alignItems:     'center',
        position:       'sticky',
        top:            '0',
    });
    header.innerHTML = '<span>🗺 QSpot Map Debug</span><span id="dbg-toggle">▼ collapse</span>';

    const body = document.createElement('div');
    body.id = 'qspot-debug-body';
    body.style.padding = '8px 12px 12px';

    let collapsed = false;
    header.addEventListener('click', () => {
        collapsed = !collapsed;
        body.style.display = collapsed ? 'none' : 'block';
        document.getElementById('dbg-toggle').textContent = collapsed ? '▶ expand' : '▼ collapse';
    });

    panel.appendChild(header);
    panel.appendChild(body);

    /* Inject after DOM is ready */
    function mountPanel() { document.body.appendChild(panel); }
    if (document.body) mountPanel();
    else document.addEventListener('DOMContentLoaded', mountPanel);

    /* ── Render helpers ──────────────────────────────────────────────── */
    function tag(t, style, html) {
        return `<${t} style="${style}">${html}</${t}>`;
    }
    const ok  = v => tag('span', 'color:#34d399', `✔ ${v}`);
    const err = v => tag('span', 'color:#f87171', `✘ ${v}`);
    const warn = v => tag('span', 'color:#fbbf24', `⚠ ${v}`);
    const dim = v => tag('span', 'color:#6b7280', v);

    function renderAll() {
        body.innerHTML = Object.values(sections).map(s =>
            `<div style="margin-bottom:10px">
                <div style="color:#a78bfa;font-weight:bold;margin-bottom:4px;border-bottom:1px solid #374151;padding-bottom:3px">${s.title}</div>
                <div>${s.html || dim('(pending…)')}</div>
             </div>`
        ).join('');
    }

    function renderLogs() {
        sections.console.html = logs.slice(-60).map(l => {
            const colour = l.level === 'error' ? '#f87171' : l.level === 'warn' ? '#fbbf24' : '#d1fae5';
            const escaped = l.text.replace(/</g,'&lt;').replace(/>/g,'&gt;');
            return `<div style="color:${colour};margin-bottom:2px">${dim(l.time + ' ')}${escaped}</div>`;
        }).join('');
        renderAll();
    }

    /* ── Section 1: Config validation ───────────────────────────────── */
    function checkConfig() {
        // Wait until config.js has loaded
        if (typeof QSPOT_CONFIG === 'undefined') {
            sections.config.html = err('QSPOT_CONFIG not found — config.js may not be loaded');
            renderAll();
            return;
        }

        const cfg = QSPOT_CONFIG;
        const lines = [];

        // MapTiler key
        if (!cfg.MAPTILER_API_KEY || cfg.MAPTILER_API_KEY === 'YOUR_MAPTILER_API_KEY_HERE') {
            lines.push(err('MAPTILER_API_KEY is the placeholder — map WILL NOT load'));
            lines.push(dim('→ Get a free key at cloud.maptiler.com and paste it into config.js'));
        } else {
            lines.push(ok(`MAPTILER_API_KEY set (${cfg.MAPTILER_API_KEY.slice(0,6)}…)`));
        }

        // Supabase
        if (cfg.SUPABASE_URL && cfg.SUPABASE_URL.includes('supabase.co')) {
            lines.push(ok(`SUPABASE_URL: ${cfg.SUPABASE_URL}`));
        } else {
            lines.push(err(`SUPABASE_URL looks wrong: ${cfg.SUPABASE_URL}`));
        }

        if (cfg.SUPABASE_ANON_KEY && cfg.SUPABASE_ANON_KEY.startsWith('eyJ')) {
            lines.push(ok('SUPABASE_ANON_KEY present (JWT format ✔)'));
        } else {
            lines.push(err('SUPABASE_ANON_KEY missing or not a JWT'));
        }

        // Free-tile flag
        if (cfg.USE_FREE_TILES) {
            lines.push(warn('USE_FREE_TILES=true → using OpenFreeMap (no MapTiler key needed)'));
        }

        // Map defaults
        const [lng, lat] = cfg.MAP_DEFAULT_CENTER || [];
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            lines.push(ok(`MAP_DEFAULT_CENTER: [${lng}, ${lat}]`));
        } else {
            lines.push(err(`MAP_DEFAULT_CENTER is invalid: ${JSON.stringify(cfg.MAP_DEFAULT_CENTER)}`));
        }

        sections.config.html = lines.join('<br>');
        renderAll();
    }

    /* ── Section 2: Supabase fetch test ─────────────────────────────── */
    async function testSupabase() {
        if (typeof QSPOT_CONFIG === 'undefined') {
            sections.supabase.html = err('Cannot test — QSPOT_CONFIG not loaded');
            renderAll();
            return;
        }

        const url = `${QSPOT_CONFIG.SUPABASE_URL}/rest/v1/spots?status=eq.ACTIVE&available_spots=gt.0&select=id,name,latitude,longitude,category&limit=5`;
        sections.supabase.html = dim(`Fetching ${ts()}…`);
        renderAll();

        const t1 = performance.now();
        try {
            const res = await fetch(url, {
                headers: {
                    'apikey':        QSPOT_CONFIG.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${QSPOT_CONFIG.SUPABASE_ANON_KEY}`,
                    'Accept':        'application/json',
                },
            });

            const elapsed = `${(performance.now() - t1).toFixed(0)}ms`;
            const lines = [];

            lines.push(res.ok ? ok(`HTTP ${res.status} (${elapsed})`) : err(`HTTP ${res.status} ${res.statusText} (${elapsed})`));

            // Rate-limit / policy headers
            const count   = res.headers.get('content-range');
            const profile = res.headers.get('x-kong-upstream-latency');
            if (count)   lines.push(dim(`Content-Range: ${count}`));
            if (profile) lines.push(dim(`Server latency: ${profile}ms`));

            if (!res.ok) {
                const body = await res.text();
                lines.push(err(`Body: ${body.slice(0, 300)}`));
                sections.supabase.html = lines.join('<br>');
                renderAll();
                return;
            }

            const data = await res.json();

            if (!Array.isArray(data)) {
                lines.push(err(`Response is not an array: ${JSON.stringify(data).slice(0, 200)}`));
                sections.supabase.html = lines.join('<br>');
                renderAll();
                return;
            }

            lines.push(ok(`${data.length} spot(s) returned (limit 5)`));

            if (data.length === 0) {
                lines.push(warn('0 spots — either no ACTIVE rows with available_spots>0, or RLS is blocking the anon key'));
            } else {
                // Validate coordinates of each spot
                data.forEach((s, i) => {
                    const hasLat = s.latitude  != null && Math.abs(s.latitude)  <= 90;
                    const hasLng = s.longitude != null && Math.abs(s.longitude) <= 180;
                    const coordStr = `lat=${s.latitude}, lng=${s.longitude}`;
                    if (hasLat && hasLng) {
                        lines.push(ok(`spot[${i}] "${s.name}" — ${coordStr}`));
                    } else {
                        lines.push(err(`spot[${i}] "${s.name}" — INVALID COORDS: ${coordStr}`));
                    }
                });
            }

            sections.supabase.html = lines.join('<br>');
        } catch (e) {
            sections.supabase.html = err(`Network error: ${e.message}`);
        }
        renderAll();
    }

    /* ── Section 3: Map lifecycle events ────────────────────────────── */
    const mapEvents = [];

    function logMapEvent(label, detail) {
        mapEvents.push({ label, detail, time: ts() });
        sections.mapEvents.html = mapEvents.map(e =>
            `<div>${dim(e.time)} <span style="color:#60a5fa">${e.label}</span>${e.detail ? ' — ' + e.detail : ''}</div>`
        ).join('');
        renderAll();
    }

    // Poll until `map` global is available, then attach listeners
    const MAP_POLL_INTERVAL = 200;
    const MAP_POLL_TIMEOUT  = 15000;
    let   pollElapsed       = 0;
    let   mapHooked         = false;

    function pollForMap() {
        if (typeof map !== 'undefined' && map && !mapHooked) {
            mapHooked = true;
            logMapEvent('map object detected', `style: ${map.getStyle ? '(checking…)' : 'unknown'}`);

            map.on('styledata',      () => logMapEvent('styledata', 'style tiles received'));
            map.on('load',           () => logMapEvent('load ✔', 'map fully ready'));
            map.on('idle',           () => logMapEvent('idle', 'render settled'));
            map.on('error',          e  => logMapEvent('error ✘', e.error ? `${e.error.status || ''} ${e.error.message || ''}` : JSON.stringify(e)));
            map.on('sourcedataloading', () => logMapEvent('sourcedataloading', ''));
            map.on('sourcedata',     () => logMapEvent('sourcedata', ''));

            // Also watch for spotsData global filling up
            const spotsWatcher = setInterval(() => {
                if (typeof spotsData !== 'undefined' && Array.isArray(spotsData)) {
                    logMapEvent(`spotsData ready`, `${spotsData.length} spot(s) in global`);
                    clearInterval(spotsWatcher);
                }
            }, 300);
        }

        if (!mapHooked && pollElapsed < MAP_POLL_TIMEOUT) {
            pollElapsed += MAP_POLL_INTERVAL;
            setTimeout(pollForMap, MAP_POLL_INTERVAL);
        } else if (!mapHooked) {
            logMapEvent('map NOT found', `after ${MAP_POLL_TIMEOUT}ms — map may have errored before init`);
        }
    }

    /* ── Boot sequence ───────────────────────────────────────────────── */
    function boot() {
        addLog('log', `[debug] QSpot Map Debug Panel loaded ${ts()}`);
        renderAll();

        // Small delay to let config.js execute first
        setTimeout(() => {
            checkConfig();
            testSupabase();
        }, 100);

        pollForMap();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();
