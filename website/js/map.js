/**
 * QSpot Website — Live Map  (clustering v2, 2026-11-02)
 *
 * Renders the anon-readable `public_live_spots` view on a MapLibre GL map and
 * clusters it the way the app's Search map does (MapLibreController +
 * ClusterTapPlanner, Issues #239 / 2026-10-25 marker overlap / 2026-10-26 1.5×):
 *
 *   • Native GeoJSON clustering: clusterMaxZoom 16, clusterRadius 44, with an
 *     n_<category> accumulator per category.
 *   • Cluster bubble: purple by size, GOLD ring, count in the upper half and a
 *     row of tiny category pins in the lower half.
 *   • Spots: the app's teardrop pin per category (static PNG sprites in
 *     assets/images/map/), bottom-anchored, zoom-scaled, with the spot name
 *     beneath. Falls back to category circles if the sprites cannot load.
 *   • Cluster tap = the app's planner: zoom to the FIRST split with every
 *     post-split item on screen; spots no zoom can separate stop at street
 *     zoom and open an "N spots at this location" list.
 *   • Popup photo gallery: arrows, counter, dots, keyboard and swipe.
 *
 * ⚠️ Two bugs this version fixes on the live site — do not reintroduce:
 *   1. MapLibre ≥ 4 cluster methods return Promises and IGNORE callbacks.
 *      Always go through compatCall().
 *   2. A text layer with no text-font requests a font OpenFreeMap 404s, and the
 *      text silently disappears. Always use resolveStyleFonts().
 *
 * Popups are built with DOM APIs rather than innerHTML so that values coming
 * from the database are inserted as text nodes and can never be parsed as
 * markup.
 */

let map;
let spotsData = [];
let activePopup = null;


/**
 * False once a request has proved the view has no owner_rating column, i.e.
 * supabase/public_live_spots_owner_rating.sql has not been applied yet.
 * A missing rating must degrade to "no rating row", never to a broken map.
 */
let ownerRatingAvailable = true;

/** True while a spots request is running, so a second tap on Refresh (or a
 *  Refresh during the first load) cannot start an overlapping request. */
let spotsRequestInFlight = false;

/**
 * False once a request has proved the view has no buyer_fee_cents column, i.e.
 * supabase/public_live_spots_buyer_fee.sql has not been applied yet. Prices
 * then fall back to the pre-fee spot price. Apply the migration BEFORE
 * publishing this file so the fallback never runs: the all-in price is what
 * keeps the advertised figure equal to what the buyer pays (Issue #287).
 */
let buyerFeeAvailable = true;

/**
 * The price a buyer actually pays: spot price + the QSpot Processing Fee frozen
 * on the listing. Pay to Post listings carry no fee (NULL), so they show the
 * spot price. Summed in cents so 50.00 + 2.99 is exactly 52.99.
 */
function buyerTotalPrice(spot) {
    const fee = Number(spot.buyer_fee_cents);
    if (!Number.isFinite(fee) || fee <= 0) return spot.price;
    return (Math.round(Number(spot.price) * 100) + fee) / 100;
}

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

/** French display names (same wording as the app's French event types). */
const CATEGORY_LABELS_FR = {
    ski_resort:     'Station de ski',
    shopping:       'Magasinage',
    concert:        'Salle de concert',
    museum_gallery: 'Musée/Galerie',
    amusement_park: "Parc d'attractions",
    sporting_event: 'Événement sportif',
    restaurant:     'Restaurant',
    general:        'Autre lieu',
};

// ─── Clustering / camera tuning — keep in sync with the app ─────────────────
// composeApp/src/androidMain/.../ui/map/MapLibreController.kt
// composeApp/src/commonMain/.../ui/map/ClusterTapPlanner.kt
const CLUSTER_MAX_ZOOM     = 16;    // CLUSTER_MAX_ZOOM (was 13 here and in the app before 2026-10-25)
const CLUSTER_RADIUS       = 44;    // withClusterRadius(44)
const CLUSTER_TAP_MAX_ZOOM = 18;    // CLUSTER_TAP_MAX_ZOOM
const TILE_SIZE            = 512;   // MapLibre's zoom basis (tileSizeDp = 512.0)
const SPLIT_EPSILON        = 0.05;  // GeoJSON tiles are chosen at floor(zoom): land just past the split
const MIN_PROGRESS         = 0.5;   // ClusterTapPlanner.MIN_PROGRESS
const CO_LOCATED_ZOOM      = 15;    // ClusterTapPlanner.CO_LOCATED_ZOOM
const CO_LOCATED_SPAN_PX   = 24;    // ClusterTapPlanner.CO_LOCATED_SPAN_DP
const PIN_COLLISION_W_PX   = 33;    // PIN_COLLISION_WIDTH_DP
const PIN_COLLISION_H_PX   = 45;    // PIN_COLLISION_HEIGHT_DP
/** ClusterTapPlanner.ItemMargins defaults. */
const ITEM_MARGINS = { side: 40, above: 56, below: 28 };
/** Strips of the map the planner keeps items out of: zoom/locate buttons (right), attribution (bottom). */
const VISIBLE_INSETS = { top: 12, right: 52, bottom: 34, left: 12 };

// ─── Pins ────────────────────────────────────────────────────────────────────
/** Categories with their own pin sprite; anything else gets pin-default (the app's plain red pin). */
const PIN_CATEGORIES = ['ski_resort', 'shopping', 'concert', 'museum_gallery', 'amusement_park', 'sporting_event', 'restaurant'];
const PIN_IMAGE_PIXEL_RATIO = 3;    // PNGs are 60×84 px → 20×28 CSS px at icon-size 1
const PIN_BASE_W_PX = 20;
const PIN_BASE_H_PX = 28;

