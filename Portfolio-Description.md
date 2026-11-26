HALDEN ROWE REAL ESTATE BROKERAGE WEBSITE
HERO SECTION
A high-end, re-skinnable website for a luxury real estate brokerage — find a home, tour it, talk to the agent, and get answers at any hour, all without a server.

A complete brokerage site built as a sales demo for real brokerages. Halden Rowe, a fictional Santa Barbara firm, shows what a modern brokerage site can do: a "folder sheet" layout, a blueprint hero animation, an in-place floor plan, inline tour and call booking, and a built-in assistant that answers questions and books appointments. Everything a visitor sees comes from JSON files, so the same site can be re-themed for a new brokerage by editing data and not code.

Tags: Web Design | Real Estate | Static Site | Lead Generation

OVERVIEW
THE CHALLENGE
Most brokerage sites are slow, template-looking portals that bury the listings and look the same as every competitor's
Booking a showing means a contact form, a wait, and a phone call back, so visitors who are ready now leave for another agent
Questions about a home, a neighborhood, or how selling works go unanswered outside office hours
Listing pages show photos but not how the house is laid out, where it sits, or who will show it
Off-the-shelf real estate themes can't be re-branded quickly, which makes a tailored demo for each prospect expensive
Agencies pay for hosting, plugins, and chat services that add monthly cost and third-party scripts to a site that should be fast
THE SOLUTION
A listings-first site with filters that live in the URL, so any search can be shared or bookmarked
Booking built into the page: tours and agent calls expand inline, show only real open slots from each agent's hours, and confirm in the same panel
A floor plan that plays in place, tracing one room at a time and counting up its figures, instead of a flat image
A site assistant that finds homes from plain requests, answers questions about the firm, listings, neighborhoods, and agents, and books a tour or call
A single JSON brand file that controls name, logo, palette, fonts, copy, contact details, and lead settings, with automatic contrast checking
A fully static build with no server, no database, and no per-message cost, hosted on Vercel
PLATFORM ARCHITECTURE
LAND → A once-per-session "front door" intro opens onto a hero with an animated blueprint of the featured home and a search console
SEARCH → Filter the 10 listings by sale or lease, neighborhood, price, and bedrooms; active filters show as removable pills and live in the URL
EXPLORE → Open a listing for photos, key facts, features, details, an in-place floor plan, a map, the listing agent, and similar homes
BOOK → Choose a tour or a call from the listing or agent page, pick an open slot, enter contact details, and get a confirmation with a reference
ASK → Open the chat assistant at any time to search, ask questions, or book, with the conversation following you from page to page
FOLLOW UP → Join the private-listings list, send a question to an agent, or call the number shown; every action can post to a CRM webhook
FULL TECHNICAL BREAKDOWN
1. LIGHT PALETTE & COLOR PSYCHOLOGY
Built on a warm, light palette chosen for a luxury, trustworthy feel: Spring Wood (#F9F6EE) as the page base, White for cards, Platinum (#EAE3E0) for alternating bands, Dark Gunmetal (#142334) for text and dark panels, and Rodeo Dust (#C9AD98) as the single accent. The accent is used for highlights, links, and borders; because it is a light colour, button text on it automatically switches to dark. Every colour is a CSS token, so components never hard-code a hex value. A `.scope-dark` class renders any section as a dark panel inside the light page.

2. SIGNATURE VISUAL ELEMENT: THE BLUEPRINT HERO
The home page opens on a hero that draws a blueprint of the featured home, using line data stored in `hero-blueprints.json`, over the property photo. The animation settles into the hero search console. It is driven by data, so a different brand or hero listing gets its own drawing, and it is switched off for visitors who prefer reduced motion.

3. THE FRONT-DOOR LOADER
On the first page a visitor lands on, two paneled doors hold the brand seal and name. A fine line fills down the seam as the page really loads (fonts and the first image), then the name lifts away and the doors part onto the hero. It plays once per browser session on any page, takes about two seconds, becomes a simple fade for visitors who turn off motion, and can be replayed in a demo by adding `?intro` to any URL.

4. FOLDER-SHEET LAYOUT
The home page is stacked like paper folders. Each section is a rounded "sheet" with a tab on top (About us, Floor plan, Listings, Agents, Neighborhoods, Clients, Private listings) and a small meta label such as "Since 2009" or "10 homes". Sheets alternate between white, platinum, base, and ink tones, with large rounded corners (28px panel radius), so the page reads as a sequence of distinct documents instead of one long scroll.

5. TYPOGRAPHY HIERARCHY & BRAND VOICE
Bricolage Grotesque for headings and Instrument Sans for body text, both self-hosted and subset to Latin so no external font request is made. Headings rise line by line as they enter the screen, and figures count up. Tabular figures are used wherever numbers line up, such as prices, phone numbers, and slot times. The copy is plain and specific: "17 days median time on market, against a county median of 34", with no filler.

6. RESPONSIVE ARCHITECTURE FOR ALL DEVICES
Desktop: full header, multi-column sheets, and a sticky contact panel beside each listing. Tablet: sections collapse to fewer columns. Mobile: a single column, a navigation menu, and a sticky booking bar on listing pages with the chat launcher moved above it so nothing is covered. Photos are served as AVIF, WebP, and JPG at several widths, and the layout never scrolls sideways.

7. SESSION STATE & PERSISTENCE
Everything runs in the browser with no account. A visitor's name, email, and phone are kept in their own localStorage only to pre-fill later forms, with a "Not you?" link that clears them. The chat conversation lives in sessionStorage, so it follows a visitor between pages and disappears when the tab closes. Bookings made in the chat are listed in localStorage so the assistant can answer "when is my tour?" and cancel or reschedule them.

8. INLINE BOOKING WITH PREMIUM UX
Tour and call widgets expand in place instead of opening a modal. In demo mode they generate availability from each agent's working hours in Pacific time and show only open slots, 21 days ahead. A visitor chooses in person or live video for tours, or phone or video for calls, then enters name, email, and mobile number with live phone formatting and field-level validation. Confirmation can come by email or text, and the "You're booked" panel gives a reference and a cancel link. If a slot is taken, the widget explains, shows refreshed times, and keeps the visitor's details. Setting the provider to Cal.com swaps in Cal.com's inline embed, themed with the brand accent, in the same panel.

KEY FEATURES
SOPHISTICATED LISTING DISCOVERY
The listings page filters by status (all, for sale, for lease), neighborhood, price, and bedrooms, and sorts the results. Price options change automatically between sale and lease ranges. Active filters appear as pills that can each be removed with one click, and the whole state is written to the URL. When nothing matches, a clear empty state says so. The home page adds a search console in the hero (Looking to buy or lease) and a horizontal featured-homes reel with previous and next controls that also scrolls by keyboard.

RICH LISTING PAGES
Each of the 10 listings has its own page with a breadcrumb, a key-facts bar (price, bedrooms, bathrooms, square feet, lot size, year built, type), a photo gallery with "All photos", the summary and full description, a "What stands out" feature list, a details section, a location map, a "Similar homes" row, and a contact panel for the listing agent. Pending homes carry a status tag, and the lease listings show monthly rent.

FLOOR PLAN THAT PLAYS IN PLACE
Listings with a plan get a "Walk the floor plan" section. While it is on screen it traces one room at a time and counts up that room's two figures, pausing on hover or focus. Visitors can click any room or any floor to jump straight to it. Plans are line drawings stored in `floorplans.json` keyed by listing id, and the featured home's plan also appears on the home page.

AGENTS & BOOKING ROUTING
The agents page and four agent profiles (Mara Ellison, principal broker and founder; Julian Okafor, associate broker; Elena Varga, director of leasing; Daniel Reyes, Ojai and Summerland) show photos, roles, languages, and hours. Each agent's hours drive their booking slots, and a call can be booked directly from their profile. The assistant routes questions to the right agent, such as leasing to Elena and Ojai to Daniel.

NEIGHBORHOOD GUIDES
Nine areas (Montecito, Hope Ranch, The Riviera, The Mesa, Downtown, Mission Canyon, Summerland, Carpinteria, Ojai) are shown on the home page explorer and a full guide page, with median prices in a comparison table and written guides. The table's figures also feed the assistant's neighborhood answers and rankings.

SITE ASSISTANT (CHAT)
A "Chat with us" launcher sits at the bottom right of every page. The assistant is rule-based, so it needs no server, API key, or per-message fee, and every answer comes from the same data files as the pages. It can:
- search from plain requests such as "4 bedrooms with a pool under 10 million" or "furnished rental in Mission Canyon", including typos, slang, prices in words, and custom features such as "with a tennis court"
- answer about the firm, each listing, each neighborhood, each agent, and about 70 common buying, selling, leasing, and booking questions
- show an inventory overview for any version of "what properties do you have", with counts and cards
- book a tour or a call using the same agent hours as the page widgets, take a message for an agent, sign someone up for private listings, and cancel or reschedule what it booked
- offer an ".ics" calendar file after a booking, and clearly say it is a demo booking that was not added to a real calendar
- decline politely and hand off to a person for offers, legal, tax, mortgage, and fee questions, and stay neutral on schools, safety, and who lives where
- greet in context: on a listing page it already knows which home you mean, and it will answer "how many bedrooms?" without being told
Under the hood it uses intent routing, weighted FAQ matching, spelling repair, and date, time, price, and bedroom parsing. The assistant loads only when someone opens or hovers the button, so each page carries about 4 KB of launcher script.

PRIVATE LISTINGS SIGNUP & INQUIRIES
A "Private listings" sheet collects an email for a short list of off-market homes, about one or two emails a month. Each listing and agent page also has a question form. All submissions, along with tour and call bookings and chat messages, post the same JSON payload to a CRM webhook, and without a webhook URL they are simulated.

RE-SKINNABLE BRAND ENGINE
A brand file controls the name, monogram or logo, tagline, six palette colours, fonts, hero copy and image, contact details, and booking and lead settings. A second brand, Calder Sloane, is included to show the whole site re-theming from one file with `BRAND=calder-sloane`. Colours are contrast-checked on every build, and each text-bearing shade is nudged until it passes WCAG AA, with a pass or fail report printed in the build log.

CLIENT PROOF & ABOUT
The About page explains how the firm works and introduces the team. The home page shows headline figures ($1.2B in homes sold since 2009, 17 days median time on market against a county median of 34, 4.9 / 5 from 312 verified reviews) and a client testimonial. Copy placeholders such as the brokerage name, founding year, and market are filled in automatically.

CONTACT & OFFICE DETAILS
The contact page offers several ways to reach the firm (tour, call, question, message), with the office address, hours, and phone and email links. Every phone and email in the site renders as a tap-to-call or mailto link.

DEMO TOOLS FOR OUTREACH
Adding `?demo=slot-taken` or `?demo=submit-error` to a listing URL walks a prospect through the booking and form edge cases. A private, noindexed Before and After page shows a prospect's current homepage next to the rebuilt one at desktop and mobile sizes, with page weight and load time. A command-line tool captures those comparisons, and another takes full-page screenshots of every page for review.

RESPONSIVE DESIGN ACROSS ALL DEVICES
Mobile-first layouts, a sticky booking bar on phones, and a full-screen chat panel on small screens. Visible focus states on every interactive element, labelled landmarks, and full support for reduced motion.

BEFORE & AFTER
BEFORE

A brokerage site that looked like every other, loaded slowly, hid listings behind a portal, and made visitors fill in a form and wait. Questions after hours went unanswered, a home's layout could not be seen, and every prospect demo meant a custom build.

AFTER

A fast, static site where a visitor can search in the URL, open a home, watch its floor plan play, pick a real open slot, and book without leaving the page. At any hour the assistant can find homes, answer questions, and book a tour or call. The whole site can be re-skinned for a new brokerage from one JSON file, and the build checks colour contrast automatically. Lighthouse scores 100 for accessibility, best practices, and SEO on every page, with zero layout shift.

WHAT THIS PROVES
Halden Rowe shows that a premium brokerage experience can be built without a backend: inline booking, an in-place floor plan, and a chat assistant that books appointments, all running on a static host at no per-use cost. It also reflects a deliberate stance on honesty. Bookings made in the demo are labelled as simulated, the fictional brokerage is not presented as real, photography is credited as demo imagery, and the assistant says plainly when it does not have an answer and offers a person instead.

TECH STACK
FRONTEND LAYER
ASTRO 7 — Static site generation with island-free pages, 21 static routes (home, listings and 10 listing pages, agents and 4 agent pages, neighborhoods, about, contact, before and after, 404)

TYPESCRIPT — Typed data access, browser modules, and the chat engine, checked with `astro check` at 0 errors, 0 warnings

TAILWIND CSS 4 — Utility-first styling, with every colour, radius, and shadow defined as a design token

ASTRO COMPONENTS — 23 components, including Header, Footer, Sheet, ListingCard, Gallery, LocationMap, BookingWidget, FloorPlan, AskQuestion, PrivateListings, Loader, and Chatbot

DESIGN & ANIMATION LAYER
CSS AND VANILLA JAVASCRIPT — Line-by-line heading reveals, photos that settle on scroll, count-up figures, the blueprint hero, the front-door loader, and the floor-plan walkthrough, with no animation library

SHARP — Build-time image pipeline that encodes every photo to AVIF, WebP, and JPG at several widths

CUSTOM FONTS — Bricolage Grotesque (headings) and Instrument Sans (body), self-hosted as subset WOFF2

DATA & CONTENT LAYER
JSON DATA FILES — Listings, agents, neighborhoods, floor plans, hero blueprints, site content, chat FAQ, and one file per brand; the only files a re-skin touches

BUILD-TIME KNOWLEDGE ENDPOINT — `/chat-knowledge.json`, generated at deploy from the data files so chat answers cannot drift from the pages

BOOKING & LEADS LAYER
DEMO BOOKING ENGINE — Slots generated from each agent's hours in Pacific time

CAL.COM EMBED — Optional live booking provider, themed with the brand accent

CRM WEBHOOK — One configurable URL receives tour bookings, agent calls, questions, signups, and chat messages as JSON

ANALYTICS — Plausible or GA4 by configuration, with events such as listing_view, filter_applied, tour_booked, and inquiry_submitted, also pushed to dataLayer

MAPS — OpenStreetMap tiles toned to the palette by default, or a Mapbox static map with a token

SECURITY & QUALITY
CONTENT SECURITY POLICY — A meta CSP with a SHA-256 hash for every inline script and style

HTTP HEADERS — HSTS, X-Frame-Options DENY, nosniff, a strict referrer policy, and a locked-down Permissions-Policy

ACCESSIBILITY TESTING — axe-core checks in real browsers, with html-validate on the built pages

PLAYWRIGHT — Browser tests for booking, chat, phone layout, and screenshots

DEPLOYMENT & INFRASTRUCTURE
VERCEL — Static hosting with automatic production builds from every push to the main branch on GitHub

GITHUB — Public repository used as the portfolio source; private planning documents are excluded

DEPLOY SCRIPT — Builds the site for its own address so canonical links, previews, and the sitemap are correct, then publishes

SCALABILITY & FLEXIBILITY
• BRAND RE-SKINNING — A new brokerage means one brand file and new data files. Layout code does not change, and the contrast check catches any palette that would fail accessibility.

• LISTING EXPANSION — New homes are added to `listings.json` with photos in the assets folder. Pages, filters, similar homes, the sitemap, and the chat knowledge all update on the next build.

• FLOOR PLAN EXPANSION — A plan is added by writing one entry keyed by listing id, with walls and a room tour. Listings without an entry simply skip the section.

• BOOKING PROVIDER SWAP — One setting moves booking from the built-in demo to Cal.com, with each agent's event link set in their data.

• CRM INTEGRATION — Setting one webhook URL turns every simulated submission into a real lead without touching components.

• CHAT KNOWLEDGE — A new answer is a new entry in the chat FAQ file with a few phrasings and a reply. Tokens such as phone and name are filled from the brand file, so a re-skin carries over.

• STATIC HOSTING — The output is plain files, so it can move between Vercel, Netlify, and Cloudflare Pages. Header files are included for each.

• ANALYTICS CHOICE — Plausible or GA4 can be switched on by configuration, and every event is also available as a DOM event for any other tool.

• CUSTOM DOMAIN — A domain is added in the Vercel project settings, and the site is rebuilt for it with one environment variable.

• MULTIPLE PROSPECT DEMOS — Each re-skinned brand can be deployed to its own address from one command.

• PERFORMANCE BUDGET — Pages ship about 40 ms of JavaScript, the chat loads only on demand, and images are encoded at build time, so adding content does not slow the first load.

• CONFIGURATION SAFETY — The build prints a colour contrast report and the chat knowledge build fails if any template token is left unfilled, so mistakes are caught at build time and not by visitors.

PROJECT DELIVERABLES
✅ Complete UI/UX Design System — Light palette as tokens, folder-sheet layout, rounded panel language, type scale, and motion guidelines with reduced-motion support

✅ 21 Static Pages — Home, listings, 10 listing pages, agents, 4 agent profiles, neighborhoods, about, contact, before and after, and a 404

✅ 23 Astro Components — Header, footer, sheets, listing cards, gallery, location map, booking widget, floor plan, question form, private-listings signup, loader, and chat assistant

✅ Responsive Design — Mobile, tablet, and desktop layouts; sticky booking bar on phones; full-screen chat on small screens

✅ Inline Booking System — Tour and call booking with real-looking availability, validation, confirmations, and cancellation

✅ Chat Assistant — Search, about 70 FAQs, listing, neighborhood, and agent answers, tour and call booking, messages, signups, cancel and reschedule, and calendar download

✅ Re-Skinnable Brand System — Two included brands, automatic contrast checking, and one-command builds per brand

✅ Operations Toolkit — Deploy script, screenshot and before-and-after tools, a lead webhook, analytics events, and security headers for three hosts

PORTFOLIO IMPACT
Design Sophistication — A warm, light luxury system with one restrained accent, a signature blueprint hero, a front-door intro, a folder-sheet layout, and a floor plan that plays in place

Technical Complexity — Astro 7 and Tailwind 4 with a typed data layer, a build-time image pipeline, a timezone-aware booking engine, and a rule-based language engine with spelling repair, slang handling, and date and price parsing, all running in the browser

Real-World Features — Inline tour and call booking, CRM webhook, analytics events, Cal.com option, map options, private-listings signup, security headers, and a chat assistant that books appointments

Commercial Positioning — Built to be shown to real brokerages and re-skinned for each one in minutes, with honest labelling of every simulated action

SUCCESS METRICS & RESULTS
Performance: Static output, AVIF and WebP images at several widths, self-hosted subset fonts, about 40 ms of JavaScript, cumulative layout shift of 0, and a chat assistant that loads only on demand

User Experience: A home can be searched, opened, and toured without leaving the page; a booking takes one panel; the chat answers at any hour and keeps its conversation across pages; a failed booking keeps everything the visitor typed

Quality: Lighthouse scores of 100 for accessibility, best practices, and SEO, axe-core clean in real browsers, valid HTML on every built page, and type checks with 0 errors and 0 warnings

Design Differentiation: A blueprint hero and front-door intro that no template ships with, a floor plan that plays in place, a folder-sheet home page, and a brand engine that re-themes the whole site from one file

TECHNOLOGY DECISIONS & RATIONALE
Decision	Why Chosen	Alternative Considered
Static site generation	Fast, cheap, nothing to secure or keep running	A CMS or server-rendered app (hosting cost, plugins, slower pages)
JSON data files	One place to edit for a re-skin; no database to run	A headless CMS (extra service and cost per prospect)
Light palette with one accent	Reads as calm and premium for high-value homes	Dark theme (reads as tech, not real estate)
Folder-sheet layout	Gives each section its own identity and a clear order	One continuous scroll of full-width bands
Inline booking widgets	No modal, no page change, fewer drop-offs	Contact form with a call back (slow, loses ready buyers)
Demo booking from agent hours	Realistic availability without a calendar account	Fake fixed slots (looks fake, breaks when hours change)
Rule-based chat assistant	No server, API key, or per-message cost, and answers match the site exactly	A hosted language model (cost, latency, risk of invented answers)
Lazy-loaded chat	Pages stay light until someone opens it	Bundling the chat into every page
Build-time contrast checks	A new palette cannot quietly break accessibility	Manual review of each brand
Hash-based CSP	Strict policy with inline styles and scripts still allowed	Wide-open policy with unsafe-inline
Self-hosted fonts	No third-party request and faster first paint	Google Fonts (extra connection, privacy cost)
Build-time image encoding	Small AVIF and WebP files at the right widths	Serving originals or a runtime image service
Webhook for leads	Works with any CRM through one setting	A built-in form backend (another thing to host)
OpenStreetMap by default, Mapbox optional	A working map with no token for demos	Requiring a paid map key before anything works

url: https://halden-rowe-demo.vercel.app
