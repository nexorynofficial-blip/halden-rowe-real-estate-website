/**
 * The site assistant's brain. Pure logic with no DOM access, so it can be tested in Node.
 * Answers come from the same data files as the pages (via /chat-knowledge.json); anything the
 * data doesn't cover is answered honestly and routed to the right person.
 */
import { buildDays, dayLabel, timeLabel, fmt, relativeDay, replyBy, todayIn, type Day } from '../time';
import { rules, } from '../forms';
import {
  Matcher, clean, tokens, makeAutocorrect, expandSlang, parseBeds, parseBaths, parsePrice, parseWhen, partRange, dateKey, findEmail, findPhone, findName,
  isYes, isNo, wantsOut, isQuestion, type WhenHint, type PriceHint,
} from './nlp';

// ---------- types ----------

export interface KListing {
  id: string; ref: string; slug: string; url: string; title: string; street: string; address: string;
  price: number; unit: 'month' | null; priceLabel: string; status: 'for-sale' | 'for-rent' | 'pending'; statusLabel: string;
  beds: number; baths: number; sqft: number; lot: number | null; year: number; type: string; hood: string; hoodName: string;
  agentId: string; listed: string; featured: boolean; summary: string; description: string; features: string[];
  thumb: string; thumbAlt: string;
}
export interface KAgent {
  id: string; name: string; first: string; title: string; short: string; bio: string; areas: string[]; languages: string[];
  phone: string; email: string; license: string; years: number; homes: number; volume: string; response: string;
  hours: { start: number; end: number; days: number[] }; listingIds: string[]; url: string;
}
export interface KHood { slug: string; name: string; plain: string; median: number; days: number; summary: string; body: string; url: string }
export interface KFaq { id: string; q: string[]; a: string; links: Link[]; actions: string[]; chips: string[] }
export interface Knowledge {
  brand: {
    id: string; name: string; legalName: string; market: string; founded: number; license: string; phone: string; email: string;
    street: string; city: string; hours: string; mapsUrl: string; tz: string; tourMinutes: number; callMinutes: number;
    daysAhead: number; responseTime: string; responseMinutes: number;
  };
  stats: { value: string; label: string }[];
  listings: KListing[]; agents: KAgent[]; hoods: KHood[];
  contactPaths: { id: string; agentId: string }[];
  glossary: { terms: string[]; text: string }[];
  welcome: string; demoNote: string; starters: { label: string; send: string }[]; faqs: KFaq[];
}

export interface Link { label: string; href: string }
export interface Chip { label: string; send?: string }
export interface Card { title: string; meta: string; sub: string; href: string; thumb: string; alt: string }
export interface Reply {
  text: string;
  cards?: Card[];
  links?: Link[];
  chips?: Chip[];
  facts?: [string, string][];
  note?: string;
  tone?: 'success' | 'error';
  ics?: { filename: string; content: string };
  redactUser?: boolean;
  intent?: string;
}

export interface ChatBooking {
  ref: string; mode: 'tour' | 'call'; slot: string; kind: string; agentId: string; listingId: string | null; place: string | null; seed: string;
}

type FlowType = 'tour' | 'call' | 'message' | 'signup' | 'cancel' | 'reschedule';
export interface Flow { type: FlowType; step: string; d: Record<string, unknown> }
export interface Session {
  flow: Flow | null;
  ctx: { listingId?: string; agentId?: string; hood?: string; topic?: 'buy' | 'sell' | 'rent'; recent?: string[] };
  page: { listingId?: string; agentId?: string; hood?: string };
  misses: number;
  offer?: string;
  lastQuestion?: string;
}

export interface Deps {
  submitLead(payload: Record<string, unknown>): Promise<void>;
  profile: { get(): { name?: string; email?: string; phone?: string }; save(p: { name?: string; email?: string; phone?: string }): void; clear(): void };
  bookings: { list(): ChatBooking[]; add(b: ChatBooking): void; remove(ref: string): void };
  FieldError: new (...a: any[]) => Error & { field: string };
  formatPhone(v: string): string;
  track(event: string, props?: Record<string, unknown>): void;
  now?: () => Date;
}