// ─── Cluster category row ────────────────────────────────────────────────────
const CLUSTER_CATEGORY_PROPS = {
    ski_resort:     'n_ski',
    shopping:       'n_shopping',
    concert:        'n_concert',
    museum_gallery: 'n_museum',
    amusement_park: 'n_amusement',
    sporting_event: 'n_sporting',
    restaurant:     'n_restaurant',
};
const CLUSTER_CAT_LAYER_PREFIX = 'qspot-cluster-cat-';
const CLUSTER_ICON_SIZE        = 0.42;  // 20×28 → ≈ 8×12 px, the app's 10×12 dp mini pin
const CLUSTER_ICON_Y_PX        = 10;    // icon centre below the bubble centre (Android +10 dp)
const CLUSTER_ICON_SPACING_PX  = 10;
const CLUSTER_ICON_ROW_MAX_PX  = 40;    // fits the smallest (26 px) bubble

document.addEventListener('DOMContentLoaded', () => {
    initMap();

    const refreshBtn = document.getElementById('map-refresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => fetchSpots({ refresh: true }));
    }
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
        showMapError(
            qsPick('Map failed to initialize', 'Échec de l\u2019initialisation de la carte'),
            qsPick('Check your tile configuration and try refreshing the page.', 'Vérifiez la configuration des tuiles et actualisez la page.')
        );
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
                qsPick('Map tiles unavailable (auth error)', 'Tuiles de carte indisponibles (erreur d\u2019authentification)'),
                QSPOT_CONFIG.USE_FREE_TILES
                    ? qsPick('OpenFreeMap returned an auth error &mdash; this is unusual. Try refreshing, or switch to MapTiler.', 'OpenFreeMap a renvoy\u00e9 une erreur d\u2019authentification, ce qui est inhabituel. Actualisez la page et r\u00e9essayez.')
                    : 'The MapTiler API key is not authorized for this domain. Check the allowed origins in your MapTiler dashboard.'
            );
        }
    });

    // Escape closes the popup or list.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closePopup();
    });

    const loadTimeout = setTimeout(() => {
        if (!map.isStyleLoaded()) {
            showMapError(
                qsPick('Map failed to load', 'Échec du chargement de la carte'),
                qsPick('The map timed out loading. Please check your MapTiler API key configuration and try refreshing.', 'Le chargement de la carte a expiré. Actualisez la page et réessayez.')
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
        return qsPick(CATEGORY_LABELS[key], CATEGORY_LABELS_FR[key]);
    }
    if (!key) return qsPick('Spot', 'Spot');
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
                label:    spot.name || '',
            },
        })),
    };
}

/** Resolve a feature's spotId back to the full record from the last fetch. */
function spotById(id) {
    return spotsData.find(s => String(s.id) === String(id)) || null;
}

/* ══════════════════════════════════════════════════════════════════════════
   MapLibre compatibility

   MapLibre GL JS 4.0 changed GeoJSONSource.getClusterLeaves /
   getClusterChildren / getClusterExpansionZoom and map.loadImage from
   callbacks to Promises (maplibre-gl-js #3421 / #3233). A callback passed to
   the 4.x methods is silently ignored, which is exactly how every cluster tap
   on this page did nothing from 2026-09-17 to the v2 rewrite.

   compatCall() accepts both shapes: it passes a trailing callback (used by
   3.x, ignored by 4.x+) AND listens to a returned Promise (4.x+), settling on
   whichever arrives first. Pinning a different MapLibre version in map.html
   can therefore never silently kill cluster taps again.
══════════════════════════════════════════════════════════════════════════ */

function compatCall(target, method, ...args) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const done = (err, value) => {
            if (settled) return;
            settled = true;
            if (err) reject(err); else resolve(value);
        };
        let ret;
        try {
            ret = target[method](...args, done);
        } catch (e) {
            done(e);
            return;
        }
        if (ret && typeof ret.then === 'function') {
            ret.then((v) => done(null, v), (e) => done(e || new Error(`${method} failed`)));
        }
    });
}

/* ══════════════════════════════════════════════════════════════════════════
   Pin sprites and fonts
══════════════════════════════════════════════════════════════════════════ */

/** Sprite id for a category's teardrop pin (assets/images/map/pin-*.png). */
function pinImageId(cat) {
    return `qspot-pin-${PIN_CATEGORIES.includes(cat) ? cat : 'default'}`;
}

function pinImageUrl(cat) {
    return `assets/images/map/pin-${cat.replace(/_/g, '-')}.png`;
}

/**
 * Registers the eight pin PNGs. They are static files decoded by MapLibre's
 * own loadImage — not canvas-generated sprites, which is what broke a symbol
 * layer in Safari under MapLibre 4.x. Resolves true when every image is in,
 * false otherwise (the caller then falls back to plain circles).
 */
async function loadPinImages() {
    const cats = [...PIN_CATEGORIES, 'default'];
    try {
        await Promise.all(cats.map(async (cat) => {
            const id = pinImageId(cat);
            if (map.hasImage(id)) return;
            const res = await compatCall(map, 'loadImage', pinImageUrl(cat));
            const img = res && res.data ? res.data : res;      // 4.x: { data }, 3.x: the image
            if (!img) throw new Error(`empty image for ${cat}`);
            if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: PIN_IMAGE_PIXEL_RATIO });
        }));
        return true;
    } catch (e) {
        console.warn('Map pin sprites unavailable, falling back to circle markers:', e);
        return false;
    }
}

