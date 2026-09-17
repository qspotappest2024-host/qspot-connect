/**
 * QSpot Website — Live Map
 *
 * Renders the anon-readable `public_live_spots` view on a MapLibre GL map.
 *
 * WHAT THIS FILE ACTUALLY DOES (kept honest — the previous header described
 * canvas teardrop pins and a per-category cluster icon row that no code path
 * ever produced: addIconImages() was defined and never called, so ~200 lines
 * of sprite generation were dead and the description was misleading):
 *
 *   • Native MapLibre GeoJSON clustering (clusterMaxZoom 13, clusterRadius 60),
 *     drawn as purple count bubbles whose colour/radius step on point_count.
 *   • Individual spots as category-coloured circles. The palette is the app's
 *     canonical one (SpotPopupCard.getCategoryColor / MapLibreController), all
 *     eight categories.
 *   • Cluster tap frames the whole cluster so every member lands on screen,
 *     rather than jumping to a zoom that may leave members outside the viewport.
 *   • SPIDERFY: spots that cannot be separated by zooming — the co-located case
 *     — fan out on legs so each one is individually reachable. Without this a
 *     stacked spot is permanently unclickable, which is live on the site today:
 *     the two Whistler listings sit 2.6 m apart.
 *   • Popup photo gallery: arrows, counter, dots, keyboard and swipe through
 *     every photo on the spot.
 *
 * Popups are built with DOM APIs rather than innerHTML so that values coming
 * from the database are inserted as text nodes and can never be parsed as
 * markup. There is no HTML-escaping helper here any more because nothing
 * concatenates untrusted strings into HTML.
 */

let map;
let spotsData = [];
let activePopup = null;

/** Currently fanned-out group, or null. See openSpiderfy(). */
let spiderfyState = null;

/**
 * False once a request has proved the view has no owner_rating column, i.e.
 * supabase/public_live_spots_owner_rating.sql has not been applied yet.
 * A missing rating must degrade to "no rating row", never to a broken map.
 */
let ownerRatingAvailable = true;

// ─── Source / layer IDs ──────────────────────────────────────────────────────
const MARKERS_SOURCE_ID       = 'qspot-markers-source';
const MARKERS_LAYER_ID        = 'qspot-markers-layer';
const CLUSTER_CIRCLE_LAYER_ID = 'qspot-cluster-circle-layer';
const CLUSTER_COUNT_LAYER_ID  = 'qspot-cluster-count-layer';

/**
 * Canonical category palette.
 *
 * ⚠️ These eight values are shared with the mobile app and must not drift:
 *   composeApp/.../ui/search/components/SpotPopupCard.kt  getCategoryColor()
 *   composeApp/.../ui/map/MapLibreController.kt           marker bitmap colours
 *   composeApp/.../ui/map/IOSMapAnnotations.kt
 *
 * sporting_event and restaurant were missing here, so every sporting_event
 * listing — which is every live listing right now — rendered brand purple on
 * the website and red in the app.
 */
const CATEGORY_COLORS = {
    ski_resort:     '#1976D2',  // blue
    shopping:       '#E65100',  // deep orange
    concert:        '#6A1B9A',  // deep purple
    museum_gallery: '#00695C',  // teal
    amusement_park: '#AD1457',  // deep pink
    sporting_event: '#C62828',  // red 800
    restaurant:     '#2E7D32',  // green 800
};
/** `general` and anything unrecognised. Matches SpotPopupCard's else branch. */
const DEFAULT_MARKER_COLOR = '#37474F';  // blue grey

/** Display names, mirroring CreateSpotState.EventType.displayName. */
const CATEGORY_LABELS = {
    ski_resort:     'Ski Resort',
    shopping:       'Shopping',
    concert:        'Concert Venue',
    museum_gallery: 'Museum/Gallery',
    amusement_park: 'Amusement Park',
    sporting_event: 'Sporting Event',
    restaurant:     'Restaurant/Dining',
    general:        'Other Venue',
};

// ─── Clustering / camera tuning ──────────────────────────────────────────────
const CLUSTER_MAX_ZOOM = 13;   // clusters dissolve at 14+ (matches the app)
const CLUSTER_RADIUS   = 60;   // px

/** Deepest zoom a cluster tap will ever take you to. */
const SPOT_MAX_ZOOM = 18;

/**
 * Two markers whose centres are closer than this are visually one blob.
 * Marker radius is 12 px plus a 2.5 px ring, so ~29 px is touching.
 */
const MIN_SEPARATION_PX = 30;

/** Viewport padding used when framing a cluster's members. */
const CLUSTER_FIT_PADDING = { top: 90, bottom: 90, left: 60, right: 60 };

/** A cluster tap must move the camera at least this much to feel like anything. */
const MIN_PROGRESS_ZOOM = 0.25;

