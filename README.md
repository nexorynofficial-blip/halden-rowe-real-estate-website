# Brokerage demo site

A static, re-skinnable real estate brokerage site built with Astro 7 and Tailwind CSS v4.
The sample brand is **Halden Rowe**, a fictional Santa Barbara brokerage. The specs are
kept in private project documents.

**Design note:** the look uses the client's palette (Spring Wood `#F9F6EE` background, White cards,
Platinum `#EAE3E0` bands, Dark Gunmetal `#142334` text and dark panels, Rodeo Dust `#C9AD98` accent),
Bricolage Grotesque for headings and Instrument Sans for body text, with large rounded corners
(`--radius-panel: 28px`) and the "folder sheet" home layout. Motion borrows from the client's
reference videos: headings rising line by line, photos settling as you scroll, count-up figures,
and the floor plan playing in place. It replaces the travertine/brass/Fraunces palette in
`Design-Stack.md` at the client's request. Light accents like Rodeo Dust automatically get dark
button text; `src/lib/theme.ts` picks whichever passes contrast. The theme engine also supports
dark-page brands, and `.scope-dark` renders any section as a dark panel inside a light page.

## Run it

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # static output in dist/
npm run preview    # serve dist/ locally
```

The first build encodes every photo to AVIF, WebP and JPG at several widths, so it takes
a few minutes. Later builds reuse the cache in `node_modules/.astro`.

Deploy `dist/` to Vercel or Netlify as a static site. Nothing runs on a server.

### Deploy to Vercel

Live demo: **https://halden-rowe-demo.vercel.app** (Vercel project `halden-rowe-demo`, team `nexoryn`).

```bash
npx vercel login                                  # once per computer
npm run deploy -- halden-rowe-demo                # rebuild and publish the main demo
BRAND=calder-sloane npm run deploy -- calder-sloane-demo   # a re-skinned prospect, on its own address
```

The command builds the site for its own address (so canonical links, link previews and the sitemap
are right), adds `vercel.json` (security headers, long-term caching, no-index for `/compare/`), and
publishes to production. The project name becomes the address: `https://<name>.vercel.app`. To use a
custom domain, add it in the Vercel project's Domains settings, then deploy with
`SITE_URL=https://your-domain.com npm run deploy -- <name>`.

## Re-skin for a prospect

Everything a prospect sees comes from `src/data/`. Layout code doesn't change.

| File | What it controls |
| --- | --- |
| `brands/<id>.json` | Name, monogram/logo, tagline, six palette colors, fonts, hero copy and hero image, contact details, booking and lead settings |
| `listings.json` | Listings (TRD data model plus `summary`, `features`, `yearBuilt` and so on) |
| `agents.json` | Agents, their hours (these drive the booking slots) and the Cal.com link |
| `neighborhoods.json` | Area medians and guides |
| `content.json` | Homepage stats, testimonials, About copy, contact paths. `{{brokerageName}}`, `{{founded}}` and `{{market}}` are filled in automatically |

Photos go in `src/assets/photos/` (listings) and `src/assets/agents/`, and data files refer
to them by filename. Astro resizes and converts them at build time. Originals are never shipped.

**To switch brands:** copy `src/data/brands/halden-rowe.json`, edit it, then build with
`BRAND=<file-name> npm run build`. A second brand (`calder-sloane`) is included to show the
whole site re-theming from one file:

```bash
BRAND=calder-sloane npm run dev
```

**Colors are contrast-checked on every build.** `src/lib/theme.ts` derives the text-bearing
shades (accent links, button fills, muted text, text on dark sections) from the six brand
colors, nudging each one until it passes WCAG AA, and prints a report:

```
[theme] Halden Rowe: contrast check
  pass  13.30:1  ink on base
  pass   4.75:1  accent text on base
  pass   4.73:1  surface on accent button
  ...
```

A new palette therefore can't quietly break contrast. At worst the accent comes out slightly
deeper than the raw hex.

**Fonts:** Fraunces and Public Sans are self-hosted from `public/fonts/`, subset to Latin.
Fraunces is pinned to a soft setting (SOFT 50, WONK 0) to keep it at 56 KB. To use other
faces, drop new `.woff2` files in `public/fonts/` and update `fontHeading`, `fontBody` and
`fontFiles` in the brand file.

## Booking

The tour and call widgets expand inline. Out of the box (`booking.provider: "demo"`) they
generate realistic availability from each agent's hours, in Pacific time, and only ever show
open slots. To go live:

1. Set `booking.provider` to `"cal"` in the brand file.
2. Set each agent's `calendarBookingLink` to their Cal.com event (`team/event-slug`).

The widget then loads Cal.com's inline embed in the same panel, themed with the brand
accent, and records the booking in the same "You're booked" state.

## Leads and analytics

- **CRM webhook:** set `leads.webhookUrl` in the brand file. Tour bookings, agent calls and
  questions all `POST` JSON there (`type`, `listingId`, `agentId`, `contact`, `slot`,
  `message`, `ref`, `source`). This is the hook for the missed-lead follow-up pipeline.
  Without a URL, submissions are simulated.