/**
 * Picks font stacks the current style's glyph server actually serves.
 *
 * A symbol layer with no text-font asks for MapLibre's default
 * "Open Sans Regular,Arial Unicode MS Regular". OpenFreeMap (production —
 * USE_FREE_TILES is true and the deploy never flips it) answers that with a
 * 404, so before v2 every cluster bubble on the live site was drawn with no
 * number in it. The style's own layers name fonts its glyph server has, so
 * borrow theirs: OpenFreeMap → Noto Sans Bold / Regular, MapTiler → whatever
 * that style uses.
 */
function resolveStyleFonts() {
    const stacks = [];
    (map.getStyle().layers || []).forEach((layer) => {
        let f = layer.layout && layer.layout['text-font'];
        if (Array.isArray(f) && f[0] === 'literal' && Array.isArray(f[1])) f = f[1];
        if (Array.isArray(f) && f.length && f.every((s) => typeof s === 'string')) stacks.push(f);
    });
    const find = (re) => stacks.find((s) => re.test(s[0]));
    const regular = find(/regular/i) || stacks[0] || ['Noto Sans Regular'];
    const bold = find(/bold/i) || regular;
    return { regular, bold };
}

/* ══════════════════════════════════════════════════════════════════════════
   Layers — mirror MapLibreController.initMarkersLayer() (clustering on)

     1. cluster bubble   purple #9C27B0 / #6A1B9A / #4A148C, radius 26 / 32 / 38
                         for <10 / 10–49 / 50+, GOLD ring #FFD700 × 3
     2. cluster count    white, in the upper half of the bubble
     3. category row     one tiny pin per category present, lower half of the
                         bubble (Android: 10×12 dp pin icons; iOS: icon row)
     4. spot pins        teardrop pin per category, bottom-anchored, zoom-scaled
                         1.2 @ z15 · 1.5 @ z17 · 1.95 @ z19, spot name beneath
══════════════════════════════════════════════════════════════════════════ */

/** n_<cat> accumulator per category, so a cluster knows which categories it holds. */
function clusterProperties() {
    const props = {};
    Object.entries(CLUSTER_CATEGORY_PROPS).forEach(([cat, prop]) => {
        props[prop] = ['+', ['case', ['==', ['get', 'category'], cat], 1, 0]];
    });
    return props;
}

/**
 * icon-offset for one category's mini pin: a centred row of only the
 * categories present (the iOS layout), so a one-category cluster shows one
 * centred icon instead of an icon in a far-left slot.
 *
 * The style spec cannot build an [x, y] array from computed numbers, so the
 * offset is a match table of literals keyed on (categories present, this
 * category's position among them) — both small integers. icon-offset is
 * multiplied by icon-size, hence the division.
 */
function categoryRowOffset(cat) {
    const props = Object.values(CLUSTER_CATEGORY_PROPS);
    const own = CLUSTER_CATEGORY_PROPS[cat];
    const present = (p) => ['case', ['>', ['coalesce', ['get', p], 0], 0], 1, 0];
    const before = props.slice(0, props.indexOf(own));
    const index = before.length ? ['+', 0, ...before.map(present)] : 0;
    const count = ['+', 0, ...props.map(present)];
    const s = CLUSTER_ICON_SIZE;
    const y = CLUSTER_ICON_Y_PX / s;
    const byCount = ['match', count];
    for (let c = 1; c <= props.length; c++) {
        const spacing = Math.min(CLUSTER_ICON_SPACING_PX, CLUSTER_ICON_ROW_MAX_PX / c);
        const byIndex = ['match', index];
        for (let i = 0; i < c; i++) {
            byIndex.push(i, ['literal', [Number((((i - (c - 1) / 2) * spacing) / s).toFixed(3)), y]]);
        }
        byIndex.push(['literal', [0, y]]);
        byCount.push(c, typeof index === 'number' ? byIndex[3] : byIndex);
    }
    byCount.push(['literal', [0, y]]);
    return byCount;
}

/** Pin icon-size at a zoom, mirroring markerIconSizeForClustering(). */
const PIN_SIZE_STOPS = [[15, 1.2], [17, 1.5], [19, 1.95]];

function pinIconSizeAt(zoom) {
    const s = PIN_SIZE_STOPS;
    if (zoom <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++) {
        if (zoom <= s[i][0]) {
            const [z0, v0] = s[i - 1];
            const [z1, v1] = s[i];
            return v0 + (v1 - v0) * (zoom - z0) / (z1 - z0);
        }
    }
    return s[s.length - 1][1];
}

let markerLayersPromise = null;
let pinsAvailable = false;

function renderSpotsOnMap(spots) {
    closePopup();

    const geojson = buildGeoJson(spots);
    const existing = map.getSource(MARKERS_SOURCE_ID);
    if (existing) {
        existing.setData(geojson);
        return markerLayersPromise || Promise.resolve();
    }

    // The source goes in synchronously, so a Refresh that lands while the pin
    // images are still loading takes the setData path above instead of trying
    // to add a second source.
    map.addSource(MARKERS_SOURCE_ID, {
        type: 'geojson',
        data: geojson,
        cluster: true,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterRadius: CLUSTER_RADIUS,
        clusterProperties: clusterProperties(),
    });

    markerLayersPromise = loadPinImages().then((ok) => {
        pinsAvailable = ok;
        addMarkerLayers();
    });
    return markerLayersPromise;
}