// ─── Spiderfy tuning ─────────────────────────────────────────────────────────
const SPIDER_CIRCLE_MAX    = 9;    // up to this many fan out on a ring
const SPIDER_CIRCLE_RADIUS = 54;   // px, ring layout
const SPIDER_SPIRAL_START  = 46;   // px, first spiral radius
const SPIDER_SPIRAL_GROWTH = 9;    // px gained per radian
const SPIDER_SPIRAL_ARC    = 36;   // px between consecutive spiral pins

document.addEventListener('DOMContentLoaded', () => {
    initMap();
});

/* ══════════════════════════════════════════════════════════════════════════
   Map setup
══════════════════════════════════════════════════════════════════════════ */

function resolveMapStyle() {
    const cfg = QSPOT_CONFIG;

    if (cfg.USE_FREE_TILES) {
        return 'https://tiles.openfreemap.org/styles/liberty';
    }

    const apiKey = cfg.MAPTILER_API_KEY;
    if (!apiKey || apiKey === 'YOUR_MAPTILER_API_KEY_HERE') {
        return null;
    }
    return `https://api.maptiler.com/maps/${cfg.MAP_STYLE}/style.json?key=${apiKey}`;
}

function initMap() {
    const styleUrl = resolveMapStyle();

    if (!styleUrl) {
        showMapError(
            'MapTiler API key not configured',
            'Open <code>js/config.js</code> and either:<br>' +
            '&bull; Set <code>USE_FREE_TILES: true</code> to use free OpenFreeMap tiles for testing, or<br>' +
            '&bull; Add your MapTiler key. Get one free at <a href="https://cloud.maptiler.com/" target="_blank" rel="noopener">cloud.maptiler.com</a>.'
        );
        return;
    }

    try {
        map = new maplibregl.Map({
            container: 'map',
            style: styleUrl,
            center: QSPOT_CONFIG.MAP_DEFAULT_CENTER,
            zoom: QSPOT_CONFIG.MAP_DEFAULT_ZOOM,
            attributionControl: true,
        });
    } catch (e) {
        showMapError('Map failed to initialize', 'Check your tile configuration and try refreshing the page.');
        return;
    }

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(
        new maplibregl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: false,
        }),
        'top-right'
    );

    map.on('load', () => {
        clearTimeout(loadTimeout);
        fetchSpots();
    });

    map.on('error', (e) => {
        console.error('Map error:', e);
        if (e.error && (e.error.status === 401 || e.error.status === 403)) {
            showMapError(
                'Map tiles unavailable (auth error)',
                QSPOT_CONFIG.USE_FREE_TILES
                    ? 'OpenFreeMap returned an auth error &mdash; this is unusual. Try refreshing, or switch to MapTiler.'
                    : 'The MapTiler API key is not authorized for this domain. Check the allowed origins in your MapTiler dashboard.'
            );
        }
    });

    // Escape collapses a fan-out, then a popup — in that order, so one press
    // never dismisses both.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (spiderfyState) { closeSpiderfy(); return; }
        if (activePopup)   { activePopup.remove(); activePopup = null; }
    });

    const loadTimeout = setTimeout(() => {
        if (!map.isStyleLoaded()) {
            showMapError(
                'Map failed to load',
                'The map timed out loading. Please check your MapTiler API key configuration and try refreshing.'
            );
        }
    }, 10000);
}

/* ══════════════════════════════════════════════════════════════════════════
   GeoJSON
══════════════════════════════════════════════════════════════════════════ */

/** Normalise a raw category string to the palette key form. */
function categoryKey(category) {
    return (category || '').toLowerCase().trim().replace(/\s+/g, '_');
}

function categoryColor(category) {
    const key = categoryKey(category);
    return Object.prototype.hasOwnProperty.call(CATEGORY_COLORS, key)
        ? CATEGORY_COLORS[key]
        : DEFAULT_MARKER_COLOR;
}

function categoryLabel(category) {
    const key = categoryKey(category);
    if (Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, key)) {
        return CATEGORY_LABELS[key];
    }
    if (!key) return 'Spot';
    // Unknown key added to the app after this file shipped — Title Case it.
    return key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function hasValidCoords(spot) {
    return typeof spot.latitude === 'number' && typeof spot.longitude === 'number' &&
           Number.isFinite(spot.latitude) && Number.isFinite(spot.longitude) &&
           Math.abs(spot.latitude) <= 90 && Math.abs(spot.longitude) <= 180;
}

function buildGeoJson(spots) {
    return {
        type: 'FeatureCollection',
        features: spots.filter(hasValidCoords).map(spot => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [spot.longitude, spot.latitude] },
            properties: {
                spotId:   spot.id,
                category: categoryKey(spot.category),
            },
        })),
    };
}

