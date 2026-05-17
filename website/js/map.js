/**
 * QSpot Website — Map Page Logic
 * Fetches live spots from Supabase and renders them on a MapLibre GL map.
 *
 * Clustering mirrors the Android MapLibreController implementation exactly:
 *   • Native MapLibre GeoJSON clustering  (clusterMaxZoom=13, clusterRadius=60)
 *   • Step-based cluster circle colours:  #9C27B0 → #6A1B9A → #4A148C
 *   • Step-based cluster circle radii:    26 → 32 → 38 px
 *   • 5 per-category count accumulators:  n_ski / n_shopping / n_concert / n_museum / n_amusement
 *   • Category mini-icon row in the lower half of each cluster bubble
 *   • Teardrop pins coloured by category for individual (unclustered) spots
 *   • Cluster tap → getClusterExpansionZoom → fly to dissolution zoom (capped at 17)
 */

let map;
let spotsData = [];
let activePopup = null;

// ─── Source / Layer IDs (match Kotlin MapLibreController constants) ───────────
const MARKERS_SOURCE_ID       = 'qspot-markers-source';
const MARKERS_LAYER_ID        = 'qspot-markers-layer';
const CLUSTER_CIRCLE_LAYER_ID = 'qspot-cluster-circle-layer';
const CLUSTER_COUNT_LAYER_ID  = 'qspot-cluster-count-layer';

// ─── Category colours (match Kotlin createColoredMarkerBitmap category colours) ──
const CATEGORY_COLORS = {
    ski_resort:     '#1976D2',  // blue
    shopping:       '#E65100',  // orange
    concert:        '#6A1B9A',  // deep purple
    museum_gallery: '#00695C',  // teal
    amusement_park: '#AD1457',  // deep pink
};
const DEFAULT_MARKER_COLOR = '#9C27B0'; // brand purple (matches app buyer marker)

// ─── Cluster category icon configs (match Kotlin CLUSTER_CAT_CONFIGS) ─────────
// xOffset values (−18 … +18) position each category in a fixed horizontal slot
// inside the lower half of the cluster bubble — identical to Kotlin layout.
const CLUSTER_CAT_CONFIGS = [
    { layerId: 'qspot-cluster-cat-ski',       imageId: 'cluster-cat-ski',       nProp: 'n_ski',       color: '#1976D2', xOffset: -18 },
    { layerId: 'qspot-cluster-cat-shopping',  imageId: 'cluster-cat-shopping',  nProp: 'n_shopping',  color: '#E65100', xOffset:  -9 },
    { layerId: 'qspot-cluster-cat-concert',   imageId: 'cluster-cat-concert',   nProp: 'n_concert',   color: '#6A1B9A', xOffset:   0 },
    { layerId: 'qspot-cluster-cat-museum',    imageId: 'cluster-cat-museum',    nProp: 'n_museum',    color: '#00695C', xOffset:   9 },
    { layerId: 'qspot-cluster-cat-amusement', imageId: 'cluster-cat-amusement', nProp: 'n_amusement', color: '#AD1457', xOffset:  18 },
];

document.addEventListener('DOMContentLoaded', () => {
    initMap();
});

/* --- Resolve map tile style URL based on config --- */
function resolveMapStyle() {
    const cfg = QSPOT_CONFIG;

    // Free tile path: OpenFreeMap (no API key, same MapLibre GL engine)
    if (cfg.USE_FREE_TILES) {
        // OpenFreeMap "liberty" style — closest visual match to MapTiler streets-v2
        return 'https://tiles.openfreemap.org/styles/liberty';
    }

    // Production path: MapTiler
    const apiKey = cfg.MAPTILER_API_KEY;
    if (!apiKey || apiKey === 'YOUR_MAPTILER_API_KEY_HERE') {
        return null; // Signals "not configured"
    }
    return `https://api.maptiler.com/maps/${cfg.MAP_STYLE}/style.json?key=${apiKey}`;
}