function addMarkerLayers() {
    const fonts = resolveStyleFonts();

    // 1 — cluster bubble
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
            'circle-radius': ['step', ['get', 'point_count'], 26, 10, 32, 50, 38],
            'circle-stroke-width': 3,
            'circle-stroke-color': '#FFD700',   // gold ring — both apps
            'circle-opacity': 0.92,
        },
    });

    // 2 — count. Upper half when the category row is drawn beneath it
    // (Android textOffset [0, -0.6]); centred otherwise.
    map.addLayer({
        id: CLUSTER_COUNT_LAYER_ID,
        type: 'symbol',
        source: MARKERS_SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
            'text-field': ['to-string', ['get', 'point_count_abbreviated']],
            'text-font': fonts.bold,
            'text-size': 15,
            'text-offset': pinsAvailable ? [0, -0.6] : [0, 0],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
        },
        paint: { 'text-color': '#FFFFFF' },
    });

    // 3 — category row (needs the pin sprites)
    if (pinsAvailable) {
        Object.entries(CLUSTER_CATEGORY_PROPS).forEach(([cat, prop]) => {
            map.addLayer({
                id: `${CLUSTER_CAT_LAYER_PREFIX}${cat}`,
                type: 'symbol',
                source: MARKERS_SOURCE_ID,
                filter: ['all', ['has', 'point_count'], ['>', ['coalesce', ['get', prop], 0], 0]],
                layout: {
                    'icon-image': pinImageId(cat),
                    'icon-size': CLUSTER_ICON_SIZE,
                    'icon-offset': categoryRowOffset(cat),
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                },
            });
        });
    }

    // 4 — individual spots
    if (pinsAvailable) {
        const iconMatch = ['match', ['get', 'category']];
        PIN_CATEGORIES.forEach((cat) => iconMatch.push(cat, pinImageId(cat)));
        iconMatch.push(pinImageId('default'));

        map.addLayer({
            id: MARKERS_LAYER_ID,
            type: 'symbol',
            source: MARKERS_SOURCE_ID,
            filter: ['!', ['has', 'point_count']],
            layout: {
                'icon-image': iconMatch,
                'icon-anchor': 'bottom',           // the tip sits on the coordinate
                'icon-size': ['interpolate', ['linear'], ['zoom'], ...PIN_SIZE_STOPS.flat()],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                // Spot name under the tip. Labels may not overlap each other and
                // drop out (pin stays) when they would — same as the app.
                'text-field': ['get', 'label'],
                'text-font': fonts.regular,
                'text-size': 11,
                'text-anchor': 'top',
                'text-offset': [0, 0.3],
                'text-max-width': 10,
                'text-allow-overlap': false,
                'text-ignore-placement': false,
                'text-optional': true,
            },
            paint: {
                'text-color': '#FFFFFF',
                'text-halo-color': 'rgba(0,0,0,0.65)',
                'text-halo-width': 1.5,
            },
        });
    } else {
        // Fallback: the pre-v2 category circles.
        const colorMatch = ['match', ['get', 'category']];
        Object.entries(CATEGORY_COLORS).forEach(([cat, hex]) => colorMatch.push(cat, hex));
        colorMatch.push(DEFAULT_MARKER_COLOR);
        map.addLayer({
            id: MARKERS_LAYER_ID,
            type: 'circle',
            source: MARKERS_SOURCE_ID,
            filter: ['!', ['has', 'point_count']],
            paint: {
                'circle-color': colorMatch,
                'circle-radius': 12,
                'circle-stroke-width': 2.5,
                'circle-stroke-color': '#FFFFFF',
                'circle-opacity': 0.92,
            },
        });
    }

    map.on('click', CLUSTER_CIRCLE_LAYER_ID, handleClusterClick);
    map.on('click', MARKERS_LAYER_ID, handleMarkerClick);

    // Blank-map click closes whatever is open (the app's map tap clears the
    // co-located list the same way).
    map.on('click', (e) => {
        const hit = map.queryRenderedFeatures(e.point, { layers: [MARKERS_LAYER_ID, CLUSTER_CIRCLE_LAYER_ID] });
        if (!hit.length) closePopup();
    });

    [CLUSTER_CIRCLE_LAYER_ID, MARKERS_LAYER_ID].forEach((id) => {
        map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    });
}

/* ══════════════════════════════════════════════════════════════════════════
   Cluster-tap planner — a line-for-line port of the app's
   composeApp/.../ui/map/ClusterTapPlanner.kt (Issue #239), so a tap on the
   website lands where the same tap lands in the app.

   Rule: a tap zooms to the CLOSEST zoom where the cluster first splits
   (7 → 6 + 1), centred so every post-split item is inside the visible map.
   Members that no zoom can separate stop at street zoom and are listed.

   Coordinates are Web Mercator world units in 0..1; 1 unit = 512 × 2^zoom px
   (MapLibre GL JS defines zoom against a 512 px world — NOT the 256 px slippy
   convention; using 256 here is off by exactly one zoom level).
══════════════════════════════════════════════════════════════════════════ */

const MAX_MERCATOR_LAT = 85.05112878;

function mercX(lng) { return (lng + 180) / 360; }

function mercY(lat) {
    const s = Math.sin(Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)) * Math.PI / 180);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

function unproject(x, y) {
    const n = Math.PI - 2 * Math.PI * y;
    return [x * 360 - 180, Math.atan(Math.sinh(n)) * 180 / Math.PI];   // [lng, lat]
}

function toWorld(m) { return { x: mercX(m.lng), y: mercY(m.lat) }; }

function spanOf(pts) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach((p) => {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    });
    return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