/** Resolve a feature's spotId back to the full record from the last fetch. */
function spotById(id) {
    return spotsData.find(s => String(s.id) === String(id)) || null;
}

/* ══════════════════════════════════════════════════════════════════════════
   Layers
══════════════════════════════════════════════════════════════════════════ */

function renderSpotsOnMap(spots) {
    closeSpiderfy();
    if (activePopup) { activePopup.remove(); activePopup = null; }

    const geojson = buildGeoJson(spots);

    if (map.getSource(MARKERS_SOURCE_ID)) {
        map.getSource(MARKERS_SOURCE_ID).setData(geojson);
        return;
    }

    map.addSource(MARKERS_SOURCE_ID, {
        type: 'geojson',
        data: geojson,
        cluster: true,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterRadius: CLUSTER_RADIUS,
    });

    // Cluster bubble. Colour and radius step on point_count, matching the app.
    map.addLayer({
        id: CLUSTER_CIRCLE_LAYER_ID,
        type: 'circle',
        source: MARKERS_SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
            'circle-color': [
                'step', ['get', 'point_count'],
                '#9C27B0',       //  < 10
                10, '#6A1B9A',   // 10–49
                50, '#4A148C',   // 50+
            ],
            'circle-radius': [
                'step', ['get', 'point_count'],
                26,
                10, 32,
                50, 38,
            ],
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#FFFFFF',
            'circle-opacity': 0.92,
        },
    });

    // Count, centred in the bubble. No text-font is specified on purpose:
    // naming one that the style's glyph endpoint does not serve 404s on
    // OpenFreeMap and the number silently disappears.
    map.addLayer({
        id: CLUSTER_COUNT_LAYER_ID,
        type: 'symbol',
        source: MARKERS_SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
            'text-field': '{point_count_abbreviated}',
            'text-size': 15,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
        },
        paint: { 'text-color': '#FFFFFF' },
    });

    // Individual spots. A circle layer rather than a symbol layer so there is
    // no sprite to register — canvas-generated sprites are what broke this
    // layer in Safari under MapLibre 4.x.
    map.addLayer({
        id: MARKERS_LAYER_ID,
        type: 'circle',
        source: MARKERS_SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
            'circle-color': [
                'match', ['get', 'category'],
                'ski_resort',     CATEGORY_COLORS.ski_resort,
                'shopping',       CATEGORY_COLORS.shopping,
                'concert',        CATEGORY_COLORS.concert,
                'museum_gallery', CATEGORY_COLORS.museum_gallery,
                'amusement_park', CATEGORY_COLORS.amusement_park,
                'sporting_event', CATEGORY_COLORS.sporting_event,
                'restaurant',     CATEGORY_COLORS.restaurant,
                DEFAULT_MARKER_COLOR,
            ],
            'circle-radius': 12,
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#FFFFFF',
            'circle-opacity': 0.92,
        },
    });

    map.on('click', CLUSTER_CIRCLE_LAYER_ID, handleClusterClick);
    map.on('click', MARKERS_LAYER_ID, handleMarkerClick);

    // Blank-map click closes whatever is open.
    map.on('click', (e) => {
        const hit = map.queryRenderedFeatures(e.point, {
            layers: [MARKERS_LAYER_ID, CLUSTER_CIRCLE_LAYER_ID],
        });
        if (hit.length) return;
        if (spiderfyState) closeSpiderfy();
        if (activePopup) { activePopup.remove(); activePopup = null; }
    });

    map.on('mouseenter', CLUSTER_CIRCLE_LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', CLUSTER_CIRCLE_LAYER_ID, () => { map.getCanvas().style.cursor = '';        });
    map.on('mouseenter', MARKERS_LAYER_ID,        () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', MARKERS_LAYER_ID,        () => { map.getCanvas().style.cursor = '';        });
}

/* ══════════════════════════════════════════════════════════════════════════
   Separation maths

   Everything here goes through map.project() rather than a metres-per-pixel
   constant. MapLibre's zoom is defined against a 512 px world, not the 256 px
   slippy convention, so a hard-coded 156543.03 constant is wrong by exactly
   2x — and being wrong by 2x here means co-located spots are classified as
   separable and stay unreachable. Web Mercator scales exactly 2x per zoom
   level, so projecting at the current zoom and scaling is both exact and free
   of that ambiguity.
══════════════════════════════════════════════════════════════════════════ */

function separationPxAtZoom(coordA, coordB, targetZoom) {
    const a = map.project(coordA);
    const b = map.project(coordB);
    const now = Math.hypot(a.x - b.x, a.y - b.y);
    return now * Math.pow(2, targetZoom - map.getZoom());
}

/**
 * True when the entire group fits inside one marker at the deepest zoom we
 * will go to — i.e. no amount of zooming can ever pull them apart, so the
 * only way to reach them all is to fan them out.
 *
 * Measured across the bounding box corners rather than pairwise: if the whole
 * extent is narrower than one marker then every pair inside it is too, and it
 * stays O(n) on a cluster of any size.
 */
function isInseparable(coords) {
    if (coords.length < 2) return false;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    coords.forEach(([lng, lat]) => {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    });
    return separationPxAtZoom([minLng, minLat], [maxLng, maxLat], SPOT_MAX_ZOOM) < MIN_SEPARATION_PX;
}

/* ══════════════════════════════════════════════════════════════════════════
   Cluster interaction
══════════════════════════════════════════════════════════════════════════ */

function handleClusterClick(e) {
    const features = map.queryRenderedFeatures(e.point, { layers: [CLUSTER_CIRCLE_LAYER_ID] });
    if (!features.length) return;

    const feature   = features[0];
    const clusterId = feature.properties.cluster_id;
    const centre    = feature.geometry.coordinates.slice();
    const count     = feature.properties.point_count || 0;
    const source    = map.getSource(MARKERS_SOURCE_ID);

    closeSpiderfy();
    if (activePopup) { activePopup.remove(); activePopup = null; }

    // limit === point_count asks for exactly this cluster's members, so there
    // is no arbitrary cap to guess at and nothing is silently left out.
    source.getClusterLeaves(clusterId, count || 1000, 0, (err, leaves) => {
        if (err || !leaves || !leaves.length) {
            zoomToExpansion(source, clusterId, centre);
            return;
        }

        const coords = leaves.map(f => f.geometry.coordinates);

        if (isInseparable(coords)) {
            // Zooming can never separate these. Fan them out instead.
            const spots = leaves.map(f => spotById(f.properties.spotId)).filter(Boolean);
            if (spots.length > 1) {
                openSpiderfy(centre, spots);
                return;
            }
        }

        // Frame every member so the split lands fully on screen, rather than
        // jumping to a zoom that can push members outside the viewport.
        const bounds = new maplibregl.LngLatBounds();
        coords.forEach(c => bounds.extend(c));

        let camera = null;
        try {
            camera = map.cameraForBounds(bounds, {
                padding: CLUSTER_FIT_PADDING,
                maxZoom: SPOT_MAX_ZOOM,
            });
        } catch (_) { /* fall through to the expansion zoom */ }

        if (camera && camera.zoom > map.getZoom() + MIN_PROGRESS_ZOOM) {
            map.easeTo({ center: camera.center, zoom: camera.zoom, duration: 600 });
        } else {
            // The members already fill the screen (a cluster spanning the whole
            // country, say), so fitting them would be a no-op. Fall back to the
            // zoom at which this cluster first splits, so the tap always does
            // something.
            zoomToExpansion(source, clusterId, centre);
        }
    });
}

function zoomToExpansion(source, clusterId, centre) {
    source.getClusterExpansionZoom(clusterId, (err, zoom) => {
        const target = err || typeof zoom !== 'number'
            ? map.getZoom() + 2
            : zoom + 0.4;   // a hair past the split so it has visibly happened
        map.easeTo({
            center: centre,
            zoom: Math.min(target, SPOT_MAX_ZOOM),
            duration: 600,
        });
    });
}

/* ══════════════════════════════════════════════════════════════════════════
   Individual marker interaction
══════════════════════════════════════════════════════════════════════════ */

function handleMarkerClick(e) {
    if (!e.features || !e.features.length) return;

    // Above CLUSTER_MAX_ZOOM there is no clustering at all, so co-located
    // spots render as circles stacked exactly on top of each other and only
    // the topmost is reachable. e.features holds every feature under the
    // clicked pixel, so more than one means they overlap right here.
    const seen = new Set();
    const spots = [];
    e.features.forEach(f => {
        const id = f.properties.spotId;
        if (seen.has(id)) return;
        seen.add(id);
        const spot = spotById(id);
        if (spot) spots.push(spot);
    });

    if (!spots.length) return;

    const coords = e.features[0].geometry.coordinates.slice();

    closeSpiderfy();

    if (spots.length > 1) {
        openSpiderfy(coords, spots);
        return;
    }

    openSpotPopup(coords, spots[0], 0, 0);
}

/* ══════════════════════════════════════════════════════════════════════════
   Spiderfy

   One MapLibre Marker anchored at the shared point holds the whole fan: an
   SVG of the legs plus one absolutely positioned button per spot. Because the
   offsets are pixels inside a single anchored element rather than separate
   unprojected coordinates, the fan keeps its shape at every zoom and needs no
   reprojection on move.
══════════════════════════════════════════════════════════════════════════ */

/** Pixel offsets for n pins: a ring while it stays legible, then a spiral. */
function spiderLayout(n) {
    const out = [];

    if (n <= SPIDER_CIRCLE_MAX) {
        const step  = (2 * Math.PI) / n;
        const start = -Math.PI / 2;   // first pin straight up
        for (let i = 0; i < n; i++) {
            const a = start + i * step;
            out.push({ dx: Math.cos(a) * SPIDER_CIRCLE_RADIUS, dy: Math.sin(a) * SPIDER_CIRCLE_RADIUS });
        }
        return out;
    }

    // Archimedean spiral. Arc length between consecutive pins is held at
    // SPIDER_SPIRAL_ARC by stepping the angle by arc / radius, so the pins stay
    // the same distance apart however far out the spiral gets.
    let angle = -Math.PI / 2;
    let radius = SPIDER_SPIRAL_START;
    for (let i = 0; i < n; i++) {
        out.push({ dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius });
        const dTheta = SPIDER_SPIRAL_ARC / radius;
        angle  += dTheta;
        radius += SPIDER_SPIRAL_GROWTH * dTheta;
    }
    return out;
}

function openSpiderfy(anchorCoords, spots) {
    closeSpiderfy();
    if (activePopup) { activePopup.remove(); activePopup = null; }

    const layout = spiderLayout(spots.length);
    const reach  = layout.reduce((m, p) => Math.max(m, Math.hypot(p.dx, p.dy)), 0) + 30;

    const root = document.createElement('div');
    root.className = 'spider-root';

    // viewBox is centred on 0,0 so leg coordinates are the pin offsets as-is.
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `${-reach} ${-reach} ${reach * 2} ${reach * 2}`);
    svg.setAttribute('width', String(reach * 2));
    svg.setAttribute('height', String(reach * 2));
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('spider-legs');
    svg.style.left = `${-reach}px`;
    svg.style.top  = `${-reach}px`;

    layout.forEach(({ dx, dy }) => {
        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', '0');
        line.setAttribute('y1', '0');
        line.setAttribute('x2', String(dx));
        line.setAttribute('y2', String(dy));
        line.setAttribute('class', 'spider-leg');
        svg.appendChild(line);
    });

    const hub = document.createElementNS(svgNS, 'circle');
    hub.setAttribute('cx', '0');
    hub.setAttribute('cy', '0');
    hub.setAttribute('r', '4');
    hub.setAttribute('class', 'spider-hub');
    svg.appendChild(hub);

    root.appendChild(svg);

    spots.forEach((spot, i) => {
        const { dx, dy } = layout[i];

        const pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'spider-pin';
        pin.style.left = `${dx}px`;
        pin.style.top  = `${dy}px`;
        pin.style.background = categoryColor(spot.category);
        pin.style.animationDelay = `${i * 28}ms`;
        pin.textContent = String(i + 1);
        pin.setAttribute(
            'aria-label',
            `${spot.name || 'Spot'} — ${categoryLabel(spot.category)} — ${formatPrice(spot.price, spot.currency || 'CAD')}`
        );
        pin.title = spot.name || 'Spot';

        pin.addEventListener('click', (ev) => {
            ev.stopPropagation();
            root.querySelectorAll('.spider-pin').forEach(el => el.classList.remove('is-active'));
            pin.classList.add('is-active');
            openSpotPopup(anchorCoords, spot, dx, dy);
        });

        root.appendChild(pin);
    });

    const marker = new maplibregl.Marker({ element: root, anchor: 'center' })
        .setLngLat(anchorCoords)
        .addTo(map);

    // Collapse on zoom: the clustering underneath changes, so leaving the fan
    // up would show the same spots twice. Panning is left alone — the fan is
    // anchored to a real coordinate and stays correct while the map moves.
    const onZoom = () => closeSpiderfy();
    map.on('zoomstart', onZoom);

    spiderfyState = { marker, onZoom, count: spots.length };
    updateSpiderfyHint(spots.length);
}