/* --- Initialize MapLibre GL map --- */
function initMap() {
    const styleUrl = resolveMapStyle();

    if (!styleUrl) {
        showMapError(
            'MapTiler API key not configured',
            'Open <code>js/config.js</code> and either:<br>' +
            '• Set <code>USE_FREE_TILES: true</code> to use free OpenFreeMap tiles for testing, or<br>' +
            '• Add your MapTiler key. Get one free at <a href="https://cloud.maptiler.com/" target="_blank" rel="noopener">cloud.maptiler.com</a>.'
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

    // Add navigation controls
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Add geolocation control
    map.addControl(
        new maplibregl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: false,
        }),
        'top-right'
    );

    map.on('load', () => {
        clearTimeout(loadTimeout);
        // Register all marker and cluster icon bitmaps before adding any layers
        addIconImages();
        fetchSpots();
    });

    map.on('error', (e) => {
        console.error('Map error:', e);
        if (e.error && (e.error.status === 401 || e.error.status === 403)) {
            showMapError(
                'Map tiles unavailable (auth error)',
                QSPOT_CONFIG.USE_FREE_TILES
                    ? 'OpenFreeMap returned an auth error — this is unusual. Try refreshing, or switch to MapTiler.'
                    : 'The MapTiler API key is not authorized for this domain. Check the allowed origins in your MapTiler dashboard.'
            );
        }
    });

    // Safety net: show an error if the style never loads within 10 seconds
    const loadTimeout = setTimeout(() => {
        if (!map.isStyleLoaded()) {
            showMapError(
                'Map failed to load',
                'The map timed out loading. Please check your MapTiler API key configuration and try refreshing.'
            );
        }
    }, 10000);
}

/* ══════════════════════════════════════════════════════════════════════════════
   Icon image generation
   Canvas-drawn bitmaps registered with the MapLibre style sprite.
   Mirrors createColoredMarkerBitmap() and rasterizeVectorDrawable() from
   MapLibreController.kt — identical colours and proportions.
══════════════════════════════════════════════════════════════════════════════ */

/**
 * Lighten (+amount) or darken (−amount) a CSS hex colour.
 * Used to build the linear gradient fill on teardrop pins.
 */
function adjustColor(hex, amount) {
    const n = parseInt(hex.replace('#', ''), 16);
    const clamp = v => Math.min(255, Math.max(0, v));
    const r = clamp((n >> 16) + amount);
    const g = clamp(((n >> 8) & 0xff) + amount);
    const b = clamp((n & 0xff) + amount);
    return `rgb(${r},${g},${b})`;
}

/**
 * Draw a teardrop map-pin on a 2× canvas and return the element.
 * Visual design mirrors Kotlin's createColoredMarkerBitmap():
 *   drop shadow → gradient fill → white border ring → white inner disc.
 *
 * Canvas: 56×80 px physical → renders at 28×40 logical px (pixelRatio: 2).
 * Register with: map.addImage(id, canvas, { pixelRatio: 2 })
 */
function createTeardropCanvas(fillColor) {
    const SCALE = 2;
    const W = 28 * SCALE;   // 56 px physical → 28 px logical
    const H = 40 * SCALE;   // 80 px physical → 40 px logical
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    // ── Pin geometry ─────────────────────────────────────────────────────────
    const cx     = W / 2;
    const headR  = W * 0.37;             // radius of the circular head
    const headCy = headR + 3 * SCALE;   // top of circle + small padding
    const tipY   = H - 3;               // tip near the bottom edge

    // Left/right tangent points on the circle where the tapered wings begin.
    // alpha = angle from the positive-X axis of the circle; points at ~30° into
    // the lower quadrants — same proportion as the Kotlin teardrop path.
    const alpha = 0.53; // radians (~30°)
    const lx = cx - headR * Math.cos(alpha);
    const ly = headCy + headR * Math.sin(alpha);
    const rx = cx + headR * Math.cos(alpha);
    // ry === ly by symmetry

    // Bezier control points curve slightly inward toward the tip
    const cpLx = cx - headR * 0.22;
    const cpRx = cx + headR * 0.22;
    const cpY  = ly + (tipY - ly) * 0.58;

    // Reusable path definition
    function drawPin() {
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.quadraticCurveTo(cpLx, cpY, cx, tipY);          // left wing → tip
        ctx.quadraticCurveTo(cpRx, cpY, rx, ly);            // tip → right wing
        // Arc counterclockwise from right tangent (alpha) back over the top to
        // left tangent (π − alpha): traces the upper ~300° of the circle head.
        ctx.arc(cx, headCy, headR, alpha, Math.PI - alpha, false);
        ctx.closePath();
    }

    // 1 — Drop shadow pass
    ctx.save();
    ctx.shadowColor   = 'rgba(0,0,0,0.38)';
    ctx.shadowBlur    = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    drawPin();
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.restore();

    // 2 — Gradient fill (matches Kotlin's LinearGradient top-lighter, bottom-darker)
    drawPin();
    const grad = ctx.createLinearGradient(cx, headCy - headR, cx, tipY);
    grad.addColorStop(0, adjustColor(fillColor, 35));
    grad.addColorStop(1, adjustColor(fillColor, -15));
    ctx.fillStyle = grad;
    ctx.fill();

    // 3 — White border ring (matches Kotlin circleStrokeWidth=2.5 / white stroke)
    drawPin();
    ctx.strokeStyle = 'rgba(255,255,255,0.90)';
    ctx.lineWidth   = 2.5;
    ctx.stroke();

    // 4 — White inner disc (matches Kotlin inner circle)
    ctx.beginPath();
    ctx.arc(cx, headCy, headR * 0.44, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.86)';
    ctx.fill();

    return canvas;
}