/** Highest zoom at which the points plus item margins fit the visible rect (+∞ for one point). */
function fitZoom(pts, vp) {
    const { w, h } = spanOf(pts);
    const availW = vp.visW - 2 * ITEM_MARGINS.side;
    const availH = vp.visH - ITEM_MARGINS.above - ITEM_MARGINS.below;
    if (availW <= 0 || availH <= 0) return -Infinity;
    const zw = w === 0 ? Infinity : Math.log2(availW / (w * TILE_SIZE));
    const zh = h === 0 ? Infinity : Math.log2(availH / (h * TILE_SIZE));
    return Math.min(zw, zh);
}

/** Centre of the bbox, nudged down so bottom-anchored pins clear the top edge. */
function focusFor(pts, zoom) {
    const b = spanOf(pts);
    const scale = TILE_SIZE * Math.pow(2, zoom);
    return {
        x: (b.minX + b.maxX) / 2,
        y: (b.minY + b.maxY) / 2 + (ITEM_MARGINS.below - ITEM_MARGINS.above) / (2 * scale),
    };
}

/**
 * Where native clustering has ENDED (expansion zoom > CLUSTER_MAX_ZOOM) the
 * pins can still sit on each other. Two pins collide at zoom z while
 * |dx|·s < W and |dy|·s < H (s = 512·2^z); the group first splits at the
 * weakest edge of the maximum spanning tree. Returns { split, groups }.
 */
function singleLinkSplit(leaves, collW, collH) {
    const n = leaves.length;
    if (n < 2) return { split: Infinity, groups: [leaves.map((_, i) => i)] };
    const pts = leaves.map(toWorld);
    const edges = [];
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const dx = Math.abs(pts[i].x - pts[j].x) * TILE_SIZE;
            const dy = Math.abs(pts[i].y - pts[j].y) * TILE_SIZE;
            const zx = dx === 0 ? Infinity : Math.log2(collW / dx);
            const zy = dy === 0 ? Infinity : Math.log2(collH / dy);
            edges.push({ a: i, b: j, z: Math.min(zx, zy) });
        }
    }
    const parent = leaves.map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) x = parent[x]; return x; };
    const mst = [];
    edges.sort((p, q) => q.z - p.z).forEach((e) => {
        const ra = find(e.a), rb = find(e.b);
        if (ra !== rb) { parent[ra] = rb; mst.push(e); }
    });
    const split = Math.min(...mst.map((e) => e.z));
    if (split === Infinity) return { split, groups: [leaves.map((_, i) => i)] };
    for (let i = 0; i < n; i++) parent[i] = i;
    mst.forEach((e) => { if (e.z > split) parent[find(e.a)] = find(e.b); });
    const byRoot = new Map();
    for (let i = 0; i < n; i++) {
        const r = find(i);
        if (!byRoot.has(r)) byRoot.set(r, []);
        byRoot.get(r).push(i);
    }
    return { split, groups: [...byRoot.values()] };
}

function groupsToChildren(leaves, groups) {
    return groups.map((g) => ({
        id: g.length === 1 ? leaves[g[0]].id : null,
        lng: g.reduce((s, i) => s + leaves[i].lng, 0) / g.length,
        lat: g.reduce((s, i) => s + leaves[i].lat, 0) / g.length,
        count: g.length,
    }));
}

/** ClusterTapPlanner.plan(). Returns { kind, focus:{x,y}, zoom, ids? }. */
function planClusterTap({ leaves, children, splitZoom, currentZoom, vp }) {
    const leafPts = leaves.map(toWorld);

    // 1. Co-located: still overlapping at the cap, or never splits before it.
    const span = spanOf(leafPts);
    const leafSpanPxAtCap = Math.max(span.w, span.h) * TILE_SIZE * Math.pow(2, CLUSTER_TAP_MAX_ZOOM);
    const neverSplitsInRange = !(splitZoom + SPLIT_EPSILON <= CLUSTER_TAP_MAX_ZOOM);   // NaN / +∞ too
    if (leaves.length >= 2 && (leafSpanPxAtCap < CO_LOCATED_SPAN_PX || neverSplitsInRange)) {
        const z = Math.max(currentZoom, Math.min(CO_LOCATED_ZOOM, CLUSTER_TAP_MAX_ZOOM));   // never zoom out
        return { kind: 'coLocated', focus: focusFor(leafPts, z), zoom: z, ids: leaves.map((l) => l.id).filter(Boolean) };
    }

    // 2. Closest split zoom; never zoom out, always make progress.
    const target = Math.max(
        Math.min(Math.max(splitZoom + SPLIT_EPSILON, currentZoom + MIN_PROGRESS), CLUSTER_TAP_MAX_ZOOM),
        currentZoom
    );
    const childPts = (children.length ? children : leaves).map(toWorld);
    const fitLeaves = fitZoom(leafPts, vp);
    const fitChildren = fitZoom(childPts, vp);

    if (fitLeaves >= target)   return { kind: 'splitInView', focus: focusFor(leafPts, target), zoom: target };
    if (fitChildren >= target) return { kind: 'splitInView', focus: focusFor(childPts, target), zoom: target };
    if (fitChildren > currentZoom + MIN_PROGRESS) {
        const z = Math.min(fitChildren, CLUSTER_TAP_MAX_ZOOM);
        return { kind: 'fitLimited', focus: focusFor(childPts, z), zoom: z };
    }
    return { kind: 'splitInView', focus: focusFor(childPts, target), zoom: target };
}