function closeSpiderfy() {
    if (!spiderfyState) return;
    map.off('zoomstart', spiderfyState.onZoom);
    spiderfyState.marker.remove();
    spiderfyState = null;
    updateSpiderfyHint(0);
}

/** Small toolbar note explaining why pins are fanned out. */
function updateSpiderfyHint(count) {
    const el = document.getElementById('map-hint');
    if (!el) return;
    if (count > 1) {
        el.textContent = `${count} spots share this location — pick one`;
        el.hidden = false;
    } else {
        el.hidden = true;
        el.textContent = '';
    }
}

/* ══════════════════════════════════════════════════════════════════════════
   Popup
══════════════════════════════════════════════════════════════════════════ */

/**
 * Offsets keyed by anchor so MapLibre can still pick whichever side fits in
 * the viewport while the popup tip lands on the pin. dx/dy carry the spiderfy
 * pin offset, and are 0 for an ordinary marker.
 */
function popupOffset(dx, dy) {
    const gap = 16;
    return {
        'top':          [dx, dy + gap],
        'top-left':     [dx, dy + gap],
        'top-right':    [dx, dy + gap],
        'bottom':       [dx, dy - gap],
        'bottom-left':  [dx, dy - gap],
        'bottom-right': [dx, dy - gap],
        'left':         [dx + gap, dy],
        'right':        [dx - gap, dy],
        'center':       [dx, dy],
    };
}

