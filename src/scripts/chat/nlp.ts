/**
 * Small, dependency-free language helpers for the site assistant: normalising text, scoring
 * questions against the FAQ, and pulling dates, times, prices and bedroom counts out of free text.
 */
import { todayIn } from '../time';

// ---------- normalising ----------

export const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9$.:/'\-+\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const SYNONYMS: Record<string, string> = {
  house: 'home', houses: 'home', property: 'home', properties: 'home', residence: 'home', place: 'home', homes: 'home',
  apartment: 'condo', condominium: 'condo', townhouse: 'condo', flat: 'condo',
  rental: 'rent', rentals: 'rent', lease: 'rent', leasing: 'rent', renting: 'rent', leases: 'rent', tenant: 'rent',
  viewing: 'tour', showing: 'tour', visit: 'tour', walkthrough: 'tour', tours: 'tour',
  realtor: 'agent', broker: 'agent', representative: 'agent', agents: 'agent', brokers: 'agent', rep: 'agent',
  telephone: 'call', ring: 'call', phone: 'call', calls: 'call', callback: 'call',
  mail: 'email', 'e-mail': 'email', emails: 'email',
  hours: 'hour',
  founder: 'found', founded: 'found', founding: 'found', started: 'found', opened: 'found',
  purchase: 'buy', buying: 'buy', buyer: 'buy', bought: 'buy',
  selling: 'sell', seller: 'sell',
  cheap: 'cheap', cheapest: 'cheap', affordable: 'cheap', inexpensive: 'cheap',
  pricey: 'expensive', priciest: 'expensive', costliest: 'expensive', expensive: 'expensive',
  cost: 'price', costs: 'price', priced: 'price', prices: 'price', pricing: 'price',
  where: 'where', located: 'where', location: 'where',
  cancel: 'cancel', cancellation: 'cancel', cancelling: 'cancel', canceling: 'cancel',
  rescheduling: 'reschedule', 'speak': 'talk', 'chat': 'talk', 'spoke': 'talk',
};

const STOP = new Set(
  ('a an the and or but if of to in on at for from by with about into over as is are was were be been being am do does did done have has had having ' +
    'i me my mine we us our you your yours it its this that these those there here they them their he she his her ' +
    'can could would should will shall may might must just so very really please thanks thank hi hello hey ok okay ' +
    'what whats which whom whose when how why than then also too some any more most much many lot lots get got want need like ' +
    "tell show give let know help helps helping assist what's it's i'm i'd i'll i've you're we're they're that's there's here's let's who's how's don't can't isn't aren't doesn't won't wouldn't couldn't shouldn't").split(' '),
);
// Question words that matter for matching are kept out of STOP on purpose where they change meaning.
const KEEP = new Set(['not', 'no', 'how', 'when', 'where', 'who', 'what']);