/** The map container minus the strips covered by controls and the attribution. */
function visibleViewport() {
    const c = map.getContainer();
    const w = c.clientWidth, h = c.clientHeight;
    const i = VISIBLE_INSETS;
    const visW = Math.max(1, w - i.left - i.right);
    const visH = Math.max(1, h - i.top - i.bottom);
    return { w, h, visW, visH, cx: i.left + visW / 2, cy: i.top + visH / 2 };
}

/** ClusterTapPlanner.cameraTargetFor() with no native padding: puts focus at the visible-rect centre. */
function cameraCenterFor(focus, zoom, vp) {
    const scale = TILE_SIZE * Math.pow(2, zoom);
    return unproject(focus.x + (vp.w / 2 - vp.cx) / scale, focus.y + (vp.h / 2 - vp.cy) / scale);
}

/* ══════════════════════════════════════════════════════════════════════════
   Cluster interaction
══════════════════════════════════════════════════════════════════════════ */

let clusterTapSeq = 0;

function featureToMember(f) {
    const c = f && f.geometry && f.geometry.coordinates;
    if (!c) return null;
    const p = f.properties || {};
    return {
        id: p.spotId != null ? String(p.spotId) : null,
        lng: c[0],
        lat: c[1],
        count: p.point_count || 1,
    };
}

async function handleClusterClick(e) {
    const feature = (e.features && e.features[0]) ||
        map.queryRenderedFeatures(e.point, { layers: [CLUSTER_CIRCLE_LAYER_ID] })[0];
    if (!feature) return;

    const seq = ++clusterTapSeq;
    closePopup();

    const source = map.getSource(MARKERS_SOURCE_ID);
    const clusterId = feature.properties.cluster_id;
    const count = feature.properties.point_count || 1000;
    const centre = feature.geometry.coordinates.slice();
    const currentZoom = map.getZoom();

    try {
        // 1) every spot, 2) first-split zoom, 3) what is drawn right after the
        //    split — walking down while there is a single child cluster.
        const [leafFeatures, expansionZoom] = await Promise.all([
            compatCall(source, 'getClusterLeaves', clusterId, count, 0),
            compatCall(source, 'getClusterExpansionZoom', clusterId),
        ]);
        let children = await compatCall(source, 'getClusterChildren', clusterId);
        for (let guard = 0; children.length === 1 && children[0].properties && children[0].properties.cluster && guard < 24; guard++) {
            children = await compatCall(source, 'getClusterChildren', children[0].properties.cluster_id);
        }
        if (seq !== clusterTapSeq) return;   // a newer tap won

        const leaves = leafFeatures.map(featureToMember).filter(Boolean);
        if (!leaves.length) throw new Error('cluster has no leaves');
        let childMembers = children.map(featureToMember).filter(Boolean);
        let splitZoom = Number(expansionZoom);

        // 4) Past CLUSTER_MAX_ZOOM clustering simply ends; use the zoom where
        //    the pins themselves stop overlapping.
        if (splitZoom > CLUSTER_MAX_ZOOM && leaves.length >= 2) {
            const { split, groups } = singleLinkSplit(leaves, PIN_COLLISION_W_PX, PIN_COLLISION_H_PX);
            if (split > splitZoom) {
                splitZoom = split;
                childMembers = groupsToChildren(leaves, groups);
            }
        }

        const vp = visibleViewport();
        const plan = planClusterTap({ leaves, children: childMembers, splitZoom, currentZoom, vp });
        const duration = Math.max(300, Math.min(700, 300 + 60 * (plan.zoom - currentZoom)));
        map.easeTo({
            center: cameraCenterFor(plan.focus, plan.zoom, vp),
            zoom: plan.zoom,
            duration,
            padding: { top: 0, bottom: 0, left: 0, right: 0 },
        });

        if (window.QSPOT_MAP_DEBUG) {
            console.log('CLUSTER_TAP_PLAN', {
                leaves: leaves.length, children: childMembers.map((c) => c.count),
                current: currentZoom.toFixed(2), split: splitZoom.toFixed(2),
                kind: plan.kind, zoom: plan.zoom.toFixed(2),
            });
        }

        if (plan.kind === 'coLocated') {
            const ids = new Set(plan.ids);
            const spots = spotsData.filter((s) => ids.has(String(s.id)));
            if (spots.length > 1) {
                const lng = leaves.reduce((s, l) => s + l.lng, 0) / leaves.length;
                const lat = leaves.reduce((s, l) => s + l.lat, 0) / leaves.length;
                openCoLocatedList([lng, lat], spots, { kind: 'cluster', radius: clusterRadiusPx(leaves.length) });
            }
        }
    } catch (err) {
        console.warn('Cluster tap planning failed; zooming in on the cluster instead:', err);
        if (seq !== clusterTapSeq) return;
        map.easeTo({ center: centre, zoom: Math.min(currentZoom + 2, CLUSTER_TAP_MAX_ZOOM), duration: 500 });
    }
}

function clusterRadiusPx(n) { return n >= 50 ? 38 : n >= 10 ? 32 : 26; }

/* ══════════════════════════════════════════════════════════════════════════
   Individual marker interaction
══════════════════════════════════════════════════════════════════════════ */

function handleMarkerClick(e) {
    if (!e.features || !e.features.length) return;

    // Pins overlap freely (icon-allow-overlap, like the app), so e.features
    // can hold several spots under one click: list them rather than silently
    // opening whichever happened to be drawn on top.
    const seen = new Set();
    const spots = [];
    e.features.forEach((f) => {
        const id = String(f.properties.spotId);
        if (seen.has(id)) return;
        seen.add(id);
        const spot = spotById(id);
        if (spot) spots.push(spot);
    });
    if (!spots.length) return;

    const coords = e.features[0].geometry.coordinates.slice();
    if (spots.length > 1) {
        openCoLocatedList(coords, spots, { kind: 'pin' });
        return;
    }
    openSpotPopup(coords, spots[0], { kind: 'pin' });
}