function openSpotPopup(coords, spot, dx, dy) {
    if (activePopup) { activePopup.remove(); activePopup = null; }

    activePopup = new maplibregl.Popup({
        offset: popupOffset(dx || 0, dy || 0),
        maxWidth: '280px',
        closeButton: true,
        className: 'spot-popup-shell',
    })
        .setLngLat(coords)
        .setDOMContent(buildSpotPopup(spot))
        .addTo(map);

    activePopup.on('close', () => {
        if (spiderfyState) {
            spiderfyState.marker.getElement()
                .querySelectorAll('.spider-pin')
                .forEach(el => el.classList.remove('is-active'));
        }
    });
}

/**
 * Every photo on the spot, cover first, de-duplicated.
 *
 * image_url is the cover and is usually also images[0] — both live listings
 * are like that — so without the de-dupe the gallery would open on the same
 * picture twice and claim one more photo than there is.
 */
function collectImages(spot) {
    const seen = new Set();
    const out = [];
    const push = (url) => {
        if (typeof url !== 'string') return;
        const trimmed = url.trim();
        if (!trimmed || seen.has(trimmed)) return;
        seen.add(trimmed);
        out.push(trimmed);
    };
    push(spot.image_url);
    parseImages(spot.images).forEach(push);
    return out;
}

