# Offline / PWA Specification

## Purpose

Defines the offline and Progressive Web App (PWA) behavior of the Athlos operator dashboard. Covers the offline data strategy, network-failure user experience, PWA installability, service worker caching policy, version-update strategy, performance budget, and mobile-specific considerations (touch, viewport, safe areas).

The spec is explicitly **conservative for v1**: Athlos is a **read-only** coexistence system during Phase 1 (Athlos reads everything; legacy is the sole writer). Given that constraint, full offline support is a low priority, but the application MUST still behave predictably when the network drops, MUST be installable on operator devices (a stated product goal in the README — "local-first, SaaS-ready"), and MUST hit a performance budget suitable for daily use on club-office hardware.

The full read-only offline experience (cached projections, queued reads) is **deferred to Phase 2** and documented as a future requirement, not a v1 one.

---

## Scope

| Phase | Offline Mode | PWA Install | Service Worker | Caching |
|-------|-------------|-------------|----------------|---------|
| v1 (this spec) | NOT supported — always online | YES | YES (app shell only) | Static assets only |
| Phase 2 (future) | Read-only offline (cached projections) | YES | YES | App shell + GET API responses (stale-while-revalidate) |
| Phase 3+ (BAJA, Gap #16) | TBD | TBD | TBD | TBD |

The rationale for the v1 scope split:

1. **Athlos is read-only in v1.** There are no user actions to queue or replay offline. The only failure mode worth handling is "the network is down, the user opened a screen" — and that is handled by a clean error state, not by serving stale data.
2. **The data is cooperative, not personal.** Operators do not need to "keep working" when offline because every relevant fact lives in legacy, which is the system of record. A network drop means legacy is unreachable too, so any cached Athlos view would mislead the operator.
3. **PWA installability is still valuable.** Install-to-home-screen, app-shell rendering, and fast cold starts are independent of whether GET responses are cached. Operators on desktop or mobile benefit from "looks and feels like an app" without us committing to offline data correctness.

---

## Requirements

### Requirement: v1 Offline Strategy — Always Online

The system MUST treat Phase 1 as an **always-online** application. The system MUST NOT ship a read-cache, response cache, or any mechanism that would let a screen render successfully when the API is unreachable.

The system MUST surface every network failure to the operator as a visible error state. Silent fallback to stale data SHALL NOT occur.

#### Scenario: User opens a screen with no network

- GIVEN the operator opens a dashboard, list, or detail screen
- AND the API is unreachable (offline, DNS failure, server down, CORS block)
- WHEN the request fails
- THEN the system MUST display a full-page error state with: a human-readable message, a "Retry" button, and the request_id for support escalation
- AND it MUST NOT show a partially-rendered screen with cached data

#### Scenario: No background sync or queueing

- GIVEN the operator triggers any action (search, filter, pagination, export, manual job trigger)
- AND the network is down
- WHEN the request fails
- THEN the system MUST report the failure immediately
- AND it MUST NOT enqueue the request for later replay (v1 has no write actions to queue, and queueing reads would mislead)

#### Scenario: Future read-only offline is a Phase 2 capability

- GIVEN Phase 2 planning begins
- WHEN the read-only offline mode is designed
- THEN it SHALL cover: cached projections per domain, stale-while-revalidate for `GET` endpoints, a banner indicating "Offline — showing data from {timestamp}", and a clear rule that **writes remain disabled offline** (legacy is still the system of record until cutover)
- AND the v1 service worker architecture MUST be designed so that adding an API response cache in Phase 2 is a configuration change, not a rewrite

### Requirement: Network Failure UX

When any HTTP request fails because the network is unavailable, the system MUST present a clear, recoverable error state. Optimistic UI is NOT used in v1 (no writes to roll back).

The error state MUST distinguish between **network failure** (no response at all) and **server error** (response received, status ≥ 500), because the operator's mental model and the recovery action differ.

#### Scenario: Network failure on initial page load

- GIVEN the operator navigates to a route that requires API data
- AND the fetch fails with a network error (`TypeError: Failed to fetch` or `net::ERR_*`)
- WHEN the error is caught
- THEN the system MUST render a full-page error component with:
  - Title: "Sin conexión" / "No connection" (per UI design language)
  - Body: "No pudimos contactar al servidor. Revisá tu conexión a internet."
  - Primary action: "Reintentar" button that re-runs the failed request
  - Secondary action: link to `request_id` details for support
- AND the header and sidebar MUST still render (the app shell is cached, only the data failed)

#### Scenario: Network failure on background action

- GIVEN the operator is viewing a screen with data already loaded
- AND triggers a background action (filter change, pagination, manual job run, export)
- WHEN the request fails with a network error
- THEN the system MUST show a non-blocking toast notification:
  - Severity: error
  - Message: "No se pudo completar la acción. Revisá tu conexión."
  - Action: "Reintentar" button on the toast that re-runs the failed request
- AND the existing data on screen MUST remain visible (not cleared)

#### Scenario: Server error (5xx) on a read

- GIVEN a request returns HTTP 5xx
- WHEN the response is received
- THEN the system MUST show a toast: "Error del servidor. Nuestro equipo ya fue notificado." with a "Reintentar" action
- AND the system MUST include the `request_id` in the toast for traceability (per `logging` spec)

#### Scenario: Retry succeeds

- GIVEN the operator clicks "Reintentar" on a network-failure error
- AND the network is now available
- WHEN the request succeeds
- THEN the error state MUST be dismissed
- AND the screen MUST render with the fresh data

#### Scenario: Retry fails again

- GIVEN the operator clicks "Reintentar" while the network is still down
- WHEN the retry fails
- THEN the error state MUST be re-displayed
- AND a small counter MAY show "Intento N — reintentá en unos segundos" to discourage rapid-fire retries

### Requirement: PWA Installability — v1

The system MUST be installable as a Progressive Web App on modern browsers and operating systems. Installability gives operators a "native-feel" home screen entry point and is independent of offline support.

The application MUST ship:

1. A `manifest.webmanifest` file at the site root with required PWA fields
2. A registered service worker
3. An HTTPS-served origin (required by the install prompt)
4. At least one icon of size 192px and one of 512px (PNG, with purpose `any` and `maskable`)

#### Scenario: Manifest is served and valid

- GIVEN the operator visits the dashboard URL over HTTPS
- WHEN the browser parses `<link rel="manifest" href="/manifest.webmanifest">`
- THEN the manifest MUST contain: `name`, `short_name`, `start_url`, `display: standalone`, `background_color`, `theme_color`, `icons` (192 and 512)
- AND `start_url` MUST be `/` (the dashboard root)
- AND `display: standalone` MUST hide the browser chrome when launched from the home screen

#### Scenario: App is installable in Chrome / Edge

- GIVEN a Chromium-based browser on desktop or Android
- WHEN the page is loaded over HTTPS with a valid manifest and active service worker
- THEN the browser MUST fire the `beforeinstallprompt` event
- AND the operator MUST be able to install the app via the browser's install UI or the in-app install button (see Install Prompt)

#### Scenario: iOS Safari install path

- GIVEN an iOS device
- WHEN the operator wants to install
- THEN they MUST use the iOS Share sheet → "Add to Home Screen" (iOS does not support `beforeinstallprompt`)
- AND the in-app install helper MUST show iOS-specific instructions (see Install Prompt)

### Requirement: Service Worker — App Shell Only

The system MUST register a service worker in v1. The service worker's responsibility is **strictly limited to caching the app shell** (HTML, CSS, JS bundles, fonts, icons). It MUST NOT cache API responses in v1.

The reason: caching GET responses without a staleness strategy would mislead operators viewing "fresh" data that is actually hours old. Phase 2 will introduce a deliberate stale-while-revalidate policy for projections.

#### Scenario: Service worker registers on first visit

- GIVEN the operator visits the dashboard for the first time
- WHEN the page loads
- THEN the service worker MUST register at `/sw.js` via `navigator.serviceWorker.register()`
- AND registration MUST NOT block first paint (deferred until after `load`)

#### Scenario: App shell is precached

- GIVEN the service worker activates
- WHEN the `install` event fires
- THEN the worker MUST precache the app shell: HTML entry, JS bundles, CSS, fonts, icons, manifest
- AND the precache list SHALL be versioned (see Version Management)

#### Scenario: API responses are never cached in v1

- GIVEN any `fetch` event for a URL matching `/api/`
- WHEN the service worker intercepts the request
- THEN it MUST pass the request through to the network with no caching
- AND it MUST NOT add the response to the cache

#### Scenario: Static assets served cache-first

- GIVEN a `fetch` event for a URL NOT matching `/api/` (e.g., `/assets/index-abc123.js`, `/fonts/...`, `/icons/...`)
- WHEN the service worker intercepts the request
- THEN it MUST serve from cache if present
- AND on cache miss, it MUST fetch from network and cache the response for next time

#### Scenario: Cross-origin requests

- GIVEN a `fetch` event for a cross-origin URL (e.g., a font CDN)
- WHEN the service worker handles it
- THEN it MUST follow an opaque-response strategy: cache the opaque response on success, fall back to network on failure
- AND it MUST NOT block app boot on a slow cross-origin fetch

### Requirement: Service Worker Version Management

The service worker MUST use explicit versioned cache names so that a new deployment invalidates the old cache atomically. The v1 strategy is **cache busting by build hash** for app assets, plus a single `caches.delete()` on activation for shell assets.

#### Scenario: New deployment invalidates old cache

- GIVEN a new build is deployed with cache name `athlos-shell-v2` and asset names `index-{newhash}.js`
- WHEN the new service worker activates
- THEN the `activate` event MUST call `caches.delete('athlos-shell-v1')` for any cache name not in the current allowlist
- AND the old `index-{oldhash}.js` references MUST be gone (the HTML references the new hashed name)

#### Scenario: Old service worker does not serve stale HTML

- GIVEN the operator has v1 of the app open in one tab and v2 is deployed
- WHEN the v1 tab navigates
- THEN the browser MUST detect the byte-level change to `sw.js` and install v2 in the background
- AND on next navigation, the v2 worker MUST take over (the `clients.claim()` strategy is acceptable for v1)

#### Scenario: Cache name format

- GIVEN the build process emits a new service worker
- WHEN it is written to disk
- THEN its `CACHE_NAME` constant MUST be `athlos-shell-{semver-or-hash}` (e.g., `athlos-shell-v1.2.0`)
- AND the change in this name is what triggers cache invalidation, not a separate "version" file

### Requirement: PWA Manifest and Icons

The system MUST ship a complete PWA manifest with high-quality icons so the installed app looks intentional on every platform.

#### Scenario: Required manifest fields

- GIVEN the manifest at `/manifest.webmanifest`
- WHEN parsed
- THEN the following fields MUST be present and valid:

| Field | Value |
|-------|-------|
| `name` | `Athlos` |
| `short_name` | `Athlos` |
| `start_url` | `/` |
| `scope` | `/` |
| `display` | `standalone` |
| `background_color` | `#f8fafc` (matches UI design off-white) |
| `theme_color` | `#1e3a5f` (matches UI design deep navy) |
| `lang` | `es-AR` |
| `dir` | `ltr` |
| `icons` | 192x192, 512x512, plus 512x512 maskable |

#### Scenario: Maskable icon set

- GIVEN an Android device installs the app
- WHEN the launcher renders the icon
- THEN the manifest MUST include a 512x512 icon with `purpose: "maskable"`
- AND the safe zone (center 80%) MUST contain the Athlos logo on a solid background, so the OS mask does not crop the brand

#### Scenario: Apple touch icon for iOS

- GIVEN an iOS device bookmarks or installs the app
- WHEN iOS looks for the home screen icon
- THEN `<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">` MUST be present
- AND the icon MUST be 180x180 PNG with no transparency (iOS adds rounded corners and a gloss by default unless the icon is opaque)

### Requirement: Install Prompt UX

The system SHOULD surface an in-app install affordance so operators on desktop or Android can install without hunting through browser menus. iOS does not support `beforeinstallprompt` and MUST be handled with a separate instructions path.

The in-app prompt MUST be **dismissible** (operator choice respected) and MUST NOT appear more than once per 30 days after dismissal (to avoid nagging).

#### Scenario: Chrome / Edge install button

- GIVEN the operator is on a Chromium browser
- AND the `beforeinstallprompt` event has fired
- WHEN the operator visits any screen and has not previously dismissed the prompt
- THEN the system SHOULD show a non-blocking banner at the bottom of the screen:
  - Text: "Instalá Athlos para acceso rápido desde tu escritorio"
  - Primary action: "Instalar" → calls `prompt.prompt()` and awaits the result
  - Secondary action: "Ahora no" → dismisses the banner
- AND on install success, the banner MUST be removed and a toast MUST confirm: "Athlos instalada"

#### Scenario: iOS install instructions

- GIVEN the operator is on iOS Safari
- AND the `beforeinstallprompt` event has NOT fired (iOS does not support it)
- WHEN the operator taps an "Instalar en iPhone" link in the app menu or footer
- THEN the system MUST show a modal with step-by-step instructions:
  1. Tocá el botón Compartir (icono de cuadro con flecha hacia arriba)
  2. Elegí "Añadir a pantalla de inicio"
  3. Confirmá tocando "Añadir"
- AND the modal MUST include a screenshot or animated GIF showing the iOS Share sheet (optional but recommended)

#### Scenario: Install already running as PWA

- GIVEN the app is already running in `standalone` display mode
- WHEN the operator visits the install banner location
- THEN the banner MUST NOT render
- AND the system MAY show a "Running as installed app" indicator instead

#### Scenario: Dismissal cooldown

- GIVEN the operator clicked "Ahora no" on the install banner
- WHEN 30 days have not elapsed
- THEN the banner MUST NOT reappear
- AND the dismissal timestamp SHALL be stored in `localStorage` under `athlos.pwa.install.dismissed_at`

### Requirement: Update Notification

The system MUST inform the operator when a new version of the app is deployed. The notification MUST be non-blocking and MUST allow the operator to defer the update (no surprise reloads mid-action).

The system uses a "soft prompt + manual reload" model in v1, not a "force refresh on critical" model. A force-refresh escape hatch SHALL be available for emergency security updates.

#### Scenario: New version detected

- GIVEN a new service worker has been installed and is waiting to activate
- WHEN the `controllerchange` event fires (or a `postMessage` from the new worker reports `VERSION`)
- THEN the system MUST show a non-blocking toast at the top of the screen:
  - Text: "Hay una nueva versión disponible"
  - Primary action: "Actualizar ahora" → calls `skipWaiting()` via `postMessage` and reloads the page
  - Secondary action: "Más tarde" → dismisses the toast; the new version takes over on next reload

#### Scenario: Operator defers update

- GIVEN the operator clicks "Más tarde" on the update toast
- WHEN they continue using the current version
- THEN the new service worker MUST be activated in the background
- AND on the next hard reload (F5 / pull-to-refresh), the operator MUST be on the new version
- AND no second update toast MUST appear in the same session (avoid noise)

#### Scenario: Emergency security update

- GIVEN the deployment pipeline tags a release as `security: critical` (via build-time flag in the manifest or a `/api/v1/version` endpoint value)
- WHEN the operator has the previous version loaded
- THEN the update toast MUST be shown with a `Cerrar` action disabled
- AND the primary action MUST be "Actualizar ahora — recomendado por seguridad"
- AND the new worker SHALL activate via `skipWaiting()` and reload the page on operator click

#### Scenario: Version check endpoint

- GIVEN the operator loads the app
- WHEN the app boots
- THEN it SHOULD call `GET /api/v1/version` to learn the current server-deployed version string (per `api-design` spec — public, no auth)
- AND the client MAY compare that against its build-time `__APP_VERSION__` constant
- AND a mismatch (e.g., server was rolled back to an older version) SHALL NOT trigger the update toast (downgrades are operator-driven, not auto-prompted)

### Requirement: Performance Budget

The system MUST meet a measurable performance budget on a reference mid-range device. The reference device is a 2020-class Android (Moto G Power equivalent) on a 4G connection in a 1.5 Mbps / 150 ms RTT profile. The budget is enforced by Lighthouse CI in the deployment pipeline (per `deployment-devops` spec).

| Metric | Target (v1) | Hard Limit |
|--------|-------------|------------|
| First Contentful Paint (FCP) | < 1.2 s | 1.8 s |
| Largest Contentful Paint (LCP) | < 2.0 s | 2.5 s |
| Time to Interactive (TTI) | < 2.5 s | 4.0 s |
| Total Blocking Time (TBT) | < 150 ms | 300 ms |
| Cumulative Layout Shift (CLS) | < 0.05 | 0.1 |
| Speed Index | < 2.5 s | 3.5 s |
| Initial JS bundle (gzipped) | < 200 KB | 300 KB |
| Initial CSS bundle (gzipped) | < 30 KB | 50 KB |
| Total app shell size (precached, gzipped) | < 600 KB | 1 MB |
| Lighthouse Performance score | ≥ 90 | ≥ 80 |
| Lighthouse PWA score | 100 (installable + SW + manifest) | ≥ 90 |
| Lighthouse Accessibility score | ≥ 95 | ≥ 90 |
| Lighthouse Best Practices score | ≥ 95 | ≥ 90 |

#### Scenario: Build fails the budget

- GIVEN a pull request introduces a change
- WHEN Lighthouse CI runs against a preview deployment
- AND any metric exceeds its hard limit
- THEN the CI check MUST fail
- AND the PR MUST be blocked from merging

#### Scenario: Bundle size guard

- GIVEN a pull request changes the JS or CSS output
- WHEN the bundle-size guard runs
- AND the gzipped JS bundle exceeds 300 KB OR the CSS bundle exceeds 50 KB
- THEN the check MUST fail with a clear message: "Bundle size limit exceeded. Consider code splitting or removing dependencies."

#### Scenario: Performance regression detected post-merge

- GIVEN the main branch has been deployed
- WHEN a synthetic Lighthouse run is performed on production (daily, per `monitoring-observability` spec)
- AND the score drops below the hard limit
- THEN an alert MUST be emitted (per the `notifications` spec) to the engineering channel
- AND the alert MUST include the URL, the failing metric, and the previous value

### Requirement: Mobile Touch and Viewport

The system MUST be usable on mobile devices (phone and tablet) for read-only review. The PWA is primarily a desktop tool, but operators on call MUST be able to pull up a socio record, a current account, or a freshness status from their phone.

#### Scenario: Viewport meta tag

- GIVEN any HTML page in the app
- WHEN parsed
- THEN `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` MUST be present
- AND `viewport-fit=cover` MUST be set so iOS safe-area insets work (see Safe Areas)

#### Scenario: Touch targets

- GIVEN the operator interacts with the UI on a touch device
- WHEN they tap a button, link, or interactive control
- THEN the touch target MUST be at least 44x44 CSS pixels (Apple HIG) / 48x48 dp (Material)
- AND interactive controls MUST have at least 8px of touch-safe padding around them
- AND tap targets MUST NOT overlap

#### Scenario: Touch gestures do not trigger browser defaults

- GIVEN the operator uses a pull-to-refresh, swipe-back, or two-finger zoom on the app
- WHEN the gesture occurs
- THEN pull-to-refresh MUST be disabled on the document body (it conflicts with in-app refresh and scroll)
- AND horizontal swipe-back MAY be allowed but MUST NOT interfere with horizontal data tables
- AND pinch-to-zoom on form inputs MUST work; pinch-to-zoom on the rest of the app MAY be disabled to prevent layout breakage

#### Scenario: Mobile keyboard does not break layout

- GIVEN the operator focuses a text input on a mobile device
- WHEN the virtual keyboard opens
- THEN the focused input MUST scroll into view (no input hidden by keyboard)
- AND the layout MUST NOT jump horizontally (no width reflow)

### Requirement: Safe Area Insets

The system MUST respect iOS safe areas (notch, Dynamic Island, home indicator) and Android display cutouts when the PWA is running in `standalone` mode (installed app).

#### Scenario: Header respects top inset

- GIVEN the PWA is running in standalone mode on an iPhone with a notch
- WHEN the dashboard renders
- THEN the header MUST have top padding equal to `env(safe-area-inset-top)` (typically 47px on notched iPhones)
- AND the sidebar / main content MUST NOT be hidden under the notch

#### Scenario: Bottom controls respect home indicator

- GIVEN a sticky footer or floating action button is rendered
- WHEN the page scrolls
- THEN the bottom edge MUST have padding equal to `env(safe-area-inset-bottom)` (typically 34px on Face ID iPhones)
- AND the home indicator MUST NOT overlap any interactive control

#### Scenario: CSS custom properties for insets

- GIVEN the design system defines layout primitives
- WHEN the app shell is styled
- THEN the following custom properties MUST be defined and used:
  - `--safe-area-top: env(safe-area-inset-top)`
  - `--safe-area-bottom: env(safe-area-inset-bottom)`
  - `--safe-area-left: env(safe-area-inset-left)`
  - `--safe-area-right: env(safe-area-inset-right)`
- AND header / footer components MUST reference these variables (not hardcoded 0)

### Requirement: Offline Indicator (Network Status)

The system SHOULD show a subtle online/offline indicator so the operator knows whether the data they are looking at is live or possibly stale (in the future Phase 2 sense). In v1, the indicator is informational only — there is no cached data to be stale.

#### Scenario: Browser goes offline

- GIVEN the operator is using the app with a healthy connection
- WHEN the browser fires the `offline` event
- THEN the system MUST show a non-blocking banner at the top: "Sin conexión — los datos no se actualizarán"
- AND the banner MUST use the warning color from the UI design palette (amber)

#### Scenario: Browser comes back online

- GIVEN the offline banner is visible
- WHEN the browser fires the `online` event
- THEN the system MUST dismiss the banner within 1 second
- AND the system SHOULD automatically retry the last failed in-flight request (best-effort)
- AND a toast MUST confirm: "Conexión restaurada"

#### Scenario: Initial load while offline

- GIVEN the operator opens the app for the first time on a device that is offline
- AND the app shell is NOT cached (or has been evicted)
- WHEN the page loads
- THEN the browser shows its default offline dinosaur / error page
- AND the system MUST NOT have a custom fallback for this case in v1 (the app shell will be cached on second visit; first-visit offline is accepted as out of scope)

---

## Success Criteria

- A network failure on any screen produces a clear, recoverable error state — never silent fallback, never a half-rendered screen
- The application is installable on Chrome / Edge / Android with the `beforeinstallprompt` flow, and on iOS Safari via the "Add to Home Screen" path with documented instructions
- The service worker caches only the app shell; no API response is cached in v1
- A new deployment invalidates the old service worker cache atomically (no mixed-version bugs)
- The operator sees a non-blocking update toast when a new version is available, with "Actualizar ahora" / "Más tarde" choices
- Lighthouse Performance ≥ 90, PWA = 100, Accessibility ≥ 95 on the production dashboard
- Initial JS bundle is under 200 KB gzipped; CI fails any PR that pushes it past 300 KB
- Touch targets meet 44x44 / 48x48 minimums on mobile, and the viewport meta + safe-area insets are correct on iOS notched devices
- The offline indicator banner appears on `offline` event and disappears on `online` event
- The Phase 2 read-only offline capability is **not** delivered in v1 but the architecture leaves room to add it (service worker strategy is configurable, not baked in)

---

## Out of Scope (v1)

The following are explicitly **not** part of v1 and are tracked under the gaps analysis:

- Offline data access (cached projections) — **Phase 2**
- Offline writes / sync queue — **N/A in Phase 1 (no writes); revisit post-cutover**
- Push notifications (web push API) — covered by the `notifications` spec for server-pushed channels; web push is a separate v2 concern
- Background sync (Background Sync API) — not needed without queued actions
- Periodic background sync — not needed without queued actions
- App store distribution (Play Store, App Store via TWA / Capacitor) — not in v1 roadmap