/* ══════════════════════════════════════════════════════════════════════════
   Co-located list — the website's version of the app's
   "N spots at this location" results-sheet filter (owner decision, #239).
   Replaces the v1 spiderfy fan: a list scales to a 30-listing stadium, is
   keyboard- and screen-reader-friendly, and matches what app users see.
══════════════════════════════════════════════════════════════════════════ */

function openCoLocatedList(coords, spots, anchor) {
    closePopup();

    const root = document.createElement('div');
    root.className = 'spot-list';

    const title = document.createElement('h3');
    title.className = 'spot-list-title';
    title.textContent = qsPick(`${spots.length} spots at this location`, `${spots.length} spots à cet endroit`);
    root.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'spot-list-items';
    spots.forEach((spot) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'spot-list-item';

        const swatch = document.createElement('span');
        swatch.className = 'spot-list-swatch';
        swatch.style.background = categoryColor(spot.category);
        swatch.setAttribute('aria-hidden', 'true');
        btn.appendChild(swatch);

        const text = document.createElement('span');
        text.className = 'spot-list-text';
        const name = document.createElement('strong');
        name.textContent = spot.name || qsPick('Untitled spot', 'Spot sans titre');
        const meta = document.createElement('span');
        meta.className = 'spot-list-meta';
        meta.textContent = `${categoryLabel(spot.category)} · ${formatPrice(buyerTotalPrice(spot), spot.currency || 'CAD')}`;
        text.appendChild(name);
        text.appendChild(meta);
        btn.appendChild(text);

        btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            openSpotPopup(coords, spot, anchor, () => openCoLocatedList(coords, spots, anchor));
        });
        li.appendChild(btn);
        list.appendChild(li);
    });
    root.appendChild(list);

    showPopup(coords, root, anchor);
    const first = root.querySelector('.spot-list-item');
    if (first) first.focus({ preventScroll: true });
}

/* ══════════════════════════════════════════════════════════════════════════
   Popup
══════════════════════════════════════════════════════════════════════════ */

function closePopup() {
    if (activePopup) { activePopup.remove(); activePopup = null; }
}

/**
 * Offsets keyed by anchor so MapLibre can still pick whichever side fits,
 * while the tip lands on the edge of what was tapped: above a bottom-anchored
 * pin (whose height follows the zoom), or around a cluster bubble.
 */
function popupOffsetFor(anchor) {
    let above, below, side, mid;
    if (anchor && anchor.kind === 'cluster') {
        const r = (anchor.radius || 26) + 4;
        above = r; below = r; side = r; mid = 0;
    } else if (pinsAvailable) {
        const s = pinIconSizeAt(map.getZoom());
        const h = PIN_BASE_H_PX * s, w = PIN_BASE_W_PX * s;
        above = h + 4; below = 6; side = w / 2 + 4; mid = h / 2;
    } else {
        above = 18; below = 18; side = 18; mid = 0;
    }
    return {
        'top':          [0, below],
        'top-left':     [0, below],
        'top-right':    [0, below],
        'bottom':       [0, -above],
        'bottom-left':  [0, -above],
        'bottom-right': [0, -above],
        'left':         [side, -mid],
        'right':        [-side, -mid],
        'center':       [0, -mid],
    };
}

function showPopup(coords, content, anchor) {
    closePopup();
    activePopup = new maplibregl.Popup({
        offset: popupOffsetFor(anchor),
        maxWidth: '280px',
        closeButton: true,
        className: 'spot-popup-shell',
    })
        .setLngLat(coords)
        .setDOMContent(content)
        .addTo(map);
    return activePopup;
}

/**
 * @param onBack  set when the spot was opened from a co-located list; adds an
 *                "All N spots" link back to that list.
 */