/**
 * Draw a small (10×13 px logical) teardrop mini-icon for the cluster category row.
 * Mirrors rasterizeVectorDrawable(ic_map_marker_*, 10dp, 12dp) from Kotlin.
 * Canvas: 20×26 px physical → renders at 10×13 logical px (pixelRatio: 2).
 */
function createMiniIconCanvas(fillColor) {
    const SCALE = 2;
    const W = 10 * SCALE;   // 20 px physical → 10 px logical
    const H = 13 * SCALE;   // 26 px physical → 13 px logical
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const cx     = W / 2;
    const headR  = W * 0.37;
    const headCy = headR + 1 * SCALE;
    const tipY   = H - 2;

    const alpha = 0.53;
    const lx = cx - headR * Math.cos(alpha);
    const ly = headCy + headR * Math.sin(alpha);
    const rx = cx + headR * Math.cos(alpha);
    const cpY  = ly + (tipY - ly) * 0.62;

    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.quadraticCurveTo(cx - headR * 0.18, cpY, cx, tipY);
    ctx.quadraticCurveTo(cx + headR * 0.18, cpY, rx, ly);
    ctx.arc(cx, headCy, headR, alpha, Math.PI - alpha, false);
    ctx.closePath();

    ctx.fillStyle = fillColor;
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.lineWidth   = 1;
    ctx.stroke();

    return canvas;
}

/**
 * Register all marker and cluster-icon images with the map style.
 * Must be called synchronously after the map 'load' event so the sprite is ready.
 * All addImage() calls are synchronous — images are available immediately for layers
 * added in the same event-loop turn (fetchSpots / renderSpotsOnMap).
 */
function addIconImages() {
    // ── Teardrop pins — one per category + a default ─────────────────────────
    const markerEntries = [
        ...Object.entries(CATEGORY_COLORS).map(([cat, color]) => [`marker-${cat}`, color]),
        ['marker-default', DEFAULT_MARKER_COLOR],
    ];
    markerEntries.forEach(([imageId, color]) => {
        map.addImage(imageId, createTeardropCanvas(color), { pixelRatio: 2 });
    });

    // ── Cluster category mini-icons — one per cluster category slot ───────────
    CLUSTER_CAT_CONFIGS.forEach(({ imageId, color }) => {
        map.addImage(imageId, createMiniIconCanvas(color), { pixelRatio: 2 });
    });
}

/* ══════════════════════════════════════════════════════════════════════════════
   GeoJSON helpers
══════════════════════════════════════════════════════════════════════════════ */

/** Return the pre-registered image ID for a spot's category. */
function getIconImageId(category) {
    const key = (category || '').toLowerCase().replace(/\s+/g, '_');
    return Object.prototype.hasOwnProperty.call(CATEGORY_COLORS, key)
        ? `marker-${key}`
        : 'marker-default';
}

