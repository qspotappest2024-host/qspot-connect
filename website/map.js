/**
 * QSpot Website — Map Page Logic
 * Fetches live spots from Supabase and renders them on a MapLibre GL map
 */

let map;
let spotsData = [];
let markers = [];

document.addEventListener('DOMContentLoaded', () => {
    initMap();
});

/* --- Initialize MapLibre GL map --- */
function initMap() {
    const apiKey = QSPOT_CONFIG.MAPTILER_API_KEY;

    if (!apiKey || apiKey === 'YOUR_MAPTILER_API_KEY_HERE') {
        showMapError(
            'MapTiler API key not configured',
            'Open <code>js/config.js</code> and add your free MapTiler API key. Get one at <a href="https://cloud.maptiler.com/" target="_blank" rel="noopener">cloud.maptiler.com</a>.'
        );
        return;
    }

    try {
        map = new maplibregl.Map({
            container: 'map',
            style: `https://api.maptiler.com/maps/${QSPOT_CONFIG.MAP_STYLE}/style.json?key=${apiKey}`,
            center: QSPOT_CONFIG.MAP_DEFAULT_CENTER,
            zoom: QSPOT_CONFIG.MAP_DEFAULT_ZOOM,
            attributionControl: true,
        });
    } catch (e) {
        showMapError('Map failed to initialize', 'Check your MapTiler API key and try refreshing the page.');
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
        fetchSpots();
    });

    map.on('error', (e) => {
        console.error('Map error:', e);
        // If the style fails to load (e.g. invalid/domain-restricted MapTiler key),
        // MapLibre fires 'error' but NOT 'load', so fetchSpots() is never called
        // and the loading overlay stays stuck forever. Handle it explicitly here.
        if (e.error && (e.error.status === 401 || e.error.status === 403)) {
            showMapError(
                'Map tiles unavailable',
                'The map API key is not authorized for this domain. Please check the MapTiler key allowed origins in your dashboard.'
            );
        }
    });

    // Safety net: if the map style never loads within 10 seconds, show an error
    // instead of leaving the user staring at a blank screen with a spinner.
    const loadTimeout = setTimeout(() => {
        if (!map.isStyleLoaded()) {
            showMapError(
                'Map failed to load',
                'The map timed out loading. Please check your MapTiler API key configuration and try refreshing.'
            );
        }
    }, 10000);
}

/* --- Fetch spots from Supabase --- */
async function fetchSpots() {
    showLoading(true);
    clearOverlays();

    try {
        const url = `${QSPOT_CONFIG.SUPABASE_URL}/rest/v1/spots?status=eq.ACTIVE&available_spots=gt.0&select=id,name,description,category,price,currency,latitude,longitude,image_url,images,rating,review_count`;

        const response = await fetch(url, {
            headers: {
                'apikey': QSPOT_CONFIG.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${QSPOT_CONFIG.SUPABASE_ANON_KEY}`,
                'Accept': 'application/json',
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
            renderSpotMarkers(spotsData);
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

/* --- Shared popup instance reused across all markers --- */
// Using a single shared popup (rather than setPopup() per marker) avoids a
// MapLibre GL JS v4 bug where setPopup() triggers marker._update() during the
// popup's DOM insertion, reads offsetWidth/offsetHeight as 0 mid-reflow, and
// snaps the marker to the top-left corner of the map container.
let activePopup = null;

/* --- Render markers on the map --- */
function renderSpotMarkers(spots) {
    // Clear existing markers
    markers.forEach(m => m.remove());
    markers = [];
    if (activePopup) { activePopup.remove(); activePopup = null; }

    spots.forEach(spot => {
        if (!spot.latitude || !spot.longitude) return;

        // Validate coordinates are in valid range
        if (Math.abs(spot.latitude) > 90 || Math.abs(spot.longitude) > 180) return;

        // Create custom marker element — styles are in .spot-marker CSS class
        const el = document.createElement('div');
        el.className = 'spot-marker';
        // Inline dimensions ensure MapLibre can read offsetWidth/offsetHeight
        // immediately, before CSS class styles are computed after first paint.
        el.style.width = '32px';
        el.style.height = '32px';
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', `Spot: ${spot.name || 'Unnamed'}`);
        el.setAttribute('tabindex', '0');

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([spot.longitude, spot.latitude])
            .addTo(map);

        // Open popup manually on click — do NOT use .setPopup() which internally
        // calls marker._update() and causes the marker to jump to (0,0).
        const openPopup = () => {
            if (activePopup) activePopup.remove();
            activePopup = new maplibregl.Popup({
                offset: [0, -20],
                maxWidth: '300px',
                closeButton: true,
                anchor: 'bottom',
            })
                .setLngLat([spot.longitude, spot.latitude])
                .setHTML(buildPopupHTML(spot))
                .addTo(map);
        };

        el.addEventListener('click', (e) => {
            e.stopPropagation();
            openPopup();
        });

        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openPopup();
            }
        });

        markers.push(marker);
    });
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
    const rating = spot.rating ? Number(spot.rating).toFixed(1) : '0.0';
    const reviews = spot.review_count || 0;
    const price = formatPrice(spot.price, spot.currency || 'USD');

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
            zoom: 14,
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