function openSpotPopup(coords, spot, anchor, onBack) {
    const content = buildSpotPopup(spot);
    if (onBack) {
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'spot-popup-back';
        back.textContent = qsPick('‹ All spots here', '‹ Tous les spots ici');
        back.addEventListener('click', (ev) => { ev.stopPropagation(); onBack(); });
        content.insertBefore(back, content.firstChild);
    }
    showPopup(coords, content, anchor);
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

    root.appendChild(buildGallery(collectImages(spot), spot.name || qsPick('Spot', 'Spot')));

    const body = document.createElement('div');
    body.className = 'spot-popup-body';

    const title = document.createElement('h3');
    title.textContent = spot.name || qsPick('Untitled spot', 'Spot sans titre');
    body.appendChild(title);

    const cat = document.createElement('span');
    cat.className = 'spot-popup-category';
    cat.style.setProperty('--cat-color', categoryColor(spot.category));
    cat.textContent = categoryLabel(spot.category);
    body.appendChild(cat);

    const price = document.createElement('div');
    price.className = 'spot-popup-price';
    price.textContent = formatPrice(buyerTotalPrice(spot), spot.currency || 'CAD');
    if (Number(spot.buyer_fee_cents) > 0) {
        const feeNote = document.createElement('span');
        feeNote.className = 'spot-popup-price-note';
        feeNote.style.cssText = 'display:block;font-size:12px;font-weight:400;opacity:0.7;';
        feeNote.textContent = qsPick('Includes QSpot Processing Fee', 'Comprend les frais de traitement QSpot');
        price.appendChild(feeNote);
    }
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
        meta.textContent = qsPick(` seller rating (${reviews} review${reviews !== 1 ? 's' : ''})`, ` note du vendeur (${reviews} avis)`);
        seller.appendChild(meta);

        body.appendChild(seller);
    }

    const cta = document.createElement('a');
    cta.className = 'spot-popup-cta';
    cta.href = 'index.html#download';
    cta.textContent = qsPick('Get the app to book', 'Obtenez l\u2019application pour r\u00e9server');
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
        empty.textContent = qsPick('No photos yet', 'Aucune photo pour l\u2019instant');
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
    failed.textContent = qsPick('Photo unavailable', 'Photo non disponible');
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
            ? qsPick(`${spotName}, photo ${index + 1} of ${urls.length}`, `${spotName}, photo ${index + 1} sur ${urls.length}`)
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
        prev.setAttribute('aria-label', qsPick('Previous photo', 'Photo pr\u00e9c\u00e9dente'));
        prev.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
        prev.addEventListener('click', (e) => { e.stopPropagation(); show(index - 1); });

        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'spot-gallery-nav is-next';
        next.setAttribute('aria-label', qsPick('Next photo', 'Photo suivante'));
        next.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
        next.addEventListener('click', (e) => { e.stopPropagation(); show(index + 1); });

        frame.appendChild(prev);
        frame.appendChild(next);
        frame.appendChild(counter);

        urls.forEach((_, i) => {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'spot-gallery-dot';
            dot.setAttribute('aria-label', qsPick(`Photo ${i + 1}`, `Photo ${i + 1}`));
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
const FEE_COLUMNS   = 'buyer_fee_cents';

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

/**
 * Load the live spots and draw them.
 *
 * The first load frames the map around every spot. A Refresh keeps the camera
 * where the viewer left it (they may be zoomed in on one area) and shows its
 * progress on the Refresh button instead of covering the map — unless there
 * were no spots before, in which case framing the new ones is what they want.
 */
async function fetchSpots({ refresh = false } = {}) {
    if (spotsRequestInFlight || !map) return;
    spotsRequestInFlight = true;

    const hadSpots = spotsData.length > 0;
    setRefreshBusy(true);
    if (!refresh) showLoading(true);
    clearOverlays();
    closePopup();

    try {
        let data;
        // public_live_spots_buyer_fee.sql adds BOTH the owner and fee columns,
        // so try everything first. On a 400 (missing column) drop the fee
        // columns, then the owner columns, so that an unapplied migration only
        // costs features, never the whole map.
        if (buyerFeeAvailable) {
            try {
                data = await requestSpots(`${BASE_COLUMNS},${OWNER_COLUMNS},${FEE_COLUMNS}`);
                ownerRatingAvailable = true;
            } catch (e) {
                if (e.status !== 400) throw e;
                buyerFeeAvailable = false;
                console.warn(
                    'public_live_spots has no buyer_fee_cents column — showing pre-fee prices. ' +
                    'Apply supabase/public_live_spots_buyer_fee.sql to show all-in prices.'
                );
            }
        }
        if (data === undefined) try {
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
            // A refresh can empty a map that had pins — clear them, or the
            // "no spots" message would sit on top of stale markers.
            if (map.getSource(MARKERS_SOURCE_ID)) renderSpotsOnMap([]);
            showEmptyState();
        } else {
            renderSpotsOnMap(spotsData);
            if (!refresh || !hadSpots) fitMapToSpots(spotsData);
        }
        markRefreshed();
    } catch (error) {
        console.error('Failed to fetch spots:', error);
        showMapError(
            qsPick('Unable to load spots', 'Impossible de charger les spots'),
            qsPick('There was a problem connecting to the server. Please check your internet connection and try again.', 'Un problème est survenu lors de la connexion au serveur. Vérifiez votre connexion Internet et réessayez.')
        );
    } finally {
        spotsRequestInFlight = false;
        showLoading(false);
        setRefreshBusy(false);
    }
}

/** Spin and disable the Refresh button while a request is running. */
function setRefreshBusy(busy) {
    const btn = document.getElementById('map-refresh');
    if (!btn) return;
    btn.disabled = busy;
    btn.classList.toggle('is-loading', busy);
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
}

/** Record when the spots were last loaded, in the button's tooltip. */
function markRefreshed() {
    const btn = document.getElementById('map-refresh');
    if (!btn) return;
    const time = new Date().toLocaleTimeString(qsPick([], 'fr-CA'), { hour: 'numeric', minute: '2-digit' });
    btn.title = qsPick(`Refresh live spots (last updated ${time})`, `Actualiser les spots en direct (derni\u00e8re mise \u00e0 jour\u00a0: ${time})`);
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
        el.textContent = qsPick(`${count} live spot${count !== 1 ? 's' : ''}`, `${count} spot${count > 1 ? 's' : ''} en direct`);
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
    title.textContent = qsPick('No Spots Yet', 'Aucun spot pour l\u2019instant');

    const body = document.createElement('p');
    body.textContent = qsPick('There are no live spots available right now. Download the app to be the first to create one!', 'Il n\u2019y a aucun spot en direct pour le moment. T\u00e9l\u00e9chargez l\u2019application pour \u00eatre le premier \u00e0 en cr\u00e9er un\u00a0!');

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
        retryBtn.textContent = qsPick('Try Again', 'R\u00e9essayer');
        retryBtn.addEventListener('click', () => {
            clearOverlays();
            fetchSpots({ refresh: spotsData.length > 0 });
        });
        overlay.appendChild(retryBtn);
    }

    container.appendChild(overlay);
}