/**
 * Build a GeoJSON FeatureCollection from the spots array.
 * Each feature carries:
 *   spotId, iconImage, label, category  — for individual-marker rendering
 *   n_ski, n_shopping, n_concert, n_museum, n_amusement  — per-category accumulators
 *     accumulated by MapLibre's native clustering (matches Kotlin withClusterProperty).
 */
function buildGeoJson(spots) {
    const features = spots
        .filter(s => s.latitude && s.longitude &&
                     Math.abs(s.latitude) <= 90 && Math.abs(s.longitude) <= 180)
        .map(spot => {
            const cat = (spot.category || '').toLowerCase().replace(/\s+/g, '_');
            return {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [spot.longitude, spot.latitude],
                },
                properties: {
                    spotId:      spot.id,
                    iconImage:   getIconImageId(spot.category),
                    label:       spot.name || '',
                    category:    cat,
                    // One-hot category flags consumed by clusterProperties accumulators
                    n_ski:       cat === 'ski_resort'     ? 1 : 0,
                    n_shopping:  cat === 'shopping'       ? 1 : 0,
                    n_concert:   cat === 'concert'        ? 1 : 0,
                    n_museum:    cat === 'museum_gallery'  ? 1 : 0,
                    n_amusement: cat === 'amusement_park'  ? 1 : 0,
                },
            };
        });

    return { type: 'FeatureCollection', features };
}

/* ══════════════════════════════════════════════════════════════════════════════
   Map layer management
   renderSpotsOnMap() mirrors initMarkersLayer() in Kotlin MapLibreController.
   Layer order (bottom → top):
     1. CLUSTER_CIRCLE_LAYER_ID    — purple bubble background
     2. CLUSTER_COUNT_LAYER_ID     — white count number (top half of bubble)
     3–7. qspot-cluster-cat-*      — category mini-icons (bottom half of bubble)
     8. MARKERS_LAYER_ID           — individual teardrop pins + name labels
══════════════════════════════════════════════════════════════════════════════ */

/**
 * Add or update the GeoJSON source and all 8 rendering layers.
 *
 * First call:  creates the clustered GeoJSON source + all layers and wires up
 *              click/cursor interaction handlers.
 * Subsequent calls (retry / data refresh):  updates source data in-place via
 *              setData() — layers are untouched, interaction handlers stay live.
 */