function buildSpotPopup(spot) {
    const root = document.createElement('div');
    root.className = 'spot-popup';

    root.appendChild(buildGallery(collectImages(spot), spot.name || 'Spot'));

    const body = document.createElement('div');
    body.className = 'spot-popup-body';

    const title = document.createElement('h3');
    title.textContent = spot.name || 'Untitled spot';
    body.appendChild(title);

    const cat = document.createElement('span');
    cat.className = 'spot-popup-category';
    cat.style.setProperty('--cat-color', categoryColor(spot.category));
    cat.textContent = categoryLabel(spot.category);
    body.appendChild(cat);

    const price = document.createElement('div');
    price.className = 'spot-popup-price';
    price.textContent = formatPrice(spot.price, spot.currency || 'CAD');
    body.appendChild(price);

    if (spot.description && String(spot.description).trim()) {
        const desc = document.createElement('p');
        desc.className = 'spot-popup-desc';
        desc.textContent = String(spot.description).trim();
        body.appendChild(desc);
    }

    // Seller rating, not spot rating. Issue #110 removed spot ratings from the
    // product; this is the seller's own rating, joined live by the view so it
    // is current rather than a copy frozen at spot creation.
    // Hidden entirely at zero reviews, matching the app, which only shows the
    // row once at least one rating exists.
    const reviews = Number(spot.owner_review_count) || 0;
    if (reviews > 0) {
        const seller = document.createElement('div');
        seller.className = 'spot-popup-seller';

        const star = document.createElement('span');
        star.className = 'spot-popup-star';
        star.setAttribute('aria-hidden', 'true');
        star.textContent = '★';
        seller.appendChild(star);

        const value = document.createElement('strong');
        value.textContent = (Number(spot.owner_rating) || 0).toFixed(1);
        seller.appendChild(value);

        const meta = document.createElement('span');
        meta.className = 'spot-popup-seller-meta';
        meta.textContent = ` seller rating (${reviews} review${reviews !== 1 ? 's' : ''})`;
        seller.appendChild(meta);

        body.appendChild(seller);
    }

    const cta = document.createElement('a');
    cta.className = 'spot-popup-cta';
    cta.href = 'index.html#download';
    cta.textContent = 'Get the app to book';
    body.appendChild(cta);

    root.appendChild(body);
    return root;
}

/* ══════════════════════════════════════════════════════════════════════════
   Photo gallery
══════════════════════════════════════════════════════════════════════════ */