- **Analytics:** set `analytics.plausibleDomain` or `analytics.ga4Id`. Events: `listing_view`,
  `filter_applied`, `booking_opened`, `tour_booked`, `call_booked`, `inquiry_opened`,
  `inquiry_submitted`, `booking_cancelled`. Every event is also pushed to `dataLayer` and
  fired as a `site:track` DOM event.
- **Maps:** set `PUBLIC_MAPBOX_TOKEN` to use a Mapbox static map. Without it, listing pages
  use OpenStreetMap tiles toned to the palette. That's fine for a demo, but use Mapbox in
  production because of OSM's tile usage policy.

## Intro loader and floor plans

- **Intro loader ("front door"):** two paneled doors hold the seal and the name; a fine line
  fills down the seam as the page really loads (fonts and the first image), then the name lifts
  away and the doors part onto the hero. Plays once per browser session on whichever page a
  visitor lands on. Add `?intro` to any URL to replay it in a demo. About two seconds; visitors
  who turn off motion get a simple fade.
- **Floor plans:** `src/data/floorplans.json`, keyed by listing id. Each floor has a `walls`
  line drawing; the `tour` list is the sequence of rooms. The section plays in place: while it's
  on screen it traces one room at a time and counts up its two figures, pausing on hover or
  focus. Visitors can also click any room or floor. A listing with an entry gets the "Walk the floor plan" section on its page;
  the hero listing's plan also appears on the home page.

## Showing error states in a live demo

Append these to any listing URL to walk a prospect through the edge cases from `UI-UX.md`:

- `?demo=slot-taken`: the first booking attempt loses its slot to "someone else". The widget
  explains what happened, shows refreshed times and keeps the visitor's details.
- `?demo=submit-error`: the first form send fails on the email field. All entered data is
  kept and the failing field is highlighted with a specific message.

## Before/after for outreach

With the site running (`npm run preview`):

```bash
npm run compare -- https://prospect-brokerage.com
```

This captures both homepages above the fold at desktop and mobile sizes, records page weight
and load time, and writes side-by-side PNGs to `compare-output/`. It also copies the
captures to `public/compare/`, so the private `/compare/` page (noindex, not in the sitemap)
shows them after the next build.

`npm run shots` takes full-page screenshots of the main pages for QA.

## Performance

Local Lighthouse mobile runs (`astro preview`, which doesn't compress anything) scored 100 on
accessibility, best practices and SEO for every page. Performance came in at 97 on listing pages
and between 77 and 94 on the home page, varying a lot from run to run on the test machine.
CLS is 0, and the pages ship about 40 ms of JavaScript. Before sending a demo link, run
PageSpeed Insights against the deployed URL. A CDN with Brotli compression should score higher
than these local runs.

## Security

- **Content Security Policy:** Astro emits a `<meta>` CSP with a SHA-256 hash for every inline
  script and style (`security.csp` in `astro.config.mjs`). External origins are limited to
  Plausible, Cal.com and the map tiles. If you add a third-party script, add its origin there.
- **HTTP headers:** `vercel.json` (Vercel) and `public/_headers` (Netlify / Cloudflare Pages) set
  HSTS, `X-Frame-Options: DENY` / `frame-ancestors 'none'`, `nosniff`, a strict referrer policy,
  a locked-down `Permissions-Policy`, and long-lived caching for hashed assets.
  There is deliberately no `Cross-Origin-Opener-Policy` header: with it, Lighthouse and Google PageSpeed
  Insights intermittently fail to measure the page (error `NO_NAVSTART`).
- **No secrets in the client.** The lead webhook URL is public by design (it's a POST
  endpoint). Put authentication and spam filtering on the receiving side. Contact details a
  visitor enters are kept in their own browser (localStorage) only to pre-fill forms, and the
  "Not you?" link clears them.
- `/compare/` is excluded from the sitemap, disallowed in `robots.txt` and sent with `noindex`.

## Checks to run before sending a link

```bash
npx astro check                     # types: 0 errors, 0 warnings
npm audit                           # dependencies: 0 vulnerabilities at the time of writing
npm run build && npx html-validate "dist/**/*.html"
npm run preview                     # then Lighthouse / PageSpeed on the deployed URL
```

## Structure

```
src/
  data/            all content and brand config (the only files a re-skin touches)
  lib/             brand selection, theme + contrast, typed data access, image lookup
  components/      ListingCard, BookingWidget, AskQuestion, Gallery, LocationMap, ...
  scripts/         small browser modules: storage, analytics, slots/time zones, validation
  pages/           /, /listings/, /listings/[slug]/, /agents/, /agents/[id]/,
                   /neighborhoods/, /about/, /contact/, /compare/, 404
scripts/           screenshot and before/after tooling (Playwright + local Chrome)
```

Photography is from Unsplash, for demonstration only.