export function stem(w: string): string {
  if (SYNONYMS[w]) return SYNONYMS[w];
  let s = w.replace(/'s$/, '');
  if (s.length > 4 && s.endsWith('ies')) s = s.slice(0, -3) + 'y';
  else if (s.length > 4 && /(ches|shes|sses|xes)$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  return SYNONYMS[s] ?? s;
}

export const tokens = (text: string, keepQuestionWords = false): string[] =>
  clean(text)
    .split(' ')
    .filter(Boolean)
    .map((w) => w.replace(/'s$/, ''))
    .filter((w) => !STOP.has(w) || (keepQuestionWords && KEEP.has(w)))
    .map(stem);

// ---------- FAQ scoring ----------

export interface Indexed<T> { item: T; phrases: string[][] }

export class Matcher<T> {
  private idf = new Map<string, number>();
  private entries: Indexed<T>[];
  private normalize: (s: string) => string;
  constructor(items: { item: T; phrases: string[] }[], normalize: (s: string) => string = (x) => x) {
    this.normalize = normalize;
    this.entries = items.map((i) => ({ item: i.item, phrases: i.phrases.map((p) => [...new Set(tokens(normalize(p)))]) }));
    const df = new Map<string, number>();
    let n = 0;
    for (const e of this.entries) for (const p of e.phrases) { n++; for (const t of p) df.set(t, (df.get(t) ?? 0) + 1); }
    for (const [t, c] of df) this.idf.set(t, Math.log(1 + n / c));
  }
  // Words the FAQ has never seen are informative too: they say the question is about something else.
  private w(t: string) { return this.idf.get(t) ?? 3.5; }
  /** Weighted cosine between the query and each stored phrase; best phrase wins. */
  rank(query: string): { item: T; score: number }[] {
    const q = [...new Set(tokens(this.normalize(query)))];
    if (!q.length) return [];
    const qNorm = Math.sqrt(q.reduce((a, t) => a + this.w(t) ** 2, 0));
    const out: { item: T; score: number }[] = [];
    for (const e of this.entries) {
      let best = 0;
      for (const p of e.phrases) {
        if (!p.length) continue;
        const set = new Set(p);
        let dot = 0;
        let shared = 0;
        for (const t of q) if (set.has(t)) { dot += this.w(t) ** 2; shared++; }
        // A phrase that boils down to one common word only answers a question that is that one word.
        if (p.length === 1 && q.length > 1) continue;
        if (!dot || shared < Math.min(2, q.length, p.length)) continue;
        const pNorm = Math.sqrt(p.reduce((a, t) => a + this.w(t) ** 2, 0));
        best = Math.max(best, dot / (qNorm * pNorm));
      }
      if (best > 0) out.push({ item: e.item, score: best });
    }
    return out.sort((a, b) => b.score - a.score);
  }
}

// ---------- numbers ----------

const WORD_NUM: Record<string, number> = {
  a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

export function parseBeds(text: string): number | null {
  const t = clean(text);
  const m = t.match(/\b(\d+|one|two|three|four|five|six|seven|eight)\s*(?:\+|plus)?\s*[- ]?(?:bed(?:room)?s?|br|bd|bdrm)\b/);
  if (m) return WORD_NUM[m[1]] ?? Number(m[1]);
  return null;
}

export function parseBaths(text: string): number | null {
  const m = clean(text).match(/\b(\d+(?:\.\d)?|one|two|three|four|five)\s*(?:\+|plus)?\s*[- ]?(?:bath(?:room)?s?|ba)\b/);
  return m ? (WORD_NUM[m[1]] ?? Number(m[1])) : null;
}

export interface PriceHint { min?: number; max?: number; monthly?: boolean; approx?: number }

const NUM_RE = /(\$)?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(million|mil|mm|m\b|thousand|grand|k\b)?/g;
const UNIT_AFTER = /^\s*(?:bed|bath|br\b|bd\b|ba\b|acre|sq|sqft|square|day|min|hour|hr|am\b|pm\b|year|yr|month\s+lease|agent|home|house|listing|percent|%|st\b|nd\b|rd\b|th\b|people|car|stor|floor|room)/;

export function parsePrice(text: string): PriceHint | null {
  const t = clean(text.replace(/(\d),(?=\d{3}\b)/g, '$1'));
  const rentCtx = /\b(rents?|rentals?|leases?|leasing|monthly|per month|a month|\/mo|\/month|month)\b/.test(t) && !/month lease|month minimum|months?\b.*\blease/.test(t.replace(/(per|a|\/)\s?month/, ''));
  const found: { v: number; idx: number; unit: boolean; dollar: boolean }[] = [];
  let m: RegExpExecArray | null;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(t))) {
    const raw = m[2].replace(/,/g, '');
    let v = parseFloat(raw);
    const unit = m[3];
    const after = t.slice(m.index + m[0].length);
    const before = t.slice(Math.max(0, m.index - 6), m.index);
    if (!unit && !m[1] && UNIT_AFTER.test(after)) continue;
    if (/hr-?$|#$|:\s?$/.test(before) || /^\s*:\d/.test(after)) continue;
    if (/\b(19|20)\d\d\b/.test(m[0]) && !m[1] && !unit && v >= 1900 && v <= 2100) continue;
    if (unit) {
      if (/^(million|mil|mm|m)$/.test(unit)) v *= 1_000_000;
      else v *= 1000;
    }
    found.push({ v, idx: m.index, unit: !!unit, dollar: !!m[1] });
  }
  // "between 3 and 6 million": the first figure shares the second one's unit.
  if (found.length >= 2 && !found[0].unit && found[1].unit && found[0].v < 1000) {
    const mult = found[1].v >= 1_000_000 && found[1].v % 1_000_000 === 0 ? 1_000_000 : found[1].v >= 1000 ? 1000 : 1;
    if (/\b(between|from)\b|\d\s?(to|-|and)\s?\$?\d/.test(t)) { found[0].v *= mult; found[0].unit = true; }
  }
  const nums = found.filter((f) => f.v >= 500 || f.unit || f.dollar);
  if (!nums.length) return null;
  const monthly = rentCtx || nums.every((n) => n.v < 100_000);
  const hint: PriceHint = { monthly: monthly || undefined };
  const between = t.match(/\bbetween\b|\bfrom\b[^.]*\bto\b|\d\s?(?:to|-|and)\s?\$?\d/);
  if (nums.length >= 2 && between) {
    hint.min = Math.min(nums[0].v, nums[1].v);
    hint.max = Math.max(nums[0].v, nums[1].v);
    return hint;
  }
  const n = nums[0];
  const lead = t.slice(Math.max(0, n.idx - 28), n.idx);
  if (/\b(under|below|less than|up to|upto|max|maximum|at most|no more than|within|cheaper than|not more than|budget|lower than|<)\b/.test(lead)) hint.max = n.v;
  else if (/\b(over|above|more than|at least|min|minimum|starting|from|greater than|higher than|>|exceed)/.test(lead)) hint.min = n.v;
  else if (/\b(around|about|approximately|roughly|near|~|approx|close to)\b/.test(lead)) { hint.min = n.v * 0.85; hint.max = n.v * 1.15; hint.approx = n.v; }
  else hint.max = n.v; // "I have 3 million" / "a 2m budget": treat as a ceiling
  return hint;
}

// ---------- dates and times ----------

export interface CivilDate { y: number; m: number; d: number }
export interface WhenHint {
  dates?: CivilDate[];
  hour?: number;
  minute?: number;
  part?: 'morning' | 'afternoon' | 'evening';
  anyDay?: boolean;
}

const civil = (base: CivilDate, plus: number): CivilDate => {
  const t = new Date(Date.UTC(base.y, base.m - 1, base.d + plus));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const dow = (c: CivilDate) => new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay();

const WEEKDAYS: [RegExp, number][] = [
  [/\bsun(?:day)?\b/, 0], [/\bmon(?:day)?\b/, 1], [/\btue(?:s|sday)?\b/, 2], [/\bwed(?:nesday|s)?\b/, 3],
  [/\bthu(?:r|rs|rsday|rsdays)?\b/, 4], [/\bfri(?:day)?\b/, 5], [/\bsat(?:urday)?\b/, 6],
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function parseWhen(text: string, tz: string): WhenHint | null {
  const t = clean(text);
  const today = todayIn(tz);
  const base: CivilDate = { y: today.y, m: today.m, d: today.d };
  const hint: WhenHint = {};

  // Day
  if (/\bday after tomorrow\b/.test(t)) hint.dates = [civil(base, 2)];
  else if (/\b(tomorrow|tmrw|tmw)\b/.test(t)) hint.dates = [civil(base, 1)];
  else if (/\b(today|tonight|this evening|this afternoon|this morning)\b/.test(t)) hint.dates = [base];
  else if (/\bthis weekend\b|\bweekend\b/.test(t)) {
    const ahead = (6 - dow(base) + 7) % 7;
    hint.dates = dow(base) === 0 ? [base] : [civil(base, ahead), civil(base, ahead + 1)];
  } else if (/\bnext week\b/.test(t)) {
    const toMon = ((8 - dow(base)) % 7) || 7;
    hint.dates = Array.from({ length: 7 }, (_, i) => civil(base, toMon + i));
  } else if (/\bthis week\b/.test(t)) {
    hint.dates = Array.from({ length: 7 }, (_, i) => civil(base, i));
  } else {
    const inDays = t.match(/\bin (\d+|a|one|two|three|four|five|six|seven) days?\b/);
    const md = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?\b/);
    const dm = t.match(/\b(\d{1,2})(?:st|nd|rd|th)? (?:of )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
    const slash = t.match(/\b(\d{1,2})[/-](\d{1,2})\b(?![/-]\d{3})/);
    const ord = t.match(/\bthe (\d{1,2})(?:st|nd|rd|th)\b/);
    const wd = WEEKDAYS.find(([re]) => re.test(t));
    const pick = (m: number, d: number) => {
      let c: CivilDate = { y: base.y, m, d };
      if (Date.UTC(c.y, c.m - 1, c.d) < Date.UTC(base.y, base.m - 1, base.d)) c = { y: base.y + 1, m, d };
      return c;
    };
    if (inDays) hint.dates = [civil(base, WORD_NUM[inDays[1]] ?? Number(inDays[1]))];
    else if (md) hint.dates = [pick(MONTHS.indexOf(md[1]) + 1, Number(md[2]))];
    else if (dm) hint.dates = [pick(MONTHS.indexOf(dm[2]) + 1, Number(dm[1]))];
    else if (slash && Number(slash[1]) <= 12 && Number(slash[2]) <= 31) hint.dates = [pick(Number(slash[1]), Number(slash[2]))];
    else if (ord) {
      const d = Number(ord[1]);
      let c: CivilDate = { y: base.y, m: base.m, d };
      if (d < base.d) c = { y: base.m === 12 ? base.y + 1 : base.y, m: base.m === 12 ? 1 : base.m + 1, d };
      hint.dates = [c];
    } else if (wd) {
      const todayDow = dow(base);
      let ahead = (wd[1] - todayDow + 7) % 7;
      if (ahead === 0) ahead = /\bnext\b/.test(t) ? 7 : 0;
      else if (/\bnext\b/.test(t) && ahead < 3) ahead += 7;
      hint.dates = [civil(base, ahead)];
    } else if (/\b(any ?day|whenever|anytime|any time|soonest|earliest|asap|first available|next available|as soon as)\b/.test(t)) hint.anyDay = true;
  }

  // Time of day
  const clock = t.match(/\b(?:at |around |about |@ ?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/) ||
    t.match(/\b(?:at |around |about |@ ?)(\d{1,2})(?::(\d{2}))?\b(?!\s*(?:bed|bath|people|day|st|nd|rd|th|%))/) ||
    t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b()/);
  if (clock) {
    let h = Number(clock[1]);
    const min = clock[2] ? Number(clock[2]) : 0;
    const mer = clock[3]?.replace(/\./g, '');
    if (mer === 'pm' && h < 12) h += 12;
    else if (mer === 'am' && h === 12) h = 0;
    else if (!mer && h <= 12) {
      // Office hours are roughly 9 to 6, so a bare "2" means 2 pm and "10" means 10 am.
      if (h >= 1 && h <= 8) h += 12;
    }
    if (h >= 0 && h <= 23) { hint.hour = h; hint.minute = min; }
  } else if (/\bnoon|midday|lunch(?:time)?\b/.test(t)) { hint.hour = 12; hint.minute = 0; }
  if (hint.hour === undefined) {
    if (/\bmorning\b/.test(t)) hint.part = 'morning';
    else if (/\bafternoon\b/.test(t)) hint.part = 'afternoon';
    else if (/\bevening|after work|late\b/.test(t)) hint.part = 'evening';
  }

  return hint.dates || hint.hour !== undefined || hint.part || hint.anyDay ? hint : null;
}

export const partRange = (p: 'morning' | 'afternoon' | 'evening'): [number, number] =>
  p === 'morning' ? [0, 12] : p === 'afternoon' ? [12, 17] : [17, 24];

export const dateKey = (c: CivilDate) => `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;

// ---------- contact details ----------

export const findEmail = (s: string) => s.match(/[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}/)?.[0] ?? null;

export function findPhone(s: string): string | null {
  const m = s.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
  return m ? m[0] : null;
}

/** Pulls a plausible name out of "my name is Sam Lee", "I'm Sam", "it's Sam Lee, sam@..." or a bare name. */
export function findName(s: string): string | null {
  if (/\?/.test(s)) return null;
  let t = s.replace(findEmail(s) ?? '', ' ').replace(findPhone(s) ?? '', ' ');
  t = t.replace(/\b(my name is|my name's|name is|this is|i am|i'm|im|it's|its|call me|name:|under the name|put it under|book it under|for)\b/gi, ' ');
  t = t.replace(/[,;|]+/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/\b(and|my|email|phone|number|is|at|mobile|cell)\b.*$/i, '').trim();
  if (!t || /[?0-9@]/.test(t)) return null;
  const words = t.split(' ');
  if (words.length > 4 || words.some((w) => w.length > 24)) return null;
  if (!/^[A-Za-zÀ-ÿ'’.\- ]+$/.test(t)) return null;
  if (/^(yes|no|ok|okay|sure|yep|nope|nah|cancel|stop|back|skip|text|email|call|phone|video|person|in person)$/i.test(t)) return null;
  return t.replace(/\b([a-zà-ÿ])([a-zà-ÿ']*)/gi, (_, a, b) => a.toUpperCase() + b);
}

export const isYes = (s: string) => /^(yes|yep|yeah|yup|sure|ok|okay|please|please do|do it|go ahead|go for it|sounds good|that works|perfect|great|confirm|correct|right|absolutely|definitely|of course|y|si|let's do it|lets do it|i do|that's right|thats right|yes please|ok sure|alright)\b/.test(clean(s));
export const isNo = (s: string) => /^(no|nope|nah|not now|no thanks|no thank you|not really|never mind|nevermind|n|don't|dont|cancel that|skip|not yet|not today|maybe later|later)\b/.test(clean(s));
export const wantsOut = (s: string) => /^(cancel|stop|quit|exit|abort|never ?mind|forget it|start over|restart|reset|nvm)\b|\b(cancel (this|that|it)|forget (it|that)|stop this|never mind|start over)\b/.test(clean(s));
export const isQuestion = (s: string) => /\?\s*$/.test(s.trim()) || /^(what|whats|what's|how|when|where|who|why|which|do you|does|can you|could you|is there|are there|is it|are you|will you|would you|tell me|do i|can i|should i)\b/.test(clean(s));

// ---------- typo tolerance ----------

/** Levenshtein distance, giving up (returning max + 1) once it can't come in under `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  // Optimal string alignment: an adjacent swap ("shcedule") costs one edit, not two.
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Repairs misspelled words that are one or two letters off a word the assistant knows. */
export function makeAutocorrect(vocabulary: Iterable<string>, alsoKnown: Iterable<string> = []) {
  const vocab = new Set<string>();
  for (const w of vocabulary) if (w.length >= 4 && /^[a-z]+$/.test(w)) vocab.add(w);
  const known = new Set([...vocabulary, ...alsoKnown]);
  for (const w of STOP) known.add(w);
  const list = [...vocab].sort();
  const swaps = (w: string) => { const out: string[] = []; for (let i = 0; i < w.length - 1; i++) out.push(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2)); return out; };
  return (text: string) =>
    text.replace(/[A-Za-z]{4,}/g, (word) => {
      const w = word.toLowerCase();
      if (known.has(w) || known.has(stem(w))) return word;
      if (w.length === 4) { const hit = swaps(w).find((x) => vocab.has(x)); return hit ?? word; }
      const max = w.length >= 9 ? 2 : 1;
      let best: string | null = null;
      let bestD = max + 1;
      for (const v of list) {
        const d = editDistance(w, v, max);
        if (d < bestD) { bestD = d; best = v; }
      }
      return best && bestD <= max ? best : word;
    });
}

// ---------- slang ----------

const SLANG: [RegExp, string][] = [
  [/\bwanna\b/gi, 'want to'], [/\bgonna\b/gi, 'going to'], [/\blemme\b/gi, 'let me'], [/\bgimme\b/gi, 'give me'],
  [/\bur\b/gi, 'your'], [/\bu\b/gi, 'you'], [/\br\b/gi, 'are'], [/\bpls\b|\bplz\b/gi, 'please'], [/\bthx\b/gi, 'thanks'],
  [/\bbc\b/gi, 'because'], [/\bcuz\b/gi, 'because'], [/\bbtw\b/gi, 'by the way'], [/\bidk\b/gi, "i don't know"],
  [/\b(\d+)\s?bd\b/gi, '$1 bedroom'], [/\bapt\b/gi, 'apartment'], [/\bsqft\b|\bsq\.? ?ft\b/gi, 'sq ft'], [/\btmrw\b|\btmw\b|\b2moro\b|\b2morrow\b/gi, 'tomorrow'],
  [/\bhrs\b/gi, 'hours'], [/\binfo\b/gi, 'information'], [/\bpics\b/gi, 'pictures'],
];
export const expandSlang = (text: string) => SLANG.reduce((t, [re, to]) => t.replace(re, to), text);