function buildGallery(urls, spotName) {
    const wrap = document.createElement('div');
    wrap.className = 'spot-gallery';

    if (!urls.length) {
        wrap.classList.add('is-empty');
        const empty = document.createElement('div');
        empty.className = 'spot-gallery-empty';
        empty.textContent = 'No photos yet';
        wrap.appendChild(empty);
        return wrap;
    }

    const frame = document.createElement('div');
    frame.className = 'spot-gallery-frame';

    const img = document.createElement('img');
    img.className = 'spot-gallery-img';
    img.decoding = 'async';
    frame.appendChild(img);

    // Shown in place of a photo that fails to load, so one dead URL costs one
    // slide rather than leaving a broken-image icon in the popup.
    const failed = document.createElement('div');
    failed.className = 'spot-gallery-empty';
    failed.textContent = 'Photo unavailable';
    failed.hidden = true;
    frame.appendChild(failed);

    wrap.appendChild(frame);

    let index = 0;

    const counter = document.createElement('span');
    counter.className = 'spot-gallery-counter';
    // Announced to screen readers when the slide changes, so arrow presses are
    // not silent.
    counter.setAttribute('aria-live', 'polite');

    const dots = document.createElement('div');
    dots.className = 'spot-gallery-dots';
    const dotEls = [];

    const show = (next) => {
        index = (next + urls.length) % urls.length;
        failed.hidden = true;
        img.hidden = false;
        img.src = urls[index];
        img.alt = urls.length > 1
            ? `${spotName} — photo ${index + 1} of ${urls.length}`
            : spotName;
        counter.textContent = `${index + 1} / ${urls.length}`;
        dotEls.forEach((d, i) => {
            d.classList.toggle('is-active', i === index);
            d.setAttribute('aria-current', i === index ? 'true' : 'false');
        });
        // Warm the neighbours so an arrow press paints immediately.
        [index + 1, index - 1].forEach((n) => {
            const url = urls[(n + urls.length) % urls.length];
            if (url && url !== urls[index]) { const pre = new Image(); pre.src = url; }
        });
    };

    img.addEventListener('error', () => {
        img.hidden = true;
        failed.hidden = false;
    });

    if (urls.length > 1) {
        const prev = document.createElement('button');
        prev.type = 'button';
        prev.className = 'spot-gallery-nav is-prev';
        prev.setAttribute('aria-label', 'Previous photo');
        prev.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
        prev.addEventListener('click', (e) => { e.stopPropagation(); show(index - 1); });

        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'spot-gallery-nav is-next';
        next.setAttribute('aria-label', 'Next photo');
        next.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
        next.addEventListener('click', (e) => { e.stopPropagation(); show(index + 1); });

        frame.appendChild(prev);
        frame.appendChild(next);
        frame.appendChild(counter);

        urls.forEach((_, i) => {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'spot-gallery-dot';
            dot.setAttribute('aria-label', `Photo ${i + 1}`);
            dot.addEventListener('click', (e) => { e.stopPropagation(); show(i); });
            dots.appendChild(dot);
            dotEls.push(dot);
        });
        wrap.appendChild(dots);

        // Arrow keys once anything inside the gallery has focus.
        wrap.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft')  { e.preventDefault(); e.stopPropagation(); show(index - 1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); show(index + 1); }
        });

        // Horizontal swipe. The popup is a DOM overlay above the canvas, so
        // these touches never reach the map and cannot drag it.
        let startX = null;
        let startY = null;
        frame.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) { startX = null; return; }
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, { passive: true });
        frame.addEventListener('touchend', (e) => {
            if (startX === null || !e.changedTouches.length) return;
            const dx = e.changedTouches[0].clientX - startX;
            const dy = e.changedTouches[0].clientY - startY;
            // Ignore mostly-vertical drags so scrolling the popup still works.
            if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
                show(dx < 0 ? index + 1 : index - 1);
            }
            startX = null;
            startY = null;
        }, { passive: true });
    }

    show(0);
    return wrap;
}

/* ══════════════════════════════════════════════════════════════════════════
   Data
══════════════════════════════════════════════════════════════════════════ */

// The view is the security boundary, so the column list here is only about
// asking for what is used. rating / review_count are deliberately absent:
// they are the dead SPOT rating columns (Issue #110) and are always 0.
const BASE_COLUMNS  = 'id,name,description,category,price,currency,latitude,longitude,image_url,images';
const OWNER_COLUMNS = 'owner_rating,owner_review_count';