function renderSpotsOnMap(spots) {
    if (activePopup) { activePopup.remove(); activePopup = null; }

    const geojson = buildGeoJson(spots);

    // ── On subsequent fetches just swap the data — layers need no change ─────
    if (map.getSource(MARKERS_SOURCE_ID)) {
        map.getSource(MARKERS_SOURCE_ID).setData(geojson);
        return;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GeoJSON source with native clustering
    // Parameters mirror Kotlin:
    //   GeoJsonOptions().withCluster(true).withClusterMaxZoom(13).withClusterRadius(60)
    // clusterProperties mirrors withClusterProperty() accumulators.
    // ══════════════════════════════════════════════════════════════════════════
    map.addSource(MARKERS_SOURCE_ID, {
        type: 'geojson',
        data: geojson,
        cluster:        true,
        clusterMaxZoom: 13,   // clusters dissolve at zoom 14+ (matches Kotlin withClusterMaxZoom(13))
        clusterRadius:  60,   // group points within 60 px  (matches Kotlin withClusterRadius(60))
        // Per-category count accumulators — mirrors Kotlin withClusterProperty() calls.
        // Syntax: { propName: ['+', map_expression] }
        // For each point, map_expression yields 1 if the category matches, else 0.
        // MapLibre sums these across all clustered points.
        clusterProperties: {
            n_ski:       ['+', ['case', ['==', ['get', 'category'], 'ski_resort'],     1, 0]],
            n_shopping:  ['+', ['case', ['==', ['get', 'category'], 'shopping'],       1, 0]],
            n_concert:   ['+', ['case', ['==', ['get', 'category'], 'concert'],        1, 0]],
            n_museum:    ['+', ['case', ['==', ['get', 'category'], 'museum_gallery'], 1, 0]],
            n_amusement: ['+', ['case', ['==', ['get', 'category'], 'amusement_park'], 1, 0]],
        },
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Layer 1 — Cluster circle bubbles
    // CircleLayer filtered to features that have a "point_count" property
    // (i.e. cluster features only). Colour and radius are step-expressions keyed
    // on point_count — identical breakpoints to the Kotlin CircleLayer.
    // ══════════════════════════════════════════════════════════════════════════
    map.addLayer({
        id:     CLUSTER_CIRCLE_LAYER_ID,
        type:   'circle',
        source: MARKERS_SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
            // Colour steps: < 10 → brand purple, 10–49 → darker, 50+ → darkest
            'circle-color': [
                'step', ['get', 'point_count'],
                '#9C27B0',          //  < 10 spots  (brand purple)
                10, '#6A1B9A',      // 10–49 spots
                50, '#4A148C',      // 50+ spots
            ],
            // Radius steps: matches Kotlin 26 / 32 / 38 dp
            'circle-radius': [
                'step', ['get', 'point_count'],
                26,                 //  < 10 spots
                10, 32,             // 10–49 spots
                50, 38,             // 50+ spots
            ],
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#FFFFFF',
            'circle-opacity':      0.92,
        },
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Layer 2 — Cluster count number
    // Large white bold text shifted upward (textOffset Y = -0.6 em) so it sits
    // in the top half of the bubble — mirrors Kotlin's SymbolLayer config.
    // Uses point_count_abbreviated ("100+" for large clusters).
    // ══════════════════════════════════════════════════════════════════════════
    map.addLayer({
        id:     CLUSTER_COUNT_LAYER_ID,
        type:   'symbol',
        source: MARKERS_SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
            'text-field':              '{point_count_abbreviated}',
            'text-font':               ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-size':               15,
            'text-offset':             [0, -0.6],   // shift upward (matches Kotlin textOffset Y = -0.6f)
            'text-allow-overlap':      true,
            'text-ignore-placement':   true,
        },
        paint: {
            'text-color': '#FFFFFF',
        },
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Layers 3–7 — Category mini-icon row
    // One SymbolLayer per category. Each layer is only visible when its
    // accumulator property (n_ski / n_shopping / …) is > 0. Fixed horizontal
    // slot positions (−18 … +18 px) keep each category in the same position
    // regardless of which others are present — identical to Kotlin's layout.
    // ══════════════════════════════════════════════════════════════════════════
    CLUSTER_CAT_CONFIGS.forEach(({ layerId, imageId, nProp, xOffset }) => {
        map.addLayer({
            id:     layerId,
            type:   'symbol',
            source: MARKERS_SOURCE_ID,
            filter: ['all',
                ['has', 'point_count'],
                ['>', ['get', nProp], 0],
            ],
            layout: {
                'icon-image':            imageId,
                'icon-size':             1.0,
                'icon-offset':           [xOffset, 10],  // fixed slot; y=+10 → lower half
                'icon-allow-overlap':    true,
                'icon-ignore-placement': true,
            },
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Layer 8 — Individual (unclustered) spot teardrop pins + name labels
    // Filtered to features WITHOUT "point_count" (non-cluster points only).
    // Only visible at zoom > clusterMaxZoom (14+), at which point every spot
    // renders as a coloured teardrop pin with its name label beneath the tip.
    // Matches Kotlin's individualMarkerLayer configuration.
    // ══════════════════════════════════════════════════════════════════════════
    map.addLayer({
        id:     MARKERS_LAYER_ID,
        type:   'symbol',
        source: MARKERS_SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        layout: {
            'icon-image':            ['get', 'iconImage'],
            'icon-size':             1.0,
            'icon-anchor':           'bottom',  // pin tip at the geographic coordinate
            'icon-allow-overlap':    true,
            'icon-ignore-placement': true,
            // Spot name label beneath the pin (matches Kotlin textAnchor=TOP / textOffset=[0, 0.3])
            'text-field':            ['get', 'label'],
            'text-anchor':           'top',
            'text-offset':           [0, 0.3],
            'text-size':             11,
            'text-allow-overlap':    true,
            'text-ignore-placement': true,
        },
        paint: {
            'text-color':       '#FFFFFF',
            'text-halo-color':  'rgba(0,0,0,0.65)',
            'text-halo-width':  1.5,
        },
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Interaction — Cluster tap: zoom to expansion zoom level
    // Mirrors Kotlin's CLUSTER TAP DETECTION in processMapClick().
    // getClusterExpansionZoom() returns the minimum zoom at which the cluster
    // fully dissolves. Falls back to currentZoom + 2 on error (max 17).
    // ══════════════════════════════════════════════════════════════════════════
    map.on('click', CLUSTER_CIRCLE_LAYER_ID, (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: [CLUSTER_CIRCLE_LAYER_ID] });
        if (!features.length) return;

        const clusterId = features[0].properties.cluster_id;
        const coords    = features[0].geometry.coordinates.slice();

        map.getSource(MARKERS_SOURCE_ID).getClusterExpansionZoom(clusterId, (err, zoom) => {
            map.easeTo({
                center: coords,
                zoom:   err ? Math.min(map.getZoom() + 2, 17) : Math.min(zoom, 17),
            });
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Interaction — Individual marker tap: show spot popup
    // Uses layer-based click (no DOM markers) and the shared popup instance.
    // ══════════════════════════════════════════════════════════════════════════
    map.on('click', MARKERS_LAYER_ID, (e) => {
        if (!e.features || !e.features.length) return;

        const props = e.features[0].properties;
        const spot  = spotsData.find(s => String(s.id) === String(props.spotId));
        if (!spot) return;

        // When a symbol overlaps the anti-meridian the coordinates array may need
        // to be adjusted — slice() to ensure we have a plain array.
        const coords = e.features[0].geometry.coordinates.slice();

        if (activePopup) { activePopup.remove(); activePopup = null; }
        activePopup = new maplibregl.Popup({
            offset:      [0, -10],
            maxWidth:    '300px',
            closeButton: true,
            anchor:      'bottom',
        })
            .setLngLat(coords)
            .setHTML(buildPopupHTML(spot))
            .addTo(map);
    });

    // Close popup when clicking blank map
    map.on('click', (e) => {
        // Only close if the click didn't land on a marker or cluster layer
        const hit = map.queryRenderedFeatures(e.point, {
            layers: [MARKERS_LAYER_ID, CLUSTER_CIRCLE_LAYER_ID],
        });
        if (!hit.length && activePopup) {
            activePopup.remove();
            activePopup = null;
        }
    });

    // ── Pointer cursor when hovering interactive layers ───────────────────────
    map.on('mouseenter', CLUSTER_CIRCLE_LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', CLUSTER_CIRCLE_LAYER_ID, () => { map.getCanvas().style.cursor = '';        });
    map.on('mouseenter', MARKERS_LAYER_ID,        () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', MARKERS_LAYER_ID,        () => { map.getCanvas().style.cursor = '';        });
}

/* --- Fetch spots from Supabase --- */
async function fetchSpots() {
    showLoading(true);
    clearOverlays();
    if (activePopup) { activePopup.remove(); activePopup = null; }

    try {
        const url = `${QSPOT_CONFIG.SUPABASE_URL}/rest/v1/spots?status=eq.ACTIVE&available_spots=gt.0&select=id,name,description,category,price,currency,latitude,longitude,image_url,images,rating,review_count`;

        const response = await fetch(url, {
            headers: {
                'apikey':        QSPOT_CONFIG.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${QSPOT_CONFIG.SUPABASE_ANON_KEY}`,
                'Accept':        'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`API returned ${response.status}: ${response.statusText}`);
        }

        spotsData = await response.json();

        if (!Array.isArray(spotsData)) {
            throw new Error('Unexpected response format');
        }

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

/* --- Parse Postgres array if needed --- */
function parseImages(images) {
    if (!images) return [];

    // Already a JS array
    if (Array.isArray(images)) return images;

    // Postgres text array format: {url1,url2,url3}
    if (typeof images === 'string' && images.startsWith('{') && images.endsWith('}')) {
        return images.slice(1, -1)
            .split(',')
            .map(s => s.replace(/^"|"$/g, '').trim())
            .filter(Boolean);
    }

    // JSON string
    if (typeof images === 'string') {
        try {
            const parsed = JSON.parse(images);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    return [];
}

/* --- Build popup HTML for a spot --- */
function buildPopupHTML(spot) {
    const parsedImages = parseImages(spot.images);
    const imageUrl = spot.image_url || (parsedImages.length > 0 ? parsedImages[0] : '');
    const rating   = spot.rating ? Number(spot.rating).toFixed(1) : '0.0';
    const reviews  = spot.review_count || 0;
    const price    = formatPrice(spot.price, spot.currency || 'USD');

    let html = '<div class="spot-popup">';

    if (imageUrl) {
        html += `<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(spot.name)}" class="spot-popup-image" loading="lazy" onerror="this.style.display='none'"/>`;
    }

    html += `
        <h3>${escapeHTML(spot.name)}</h3>
        <span class="spot-popup-category">${escapeHTML(spot.category || 'Spot')}</span>
        <div class="spot-popup-price">${escapeHTML(price)}</div>
        <div class="spot-popup-rating">${renderStars(spot.rating || 0)} ${escapeHTML(rating)} (${reviews} review${reviews !== 1 ? 's' : ''})</div>
        <span class="spot-popup-cta">View in App</span>
    </div>`;

    return html;
}

/* --- Fit map bounds to show all spots --- */
function fitMapToSpots(spots) {
    const validSpots = spots.filter(s =>
        s.latitude && s.longitude &&
        Math.abs(s.latitude) <= 90 && Math.abs(s.longitude) <= 180
    );

    if (validSpots.length === 0) return;

    if (validSpots.length === 1) {
        map.flyTo({
            center: [validSpots[0].longitude, validSpots[0].latitude],
            zoom:   14,
        });
        return;
    }

    const bounds = new maplibregl.LngLatBounds();
    validSpots.forEach(spot => {
        bounds.extend([spot.longitude, spot.latitude]);
    });

    map.fitBounds(bounds, {
        padding: { top: 60, bottom: 60, left: 60, right: 60 },
        maxZoom: 15,
    });
}

/* --- Update spot count badge --- */
function updateSpotCount(count) {
    const el = document.getElementById('spot-count');
    if (el) {
        el.textContent = `${count} live spot${count !== 1 ? 's' : ''}`;
    }
}

/* --- Show/hide loading spinner --- */
function showLoading(show) {
    const el = document.getElementById('map-loading');
    if (el) {
        el.style.display = show ? 'flex' : 'none';
    }
}

/* --- Clear overlay elements (empty state, error state) --- */
function clearOverlays() {
    document.querySelectorAll('.map-empty-state, .map-error-state').forEach(el => el.remove());
}

/* --- Show empty state when no spots exist --- */
function showEmptyState() {
    const container = document.querySelector('.map-container');
    if (!container) return;

    const overlay = document.createElement('div');
    overlay.className = 'map-empty-state';
    overlay.innerHTML = `
        <div class="icon">&#128205;</div>
        <h3>No Spots Yet</h3>
        <p>There are no live spots available right now. Download the app to be the first to create one!</p>
    `;
    container.appendChild(overlay);
}

/* --- Show error message overlaid on the map --- */
function showMapError(title, detail) {
    showLoading(false);

    const container = document.querySelector('.map-container');
    if (!container) return;

    clearOverlays();

    const overlay = document.createElement('div');
    overlay.className = 'map-error-state';

    const titleEl = document.createElement('h3');
    titleEl.textContent = title;

    const detailEl = document.createElement('p');
    // detail may contain safe HTML (our own hardcoded links), so we use innerHTML here
    // but title is always plain text via textContent
    detailEl.innerHTML = detail;

    const iconEl = document.createElement('div');
    iconEl.className = 'icon';
    iconEl.textContent = '\u26A0';

    overlay.appendChild(iconEl);
    overlay.appendChild(titleEl);
    overlay.appendChild(detailEl);

    // Add retry button if map was initialized (fetch error, not config error)
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

/* --- Escape HTML to prevent XSS in text content --- */
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

/* --- Escape for use in HTML attributes --- */
function escapeAttr(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