// ---------- small helpers ----------

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const baths = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const num = (n: number) => n.toLocaleString('en-US');
const joinList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const rid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const mins = (d: Date, tz: string) => { const [h, m] = fmt(d, tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number); return h * 60 + m; };
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourWord = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h >= 12 ? 'pm' : 'am'}`;
const daysWord = (days: number[]) => {
  const s = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // Monday first
  const idx = s.map((d) => (d + 6) % 7);
  const consecutive = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  return consecutive && s.length > 2 ? `${WEEKDAY_NAMES[s[0]]} to ${WEEKDAY_NAMES[s.at(-1)!]}` : joinList(s.map((d) => WEEKDAY_NAMES[d]));
};

const card = (l: KListing): Card => ({
  title: l.street,
  meta: `${l.priceLabel} · ${l.beds} bd · ${baths(l.baths)} ba · ${num(l.sqft)} sq ft`,
  sub: `${l.hoodName.replace(/^The /, '')} · ${l.statusLabel}`,
  href: l.url, thumb: l.thumb, alt: l.thumbAlt,
});

const CAPS: Record<string, Chip> = {
  tour: { label: 'Book a tour', send: 'Book a tour' },
  call: { label: 'Book a call', send: 'Book a call with an agent' },
  message: { label: 'Leave a message', send: 'Leave a message for an agent' },
  signup: { label: 'Private listings', send: 'Sign me up for private listings' },
  cancel: { label: 'Cancel a booking', send: 'Cancel my booking' },
  clear: { label: 'Clear my saved details', send: 'Clear my saved details' },
};

// ---------- amenity search ----------

interface Amenity { key: string; label: string; trigger: RegExp; test: (l: KListing, text: string) => boolean }
const AMENITIES: Amenity[] = [
  { key: 'pool', label: 'a pool', trigger: /\b(pools?|swim(ming)?|lap pool|plunge)\b/, test: (_l, t) => /\bpool\b/.test(t) },
  { key: 'beach', label: 'a beach nearby', trigger: /\b(beach|beachfront|oceanfront|waterfront|by the (sea|ocean)|near the (sea|ocean|water)|surf)\b/, test: (_l, t) => /beach/.test(t) },
  { key: 'view', label: 'views', trigger: /\b(views?|scenic|sunsets?|panoramic)\b/, test: (_l, t) => /\bviews?\b/.test(t) },
  { key: 'guest', label: 'a guest house or studio', trigger: /\b(guest ?(house|suite|room|quarters|casita)|casita|in-?law|adu|studio|barn|separate unit|extra (room|space))\b/, test: (_l, t) => /guest|casita|studio|barn/.test(t) },
  { key: 'garage', label: 'a garage', trigger: /\b(garages?|parking|carport|motor court)\b/, test: (_l, t) => /garage|parking|motor court/.test(t) },
  { key: 'furnished', label: 'a furnished option', trigger: /\bfurnish(ed|ings)?\b/, test: (_l, t) => /furnished/.test(t) },
  { key: 'gated', label: 'a gated entry', trigger: /\b(gated|gate)\b/, test: (_l, t) => /gated/.test(t) },
  { key: 'acre', label: 'an acre or more', trigger: /\b(acres?|acreage|big lot|large lot|big property|large property|lots? of land|land)\b/, test: (l) => (l.lot ?? 0) >= 1 },
  { key: 'yard', label: 'a lawn or garden', trigger: /\b(yard|lawn|gardens?|outdoor space|grass)\b/, test: (_l, t) => /lawn|garden|yard|grove/.test(t) },
  { key: 'new', label: 'newer construction (2015 or later)', trigger: /\b(new build|newly built|new construction|newer|recently built|brand new|new home|built recently)\b/, test: (l) => l.year >= 2015 },
  { key: 'historic', label: 'built before 1950', trigger: /\b(historic|historical|old(er)? home|vintage|period home|character|restored|classic|1920s|1930s|original details|heritage)\b/, test: (l) => l.year < 1950 },
  { key: 'modern', label: 'a modern design', trigger: /\b(modern|contemporary|minimalist|sleek)\b/, test: (_l, t) => /modern|contemporary|glass|cantilever/.test(t) },
  { key: 'solar', label: 'solar or all-electric systems', trigger: /\b(solar|energy efficient|all-?electric|powerwall|green home|sustainable|eco)\b/, test: (_l, t) => /solar|powerwall|all-electric|greywater/.test(t) },
  { key: 'fireplace', label: 'a fireplace', trigger: /\b(fireplaces?|fire pit)\b/, test: (_l, t) => /fireplace/.test(t) },
  { key: 'wine', label: 'a wine cellar', trigger: /\b(wine|cellar)\b/, test: (_l, t) => /wine/.test(t) },
  { key: 'ev', label: 'EV charging', trigger: /\b(ev|electric (car|vehicle)|tesla|charging)\b/, test: (_l, t) => /ev charging|tesla|charging/.test(t) },
  { key: 'office', label: 'a library, study or office', trigger: /\b(study|library|work from home|wfh|home office)\b/, test: (_l, t) => /library|study|office/.test(t) },
  { key: 'spa', label: 'a spa or hot tub', trigger: /\b(spa|hot tub|jacuzzi)\b/, test: (_l, t) => /\bspa\b|hot tub/.test(t) },
  { key: 'walk', label: 'a walkable location', trigger: /\b(walkable|walk to|within walking|walking distance)\b/, test: (_l, t) => /walk/.test(t) },
  { key: 'citrus', label: 'citrus or an orchard', trigger: /\b(citrus|orchard|orange trees?|olive|grove|avocado)\b/, test: (_l, t) => /orange|citrus|olive|grove|orchard/.test(t) },
  { key: 'porch', label: 'a porch, balcony or terrace', trigger: /\b(porch|balcon(y|ies)|terrace|patio|deck)\b/, test: (_l, t) => /porch|balcon|terrace|deck/.test(t) },
  { key: 'trails', label: 'trail access', trigger: /\b(trails?|hik(e|ing)|riding)\b/, test: (_l, t) => /trail|hik/.test(t) },
  { key: 'pets', label: 'pets considered', trigger: /\b(pets?|dogs?|cats?)\b/, test: (_l, t) => /pets? considered/.test(t) },
  { key: 'condo', label: 'a condominium', trigger: /\b(condos?|condominiums?|apartments?|townhomes?|townhouses?)\b/, test: (l) => /condominium/i.test(l.type) },
  { key: 'estate', label: 'an estate', trigger: /\b(estates?|mansion)\b/, test: (l) => /estate/i.test(l.type) },
];
const listingText = (l: KListing) => `${l.title} ${l.summary} ${l.description} ${l.features.join(' ')} ${l.type}`.toLowerCase();

// ---------- the bot ----------

export function createBot(k: Knowledge, deps: Deps) {
  const tz = k.brand.tz;
  const now = () => deps.now?.() ?? new Date();
  const agentOf = (id: string) => k.agents.find((a) => a.id === id)!;
  const listingOf = (id?: string) => k.listings.find((l) => l.id === id);
  const hoodOf = (slug?: string) => k.hoods.find((h) => h.slug === slug);
  const first = (a: KAgent) => a.first;
  const bookable = (l: KListing) => l.status !== 'pending';

  // --- indexes
  const officeHours = (() => {
    const m = k.brand.hours.match(/(\d{1,2})\s*(am|pm)[^\d]+(\d{1,2})\s*(am|pm)/i);
    const to24 = (h: string, ap: string) => (ap.toLowerCase() === 'pm' ? (Number(h) % 12) + 12 : Number(h) % 12);
    return m ? { start: to24(m[1], m[2]), end: to24(m[3], m[4]) } : { start: 9, end: 18 };
  })();

  const SUFFIX = new Set(['lane', 'road', 'avenue', 'drive', 'street', 'way', 'west', 'east', 'north', 'south', 'las', 'la', 'via', 'st', 'rd', 'ave', 'dr', 'ln']);
  const streetKeys = k.listings.map((l) => {
    const words = clean(l.street).split(' ').filter((w) => !/^\d/.test(w) && !SUFFIX.has(w) && !/^\d+[a-z]$/.test(w));
    return { l, number: (l.street.match(/^\d+/) ?? [''])[0], words };
  });
  // Names of places, people and homes are removed before a question is scored against the FAQ, so
  // "can I make an offer on 1190 Pepper Lane" is judged as "can I make an offer".
  const entityWords = new Set<string>(['hr']);
  for (const w of clean(k.brand.name).split(' ')) entityWords.add(w);
  for (const h of k.hoods) for (const w of clean(h.plain).split(' ')) entityWords.add(w);
  for (const a of k.agents) for (const w of clean(a.name).split(' ')) { entityWords.add(w); entityWords.add(`${w}'s`); }
  for (const sk of streetKeys) for (const w of sk.words) entityWords.add(w);
  const entityRe = new RegExp(`\\b(${[...entityWords].filter((w) => w.length > 1 && !/^(the|and|of)$/.test(w)).join('|')})\\b`, 'g');
  const streetWordSet = new Set(streetKeys.flatMap((sk) => sk.words));
  const stripEntities = (text: string) => {
    let street = false;
    let t = clean(text).replace(entityRe, (m) => { if (streetWordSet.has(m)) street = true; return ' '; });
    if (street) t = t.replace(/\b(lane|road|avenue|drive|street|ave|rd|dr|st|unit|suite)\b/g, ' ');
    return t.replace(/\b\d{3,4}[a-z]?\b/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const faqMatcher = new Matcher(k.faqs.map((f) => ({ item: f, phrases: f.q })), stripEntities);
  const faqById = (id: string) => k.faqs.find((f) => f.id === id)!;
  // Misspellings ("shcedule a tuor", "montecto") are repaired against the words the assistant knows.
  const vocabulary = new Set<string>();
  for (const f of k.faqs) for (const q of f.q) for (const w of clean(q).split(' ')) vocabulary.add(w);
  for (const w of entityWords) vocabulary.add(w);
  for (const l of k.listings) for (const w of clean(`${l.type} ${l.title} ${l.features.join(' ')}`).split(' ')) vocabulary.add(w);
  for (const w of ('tomorrow today tonight morning afternoon evening weekend saturday sunday monday tuesday wednesday thursday friday schedule appointment viewing showing bedroom bedrooms bathroom bathrooms neighborhood neighborhoods property properties mortgage commission listing listings available furnished garage fireplace million thousand reschedule cancel appointment consultation condominium townhouse estate agent agents realtor broker brokerage neighbourhood expensive cheapest affordable apartment appraisal inspection').split(' ')) vocabulary.add(w);
  // Real words that appear anywhere on the site are never "corrected", only unfamiliar ones are.
  const knownWords = new Set<string>();
  const addWords = (txt: string) => { for (const w of clean(txt).split(' ')) knownWords.add(w); };
  for (const f of k.faqs) addWords(f.a);
  for (const l of k.listings) addWords(`${l.title} ${l.summary} ${l.description} ${l.features.join(' ')} ${l.address} ${l.type} ${l.hoodName}`);
  for (const h of k.hoods) addWords(`${h.summary} ${h.body}`);
  for (const a of k.agents) addWords(`${a.bio} ${a.title} ${a.languages.join(' ')}`);
  addWords('hello hi hey there thanks thank please goodbye welcome great amazing awesome wonderful perfect lovely features amenities photos pictures bedrooms bathrooms neighbourhood neighborhood nearby around similar alternatives details address located available whether another anything something everything maybe really');
  const autocorrect = makeAutocorrect(vocabulary, knownWords);
  const DESCRIPTORS: [RegExp, string][] = [
    [/\bcourtyard\b/, 'hr-1018'], [/\bcolonial\b/, 'hr-1009'], [/\bshingled\b|\bporch house\b/, 'hr-1015'], [/\bcraftsman\b/, 'hr-1012'],
    [/\bblackened steel\b|\bcedar\b|\btimber and (blackened )?steel\b/, 'hr-1036'], [/\bglass and timber\b/, 'hr-1024'],
    [/\bcorner (residence|unit|condo)\b|\b4b\b/, 'hr-1050'], [/\bsandyland\b/, 'hr-1042'], [/\bfurnished canyon\b|\bcanyon house\b/, 'hr-1047'],
    [/\blagoon\b|\bwhite modern\b/, 'hr-1031'],
  ];

  // --- entity finders
  function findListing(text: string): KListing | null {
    const t = clean(text);
    const idm = t.match(/\bhr[- ]?(\d{4})\b/) ?? t.match(/\b(10[0-9]{2})\b/);
    if (idm) { const l = k.listings.find((x) => x.id === `hr-${idm[1]}`); if (l) return l; }
    for (const s of streetKeys) {
      if (s.number && new RegExp(`\\b${s.number}\\b`).test(t) && s.words.some((w) => t.includes(w))) return s.l;
    }
    for (const s of streetKeys) {
      if (s.words.length && s.words.every((w) => new RegExp(`\\b${w}\\b`).test(t))) return s.l;
    }
    for (const s of streetKeys) {
      if (s.number && new RegExp(`\\b${s.number}\\b`).test(t) && !/\$|\bsq|\bsqft|bed|bath|acre/.test(t)) return s.l;
    }
    if (!findHood(text) || /\b(the|that|this) (home|house|one|place|listing)\b/.test(t)) {
      for (const [re, id] of DESCRIPTORS) if (re.test(t)) { const l = k.listings.find((x) => x.id === id); if (l) return l; }
    }
    return null;
  }
  function findListings(text: string): KListing[] {
    const t = clean(text);
    const out: KListing[] = [];
    const add = (l: KListing | null | undefined) => { if (l && !out.includes(l)) out.push(l); };
    for (const s of streetKeys) {
      if ((s.words.length && s.words.every((w) => new RegExp(`\\b${w}\\b`).test(t))) || (s.number && new RegExp(`\\b${s.number}\\b`).test(t))) add(s.l);
    }
    for (const m of t.matchAll(/\bhr[- ]?(\d{4})\b/g)) add(k.listings.find((x) => x.id === `hr-${m[1]}`));
    for (const [re, id] of DESCRIPTORS) if (re.test(t)) add(k.listings.find((x) => x.id === id));
    return out;
  }
  const HOOD_ALIASES: [RegExp, string][] = [
    [/\bmontecito\b/, 'montecito'], [/\bhope ranch\b/, 'hope-ranch'], [/\briviera\b/, 'riviera'], [/\bmesa\b/, 'mesa'],
    [/\bdowntown\b|\bstate street\b|\bfunk zone\b/, 'downtown'], [/\bmission canyon\b/, 'mission-canyon'], [/\bsummerland\b/, 'summerland'],
    [/\bcarpinteria\b/, 'carpinteria'], [/\bojai\b/, 'ojai'],
  ];
  function findHood(text: string): KHood | null {
    const t = clean(text);
    for (const [re, slug] of HOOD_ALIASES) if (re.test(t)) return hoodOf(slug) ?? null;
    return null;
  }
  function findHoods(text: string): KHood[] {
    const t = clean(text);
    return HOOD_ALIASES.filter(([re]) => re.test(t)).map(([, s]) => hoodOf(s)!).filter(Boolean);
  }
  function findAgent(text: string): KAgent | null {
    const t = clean(text);
    for (const a of k.agents) {
      const parts = a.name.toLowerCase().split(' ');
      if (t.includes(a.name.toLowerCase()) || new RegExp(`\\b${parts[0]}\\b`).test(t) || new RegExp(`\\b${parts[1]}\\b`).test(t)) return a;
    }
    if (/\b(founder|principal broker)\b/.test(t)) return agentOf('mara-ellison');
    if (/\b(director of leasing|leasing director|leasing agent)\b/.test(t)) return agentOf('elena-varga');
    if (/\b(attorney|lawyer|land use)\b/.test(t)) return agentOf('julian-okafor');
    return null;
  }
  function agentsForHood(slug: string) { return k.agents.filter((a) => a.areas.includes(slug)); }
  function amenitiesIn(text: string) {
    const t = clean(text);
    return AMENITIES.filter((a) => a.trigger.test(t));
  }
  function topicOf(text: string): 'buy' | 'sell' | 'rent' | null {
    const t = clean(text);
    if (/\b(sell|selling|list my|listing my|list our|put (it|my house) on the market)\b/.test(t)) return 'sell';
    if (/\b(rent|lease|leasing|rental|renting|tenant)\b/.test(t)) return 'rent';
    if (/\b(buy|buying|purchase|purchasing|looking for a home|find a home|find me a home|move to|relocat)/.test(t)) return 'buy';
    return null;
  }
  function routeAgent(s: Session, text: string): KAgent | null {
    const l = findListing(text) ?? listingOf(s.ctx.listingId);
    const ag = findAgent(text);
    if (ag) return ag;
    if (l && /\b(this|that|the) (home|house|listing|property)|\bit\b/.test(clean(text)) ) return agentOf(l.agentId);
    const topic = topicOf(text) ?? s.ctx.topic;
    const hood = findHood(text) ?? hoodOf(s.ctx.hood);
    if (topic === 'rent') return agentOf('elena-varga');
    if (hood) {
      const as = agentsForHood(hood.slug);
      if (topic === 'buy' && hood.slug === 'summerland') return agentOf('daniel-reyes');
      if (as.length) return as[0];
    }
    if (topic === 'sell') return agentOf('mara-ellison');
    if (topic === 'buy') return agentOf('julian-okafor');
    if (l) return agentOf(l.agentId);
    return null;
  }

  // ---------- replies ----------

  const withTour = (l: KListing): Chip[] => (bookable(l) ? [{ label: 'Book a tour', send: `Book a tour of ${l.street}` }] : []);
  const contactLine = (a: KAgent) => `${a.name}: ${a.phone}, ${a.email}`;
  const agentLinks = (a: KAgent): Link[] => [{ label: a.name, href: a.url }];
  const mainOffice = () => `${k.brand.phone} or ${k.brand.email}`;

  function capChips(actions: string[]): Chip[] {
    return actions.map((a) => CAPS[a]).filter(Boolean);
  }

  function describeListing(l: KListing): Reply {
    const a = agentOf(l.agentId);
    const lot = l.lot ? `, on ${l.lot} acres` : '';
    const lines = [
      `**${l.street}**, ${l.hoodName.replace(/^The /, '')}: ${l.summary}`,
      `${l.priceLabel} · ${l.beds} bedrooms · ${baths(l.baths)} bathrooms · ${num(l.sqft)} sq ft${lot} · built ${l.year}. ${l.statusLabel}${l.status === 'pending' ? ', so tours have stopped' : ''}.`,
      `Listing agent: ${a.name}.`,
    ];
    const chips: Chip[] = [
      ...withTour(l),
      { label: `Ask ${first(a)} a question`, send: `Message ${a.name} about ${l.street}` },
      { label: 'What features does it have?', send: `What are the features of ${l.street}?` },
    ];
    if (l.id === 'hr-1024') chips.push({ label: 'Floor plan', send: `Is the floor plan for ${l.street} exact?` });
    return { text: lines.join('\n'), cards: [card(l)], chips, intent: 'listing' };
  }

  function listingAttribute(l: KListing, text: string): Reply | null {
    const t = clean(text);
    const a = agentOf(l.agentId);
    const chips = [...withTour(l), { label: `Message ${first(a)}`, send: `Message ${a.name} about ${l.street}` }];
    const am = amenitiesIn(text).filter((x) => !['condo', 'estate', 'modern', 'new', 'historic'].includes(x.key));
    if (am.length) {
      const body = listingText(l);
      const yes: Amenity[] = [];
      const no: Amenity[] = [];
      for (const x of am) (x.test(l, body) ? yes : no).push(x);
      const evidence = (x: Amenity) => {
        const re = new RegExp(x.trigger.source.replace(/\\b/g, ''), 'i');
        const feat = l.features.find((f) => re.test(f));
        return feat ? ` (${feat.charAt(0).toLowerCase()}${feat.slice(1)})` : '';
      };
      const parts: string[] = [];
      if (yes.length) parts.push(yes.length === 1 && yes[0].key === 'pets' ? `Pets are considered at ${l.street}.` : `Yes, ${l.street} has ${joinList(yes.map((x) => x.label))}${yes.length === 1 && !(evidence(yes[0]).toLowerCase().includes(yes[0].label.toLowerCase())) ? evidence(yes[0]) : ''}.`);
      if (no.length) parts.push(`The listing doesn't mention ${joinList(no.map((x) => x.label))}. ${a.first} can confirm what isn't published: ${a.phone}.`);
      return { text: parts.join(' '), chips, intent: 'listing-amenity' };
    }
    const lines: string[] = [];
    if (/\b(price|how much|asking|cost|rent|list price|monthly)\b/.test(t)) lines.push(`${l.street} is ${l.priceLabel}${l.unit ? '' : ''}. ${l.status === 'pending' ? 'It is pending, in escrow with a buyer.' : l.unit ? 'Lease prices are per month.' : ''}`.trim());
    if (/\b(bed|beds|bedroom|bedrooms|bath|baths|bathroom|bathrooms|rooms)\b/.test(t)) lines.push(`${l.beds} bedrooms and ${baths(l.baths)} bathrooms.`);
    if (/\b(sq ?ft|square|size|big|how large|how big|area|floor area|living space)\b/.test(t) && (!/\b(lot|acre|acres|land|yard|grounds)\b/.test(t) || /\b(sq ?ft|square|living)\b/.test(t))) lines.push(`${num(l.sqft)} sq ft of living space.`);
    if (/\b(lot|acre|acres|land|grounds|property size)\b/.test(t)) lines.push(l.lot ? `The lot is ${l.lot} acres.` : 'This is a condominium, so there is no private lot.');
    if (/\b(built|year built|what year|how old|age of|age)\b/.test(t)) lines.push(`Built in ${l.year}.`);
    if (/\b(agent|who is selling|who's selling|listed by|listing agent|contact|who do i (talk|call|speak)|who handles)\b/.test(t)) lines.push(`The listing agent is ${contactLine(a)}.`);
    if (/\b(address|where is|where's|located|location|street|neighborhood|neighbourhood|area|which area)\b/.test(t)) lines.push(`${l.address}. That's in ${l.hoodName}.`);
    if (/\b(status|available|still for sale|still available|sold|pending|on the market)\b/.test(t)) {
      lines.push(l.status === 'pending' ? `${l.street} is pending: it's in escrow with a buyer and tours have stopped. ${a.first} can tell you about similar homes.` : `${l.street} is listed as ${l.statusLabel.toLowerCase()}. ${a.first} confirms the latest status before you plan around it.`);
    }
    if (/\b(listed|when was it listed|how long on the market|days on market|new listing)\b/.test(t)) {
      const days = Math.max(0, Math.round((now().getTime() - new Date(`${l.listed}T12:00:00Z`).getTime()) / 86400000));
      lines.push(`It was listed on ${new Date(`${l.listed}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}, ${days} days ago.`);
    }
    if (/\b(features?|amenit|includes?|what('s| is) (in|included)|highlights|special|details|extras)\b/.test(t)) {
      lines.push(`Features of ${l.street}:\n${l.features.map((f) => `- ${f}`).join('\n')}`);
    }
    if (/\b(describe|description|about it|tell me more|more (info|about)|overview|summary|what('s| is) it like)\b/.test(t)) {
      return describeListing(l);
    }
    if (/\b(photos?|pictures?|images?|gallery)\b/.test(t)) lines.push(`You can see every photo on the listing page.`);
    if (/\b(floor ?plans?|layout|blueprints?)\b/.test(t)) lines.push(l.id === 'hr-1024' ? `${l.street} has an illustrated floor plan walkthrough on its page. The whole-house figures come from the listing, but the room-by-room sizes aren't confirmed measurements, so ask ${a.first} for measured plans.` : `I don't have a floor plan for ${l.street}. ${a.first} can tell you what plans exist: ${a.phone}.`);
    if (/\b(directions?|map|navigate|how (do i|to|can i) get (to|there)|drive to)\b/.test(t)) {
      return { text: `${l.address}. Open it in Maps for directions.`, links: [{ label: 'Get directions', href: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(l.address)}` }, { label: `View ${l.street}`, href: l.url }], chips, intent: 'listing-directions' };
    }
    if (!lines.length) return null;
    return { text: lines.join('\n'), links: [{ label: `View ${l.street}`, href: l.url }], chips, intent: 'listing-attr' };
  }

  // --- search
  interface Criteria { status?: 'for-sale' | 'for-rent'; hood?: KHood; price?: PriceHint; beds?: number; baths?: number; am: Amenity[]; wantsPending: boolean; sort?: 'cheap' | 'expensive' | 'big' | 'new' | 'old' | 'lot' | 'beds' | 'small' }
  function criteriaFrom(text: string): Criteria {
    const t = clean(text);
    const c: Criteria = { am: amenitiesIn(text), wantsPending: /\bpending|in escrow|under contract\b/.test(t) };
    if (/\b(rent|rental|rentals|renting|lease|leases|leasing|for lease|for rent|tenant)\b/.test(t)) c.status = 'for-rent';
    else if (/\b(buy|purchase|for sale|own|owning|buying)\b/.test(t)) c.status = 'for-sale';
    c.hood = findHood(text) ?? undefined;
    // A feature we have no category for ("with a tennis court"): look for the words themselves in the listings.
    const homeContext = /\b(home|homes|house|houses|property|properties|listing|listings|place|places|rental|rentals|condo|condos|apartment)\b/.test(t);
    const wm = homeContext ? t.match(/\b(?:with|having)\s+(?:an?\s+|the\s+|some\s+)?([a-z][a-z -]{2,28}?)(?=\s+(?:and|in|under|near|for|that|which|over|around)\b|\s*$)/) : null;
    if (wm && !/\b(you|your|my|me|mine|us|our|information|details|questions?)\b/.test(wm[1])) {
      const words = wm[1].split(' ').filter((w) => w.length >= 4 && !/^(home|homes|house|houses|place|property|bedroom|bedrooms|bathroom|bathrooms|price|budget|million|rooms?|anything|something|nothing|everything|views?|that|this|what|which|have|with)$/.test(w));
      const known = amenitiesIn(wm[1]).length > 0 || parseBeds(wm[1]) !== null || parseBaths(wm[1]) !== null || !!parsePrice(wm[1]);
      if (words.length && !known) {
        const stems = words.map((w) => w.replace(/(ing|es|s)$/, ''));
        const what = wm[1].trim().replace(/^(an?|the)\s+/, '');
        c.am.push({ key: `custom:${what}`, label: `${/^[aeiou]/.test(what) ? 'an' : 'a'} ${what}`, trigger: /$^/, test: (_l, body) => stems.every((w) => body.includes(w)) });
      }
    }
    const p = parsePrice(text);
    if (p) { c.price = p; if (p.monthly && !c.status) c.status = 'for-rent'; if (!p.monthly && !c.status) c.status = 'for-sale'; }
    let b = parseBeds(text);
    if (b && /\b(more than|over|above|greater than|exceeding)\s+(\d+|one|two|three|four|five|six|seven|eight)\s*(\+|plus)?\s*[- ]?(bed|br|bd)/.test(t)) b += 1;
    if (b) c.beds = b;
    const ba = parseBaths(text);
    if (ba) c.baths = ba;
    if (/\b(cheapest|least expensive|lowest|most affordable|cheaper|inexpensive)\b/.test(t)) c.sort = 'cheap';
    else if (/\b(most expensive|priciest|highest|luxury|top end|high end|biggest budget)\b/.test(t)) c.sort = 'expensive';
    else if (/\b(biggest|largest|most spacious|most square|most sq)\b/.test(t)) c.sort = 'big';
    else if (/\b(smallest|most compact|cosy|cozy)\b/.test(t)) c.sort = 'small';
    else if (/\b(newest|most recent|newly built|latest)\b/.test(t)) c.sort = 'new';
    else if (/\b(oldest|most historic)\b/.test(t)) c.sort = 'old';
    else if (/\b(most land|largest lot|biggest lot|most acreage)\b/.test(t)) c.sort = 'lot';
    else if (/\bmost bedrooms\b/.test(t)) c.sort = 'beds';
    if (c.sort && !c.status && !c.wantsPending && runSearch({ ...c, status: 'for-sale' }).length) c.status = 'for-sale';
    return c;
  }
  const hasCriteria = (c: Criteria) => !!(c.status || c.hood || c.price || c.beds || c.baths || c.am.length || c.sort);
  function runSearch(c: Criteria, drop: Set<string> = new Set()): KListing[] {
    return k.listings.filter((l) => {
      if (l.status === 'pending' && !c.wantsPending) return false;
      if (c.status && l.status !== c.status && !(c.wantsPending && l.status === 'pending' && (c.status === 'for-rent') === (l.unit === 'month'))) return false;
      if (!drop.has('hood') && c.hood && l.hood !== c.hood.slug) return false;
      if (!drop.has('beds') && c.beds && l.beds < c.beds) return false;
      if (!drop.has('baths') && c.baths && l.baths < c.baths) return false;
      if (!drop.has('price') && c.price) {
        if (c.price.monthly && l.unit !== 'month') return false;
        if (!c.price.monthly && l.unit === 'month') return false;
        if (c.price.min && l.price < c.price.min) return false;
        if (c.price.max && l.price > c.price.max) return false;
      }
      if (!drop.has('am') && c.am.length) { const body = listingText(l); if (!c.am.every((x) => x.test(l, body))) return false; }
      return true;
    });
  }
  function sortFor(c: Criteria, xs: KListing[]) {
    const by = (f: (l: KListing) => number, dir = 1) => [...xs].sort((a, b) => dir * (f(a) - f(b)));
    switch (c.sort) {
      case 'cheap': return by((l) => l.price);
      case 'expensive': return by((l) => l.price, -1);
      case 'big': return by((l) => l.sqft, -1);
      case 'small': return by((l) => l.sqft);
      case 'new': return by((l) => l.year, -1);
      case 'old': return by((l) => l.year);
      case 'lot': return by((l) => l.lot ?? 0, -1);
      case 'beds': return by((l) => l.beds, -1);
      default: return [...xs].sort((a, b) => Number(b.featured) - Number(a.featured) || (a.unit ? 1 : 0) - (b.unit ? 1 : 0) || b.listed.localeCompare(a.listed));
    }
  }
  const describeCriteria = (c: Criteria) => {
    const parts: string[] = [];
    if (c.beds) parts.push(`${c.beds}+ bedrooms`);
    if (c.baths) parts.push(`${c.baths}+ bathrooms`);
    if (c.hood) parts.push(`in ${c.hood.plain}`);
    if (c.price) {
      const u = c.price.monthly ? ' a month' : '';
      if (c.price.min && c.price.max) parts.push(`${usd(c.price.min)} to ${usd(c.price.max)}${u}`);
      else if (c.price.max) parts.push(`up to ${usd(c.price.max)}${u}`);
      else if (c.price.min) parts.push(`from ${usd(c.price.min)}${u}`);
    }
    for (const a of c.am) parts.push(`with ${a.label}`);
    return parts.join(', ');
  }
  const listingsUrl = (c: Criteria) => {
    const q = new URLSearchParams();
    if (c.status) q.set('status', c.status);
    if (c.hood) q.set('hood', c.hood.slug);
    if (c.beds) q.set('beds', String(c.beds));
    const s = q.toString();
    return s ? `/listings/?${s}` : '/listings/';
  };

  function searchReply(text: string, s: Session): Reply {
    const c = criteriaFrom(text);
    if (c.hood) s.ctx.hood = c.hood.slug;
    if (c.status) s.ctx.topic = c.status === 'for-rent' ? 'rent' : 'buy';
    if (!hasCriteria(c)) {
      return {
        text: 'Happy to look. Tell me what matters, for example an area, a budget, bedrooms or a feature like a pool, and I\'ll search the homes on the site. Or start from one of these.',
        chips: [
          { label: 'Under $4M', send: 'Homes for sale under $4 million' },
          { label: '4+ bedrooms with a pool', send: '4 bedroom homes with a pool' },
          { label: 'Near the beach', send: 'Homes near the beach' },
          { label: 'Rentals', send: 'What rentals do you have?' },
          { label: 'Browse all', send: 'How many homes do you have?' },
        ],
        links: [{ label: 'Browse all listings', href: '/listings/' }],
        intent: 'search-prompt',
      };
    }
    let results = sortFor(c, runSearch(c));
    const what = describeCriteria(c);
    const noun = c.status === 'for-rent' ? 'leases' : c.status === 'for-sale' ? 'homes for sale' : 'homes';
    if (results.length && c.sort) {
      const top = results[0];
      const label: Record<NonNullable<Criteria['sort']>, string> = {
        cheap: 'The lowest-priced', expensive: 'The most expensive', big: 'The largest', small: 'The smallest',
        new: 'The newest', old: 'The oldest', lot: 'The one with the most land', beds: 'The one with the most bedrooms',
      };
      const kind = c.status === 'for-rent' ? 'lease' : c.status === 'for-sale' ? 'home for sale' : 'home';
      let extra = '';
      if (c.sort === 'cheap' || c.sort === 'expensive') {
        const withPending = sortFor(c, runSearch({ ...c, status: undefined, wantsPending: true }).filter((l) => !!l.unit === !!top.unit));
        const lead = withPending[0];
        if (lead && lead.id !== top.id && lead.status === 'pending') extra = ` ${lead.street} is ${c.sort === 'cheap' ? 'lower' : 'higher'} at ${lead.priceLabel}, but it's pending.`;
      }
      const detail = c.sort === 'big' ? `${num(top.sqft)} sq ft, ` : c.sort === 'lot' ? `${top.lot ?? 0} acres, ` : c.sort === 'new' || c.sort === 'old' ? `built ${top.year}, ` : '';
      return {
        text: `${label[c.sort]}${what ? ` ${what}` : ''} ${kind} is ${top.street}, ${detail}${top.priceLabel}.${extra}`.replace(/\s+/g, ' '),
        cards: [card(top)], links: [{ label: 'Browse all listings', href: listingsUrl(c) }],
        chips: [...withTour(top), { label: 'See more homes', send: 'How many homes do you have?' }], intent: 'search-top',
      };
    }
    if (results.length) {
      const shown = results.slice(0, 4);
      const more = results.length > shown.length ? ` Showing ${shown.length}; the rest are on the listings page.` : '';
      const mixed = !c.status && results.some((l) => l.unit) && results.some((l) => !l.unit) ? ' Lease prices are per month.' : '';
      const pend = !c.wantsPending ? runSearch({ ...c, wantsPending: true }).filter((l) => l.status === 'pending') : [];
      const pendNote = pend.length ? ` ${pend.map((l) => l.street).join(' and ')} also match${pend.length === 1 ? 'es' : ''} but ${pend.length === 1 ? 'is' : 'are'} pending.` : '';
      return {
        text: `${results.length === 1 ? 'One match' : `${results.length} matches`}${what ? ` (${what})` : ''}.${mixed}${more}${pendNote}`,
        cards: shown.map(card), links: [{ label: `See ${results.length > 4 ? 'all' : 'them'} on the listings page`, href: listingsUrl(c) }],
        chips: [{ label: 'Book a tour', send: 'Book a tour' }, { label: 'Refine my search', send: 'Help me find a home' }], intent: 'search',
      };
    }
    // Nothing matches: say so plainly, mention pending homes that do match, and offer the closest alternatives.
    const pend = runSearch({ ...c, wantsPending: true }).filter((l) => l.status === 'pending');
    const pendLine = pend.length
      ? `${joinList(pend.map((l) => l.street))} ${pend.length === 1 ? 'matches' : 'match'} that${what ? ` (${what})` : ''}, but ${pend.length === 1 ? 'it is' : 'they are'} pending, so tours have stopped. `
      : `Nothing matches all of that${what ? ` (${what})` : ''}. `;
    const onlyCustom = c.am.length > 0 && c.am.every((a) => a.key.startsWith('custom:')) && !c.hood && !c.price && !c.beds && !c.baths;
    if (onlyCustom && !pend.length) {
      return {
        text: `None of the homes on the site mention ${joinList(c.am.map((a) => a.label))}. The listings don't cover everything, so ${first(agentOf('julian-okafor'))}, ${first(agentOf('mara-ellison'))} or another agent may know of one, and about a third of the homes we sell never appear here. I can search by pool, views, guest house, garage and more, or set up a call.`,
        chips: [CAPS.call, CAPS.signup, { label: 'Homes with a pool', send: 'Homes with a pool' }], links: [{ label: 'Browse all listings', href: '/listings/' }], intent: 'search-none-feature',
      };
    }
    const tries: { label: string; c: Criteria; drop: Set<string> }[] = [];  // label completes "If I ..."
    if (c.am.length > 1) for (const a of c.am) tries.push({ label: `set aside ${a.label}`, c: { ...c, am: c.am.filter((x) => x !== a) }, drop: new Set() });
    if (c.am.length) tries.push({ label: c.am.length > 1 ? 'set aside the features' : `set aside ${c.am[0].label}`, c, drop: new Set(['am']) });
    if (c.beds) tries.push({ label: 'set aside the bedroom count', c, drop: new Set(['beds']) });
    if (c.price) tries.push({ label: 'set aside the price limit', c, drop: new Set(['price']) });
    if (c.hood) tries.push({ label: `look beyond ${c.hood.plain}`, c, drop: new Set(['hood']) });
    for (const t of tries) {
      const alt = sortFor(c, runSearch(t.c, t.drop));
      if (!alt.length) continue;
      const shown = alt.slice(0, 3);
      return {
        text: `${pendLine}If I ${t.label}, ${alt.length === 1 ? 'there is one home' : `there are ${alt.length} homes`}${alt.length > shown.length ? ` (here are ${shown.length})` : ''}:`,
        cards: shown.map(card), links: [{ label: 'Browse all listings', href: '/listings/' }],
        chips: [CAPS.signup, CAPS.call], intent: 'search-relaxed',
      };
    }
    return {
      text: `${pend.length ? pendLine : `I don't have any ${noun}${what ? ` ${what}` : ''} on the site right now. `}About a third of the homes we sell never appear on the site, so an agent may know of something. I can sign you up for private listings or set up a call.`,
      chips: [CAPS.signup, CAPS.call, { label: 'See all listings', send: 'How many homes do you have?' }], links: [{ label: 'Browse all listings', href: '/listings/' }], intent: 'search-empty',
    };
  }

  function similarReply(l: KListing): Reply {
    const score = (x: KListing) => (x.hood === l.hood ? 2 : 0) + (1 - Math.min(1, Math.abs(Math.log(x.price / l.price)))) + (1 - Math.min(1, Math.abs(x.beds - l.beds) / 3));
    const pool = k.listings.filter((x) => x.id !== l.id && x.status !== 'pending' && !!x.unit === !!l.unit).sort((a, b) => score(b) - score(a)).slice(0, 3);
    return {
      text: `Homes closest to ${l.street} in price, size and area:`,
      cards: pool.map(card), links: [{ label: 'Browse all listings', href: '/listings/' }],
      chips: [...pool.slice(0, 2).map((x) => ({ label: `Compare with ${x.street}`, send: `Compare ${l.street} and ${x.street}` })), CAPS.signup], intent: 'similar',
    };
  }

  function whichHome(): Reply {
    const pool = k.listings.filter((x) => x.featured && x.status !== 'pending').slice(0, 4);
    return { text: 'Which home do you mean? Tell me the address, or pick one.', chips: pool.map((x) => ({ label: x.street, send: `Tell me about ${x.street}` })), intent: 'which-home' };
  }

  function listingsOverview(): Reply {
    const sale = k.listings.filter((l) => l.status === 'for-sale');
    const rent = k.listings.filter((l) => l.status === 'for-rent');
    const pend = k.listings.filter((l) => l.status === 'pending');
    return {
      text: `There are ${k.listings.length} homes on the site right now: ${sale.length} for sale, ${rent.length} for lease and ${pend.length} pending. About a third of the homes we sell never appear here, so ask about private listings too.`,
      cards: sortFor({ am: [], wantsPending: false }, k.listings.filter((l) => l.featured && l.status !== 'pending')).slice(0, 3).map(card),
      links: [{ label: 'Browse all listings', href: '/listings/' }],
      chips: [{ label: 'Homes for sale', send: 'Show me homes for sale' }, { label: 'Rentals', send: 'What rentals do you have?' }, CAPS.signup], intent: 'overview',
    };
  }

  // --- neighborhoods
  function hoodProfile(h: KHood): Reply {
    const ags = agentsForHood(h.slug);
    const ls = k.listings.filter((l) => l.hood === h.slug);
    return {
      text: `**${h.plain}**: ${h.summary} ${h.body}\n\nMedian sale price ${usd(h.median)} and ${h.days} days on market (Q3 2026, single-family).${ags.length ? ` ${joinList(ags.map((a) => a.name))} ${ags.length === 1 ? 'is' : 'are'} our ${ags.length === 1 ? 'agent' : 'agents'} here.` : ''}${ls.length ? ` We have ${ls.length} ${ls.length === 1 ? 'home' : 'homes'} there at the moment.` : ''}`,
      links: [{ label: `${h.plain} guide`, href: h.url }],
      chips: [...(ls.length ? [{ label: `Homes in ${h.plain}`, send: `Show me homes in ${h.plain}` }] : []), ...(ags[0] ? [{ label: `Talk to ${first(ags[0])}`, send: `Book a call with ${ags[0].name}` }] : [])],
      intent: 'hood',
    };
  }
  function hoodStats(hs: KHood[]): Reply {
    if (hs.length >= 2) {
      const [a, b] = hs;
      const cheaper = a.median < b.median ? a : b;
      const quicker = a.days < b.days ? a : b.days < a.days ? b : null;
      return {
        text: `${a.plain}: median ${usd(a.median)}, ${a.days} days on market.\n${b.plain}: median ${usd(b.median)}, ${b.days} days on market.\n\n${cheaper.plain} is ${usd(Math.abs(a.median - b.median))} lower at the median${quicker ? `, and homes in ${quicker.plain} sell faster` : ''}. These are Q3 2026 single-family medians.`,
        links: [{ label: 'Neighborhood guide', href: '/neighborhoods/' }], chips: [{ label: `Tell me about ${a.plain}`, send: `Tell me about ${a.plain}` }, { label: `Tell me about ${b.plain}`, send: `Tell me about ${b.plain}` }], intent: 'hood-compare',
      };
    }
    const h = hs[0];
    const rank = [...k.hoods].sort((x, y) => y.median - x.median).findIndex((x) => x.slug === h.slug) + 1;
    return {
      text: `${h.plain}: median sale price ${usd(h.median)}, and homes take a median of ${h.days} days to sell (Q3 2026, single-family, from the Santa Barbara MLS). That's number ${rank} of ${k.hoods.length} by price among the areas we track.`,
      links: [{ label: `${h.plain} guide`, href: h.url }], chips: [{ label: `Tell me about ${h.plain}`, send: `Tell me about ${h.plain}` }, { label: `Homes in ${h.plain}`, send: `Show me homes in ${h.plain}` }], intent: 'hood-stats',
    };
  }
  function hoodRanking(t: string): Reply | null {
    const sorted = (f: (h: KHood) => number, dir = 1) => [...k.hoods].sort((a, b) => dir * (f(a) - f(b)));
    let list: KHood[]; let line: (h: KHood) => string; let head: string;
    if (/\b(most expensive|priciest|highest price|costliest|most pricey)\b/.test(t)) { list = sorted((h) => h.median, -1); head = `${list[0].plain} is the most expensive, with a median of ${usd(list[0].median)}.`; line = (h) => `${h.plain}: ${usd(h.median)}`; }
    else if (/\b(cheapest|least expensive|most affordable|lowest price|cheaper)\b/.test(t)) { list = sorted((h) => h.median); head = `${list[0].plain} has the lowest median price we publish, at ${usd(list[0].median)} (mostly condominiums and townhouses), followed by ${list[1].plain} at ${usd(list[1].median)}.`; line = (h) => `${h.plain}: ${usd(h.median)}`; }
    else if (/\b(fastest|quickest|sell fastest|shortest)\b/.test(t)) { list = sorted((h) => h.days); head = `Homes sell fastest in ${list[0].plain}, with a median of ${list[0].days} days on market. Slowest is ${list.at(-1)!.plain} at ${list.at(-1)!.days} days.`; line = (h) => `${h.plain}: ${h.days} days`; }
    else if (/\b(slowest|longest)\b/.test(t)) { list = sorted((h) => h.days, -1); head = `Homes take longest to sell in ${list[0].plain}, with a median of ${list[0].days} days on market.`; line = (h) => `${h.plain}: ${h.days} days`; }
    else return null;
    return { text: `${head}\n\nAll nine, in that order:\n${list.map((h) => `- ${line(h)}`).join('\n')}`, links: [{ label: 'Neighborhood guide', href: '/neighborhoods/' }], intent: 'hood-ranking' };
  }

  // --- agents
  function agentProfile(a: KAgent): Reply {
    const areas = joinList(a.areas.map((s) => hoodOf(s)?.plain ?? s));
    const ls = a.listingIds.map((id) => listingOf(id)).filter(Boolean) as KListing[];
    return {
      text: `**${a.name}**, ${a.title}. ${a.short}\n\nAreas: ${areas}. Languages: ${joinList(a.languages)}. ${a.years} years in the business, ${a.homes} homes sold, ${a.volume} in sales.\nTakes tours and calls ${daysWord(a.hours.days)}, ${hourWord(a.hours.start)} to ${hourWord(a.hours.end)} Pacific. Replies ${a.response}.\n${a.phone} · ${a.email}`,
      links: agentLinks(a), cards: ls.slice(0, 2).map(card),
      chips: [{ label: `Book a call with ${first(a)}`, send: `Book a call with ${a.name}` }, { label: `Message ${first(a)}`, send: `Message ${a.name}` }], intent: 'agent',
    };
  }
  function agentAttribute(a: KAgent, t: string): Reply | null {
    const chips: Chip[] = [{ label: `Book a call with ${first(a)}`, send: `Book a call with ${a.name}` }, { label: `Message ${first(a)}`, send: `Message ${a.name}` }];
    const out: string[] = [];
    if (/\b(phone|call|number|reach|contact|email|mail|get hold)\b/.test(t)) out.push(`${a.name}: ${a.phone}, ${a.email}. Replies ${a.response}.`);
    if (/\b(language|speak|spanish|french|hungarian|english)\b/.test(t)) out.push(`${a.name} speaks ${joinList(a.languages)}.`);
    if (/\b(hour|when|available|availability|schedule|days)\b/.test(t)) out.push(`${a.name} takes tours and calls ${daysWord(a.hours.days)}, ${hourWord(a.hours.start)} to ${hourWord(a.hours.end)} Pacific. Booking shows the open times.`);
    if (/\b(listing|listings|homes|selling|sells|properties)\b/.test(t) && !/\b(sold|how many|volume|sales)\b/.test(t)) {
      const ls = a.listingIds.map((id) => listingOf(id)).filter(Boolean) as KListing[];
      return { text: `${a.name}'s current listings:`, cards: ls.map(card), chips, intent: 'agent-listings' };
    }
    if (/\b(license|licence|dre|licensed)\b/.test(t)) out.push(`${a.name}'s license is ${a.license}.`);
    if (/\b(area|areas|cover|neighborhood|specialt|where)\b/.test(t)) out.push(`${a.name} covers ${joinList(a.areas.map((s) => hoodOf(s)?.plain ?? s))}.`);
    if (/\b(experience|years|sold|volume|sales|track)\b/.test(t)) out.push(`${a.name} has ${a.years} years in the business, ${a.homes} homes sold and ${a.volume} in sales.`);
    if (!out.length) return null;
    return { text: out.join('\n'), links: agentLinks(a), chips, intent: 'agent-attr' };
  }
  function routingReply(s: Session, text: string): Reply {
    const a = routeAgent(s, text);
    if (!a) {
      return {
        text: `Tell me a little more and I'll point you to the right person. Buyers usually start with Julian Okafor, sellers with Mara Ellison, and renters with Elena Varga. Or call the main office on ${k.brand.phone}.`,
        chips: [{ label: 'I want to buy', send: 'Who should I talk to about buying?' }, { label: 'I want to sell', send: 'Who should I talk to about selling?' }, { label: 'I want to rent', send: 'Who should I talk to about renting?' }], intent: 'route-ask',
      };
    }
    const hood = findHood(text);
    const topic = topicOf(text) ?? s.ctx.topic;
    const why = hood && a.areas.includes(hood.slug) ? ` ${first(a)} covers ${hood.plain}.` : topic === 'rent' ? ' Elena runs all of our leasing.' : topic === 'sell' ? ' Mara handles most of our estate listings and sellers.' : '';
    return {
      text: `${a.name} is the right person for that.${why}\n${a.phone} · ${a.email}`,
      links: agentLinks(a),
      chips: [{ label: `Book a call with ${first(a)}`, send: `Book a call with ${a.name}` }, { label: `Message ${first(a)}`, send: `Message ${a.name}` }], intent: 'route',
    };
  }

  // --- hours
  function hoursReply(): Reply {
    const t = todayIn(tz);
    const minutes = t.h * 60 + t.min;
    const openNow = minutes >= officeHours.start * 60 && minutes < officeHours.end * 60;
    const clock = fmt(now(), tz, { hour: 'numeric', minute: '2-digit' }).toLowerCase();
    const state = openNow ? `It's ${clock} in Santa Barbara, so the office is open now` : `It's ${clock} in Santa Barbara, so the office is closed right now`;
    return {
      text: `${state}. Our hours are ${k.brand.hours.toLowerCase().replace(/^open/, 'open')} (Pacific time). Agents take tours and calls on their own hours, which you'll see when you book. ${openNow ? '' : 'You can still book a tour or leave a message here, and an agent replies when they are in.'}`.replace(/\s+/g, ' '),
      links: [{ label: 'Call the office', href: `tel:${k.brand.phone.replace(/\D/g, '')}` }], chips: [CAPS.tour, CAPS.message], intent: 'hours',
    };
  }

  // --- compare
  function compareReply(ls: KListing[]): Reply {
    const [a, b] = ls;
    const diff = Math.abs(a.price - b.price);
    const same = !!a.unit === !!b.unit;
    const row = (l: KListing) => `**${l.street}**: ${l.priceLabel}, ${l.beds} bd, ${baths(l.baths)} ba, ${num(l.sqft)} sq ft${l.lot ? `, ${l.lot} acres` : ''}, built ${l.year}, ${l.hoodName.replace(/^The /, '')}, ${l.statusLabel.toLowerCase()}.`;
    const cmp = same ? `${(a.price > b.price ? a : b).street} is ${usd(diff)}${a.unit ? ' a month' : ''} more. ` : '';
    const size = a.sqft !== b.sqft ? `${(a.sqft > b.sqft ? a : b).street} is larger by ${num(Math.abs(a.sqft - b.sqft))} sq ft.` : '';
    return { text: `${row(a)}\n${row(b)}\n\n${cmp}${size}`.trim(), cards: [card(a), card(b)], chips: [a, b].filter(bookable).map((x) => ({ label: `Tour ${x.street}`, send: `Book a tour of ${x.street}` })), intent: 'compare' };
  }

  // ---------- FAQ ----------

  const ESCALATE = new Set(['offer', 'mortgage', 'closing', 'taxes', 'commission', 'lease-apply', 'sold-history', 'market-forecast', 'hr-schools', 'thanks-human', 'buy-and-sell', 'first-time', 'outside-hours']);
  function faqAnswer(f: KFaq): Reply {
    const chips: Chip[] = [...capChips(f.actions), ...f.chips.map((c) => ({ label: c }))];
    return { text: f.a, links: f.links, chips: chips.slice(0, 5), intent: `faq:${f.id}` };
  }
  function glossaryReply(text: string): Reply | null {
    const t = clean(text);
    if (!/\b(what is|what's|what does|what are|define|meaning of|explain|mean)\b/.test(t)) return null;
    const hit = k.glossary.filter((g) => g.terms.some((term) => new RegExp(`\\b${clean(term)}\\b`).test(t)));
    if (!hit.length) return null;
    hit.sort((a, b) => Math.max(...b.terms.map((x) => x.length)) - Math.max(...a.terms.map((x) => x.length)));
    return { text: hit[0].text, intent: 'glossary' };
  }

  // ---------- small talk & guardrails ----------

  function smallTalk(text: string): Reply | null {
    const t = clean(text);
    if (/^(hi|hello|hey|hiya|howdy|yo|greetings|good (morning|afternoon|evening)|hi there|hello there|hey there)\b[\s!.]*$/.test(t) || /^(hi|hello|hey)[ ,]+(there|team|halden|assistant|bot)\b/.test(t)) {
      return { text: 'Hello. What can I help you with: finding a home, a question about the firm, or booking a tour or a call?', chips: k.starters.slice(0, 5).map((x) => ({ label: x.label, send: x.send })), intent: 'greet' };
    }
    if (/^(how are you|how's it going|how are things|how do you do|what's up|whats up|sup)\b/.test(t)) {
      return { text: 'Doing well, thanks for asking. What can I help you find today?', chips: k.starters.slice(0, 4).map((x) => ({ label: x.label, send: x.send })), intent: 'smalltalk' };
    }
    if (/^(thanks|thank you|thx|ty|cheers|much appreciated|appreciate it|great thanks|ok thanks|okay thanks|perfect thanks|thanks a lot|thank you so much)\b/.test(t)) {
      return { text: "You're welcome. Is there anything else I can help with?", chips: [{ label: 'Find a home', send: 'Help me find a home' }, CAPS.call], intent: 'thanks' };
    }
    if (/^(bye|goodbye|see you|see ya|that's all|thats all|that is all|i'm done|im done|nothing else|no that's it|no thats it|have a good one|talk later|good night)\b/.test(t)) {
      return { text: `Thanks for stopping by. If anything comes up, ${k.brand.name} is on ${k.brand.phone}, and I'm here whenever you need me.`, intent: 'bye' };
    }
    if (/^(who|what) (are|r) (you|u)\b|^who is this\b|^what is this( chat| bot| thing)?$|^(introduce yourself|your name|what('s| is) your name|who am i (talking|speaking|chatting) (to|with))\b/.test(t)) return faqAnswer(faqById('bot'));
    if (/^(help|menu|options|what can you do|what do you do|what can i ask|how can you help|how can you help me|what can i ask you|what are you able to do|capabilities|commands|can you help me|can you help|i need help|help me|need help)[\s?.!]*$/.test(t)) {
      return {
        text: 'I can:\n- find homes by area, price, bedrooms or features\n- tell you about any listing, neighborhood or agent\n- book a tour or a call with an agent\n- take a message for an agent\n- explain how buying, selling and leasing work with us\n\nI can\'t give legal, tax or mortgage advice, or negotiate; an agent can help with those.',
        chips: k.starters.map((x) => ({ label: x.label, send: x.send })).slice(0, 6), intent: 'help',
      };
    }
    if (/\b(hola|buenas|buenos dias|buenas tardes|gracias|quiero|necesito|comprar|vender|alquilar|casa|bonjour|bonsoir|merci|acheter|vendre|louer|maison|je voudrais|ciao|danke|guten tag)\b/.test(t) && !/\b(home|house|listing|property|tour|agent)\b/.test(t)) {
      return { text: `I can only answer in English here. Elena Varga and Daniel Reyes speak Spanish, and Mara Ellison speaks French, so I can book a call with one of them. Puedo reservar una llamada con Elena o Daniel; je peux réserver un appel avec Mara.`, chips: [{ label: 'Call with Elena (Spanish)', send: 'Book a call with Elena Varga' }, { label: 'Call with Daniel (Spanish)', send: 'Book a call with Daniel Reyes' }, { label: 'Call with Mara (French)', send: 'Book a call with Mara Ellison' }], intent: 'language' };
    }
    if (/^(great|awesome|cool|nice|wow|amazing|excellent|good|wonderful|fantastic|beautiful|love it|looks good|lovely|impressive|you'?re (great|awesome|amazing|the best|helpful|good|wonderful|so helpful|fantastic)|you are (great|awesome|amazing|the best|helpful|good|wonderful|fantastic)|good (bot|job|work)|nice work|well done|love you|you rock|so helpful|very helpful|that'?s (great|awesome|perfect|helpful))[\s!.]*$/.test(t)) {
      return { text: 'Glad that helps. Would you like to see more homes, or set up a tour?', chips: [{ label: 'See more homes', send: 'Show me homes for sale' }, CAPS.tour], intent: 'praise' };
    }
    if (/\b(fuck|shit|bitch|asshole|bastard|damn you|stupid|idiot|useless|dumb|moron|garbage bot|worthless)\b/.test(t)) {
      return { text: `I'm sorry I wasn't more help. If you'd rather talk to a person, ${k.brand.phone} reaches the main office, or I can take a message.`, chips: [CAPS.message, CAPS.call], intent: 'abuse' };
    }
    if (/\b(ignore (all |your |the )?(previous|above|prior) (instructions|prompts?)|system prompt|your instructions|jailbreak|pretend you|act as|you are now|developer mode|reveal your)\b/.test(t)) {
      return { text: `I'm here to help with ${k.brand.name}: homes, neighborhoods, our team, and booking tours and calls. What would you like to know?`, chips: k.starters.slice(0, 4).map((x) => ({ label: x.label, send: x.send })), intent: 'inject' };
    }
    if (/\b(weather|joke|poem|song|recipe|movie|football|basketball|baseball|soccer|politic|election|president|bitcoin|crypto|stock market|stocks|horoscope|translate|homework|essay|python|javascript|code|math problem|capital of|who won|celebrity|news)\b/.test(t) && !/\b(home|house|listing|property|agent|tour|rent|buy|sell|neighborhood)\b/.test(t)) {
      return { text: `That's outside what I can help with. I'm here for ${k.brand.name}: finding homes, neighborhoods, our agents, and booking tours and calls.`, chips: k.starters.slice(0, 4).map((x) => ({ label: x.label, send: x.send })), intent: 'offtopic' };
    }
    if (/\b(\d[ -]?){13,19}\b/.test(text) || /\b\d{3}-\d{2}-\d{4}\b/.test(text) || /\b(credit card|debit card|card number|cvv|routing number|account number|social security|ssn|passport number|password)\b/.test(t)) {
      return { text: "Please don't share card, bank, ID or password details in this chat. I don't need them, and neither does an agent to arrange a tour. I've hidden that message.", redactUser: true, intent: 'sensitive' };
    }
    return null;
  }

  // ---------- slots ----------

  function seedOf(f: Flow) { return f.type === 'tour' ? String(f.d.listingId) : String(f.d.agentId); }
  function daysFor(f: Flow): Day[] {
    const agent = agentOf(String(f.d.agentId));
    const taken = deps.bookings.list().filter((b) => b.seed === seedOf(f)).map((b) => b.slot);
    return buildDays({ seed: seedOf(f), tz, daysAhead: k.brand.daysAhead, stepMinutes: f.type === 'tour' ? 60 : 30, hours: agent.hours, taken });
  }
  const dayChip = (d: Day): Chip => ({ label: relativeDay(d.date, tz) === 'today' ? 'Today' : relativeDay(d.date, tz) === 'tomorrow' ? 'Tomorrow' : fmt(d.date, tz, { weekday: 'short', month: 'short', day: 'numeric' }), send: dayLabel(d.date, tz) });
  const slotChip = (d: Date, withDay: boolean): Chip => ({ label: withDay ? `${fmt(d, tz, { weekday: 'short' })} ${timeLabel(d, tz)}` : timeLabel(d, tz), send: `${dayLabel(d, tz)} at ${timeLabel(d, tz)}` });
  const whenText = (d: Date) => `${dayLabel(d, tz)} at ${timeLabel(d, tz)}`;
  const whenShort = (d: Date) => `${fmt(d, tz, { weekday: 'short' })}, ${fmt(d, tz, { month: 'short', day: 'numeric' })} at ${timeLabel(d, tz)}`;
  const matchTime = (slot: Date, h: WhenHint) => {
    const m = mins(slot, tz);
    if (h.hour !== undefined) return m === h.hour * 60 + (h.minute ?? 0);
    if (h.part) { const [a, b] = partRange(h.part); return m >= a * 60 && m < b * 60; }
    return true;
  };
  const fmtPart = (h: WhenHint) => (h.part ? ` in the ${h.part}` : h.hour !== undefined ? ` at ${hourWord(h.hour)}${h.minute ? `:${String(h.minute).padStart(2, '0')}` : ''}`.replace(/(\d+) (am|pm)$/, '$1 $2') : '');

  function offerSlots(f: Flow, hint: WhenHint | null): Reply {
    const agent = agentOf(String(f.d.agentId));
    const days = daysFor(f);
    const open = days.filter((d) => d.slots.length);
    const cancelChip: Chip = { label: 'Cancel', send: 'cancel' };
    f.step = 'slot';
    if (!open.length) {
      return { text: `${first(agent)} has no open times in the next ${k.brand.daysAhead} days. I can take a message instead, or you can call ${agent.phone}.`, chips: [CAPS.message, cancelChip], intent: 'slot-none' };
    }
    if (hint?.dates?.length) {
      const wanted = days.filter((d) => hint.dates!.some((c) => dateKey(c) === d.key));
      if (!wanted.length) {
        const last = days.at(-1)!;
        return { text: `I can book up to ${k.brand.daysAhead} days ahead, through ${dayLabel(last.date, tz)}. Which day within that works?`, chips: [...open.slice(0, 4).map(dayChip), cancelChip], intent: 'slot-range' };
      }
      const matches = wanted.flatMap((d) => d.slots.filter((s) => matchTime(s, hint)));
      if (hint.hour !== undefined && matches.length === 1) return pickSlot(f, matches[0]);
      if (matches.length) {
        const single = wanted.length === 1;
        const head = single ? `Open times on ${dayLabel(wanted[0].date, tz)}${fmtPart({ ...hint, hour: undefined })}:` : 'Open times:';
        return { text: `${head} choose one, or tell me another day.`, chips: [...matches.slice(0, 8).map((s) => slotChip(s, !single)), cancelChip], intent: 'slot-offer' };
      }
      const wd = wanted[0];
      const reason = wd.closed ? `${first(agent)} doesn't take ${f.type === 'tour' ? 'tours' : 'calls'} on ${fmt(wd.date, tz, { weekday: 'long' })}s (${daysWord(agent.hours.days)}).` : wd.slots.length === 0 ? `There are no open times on ${dayLabel(wd.date, tz)}.` : `That time isn't open on ${dayLabel(wd.date, tz)}. Open then: ${wd.slots.map((s) => timeLabel(s, tz)).join(', ')}.`;
      const alt = wd.slots.length && !wd.closed ? wd.slots.slice(0, 6).map((s) => slotChip(s, false)) : open.slice(0, 5).map(dayChip);
      return { text: `${reason}${wd.slots.length && !wd.closed ? '' : ' These days have open times:'}`, chips: [...alt, cancelChip], intent: 'slot-unavailable' };
    }
    if (hint && (hint.hour !== undefined || hint.part)) {
      const found = open.flatMap((d) => d.slots.filter((s) => matchTime(s, hint))).slice(0, 8);
      if (found.length) return { text: `Here are the next open times${fmtPart(hint)}:`, chips: [...found.map((s) => slotChip(s, true)), cancelChip], intent: 'slot-by-time' };
    }
    const soonest = open[0].slots[0];
    return {
      text: `The soonest open time for ${f.type === 'tour' ? `a tour of ${listingOf(String(f.d.listingId))!.street}` : 'a call'} with ${first(agent)} is ${whenText(soonest)}. Pick a day below, or tell me what suits you, like "Friday afternoon".`,
      chips: [{ ...slotChip(soonest, true), label: `Soonest: ${fmt(soonest, tz, { weekday: 'short' })} ${timeLabel(soonest, tz)}` }, ...open.slice(0, 5).map(dayChip), cancelChip], intent: 'slot-days',
    };
  }

  function pickSlot(f: Flow, slot: Date): Reply {
    f.d.slot = slot.toISOString();
    const agent = agentOf(String(f.d.agentId));
    f.step = 'kind';
    const opts = f.type === 'tour'
      ? [{ label: 'In person', send: 'In person' }, { label: 'Live video walkthrough', send: 'Live video walkthrough' }]
      : [{ label: 'Phone call', send: 'Phone call' }, { label: 'Video call', send: 'Video call' }];
    return { text: `${whenText(slot)} is open with ${first(agent)}. ${f.type === 'tour' ? 'Would you like to tour in person, or by live video?' : 'Phone or video?'}`, chips: [...opts, { label: 'Change the time', send: 'Change the time' }], intent: 'slot-picked' };
  }

  // ---------- flow engine ----------

  const FLOW_CHIPS_CANCEL: Chip = { label: 'Cancel', send: 'cancel' };

  function startBooking(type: 'tour' | 'call', s: Session, text: string, seed?: { listingId?: string; agentId?: string }): Reply[] {
    const hint = parseWhen(text, tz);
    const flow: Flow = { type, step: type === 'tour' ? 'listing' : 'agent', d: { hint } };
    s.flow = flow;
    if (type === 'tour') {
      const l = (seed?.listingId ? listingOf(seed.listingId) : null) ?? findListing(text) ?? listingOf(s.ctx.listingId);
      if (l) return chooseListing(flow, s, l);
      const options = k.listings.filter(bookable).slice(0, 6);
      return [{ text: 'Which home would you like to tour? Pick one, or tell me the address.', chips: [...options.map((l) => ({ label: l.street, send: l.street })), FLOW_CHIPS_CANCEL], intent: 'tour-which' }];
    }
    const a = (seed?.agentId ? agentOf(seed.agentId) : null) ?? routeAgent(s, text);
    if (a) return chooseAgent(flow, s, a);
    return [{ text: 'Who would you like to speak with?', chips: [...k.agents.map((a) => ({ label: `${a.name}`, send: a.name })), { label: 'Not sure', send: 'Not sure who' }, FLOW_CHIPS_CANCEL], intent: 'call-which' }];
  }
  function chooseListing(f: Flow, s: Session, l: KListing): Reply[] {
    s.ctx.listingId = l.id;
    if (!bookable(l)) {
      f.step = 'listing';
      const alts = k.listings.filter((x) => x.hood === l.hood && bookable(x));
      const pool = (alts.length ? alts : k.listings.filter((x) => bookable(x) && !x.unit === !l.unit)).slice(0, 3);
      return [{ text: `${l.street} is pending, in escrow with a buyer, so tours have stopped. ${agentOf(l.agentId).first} can tell you about similar homes, including ones not yet listed. Would you like to tour one of these instead?`, cards: pool.map(card), chips: [...pool.map((x) => ({ label: x.street, send: `Book a tour of ${x.street}` })), FLOW_CHIPS_CANCEL], intent: 'tour-pending' }];
    }
    f.d.listingId = l.id;
    f.d.agentId = l.agentId;
    const a = agentOf(l.agentId);
    const intro: Reply = { text: `${l.street} with ${a.name}, its listing agent. A tour takes ${k.brand.tourMinutes} minutes.`, cards: [card(l)], intent: 'tour-listing' };
    return [intro, offerSlots(f, (f.d.hint as WhenHint | null) ?? null)];
  }
  function chooseAgent(f: Flow, s: Session, a: KAgent): Reply[] {
    s.ctx.agentId = a.id;
    f.d.agentId = a.id;
    return [{ text: `A call with ${a.name}, ${a.title}, takes about ${k.brand.callMinutes} minutes.`, intent: 'call-agent' }, offerSlots(f, (f.d.hint as WhenHint | null) ?? null)];
  }

  function profileOffer(f: Flow): Reply | null {
    const p = deps.profile.get();
    if (p.name && p.email && p.phone && !f.d.offeredProfile) {
      f.d.offeredProfile = true;
      f.step = 'profile';
      return { text: `I have these details saved on this device:\n${p.name}\n${p.email}\n${p.phone}\n\nShall I use them?`, chips: [{ label: 'Use these', send: 'Use these details' }, { label: 'Use different details', send: 'Use different details' }, FLOW_CHIPS_CANCEL], intent: 'profile-offer' };
    }
    return null;
  }

  function absorbContact(f: Flow, text: string) {
    const c = (f.d.contact ??= {}) as Record<string, string>;
    const email = findEmail(text);
    if (email) c.email = email;
    const phone = findPhone(text);
    if (phone && !rules.phone(phone, null as never)) c.phone = deps.formatPhone(phone);
    const named = /\b(my name is|my name's|name is|i am|i'm|this is|call me|it's|its)\b/i.test(text) || f.step === 'name';
    if (named && !c.name) { const n = findName(text); if (n && !rules.name(n, null as never)) c.name = n; }
  }
  function nextContactStep(f: Flow): Reply {
    const c = (f.d.contact ??= {}) as Record<string, string>;
    const type = f.type;
    const who = type === 'message' ? '' : '';
    if (type === 'message') {
      if (!c.name) { f.step = 'name'; return { text: 'What name should I put on it?', chips: [FLOW_CHIPS_CANCEL], intent: 'ask-name' }; }
      if (!f.d.replyBy) { f.step = 'replyBy'; return { text: 'How would you like a reply?', chips: [{ label: 'Email', send: 'By email' }, { label: 'Phone call', send: 'By phone call' }, { label: 'Text message', send: 'By text message' }, FLOW_CHIPS_CANCEL], intent: 'ask-replyby' }; }
      if (f.d.replyBy === 'email' && !c.email) { f.step = 'email'; return { text: 'What email address should they reply to?', chips: [FLOW_CHIPS_CANCEL], intent: 'ask-email' }; }
      if (f.d.replyBy !== 'email' && !c.phone) { f.step = 'phone'; return { text: `What's the best number to ${f.d.replyBy === 'text' ? 'text' : 'call'}? Include the area code.`, chips: [FLOW_CHIPS_CANCEL], intent: 'ask-phone' }; }
      return reviewReply(f);
    }
    if (!c.name) { f.step = 'name'; return { text: `${who}What name should the booking be under?`, chips: [FLOW_CHIPS_CANCEL], intent: 'ask-name' }; }
    if (!c.email) { f.step = 'email'; return { text: `Thanks, ${c.name.split(' ')[0]}. What's your email address?`, chips: [FLOW_CHIPS_CANCEL], intent: 'ask-email' }; }
    if (!c.phone) { f.step = 'phone'; return { text: 'And a mobile number, with the area code, in case the agent needs to reach you on the day?', chips: [FLOW_CHIPS_CANCEL], intent: 'ask-phone' }; }
    if (!c.confirmBy) { f.step = 'confirmBy'; return { text: 'How should the agent confirm with you?', chips: [{ label: 'Text me', send: 'Text me' }, { label: 'Email me', send: 'Email me' }, FLOW_CHIPS_CANCEL], intent: 'ask-confirmby' }; }
    return reviewReply(f);
  }

  function reviewReply(f: Flow): Reply {
    f.step = 'review';
    const c = f.d.contact as Record<string, string>;
    if (f.type === 'tour' || f.type === 'call') {
      const a = agentOf(String(f.d.agentId));
      const slot = new Date(String(f.d.slot));
      const facts: [string, string][] = f.type === 'tour'
        ? [['Home', listingOf(String(f.d.listingId))!.street], ['With', a.name], ['When', whenShort(slot)], ['How', f.d.kind === 'video' ? 'Live video' : 'In person'], ['Name', c.name], ['Email', c.email], ['Phone', c.phone], ['Confirm by', c.confirmBy === 'text' ? 'Text' : 'Email']]
        : [['With', a.name], ['When', whenShort(slot)], ['How', f.d.kind === 'video' ? 'Video call' : 'Phone call'], ['Name', c.name], ['Email', c.email], ['Phone', c.phone], ['Confirm by', c.confirmBy === 'text' ? 'Text' : 'Email']];
      return { text: `Here's what I have. Shall I book it?`, facts, chips: [{ label: 'Confirm booking', send: 'Confirm booking' }, { label: 'Change the time', send: 'Change the time' }, FLOW_CHIPS_CANCEL], intent: 'review' };
    }
    if (f.type === 'message') {
      const a = f.d.agentId ? agentOf(String(f.d.agentId)) : null;
      const via = f.d.replyBy === 'email' ? c.email : c.phone;
      return { text: 'Here is your message. Shall I send it?', facts: [['To', a ? a.name : `${k.brand.name} main office`], ['Message', String(f.d.message)], ['From', c.name], [f.d.replyBy === 'email' ? 'Reply by email' : f.d.replyBy === 'text' ? 'Reply by text' : 'Reply by call', via]], chips: [{ label: 'Send it', send: 'Send it' }, { label: 'Edit my message', send: 'Edit my message' }, FLOW_CHIPS_CANCEL], intent: 'review' };
    }
    return { text: 'Shall I sign you up?', facts: [['Email', c.email], ['Area', f.d.area === 'any' ? 'Anywhere we work' : hoodOf(String(f.d.area))?.plain ?? '']], chips: [{ label: 'Sign me up', send: 'Sign me up' }, FLOW_CHIPS_CANCEL], intent: 'review' };
  }

  function icsFor(b: ChatBooking, title: string, where: string, body: string) {
    const start = new Date(b.slot);
    const end = new Date(start.getTime() + (b.mode === 'tour' ? k.brand.tourMinutes : k.brand.callMinutes) * 60000);
    const stamp = (x: Date) => x.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${k.brand.name}//Chat//EN`, 'BEGIN:VEVENT', `UID:${b.ref}@${b.mode}`, `DTSTAMP:${stamp(now())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${title}`, `LOCATION:${where}`, `DESCRIPTION:${body} Reference ${b.ref}.`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  }

  async function submitFlow(f: Flow, s: Session): Promise<Reply[]> {
    const c = f.d.contact as Record<string, string>;
    try {
      if (f.type === 'tour' || f.type === 'call') {
        const a = agentOf(String(f.d.agentId));
        const l = f.type === 'tour' ? listingOf(String(f.d.listingId))! : null;
        const ref = rid(f.type === 'tour' ? 'T' : 'C');
        await deps.submitLead({
          type: f.type === 'tour' ? 'tour_booking' : 'agent_call', listingId: l?.id ?? null, agentId: a.id, slot: f.d.slot,
          durationMinutes: f.type === 'tour' ? k.brand.tourMinutes : k.brand.callMinutes, kind: f.d.kind,
          contact: { name: c.name, email: c.email, phone: c.phone, confirmBy: c.confirmBy }, notes: '', ref, channel: 'chat',
        });
        deps.profile.save({ name: c.name, email: c.email, phone: c.phone });
        const slot = new Date(String(f.d.slot));
        const b: ChatBooking = { ref, mode: f.type, slot: String(f.d.slot), kind: String(f.d.kind), agentId: a.id, listingId: l?.id ?? null, place: l?.street ?? null, seed: seedOf(f) };
        deps.bookings.add(b);
        deps.track(f.type === 'tour' ? 'tour_booked' : 'call_booked', { listing: l?.id ?? null, agent: a.id, kind: f.d.kind, via: 'chat' });
        s.flow = null;
        const via = c.confirmBy === 'text' ? `text ${c.phone}` : `email ${c.email}`;
        const body = f.type === 'tour'
          ? (f.d.kind === 'video'
            ? `${a.first} will ${via} with a video link within 15 minutes, then call you from the house at ${timeLabel(slot, tz)}. Allow ${k.brand.tourMinutes} minutes.`
            : `${a.first} will ${via} to confirm within 15 minutes and meet you at the front door of ${l!.street}. Allow ${k.brand.tourMinutes} minutes, and bring any questions about the house.`)
          : (f.d.kind === 'video'
            ? `${a.first} will ${via} with a video link within 15 minutes. The call takes about ${k.brand.callMinutes} minutes.`
            : `${a.first} will ${via} to confirm within 15 minutes, then call ${c.phone} at ${timeLabel(slot, tz)}. The call takes about ${k.brand.callMinutes} minutes.`);
        const title = f.type === 'tour' ? `Tour of ${l!.street} with ${a.name}` : `Call with ${a.name}, ${k.brand.name}`;
        return [{
          text: `You're booked for ${whenText(slot)}.\n${body}\nYour reference is **${ref}**.`, tone: 'success',
          note: 'Demo booking: nothing was added to a real calendar.',
          ics: { filename: `${f.type}-${ref}.ics`, content: icsFor(b, title, f.type === 'tour' && f.d.kind !== 'video' ? l!.address : '', body) },
          chips: [{ label: 'Cancel this booking', send: 'Cancel my booking' }, ...(f.type === 'tour' ? [{ label: 'Book another tour', send: 'Book a tour' }] : []), { label: 'Find more homes', send: 'Help me find a home' }], intent: 'booked',
        }];
      }
      if (f.type === 'message') {
        const a = f.d.agentId ? agentOf(String(f.d.agentId)) : null;
        const ref = rid('Q');
        await deps.submitLead({
          type: 'inquiry', topic: String(f.d.topic ?? 'listing'), listingId: f.d.listingId ?? null, agentId: a?.id ?? null,
          contact: { name: c.name, replyBy: f.d.replyBy, ...(f.d.replyBy === 'email' ? { email: c.email } : { phone: c.phone }) }, message: f.d.message, ref, channel: 'chat',
        });
        deps.profile.save({ name: c.name, ...(f.d.replyBy === 'email' ? { email: c.email } : { phone: c.phone }) });
        deps.track('inquiry_submitted', { topic: f.d.topic, agent: a?.id, via: 'chat' });
        s.flow = null;
        const hours = a?.hours ?? { start: officeHours.start, end: officeHours.end, days: [0, 1, 2, 3, 4, 5, 6] };
        const by = replyBy(a ? (a.response.includes('1 business hour') ? 60 : k.brand.responseMinutes) : k.brand.responseMinutes, hours, tz);
        const who = a ? a.first : 'The office';
        return [{
          text: `Sent. ${who} will reply ${by}, by ${f.d.replyBy === 'email' ? `email to ${c.email}` : f.d.replyBy === 'text' ? `text to ${c.phone}` : `phone on ${c.phone}`}. Your reference is **${ref}**.`, tone: 'success',
          note: 'Demo message: nothing was delivered to a real inbox.',
          chips: [{ label: 'Find a home', send: 'Help me find a home' }, CAPS.tour], intent: 'message-sent',
        }];
      }
      await deps.submitLead({ type: 'private_listings', contact: { email: c.email }, area: f.d.area ?? 'any', channel: 'chat' });
      deps.profile.save({ email: c.email });
      deps.track('private_listings_signup', { area: f.d.area, via: 'chat' });
      s.flow = null;
      return [{ text: `You're on the list. We'll email ${c.email} one or two times a month, and each email names the agent handling the home, so you can reply to them directly. Every email has an unsubscribe link.`, tone: 'success', note: 'Demo signup: nothing was stored.', chips: [{ label: 'Find a home', send: 'Help me find a home' }, CAPS.call], intent: 'signup-done' }];
    } catch (err) {
      if (err instanceof deps.FieldError) {
        const field = (err as { field: string }).field;
        if (field === 'email') { const cc = f.d.contact as Record<string, string>; delete cc.email; f.step = 'email'; }
        return [{ text: `That didn't go through: ${(err as Error).message} Enter the email address again, and everything else is kept.`, tone: 'error', chips: [FLOW_CHIPS_CANCEL], intent: 'submit-fielderror' }];
      }
      const a = f.d.agentId ? agentOf(String(f.d.agentId)) : null;
      return [{ text: `That didn't send because the connection dropped. Your details are still here. Try again, or ${a ? `call ${a.first} on ${a.phone}` : `call us on ${k.brand.phone}`}.`, tone: 'error', chips: [{ label: 'Try again', send: f.type === 'message' ? 'Send it' : f.type === 'signup' ? 'Sign me up' : 'Confirm booking' }, FLOW_CHIPS_CANCEL], intent: 'submit-error' }];
    }
  }

  // Parses the visitor's answer for the current step. Returns replies, or null if the text isn't an answer.
  async function stepFlow(f: Flow, text: string, s: Session): Promise<Reply[] | null> {
    if (!['name', 'email', 'phone', 'message', 'signupEmail', 'agentPick'].includes(f.step)) text = autocorrect(text);
    const t = clean(text);
    const c = (f.d.contact ??= {}) as Record<string, string>;
    // A new day or time typed after the slot was picked changes the slot.
    if ((f.type === 'tour' || f.type === 'call') && ['kind', 'profile', 'name', 'email', 'phone', 'confirmBy', 'review'].includes(f.step) && !findEmail(text) && !findPhone(text)) {
      const hint = parseWhen(text, tz);
      if (hint && (hint.dates || hint.hour !== undefined || hint.part)) { delete f.d.slot; f.d.hint = hint; return [offerSlots(f, hint)]; }
    }
    // Anything can be corrected from the review screen.
    if (/\b(change|different|another|edit|redo|wrong|reschedule)\b.*\b(time|day|date|slot)\b|^change the time$|^another time$/.test(t) && (f.type === 'tour' || f.type === 'call')) { delete f.d.slot; delete f.d.hint; return [offerSlots(f, null)]; }
    switch (f.step) {
      case 'listing': {
        const l = findListing(text);
        if (l) return chooseListing(f, s, l);
        const h = findHood(text);
        if (h) { const ls = k.listings.filter((x) => x.hood === h.slug && bookable(x)); if (ls.length === 1) return chooseListing(f, s, ls[0]); if (ls.length) return [{ text: `In ${h.plain} you can tour:`, cards: ls.map(card), chips: [...ls.map((x) => ({ label: x.street, send: x.street })), FLOW_CHIPS_CANCEL], intent: 'tour-which' }]; }
        return null;
      }
      case 'agent': {
        const a = findAgent(text) ?? (/not sure|don't know|dont know|anyone|whoever|any agent|doesn't matter/.test(t) ? routeAgent(s, text) ?? agentOf('julian-okafor') : null);
        if (a) return chooseAgent(f, s, a);
        return null;
      }
      case 'slot': {
        const hint = parseWhen(text, tz);
        if (!hint) return null;
        const merged: WhenHint = { ...(f.d.hint as WhenHint | null ?? {}), ...hint };
        // A new day replaces an old one; a bare time keeps the day already chosen.
        if (hint.dates) merged.dates = hint.dates; else if (!hint.anyDay && (f.d.hint as WhenHint | null)?.dates) merged.dates = (f.d.hint as WhenHint).dates;
        if (hint.dates && hint.hour === undefined && !hint.part) { delete merged.hour; delete merged.minute; delete merged.part; }
        f.d.hint = merged;
        return [offerSlots(f, merged)];
      }
      case 'kind': {
        let kind: string | null = null;
        if (/video|virtual|remote|zoom|facetime|online|screen/.test(t)) kind = 'video';
        else if (f.type === 'tour' && /person|visit|house|there|on site|onsite|meet|physically|myself/.test(t)) kind = 'in-person';
        else if (f.type === 'call' && /phone|call|voice|ring|audio|regular/.test(t)) kind = 'phone';
        if (!kind) return null;
        f.d.kind = kind;
        return afterKind(f);
      }
      case 'profile': {
        if (isYes(text) || /use (these|them|saved)|these details|that's right|correct/.test(t)) { const p = deps.profile.get(); Object.assign(c, { name: p.name, email: p.email, phone: p.phone }); return [nextContactStep(f)]; }
        if (isNo(text) || /different|new details|someone else|other/.test(t)) return [nextContactStep(f)];
        return null;
      }
      case 'name': case 'email': case 'phone': {
        if (isQuestion(text) && !findEmail(text) && !findPhone(text)) return null;
        absorbContact(f, text);
        if (f.step === 'email' && !c.email) { const bad = text.trim(); return [{ text: `That doesn't look like an email address${bad.length < 40 ? ` (${bad})` : ''}. Enter one like name@example.com.`, tone: 'error', chips: [FLOW_CHIPS_CANCEL], intent: 'bad-email' }]; }
        if (f.step === 'phone' && !c.phone) return [{ text: 'I need a 10-digit phone number with the area code, like (805) 555-0123.', tone: 'error', chips: [FLOW_CHIPS_CANCEL], intent: 'bad-phone' }];
        if (f.step === 'name' && !c.name) return [{ text: 'Enter your name so the agent knows who to expect.', tone: 'error', chips: [FLOW_CHIPS_CANCEL], intent: 'bad-name' }];
        return [nextContactStep(f)];
      }
      case 'confirmBy': {
        if (/text|sms|message me|txt/.test(t)) c.confirmBy = 'text';
        else if (/email|mail/.test(t)) c.confirmBy = 'email';
        else return null;
        return [reviewReply(f)];
      }
      case 'replyBy': {
        if (/email|mail/.test(t)) f.d.replyBy = 'email';
        else if (/text|sms|txt/.test(t)) f.d.replyBy = 'text';
        else if (/call|phone|ring/.test(t)) f.d.replyBy = 'call';
        else return null;
        return [nextContactStep(f)];
      }
      case 'message': {
        if (/^send my last question|^use my last question/.test(t) && s.lastQuestion) { f.d.message = s.lastQuestion; return [nextContactStep(f)]; }
        const msg = text.trim();
        const err = rules.message(msg, null as never);
        if (err) return [{ text: 'Add a sentence or two so we can give you a useful answer.', tone: 'error', chips: [FLOW_CHIPS_CANCEL], intent: 'bad-message' }];
        f.d.message = msg.slice(0, 600);
        return [nextContactStep(f)];
      }
      case 'agentPick': {
        const a = findAgent(text);
        if (a) { f.d.agentId = a.id; f.step = 'message'; return [messagePrompt(f, s)]; }
        if (/not sure|don't know|dont know|main office|office|anyone|whoever/.test(t)) { f.d.agentId = null; f.step = 'message'; return [messagePrompt(f, s)]; }
        const tp = topicOf(text);
        if (tp) { const a2 = routeAgent(s, text); if (a2) { f.d.agentId = a2.id; f.step = 'message'; return [messagePrompt(f, s)]; } }
        return null;
      }
      case 'area': {
        const h = findHood(text);
        if (h) f.d.area = h.slug;
        else if (/any|all|everywhere|anywhere|open|no preference|doesn't matter|dont mind/.test(t)) f.d.area = 'any';
        else return null;
        return [reviewReply(f)];
      }
      case 'signupEmail': {
        const e = findEmail(text);
        if (!e) return [{ text: "That doesn't look like an email address. Enter one like name@example.com.", tone: 'error', chips: [FLOW_CHIPS_CANCEL], intent: 'bad-email' }];
        c.email = e; f.step = 'area';
        return [{ text: 'Which area are you most interested in?', chips: [{ label: 'Anywhere we work', send: 'Anywhere' }, ...k.hoods.slice(0, 4).map((h) => ({ label: h.plain, send: h.plain })), FLOW_CHIPS_CANCEL], intent: 'ask-area' }];
      }
      case 'review': {
        if (/^(confirm|send it|sign me up|yes|yep|yeah|book it|do it|go ahead|looks good|that's right|correct|confirm booking|sure|ok|okay)\b/.test(t) || isYes(text)) return submitFlow(f, s);
        if (f.type === 'message' && /edit|change|rewrite/.test(t)) { f.step = 'message'; return [{ text: 'Go ahead and type the message again.', chips: [FLOW_CHIPS_CANCEL], intent: 'edit-message' }]; }
        if (/\bdetails|contact|name|email|phone\b/.test(t) && /change|edit|wrong|different/.test(t)) { f.d.contact = {}; f.d.offeredProfile = true; return [nextContactStep(f)]; }
        return null;
      }
      case 'cancelPick': {
        const list = deps.bookings.list();
        const hit = list.find((b) => t.includes(b.ref.toLowerCase())) ?? (list.length === 1 && (isYes(text) || /cancel it|yes cancel|that one/.test(t)) ? list[0] : null);
        if (hit) { deps.bookings.remove(hit.ref); deps.track('booking_cancelled', { ref: hit.ref, via: 'chat' }); s.flow = null; return [cancelledReply(hit)]; }
        if (isNo(text) || /keep/.test(t)) { s.flow = null; return [{ text: 'Okay, I\'ve kept it as it is.', intent: 'cancel-kept' }]; }
        return null;
      }
      case 'reschedulePick': {
        const list = deps.bookings.list();
        const hit = list.find((b) => t.includes(b.ref.toLowerCase())) ?? (list.length === 1 && (isYes(text) || /reschedule|change|move/.test(t)) ? list[0] : null);
        if (hit) { deps.bookings.remove(hit.ref); s.flow = null; const out = startBooking(hit.mode, s, '', hit.mode === 'tour' ? { listingId: hit.listingId ?? undefined } : { agentId: hit.agentId }); return [{ text: `I've released your ${hit.mode === 'tour' ? 'tour' : 'call'} on ${whenText(new Date(hit.slot))}. Let's pick a new time.` }, ...out]; }
        if (isNo(text) || /keep/.test(t)) { s.flow = null; return [{ text: 'Okay, I\'ve kept it as it is.', intent: 'cancel-kept' }]; }
        return null;
      }
    }
    return null;
  }

  function afterKind(f: Flow): Reply[] {
    const p = profileOffer(f);
    if (p) return [p];
    return [nextContactStep(f)];
  }

  function messagePrompt(f: Flow, s: Session): Reply {
    const a = f.d.agentId ? agentOf(String(f.d.agentId)) : null;
    const l = f.d.listingId ? listingOf(String(f.d.listingId)) : null;
    const chips: Chip[] = [];
    if (s.lastQuestion) chips.push({ label: 'Send my last question', send: 'Send my last question' });
    chips.push(FLOW_CHIPS_CANCEL);
    return { text: `What would you like to ask ${a ? a.first : 'the team'}${l ? ` about ${l.street}` : ''}? A sentence or two is plenty.`, chips, intent: 'ask-message' };
  }

  function startMessage(s: Session, text: string, seedAgent?: KAgent): Reply[] {
    const l = findListing(text) ?? (/\b(this|that|the) (home|house|listing|property)\b/.test(clean(text)) ? listingOf(s.ctx.listingId) : null);
    const a = seedAgent ?? findAgent(text) ?? (l ? agentOf(l.agentId) : routeAgent(s, text));
    const topic = l ? 'listing' : a ? 'agent' : (topicOf(text) === 'sell' ? 'selling' : topicOf(text) === 'rent' ? 'leasing' : topicOf(text) === 'buy' ? 'buying' : 'agent');
    const flow: Flow = { type: 'message', step: 'message', d: { agentId: a?.id ?? null, listingId: l?.id ?? null, topic: topic === 'selling' || topic === 'buying' || topic === 'leasing' || topic === 'listing' ? topic : 'agent', contact: {} } };
    s.flow = flow;
    if (!a) {
      flow.step = 'agentPick';
      return [{ text: 'Who should it go to?', chips: [{ label: 'Buying: Julian', send: 'Julian Okafor' }, { label: 'Selling: Mara', send: 'Mara Ellison' }, { label: 'Leasing: Elena', send: 'Elena Varga' }, { label: 'Ojai: Daniel', send: 'Daniel Reyes' }, { label: 'Not sure', send: 'Not sure, main office' }, FLOW_CHIPS_CANCEL], intent: 'message-who' }];
    }
    s.ctx.agentId = a.id;
    // If the visitor already wrote their question in the same breath, use it.
    const stripped = text.replace(/^(please )?(can you |could you )?(send|leave|take|pass|relay|forward)( a| my| this)? message( to)?/i, '').trim();
    if (stripped.length > 40 && !/^(for|to) (an? )?agent$/i.test(stripped) && isQuestion(stripped)) {
      flow.d.message = stripped.slice(0, 600);
      return [{ text: `I'll pass that to ${a.first}: "${stripped.slice(0, 200)}${stripped.length > 200 ? '...' : ''}"`, intent: 'message-prefilled' }, nextContactStep(flow)];
    }
    return [messagePrompt(flow, s)];
  }

  function startSignup(s: Session, text: string): Reply[] {
    const flow: Flow = { type: 'signup', step: 'signupEmail', d: { contact: {}, area: findHood(text)?.slug } };
    s.flow = flow;
    const c = flow.d.contact as Record<string, string>;
    const e = findEmail(text) ?? deps.profile.get().email;
    if (e && findEmail(text)) { c.email = e; flow.step = 'area'; }
    if (findEmail(text) && flow.d.area) return [reviewReply(flow)];
    if (findEmail(text)) return [{ text: 'Which area are you most interested in?', chips: [{ label: 'Anywhere we work', send: 'Anywhere' }, ...k.hoods.slice(0, 4).map((h) => ({ label: h.plain, send: h.plain })), FLOW_CHIPS_CANCEL], intent: 'ask-area' }];
    return [{ text: 'Happy to. About a third of the homes we sell never appear on the site, and this is how you hear about them. What email address should we send them to?', chips: [FLOW_CHIPS_CANCEL], intent: 'signup-start' }];
  }

  function cancelledReply(b: ChatBooking): Reply {
    const a = agentOf(b.agentId);
    return { text: `Cancelled: your ${b.mode === 'tour' ? `tour of ${b.place}` : 'call'} on ${whenText(new Date(b.slot))} (${b.ref}). If ${a.first} has already confirmed with you, let them know so they can free the time: ${a.phone}.`, tone: 'success', chips: [{ label: b.mode === 'tour' ? 'Book a new time' : 'Book another call', send: b.mode === 'tour' ? `Book a tour of ${b.place}` : `Book a call with ${a.name}` }, { label: 'Find a home', send: 'Help me find a home' }], intent: 'cancelled' };
  }

  function startCancel(s: Session, reschedule: boolean): Reply[] {
    const list = deps.bookings.list().filter((b) => new Date(b.slot).getTime() > now().getTime() - 3600_000);
    if (!list.length) {
      return [{ text: `I don't see any bookings made in this chat on this device. If you booked on a listing page, open its "You're booked" panel to change or cancel it, or call the agent directly. Or I can book something new.`, chips: [CAPS.tour, CAPS.call], intent: 'cancel-none' }];
    }
    s.flow = { type: reschedule ? 'reschedule' : 'cancel', step: reschedule ? 'reschedulePick' : 'cancelPick', d: {} };
    const label = (b: ChatBooking) => `${b.mode === 'tour' ? `Tour of ${b.place}` : `Call with ${agentOf(b.agentId).first}`}, ${whenText(new Date(b.slot))} (${b.ref})`;
    if (list.length === 1) {
      return [{ text: `You have ${label(list[0])}. ${reschedule ? 'Move it to another time?' : 'Cancel it?'}`, chips: [{ label: reschedule ? 'Yes, reschedule' : 'Yes, cancel it', send: reschedule ? 'Yes, reschedule it' : 'Yes, cancel it' }, { label: 'Keep it', send: 'Keep it' }], intent: 'cancel-confirm' }];
    }
    return [{ text: `Which one?\n${list.map((b) => `- ${label(b)}`).join('\n')}`, chips: [...list.map((b) => ({ label: b.ref, send: b.ref })), { label: 'Keep them', send: 'Keep them' }], intent: 'cancel-pick' }];
  }

  function myBookings(): Reply {
    const list = deps.bookings.list();
    if (!list.length) return { text: "I don't see any bookings made in this chat on this device. I can book a tour or a call now.", chips: [CAPS.tour, CAPS.call], intent: 'bookings-none' };
    return {
      text: `Your bookings:\n${list.map((b) => `- ${b.mode === 'tour' ? `Tour of ${b.place}` : `Call with ${agentOf(b.agentId).first}`}, ${whenText(new Date(b.slot))} (${b.ref})`).join('\n')}`,
      chips: [CAPS.cancel, { label: 'Reschedule', send: 'Reschedule my booking' }], intent: 'bookings',
    };
  }

  // ---------- main entry ----------

  const PLACES = /\b(malibu|los angeles|san francisco|santa monica|goleta|santa ynez|ventura|oxnard|napa|san diego|santa cruz|monterey|carmel|palm springs|beverly hills|orange county|newport beach|laguna|pasadena|hollywood|bay area|new york|miami|texas|florida|arizona|nevada|hawaii|colorado|seattle|portland|las vegas|london|paris|dubai|sacramento|san jose|oakland|fresno|bakersfield|lompoc|solvang|los olivos|isla vista|santa maria|paso robles|san luis obispo)\b/;
  const ACTION = {
    tour: /\b(book|schedule|arrange|set up|setup|reserve|organi[sz]e|request|make)\b[^?]*\b(tour|viewing|showing|visit|appointment|walkthrough|walk-through|walk through|look at)\b|\b(i|we)('d| would|'ll| will)? (like|want|wanna|love|need|hope|am hoping|'m hoping) to (tour|see|view|visit|walk through|look at|go see)\b|\bcan (i|we) tour\b|\b(tour|visit) (it|that|this|the)\b|^(book|schedule) (a )?tour\b|^tour\b|\bbook (it|that|this one)\b|\bcome (see|look)\b/,
    call: /\b(book|schedule|arrange|set up|setup|request|make)\b[^?]*\b(call|phone call|callback|consultation|meeting|appointment|video call|zoom|chat)\b|\b(call me|ring me|phone me|give me a call|call me back|have (an? )?(agent|someone|mara|julian|elena|daniel) (call|phone|ring)|can (an? )?(agent|someone|mara|julian|elena|daniel) call)\b|\b(talk|speak|chat) (to|with) (an? |the )?(agent|person|human|someone|broker|realtor|mara|julian|elena|daniel|representative)\b|\bconnect me\b|\bi (want|need|would like|'d like|wanna) (to )?(talk|speak|chat)\b|\bget (me )?(an? )?agent\b/,
    message: /\b(leave|send|take|pass|relay|forward|drop)( me)?( an?| my| this| the)? (message|note|inquiry|enquiry|question)\b|\bmessage (mara|julian|elena|daniel|an agent|the agent|the team|someone)\b|\b(email|contact|write to|reach out to) (an? |the )?(agent|mara|julian|elena|daniel)\b|\bhave (an? |the )?(agent|someone|mara|julian|elena|daniel) (email|contact|reach|get back|respond|reply)\b|\bask (an? |the |my )?(agent|mara|julian|elena|daniel)( a| my)? ?(question)?\b|\bcontact me\b|\bget back to me\b|\bi have a question for\b|\bleave my details\b/,
    signup: /\b(sign me up|sign up|subscribe|notify me|alert me|keep me (posted|updated|in the loop)|put me on (the|your) (list|mailing)|add me to (the|your) (list|mailing)|email me (new|private|off|listings|homes)|send me (private|off-?market|new|listings|homes)|join (the|your) (list|mailing))\b/,
    cancel: /\b(cancel|call off|scrap|delete|remove)\b[^?]*\b(booking|tour|appointment|call|viewing|reservation|slot|showing|it)\b|\bi (can'?t|cannot|won'?t|am unable to) make it\b/,
    reschedule: /\b(reschedule|rebook)\b|\b(move|change|postpone|push back|switch)\b[^?]*\b(booking|tour|appointment|call|viewing|reservation|slot|showing|time|date)\b/,
    mine: /\b(my (booking|bookings|tour|tours|appointment|reservation|upcoming)|what('s| is) booked|when is my|what time is my|do i have (a )?(booking|tour|appointment))\b/,
    clear: /\b(clear|forget|delete|remove|erase|reset)\b[^?]*\b(my (saved |stored )?(details|info|information|data|profile))\b|\bclear my saved details\b|\bnot you\b/,
  };

  async function reply(rawText: string, s: Session): Promise<Reply[]> {
    const text = rawText.trim().slice(0, 600);
    const t = clean(text);
    if (!t) return [{ text: 'Type a question, or pick one of the options below.', intent: 'empty' }];

    const side = smallTalk(text);
    if (side?.redactUser) return [side];

    // Restart
    if (/^(start over|restart|reset|new chat|clear chat)\b/.test(t)) { s.flow = null; s.ctx = {}; s.misses = 0; return [greeting(s)]; }

    // Inside a flow
    if (s.flow) {
      const f = s.flow;
      if (wantsOut(text) && f.type !== 'cancel' && f.type !== 'reschedule' && !/\bcancel (my|the) (booking|tour|appointment)\b/.test(t)) {
        s.flow = null;
        return [{ text: "No problem, I've stopped that. Nothing was sent.", chips: [{ label: 'Find a home', send: 'Help me find a home' }, CAPS.call], intent: 'flow-cancelled' }];
      }
      // Corrections that apply anywhere in a booking
      const answered = await stepFlow(f, text, s);
      if (answered) { s.misses = 0; return answered; }
      // Not an answer to the step: treat as a side question, then ask again.
      s.flow = null;
      const out = await respondFree(text, s);
      const started = s.flow !== null;
      if (!started) {
        s.flow = f;
        const re = await reprompt(f, s);
        return [...out, ...re];
      }
      return out;
    }
    return respondFree(text, s);
  }

  async function reprompt(f: Flow, s: Session): Promise<Reply[]> {
    const lead = 'Back to where we were: ';
    let r: Reply;
    switch (f.step) {
      case 'listing': r = { text: `${lead}which home would you like to tour?`, chips: [...k.listings.filter(bookable).slice(0, 5).map((l) => ({ label: l.street, send: l.street })), FLOW_CHIPS_CANCEL] }; break;
      case 'agent': r = { text: `${lead}who would you like to speak with?`, chips: [...k.agents.map((a) => ({ label: a.name, send: a.name })), FLOW_CHIPS_CANCEL] }; break;
      case 'slot': { const o = offerSlots(f, (f.d.hint as WhenHint | null) ?? null); r = { ...o, text: `${lead}${o.text.charAt(0).toLowerCase()}${o.text.slice(1)}` }; break; }
      case 'kind': r = { text: `${lead}${f.type === 'tour' ? 'in person or live video?' : 'phone or video?'}`, chips: f.type === 'tour' ? [{ label: 'In person' }, { label: 'Live video walkthrough' }, FLOW_CHIPS_CANCEL] : [{ label: 'Phone call' }, { label: 'Video call' }, FLOW_CHIPS_CANCEL] }; break;
      case 'review': { const o = reviewReply(f); r = { ...o, text: `${lead}shall I go ahead?` }; break; }
      case 'message': r = { ...messagePrompt(f, s), text: `${lead}what would you like to say?` }; break;
      default: { const o = nextContactStep(f); r = { ...o, text: `${lead}${o.text.charAt(0).toLowerCase()}${o.text.slice(1)}` }; }
    }
    return [r];
  }

  async function respondFree(rawText: string, s: Session): Promise<Reply[]> {
    const text = autocorrect(expandSlang(rawText));
    const t = clean(text);
    const st = smallTalk(rawText);
    if (st) { s.misses = 0; return [st]; }

    // "yes" to the last suggestion
    if (isYes(text) && s.offer && t.split(' ').length <= 4) { const o = s.offer; s.offer = undefined; return respondFree(o, s); }

    // A bare yes or no with nothing pending
    if ((isYes(text) || isNo(text)) && t.split(' ').length <= 3 && !s.offer) {
      return [{ text: isYes(text) ? 'Happy to help. What would you like to do?' : 'No problem. Is there anything else I can help with?', chips: k.starters.slice(0, 5).map((x) => ({ label: x.label, send: x.send })), intent: 'yesno' }];
    }

    // Remember the visitor's last real question, so "send my last question" can reuse it.
    const rememberQ = () => { if (isQuestion(text) || t.split(' ').length > 6) s.lastQuestion = text.slice(0, 600); };
    const asking = /\bhow (do|can|to|would|does)\b|\bwhat (if|happens)\b/.test(t);

    // Account-style actions
    if (ACTION.clear.test(t)) { deps.profile.clear(); return [{ text: 'Done. I\'ve cleared the contact details this site kept in your browser.', intent: 'cleared' }]; }
    if ((ACTION.cancel.test(t) && !asking) || /^(i (need|want|have|'d like|would like) to |please |can i |could i |i'd like to )?cancel( (it|this|that|please|now))?[.!?]*$/.test(t)) { rememberQ(); return startCancel(s, false); }
    if (ACTION.reschedule.test(t) && !asking) return startCancel(s, true);
    if (ACTION.mine.test(t) && !/\b(cancel|reschedule|change|move)\b/.test(t)) return [myBookings()];

    // What the question is about
    const ls = findListings(text);
    const l = findListing(text);
    const hs = findHoods(text);
    const ag = findAgent(text);
    const entity = !!(l || hs.length || ag);
    const ranked = faqMatcher.rank(text);
    const best = ranked[0];
    const c = criteriaFrom(text);

    // "I'd like an appointment": tour or call?
    if (/\b(appointment|meeting|consultation)\b/.test(t) && !/\b(tour|viewing|showing|visit|walkthrough|call|phone|video)\b/.test(t) && !l && !listingOf(s.ctx.listingId) && !asking && (ACTION.tour.test(t) || ACTION.call.test(t) || /\b(make|set up|schedule|book|need|want|like)\b/.test(t))) {
      return [{ text: 'Would you like to tour a home, or talk to an agent?', chips: [CAPS.tour, CAPS.call], intent: 'appointment-which' }];
    }

    // Booking-type actions
    const isHow = /^(how|what|when|where|why|who|which|is|are|does|do you|can you tell)\b/.test(t) && !/^(can|could|would|will) (i|we|you)\b/.test(t) && !/\b(i|we) (want|need|would|'d|wanna)\b/.test(t);
    if (ACTION.signup.test(t) && !isHow) return startSignup(s, text);
    if (ACTION.message.test(t) && !isHow) { rememberQ(); return startMessage(s, text); }
    if (ACTION.call.test(t) && !isHow && !/\b(office|your) (phone|number)\b/.test(t)) return startBooking('call', s, text);
    const wantsListingTour = !!l && /\b(see|view|visit|tour|walk through|go see|look at|come see|show me)\b/.test(t) && /\b(can|could|may|would|want|like|love|wish|hope|interested|i'd|id|let's|lets|please)\b/.test(t);
    if ((ACTION.tour.test(t) || wantsListingTour) && !/^(how|what|when|where|why|who|which)\b/.test(t) && !(/\bpending\b/.test(t) && !l)) {
      const target = l ?? listingOf(s.ctx.listingId);
      const noListingHint = !target && /\b(homes|houses|properties|listings|places)\b/.test(t) && !/\btour\b/.test(t);
      if (!noListingHint) return startBooking('tour', s, text);
    }

    // Office hours, and counts of what is on the site
    if (/\b(are you open|you open|is the office open|opening hours|office hours|business hours|hours of operation|when are you open|what time (do|does) (you|the office) (open|close)|are you closed|open (today|now|on (sunday|saturday|monday|tuesday|wednesday|thursday|friday|weekends?))|open late|closing time|what are your hours|your hours)\b/.test(t)) return [hoursReply()];
    if (/\b(how many (homes|listings|properties|houses|rentals|leases|condos|pending)|number of (homes|listings)|what (homes|listings|properties) do you have|what do you have( for sale| available)?|what('s| is) available|what('s| is) for sale|current (listings|inventory)|your (listings|inventory)|show me (all|everything)|what are you selling|available homes|inventory)\b/.test(t) && !hasCriteria({ ...c, sort: undefined }) && !ag && !hs.length) return [listingsOverview()];

    // Glossary: "what is escrow"
    if (!entity) { const g = glossaryReply(text); if (g) return [g]; }

    // Escalation topics (offers, legal, financing, fees, complaints...) outrank everything below
    const qTok = tokens(stripEntities(text)).length;
    const critNoHood = hasCriteria({ ...c, hood: undefined });
    if (best && ESCALATE.has(best.item.id) && best.score >= (critNoHood ? 0.7 : 0.6) && (qTok >= 2 || !critNoHood) && !c.sort) { rememberQ(); s.misses = 0; return [faqAnswer(best.item)]; }

    // Asking for agent by topic: "who should I talk to about selling"
    if (/\b(who (should|can|do|would|is the best)|which agent|who handles|who covers|who sells|who is the (agent|expert|right)|right (agent|person))\b/.test(t) && !/\b(are you|is this)\b/.test(t) && !l && routeAgent(s, text)) { s.misses = 0; return [routingReply(s, text)]; }

    // Questions about the firm that name only the firm
    if (!ranked.length && t.includes(clean(k.brand.name)) && tokens(stripEntities(text)).length === 0) return [finishFaq(faqById('who'), s, ag, rememberQ)];

    // Places we don't cover: "a house in Malibu"
    if ((!best || best.score < 0.5) && (PLACES.test(t) || (/\b(home|house|homes|houses|condo|property|properties|rent|buy|sell|listing|listings)\b/.test(t) && /\b(in|near|around|outside|at)\s+(?!the\b)[A-Z][a-z]{3,}/.test(text.replace(/^[A-Z]/, (m) => m.toLowerCase())) && !entity && !hasCriteria(c)))) return [finishFaq(faqById('areas'), s, ag, rememberQ)];

    // Plain requests to find a home
    if (/\b(help me find|find me|find a home|looking for a home|looking to find|i need a home|i want a home|search for|help me search)\b/.test(t) && !entity) { s.misses = 0; return [searchReply(text, s)]; }

    // Follow-ups about the home being discussed ("how many bedrooms?", "is it still available?")
    const ctxL = listingOf(s.ctx.listingId);
    const plural = /\b(homes|houses|listings|properties|rentals|options|condos)\b/.test(t);
    const aboutUs = /\b(you|your|yours|office|company|firm|brokerage|team|agents)\b/.test(t);
    const ATTR = /\b(price|cost|how much|asking|bed|beds|bedroom|bedrooms|bath|baths|bathroom|bathrooms|sq ?ft|square|how big|how large|lot|acre|acres|built|year|agent|listed|features?|amenities|includes?|included|status|available|still (for sale|available)|pending|address|located|neighbou?rhood|photos?|pictures?|details|describe|tell me more|more info|about it|pool|beach|views?|garage|guest|furnished|pets?|fireplace|solar|size|floor ?plans?|layout|directions?|navigate)\b/;
    const hoodAsk = /\b(neighbou?rhood|area|nearby|around (it|there|here)|what('s| is) it like (there|around))\b/.test(t) && !/\b(address|where is|located|which)\b/.test(t);
    if (ctxL && !l && !hs.length && !aboutUs && hoodAsk) { const h = hoodOf(ctxL.hood); if (h) { s.misses = 0; return [hoodProfile(h)]; } }
    if (!l && !hs.length && !ag && !plural && !aboutUs && ATTR.test(t)) {
      if (ctxL) {
        const attr = listingAttribute(ctxL, text);
        if (attr) { rememberQ(); s.misses = 0; return [attr]; }
      } else if (/\b(it|this (home|house|property|place)|that (home|house|property|place))\b/.test(t)) {
        return [whichHome()];
      }
    }
    if (ctxL && !hs.length && !aboutUs && /\b(neighbou?rhood|area|nearby|around (it|there|here)|what('s| is) it like (there|around))\b/.test(t)) { const h = hoodOf(ctxL.hood); if (h) { s.misses = 0; return [hoodProfile(h)]; } }
    if (ctxL && /\b(similar|alternatives?|comparable|other (homes|options|listings)|more like (this|it)|anything like|something like)\b/.test(t)) { s.misses = 0; return [similarReply(ctxL)]; }
    const recent = (s.ctx.recent ?? []).map((id) => listingOf(id)).filter((x): x is KListing => !!x);
    if (recent.length >= 2 && ls.length < 2 && /\b(compare|them|these|both|the two|which (one )?(is )?(bigger|larger|cheaper|pricier|more expensive|newer|older|better)|difference)\b/.test(t)) { s.misses = 0; return [compareReply(recent.slice(0, 2))]; }

    // Distances and drive times: only what the listings and area guides actually say
    if (/\b(how far(?! in advance| ahead| back)|distance|drive time|commute|minutes (from|to)|miles (from|to)|airport|freeway|how long (is|does) it take to (get|drive))\b/.test(t) && !/\b(you|your|office)\b/.test(t)) {
      const pieces: string[] = [];
      const grab = (txt: string) => (txt.match(/[^.!?]+[.!?]+/g) ?? []).map((x) => x.trim()).filter((x) => /minute|mile|drive|walk|inland|away|block/i.test(x));
      const lt = l ?? ctxL;
      if (lt) pieces.push(...grab(lt.description).map((x) => `${lt.street}: ${x}`));
      for (const h of hs) pieces.push(...grab(`${h.summary} ${h.body}`).map((x) => `${h.plain}: ${x}`));
      s.misses = 0;
      return [{
        text: pieces.length
          ? `Here's what's published:\n${pieces.slice(0, 4).map((x) => `- ${x}`).join('\n')}\n\nI don't have other distances or drive times; Maps will give exact ones.`
          : "I don't have distances or drive times beyond what's in the listings and area guides. Maps will give exact ones, and the listing agent knows the area well.",
        chips: [lt ? { label: `Ask ${agentOf(lt.agentId).first}`, send: `Message ${agentOf(lt.agentId).name} about ${lt.street}` } : CAPS.message, CAPS.call], intent: 'distance',
      }];
    }

    // "Which area is good for hiking / near the beach": answered from the published area descriptions only
    if (!hs.length && /\b(which|what)\b.*\b(neighbou?rhoods?|areas?|parts? of (town|santa barbara))\b/.test(t)) {
      const topics: [RegExp, RegExp, string][] = [
        [/\b(beach|beaches|ocean|surf|swimming|sea)\b/, /beach|\bsea\b|ocean|surf|shore/, 'the water'],
        [/\b(hik(e|ing)|trails?|nature|outdoors?)\b/, /trail|hik|botanic|mountain/, 'trails and the outdoors'],
        [/\b(walkable|walk|restaurants?|cafes?|coffee|shops?|nightlife|dining|farmers? market|theaters?)\b/, /walk|restaurant|caf[eé]|coffee|shops?|theat|market/, 'walking to places to eat and shop'],
        [/\b(quiet|private|secluded|peaceful|gated)\b/, /quiet|private|gated|wooded|secluded/, 'quiet and privacy'],
        [/\b(views?|sunsets?)\b/, /\bviews?\b|sunset/, 'views'],
        [/\b(citrus|orchards?|acreage|rural|country|land)\b/, /citrus|orchard|acre|valley/, 'space and land'],
      ];
      for (const [trigger, re, label] of topics) {
        if (!trigger.test(t)) continue;
        const hit = k.hoods.filter((h) => re.test(`${h.summary} ${h.body}`.toLowerCase())).slice(0, 5);
        if (!hit.length) continue;
        s.misses = 0;
        return [{
          text: `Areas whose published guides mention ${label}:\n${hit.map((h) => `- ${h.plain}: ${h.summary}`).join('\n')}\n\nThat's from our own area guides; I can't rank areas by quality.`,
          chips: hit.slice(0, 3).map((h) => ({ label: `About ${h.plain}`, send: `Tell me about ${h.plain}` })),
          links: [{ label: 'Neighborhood guide', href: '/neighborhoods/' }], intent: 'hood-topic',
        }];
      }
    }

    // Neighborhood rankings: "which neighborhood is cheapest"
    if (/\b(neighborhood|neighbourhood|area|areas|part of town|where)\b/.test(t) && !hs.length) { const rank = hoodRanking(t); if (rank) { s.misses = 0; return [rank]; } }

    // A clear match to a general question, when the question names no particular home, place or person
    const aboutFirm = /\b(you|your|yours|office|company|firm|brokerage)\b/.test(t) && !l;
    const firstMin = aboutFirm ? 0.5 : hasCriteria(c) ? 0.8 : 0.62;
    if (best && !entity && best.score >= firstMin && !ESCALATE.has(best.item.id) && (qTok >= 2 || !hasCriteria(c)) && !c.sort && !(hasCriteria(c) && /\b(homes|houses|listings|properties)\b/.test(t) && !aboutFirm)) return [finishFaq(best.item, s, ag, rememberQ)];

    // Specific homes
    if (ls.length >= 2 && (/\b(compare|versus|vs|difference|differ|better|which (one|is)|or)\b/.test(t))) return [compareReply(ls.slice(0, 2))];
    const refersBack = /\b(this|that|the|it|its|here)\b/.test(t) && !!listingOf(s.ctx.listingId) && !hs.length && !/\b(homes|houses|listings|properties|rentals|options)\b/.test(t);
    const target = l ?? (refersBack ? listingOf(s.ctx.listingId)! : null);
    if (target) {
      s.ctx.listingId = target.id;
      s.ctx.recent = [target.id, ...(s.ctx.recent ?? []).filter((x) => x !== target.id)].slice(0, 4);
      s.misses = 0;
      rememberQ();
      const attr = listingAttribute(target, text);
      if (attr) return [attr];
      // Only names a listing: describe it, unless the text is really a different request.
      if (l || !best || best.score < 0.6) {
        if (!/\b(agent|who)\b/.test(t)) return [describeListing(target)];
      }
    }

    // Neighborhood stats and comparisons
    const statWords = /\b(median|average|typical|going rate|how much (do|are|does|is)|how expensive|how fast|how long|days on market|market (stats|data|numbers|trends?)|price level|price range|how (pricey|costly)|prices? in|cost of living)\b/;
    if (hs.length && statWords.test(t) && !/\b(show|find|list|any|have)\b/.test(t)) { s.ctx.hood = hs[0].slug; s.misses = 0; return [hoodStats(hs)]; }
    if (hs.length >= 2 && /\b(compare|versus|vs|difference|better|or)\b/.test(t)) { s.misses = 0; return [hoodStats(hs)]; }

    // Agents
    if (ag && !ACTION.call.test(t)) {
      s.ctx.agentId = ag.id; s.misses = 0;
      const attr = agentAttribute(ag, t);
      if (attr) return [attr];
      if (!hs.length || /\b(who is|tell me about|about|bio|profile)\b/.test(t)) return [agentProfile(ag)];
    }
    // "Who should I talk to about ...": route when the topic points at someone, otherwise let the FAQ answer
    if (/\b(who (should|can|do|would|is the best)|which agent|who handles|who covers|who sells|who is the (agent|expert|right)|right (agent|person))\b/.test(t) && !/\b(are you|is this)\b/.test(t)) {
      if (routeAgent(s, text) || !best || best.score < 0.5) { s.misses = 0; return [routingReply(s, text)]; }
    }

    // Neighborhood profile
    if (hs.length === 1 && !hasCriteria({ ...c, hood: undefined })) {
      s.ctx.hood = hs[0].slug; s.misses = 0;
      if (!/\b(homes?|houses?|listings?|properties|condos?|rentals?|show|find|search)\b/.test(t)) return [hoodProfile(hs[0])];
    }

    // Search
    const searchy = /\b(find|search|show|looking|look for|any|have|got|recommend|suggest|options|browse|homes|houses|properties|listings|condos?|rentals?|something|anything|place to (live|rent)|help me find|what('s| is) available|do you have)\b/.test(t);
    if (hasCriteria(c) && (searchy || c.am.length || c.price || c.beds || c.hood || c.sort)) { s.misses = 0; return [searchReply(text, s)]; }

    // Topic context for later routing
    const tp = topicOf(text);
    if (tp) s.ctx.topic = tp;

    // General FAQ
    if (best && best.score >= 0.5) { rememberQ(); s.misses = 0; return [finishFaq(best.item, s, ag, rememberQ)]; }

    if (/\b(help me find|find me|find a home|looking for a home|looking to find|i need a home|i want a home|search for)\b/.test(t) || (searchy && /\b(home|homes|house|houses)\b/.test(t))) { s.misses = 0; return [searchReply(text, s)]; }

    // "I want to sell my hose": a first-person sell or buy request with no clearer match
    if (/\b(i|my|we|our|i'm|im|i'd|id)\b/.test(t) && (!best || best.score < 0.5)) {
      const tp2 = topicOf(text);
      if (tp2 === 'sell') return [finishFaq(faqById('sell-start'), s, ag, rememberQ)];
      if (tp2 === 'buy') return [finishFaq(faqById('buy-start'), s, ag, rememberQ)];
    }

    // Looser FAQ match, offered as a suggestion rather than an answer.
    const loose = best && best.score >= 0.34 ? best : null;
    s.misses += 1;
    rememberQ();
    const escalate = s.misses >= 2;
    const a = routeAgent(s, text);
    const base = loose
      ? `I'm not certain I have that. The closest thing I have is below; if it isn't what you meant, ${escalate ? 'I can pass your question to a person.' : 'try rephrasing, or I can pass your question to a person.'}`
      : `I don't have an answer to that${escalate ? '' : ', and I would rather not guess'}. ${a ? `${a.name} would know: ${a.phone}.` : `The main office can help: ${mainOffice()}.`} I can also leave a message for you.`;
    const out: Reply[] = [];
    if (loose) out.push({ ...faqAnswer(loose.item), text: `${base}\n\n${loose.item.a}`, intent: `loose:${loose.item.id}` });
    else out.push({ text: base, chips: [CAPS.message, CAPS.call, { label: 'Find a home', send: 'Help me find a home' }], intent: 'fallback' });
    if (loose && escalate) out[0].chips = [CAPS.message, CAPS.call];
    return out;
  }

  function finishFaq(f: KFaq, s: Session, ag: KAgent | null, rememberQ: () => void): Reply {
    rememberQ();
    s.misses = 0;
    const r = faqAnswer(f);
    if (f.id === 'team' && !ag) r.chips = k.agents.map((a) => ({ label: a.first, send: `Tell me about ${a.name}` }));
    if (f.id === 'buy-start') s.offer = 'Book a call with Julian Okafor';
    else if (f.id === 'sell-start') s.offer = 'Book a call with Mara Ellison';
    else if (f.id === 'lease-apply' || f.id === 'furnished') s.offer = 'Book a call with Elena Varga';
    const tp = topicOf(f.q[0] ?? '');
    if (tp && ['buy-start', 'sell-start', 'lease-length', 'furnished', 'lease-apply', 'pets'].includes(f.id)) s.ctx.topic = tp;
    return r;
  }

  // ---------- greeting ----------

  function greeting(s: Session): Reply {
    const l = listingOf(s.page.listingId);
    const a = k.agents.find((x) => x.id === s.page.agentId);
    const h = hoodOf(s.page.hood);
    if (l) {
      return {
        text: `${k.welcome}\n\nI see you're looking at ${l.street}. I can answer questions about it, or book a tour.`,
        chips: [...withTour(l), { label: 'What features does it have?', send: `What are the features of ${l.street}?` }, { label: `Ask ${first(agentOf(l.agentId))} a question`, send: `Message ${agentOf(l.agentId).name} about ${l.street}` }, { label: 'See similar homes', send: `Show me homes in ${l.hoodName.replace(/^The /, '')}` }],
        intent: 'welcome-listing',
      };
    }
    if (a) {
      return { text: `${k.welcome}\n\nI see you're on ${a.first}'s page. I can tell you more about ${a.first}, or book a call.`, chips: [{ label: `Book a call with ${a.first}`, send: `Book a call with ${a.name}` }, { label: `Message ${a.first}`, send: `Message ${a.name}` }, { label: `${a.first}'s listings`, send: `Show me ${a.name}'s listings` }], intent: 'welcome-agent' };
    }
    if (h) {
      return { text: `${k.welcome}\n\nI see you're reading about ${h.plain}. I can show you homes there or tell you more about the area.`, chips: [{ label: `Homes in ${h.plain}`, send: `Show me homes in ${h.plain}` }, { label: `About ${h.plain}`, send: `Tell me about ${h.plain}` }, CAPS.call], intent: 'welcome-hood' };
    }
    return { text: k.welcome, chips: k.starters.map((x) => ({ label: x.label, send: x.send })), intent: 'welcome' };
  }

  return {
    greeting,
    respond: async (text: string, s: Session) => {
      const out = await reply(text, s);
      for (const r of out) if (r.chips && r.chips.length > 8) r.chips = r.chips.slice(0, 8);
      return out;
    },
    newSession(page: Session['page'] = {}): Session {
      return { flow: null, ctx: { listingId: page.listingId, agentId: page.agentId, hood: page.hood }, page, misses: 0 };
    },
  };
}