async function requestSpots(columns) {
    const url = `${QSPOT_CONFIG.SUPABASE_URL}/rest/v1/public_live_spots?select=${columns}`;
    const response = await fetch(url, {
        headers: {
            'apikey': QSPOT_CONFIG.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${QSPOT_CONFIG.SUPABASE_ANON_KEY}`,
            'Accept': 'application/json',
        },
    });
    if (!response.ok) {
        const err = new Error(`API returned ${response.status}: ${response.statusText}`);
        err.status = response.status;
        throw err;
    }
    return response.json();
}

async function fetchSpots() {
    showLoading(true);
    clearOverlays();
    closeSpiderfy();
    if (activePopup) { activePopup.remove(); activePopup = null; }

    try {
        let data;
        try {
            data = await requestSpots(
                ownerRatingAvailable ? `${BASE_COLUMNS},${OWNER_COLUMNS}` : BASE_COLUMNS
            );
        } catch (e) {
            // PostgREST answers 400 for a column the view does not have. That
            // means supabase/public_live_spots_owner_rating.sql has not been
            // applied. Losing the seller rating is a missing line in a popup;
            // losing the whole request is a blank map, so retry without it.
            if (e.status === 400 && ownerRatingAvailable) {
                ownerRatingAvailable = false;
                console.warn(
                    'public_live_spots has no owner_rating column — seller ratings hidden. ' +
                    'Apply supabase/public_live_spots_owner_rating.sql to enable them.'
                );
                data = await requestSpots(BASE_COLUMNS);
            } else {
                throw e;
            }
        }

        if (!Array.isArray(data)) {
            throw new Error('Unexpected response format');
        }
        spotsData = data;

        updateSpotCount(spotsData.length);

        if (spotsData.length === 0) {
            showEmptyState();
        } else {
            renderSpotsOnMap(spotsData);
            fitMapToSpots(spotsData);
        }
    } catch (error) {
        console.error('Failed to fetch spots:', error);
        showMapError(
            'Unable to load spots',
            'There was a problem connecting to the server. Please check your internet connection and try again.'
        );
    } finally {
        showLoading(false);
    }
}

/** Normalise the images column, which may arrive as an array, a Postgres
 *  text[] literal, or a JSON string depending on the column type. */
function parseImages(images) {
    if (!images) return [];
    if (Array.isArray(images)) return images;

    if (typeof images === 'string') {
        const trimmed = images.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            return trimmed.slice(1, -1)
                .split(',')
                .map(s => s.replace(/^"|"$/g, '').trim())
                .filter(Boolean);
        }
        try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

/* ══════════════════════════════════════════════════════════════════════════
   Camera / chrome
══════════════════════════════════════════════════════════════════════════ */

function fitMapToSpots(spots) {
    const valid = spots.filter(hasValidCoords);
    if (!valid.length) return;

    if (valid.length === 1) {
        map.flyTo({ center: [valid[0].longitude, valid[0].latitude], zoom: 14 });
        return;
    }

    const bounds = new maplibregl.LngLatBounds();
    valid.forEach(spot => bounds.extend([spot.longitude, spot.latitude]));

    map.fitBounds(bounds, {
        padding: { top: 60, bottom: 60, left: 60, right: 60 },
        maxZoom: 15,
    });
}

function updateSpotCount(count) {
    const el = document.getElementById('spot-count');
    if (el) {
        el.textContent = `${count} live spot${count !== 1 ? 's' : ''}`;
    }
}

function showLoading(show) {
    const el = document.getElementById('map-loading');
    if (el) {
        el.style.display = show ? 'flex' : 'none';
    }
}

function clearOverlays() {
    document.querySelectorAll('.map-empty-state, .map-error-state').forEach(el => el.remove());
}

function showEmptyState() {
    const container = document.querySelector('.map-container');
    if (!container) return;

    const overlay = document.createElement('div');
    overlay.className = 'map-empty-state';

    const icon = document.createElement('div');
    icon.className = 'icon';
    icon.textContent = '📍';

    const title = document.createElement('h3');
    title.textContent = 'No Spots Yet';

    const body = document.createElement('p');
    body.textContent = 'There are no live spots available right now. Download the app to be the first to create one!';

    overlay.appendChild(icon);
    overlay.appendChild(title);
    overlay.appendChild(body);
    container.appendChild(overlay);
}

function showMapError(title, detail) {
    showLoading(false);

    const container = document.querySelector('.map-container');
    if (!container) return;

    clearOverlays();

    const overlay = document.createElement('div');
    overlay.className = 'map-error-state';

    const iconEl = document.createElement('div');
    iconEl.className = 'icon';
    iconEl.textContent = '⚠';

    const titleEl = document.createElement('h3');
    titleEl.textContent = title;

    const detailEl = document.createElement('p');
    // detail is always one of this file's own literals, never user or database
    // content, which is why innerHTML is acceptable here.
    detailEl.innerHTML = detail;

    overlay.appendChild(iconEl);
    overlay.appendChild(titleEl);
    overlay.appendChild(detailEl);

    if (map) {
        const retryBtn = document.createElement('button');
        retryBtn.className = 'btn-retry';
        retryBtn.textContent = 'Try Again';
        retryBtn.addEventListener('click', () => {
            clearOverlays();
            fetchSpots();
        });
        overlay.appendChild(retryBtn);
    }

    container.appendChild(overlay);
}
