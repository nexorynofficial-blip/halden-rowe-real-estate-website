/**
 * Slots are expressed in the brokerage's own time zone (Pacific), whatever
 * the visitor's device is set to.
 */

const partsIn = (date: Date, tz: string) => {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, weekday: p.weekday as string };
};

/** UTC instant for a wall-clock time in `tz`. */
export function zoned(y: number, m: number, d: number, h: number, min: number, tz: string) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const p = partsIn(new Date(guess), tz);
  const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  return new Date(guess - (asIfUtc - guess));
}

export const todayIn = (tz: string) => {
  const p = partsIn(new Date(), tz);
  return { y: p.y, m: p.m, d: p.d, h: p.h, min: p.min };
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const weekdayIndex = (date: Date, tz: string) => WEEKDAYS.indexOf(partsIn(date, tz).weekday);

export const fmt = (date: Date, tz: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(date);

/** "2:00 pm" */
export const timeLabel = (date: Date, tz: string) =>
  fmt(date, tz, { hour: 'numeric', minute: '2-digit' }).replace(' AM', ' am').replace(' PM', ' pm');

/** "Thursday, November 13" */
export const dayLabel = (date: Date, tz: string) => fmt(date, tz, { weekday: 'long', month: 'long', day: 'numeric' });

/** "Thursday" or "today" / "tomorrow" */
export const relativeDay = (date: Date, tz: string) => {
  const t = todayIn(tz);
  const p = partsIn(date, tz);
  const a = Date.UTC(t.y, t.m - 1, t.d);
  const b = Date.UTC(p.y, p.m - 1, p.d);
  const diff = Math.round((b - a) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return fmt(date, tz, { weekday: 'long' });
};

/** Small deterministic hash so the same listing shows the same availability on reload. */
export function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

export interface Day { key: string; date: Date; slots: Date[]; closed: boolean }

/**
 * Demo availability. Each agent works their own days and hours; roughly half
 * of their slots are already taken. Same-day slots need two hours' notice.
 */
export function buildDays(opts: {
  seed: string; tz: string; daysAhead: number; stepMinutes: number;
  hours: { start: number; end: number; days: number[] }; taken?: string[];
}): Day[] {
  const { seed, tz, daysAhead, stepMinutes, hours, taken = [] } = opts;
  const t = todayIn(tz);
  const now = Date.now();
  const out: Day[] = [];
  for (let i = 0; i < daysAhead; i++) {
    const noon = zoned(t.y, t.m, t.d + i, 12, 0, tz);
    const p = partsIn(noon, tz);
    const wd = weekdayIndex(noon, tz);
    const key = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
    const closed = !hours.days.includes(wd);
    const slots: Date[] = [];
    if (!closed) {
      for (let mins = hours.start * 60; mins + stepMinutes <= hours.end * 60; mins += stepMinutes) {
        const s = zoned(p.y, p.m, p.d, Math.floor(mins / 60), mins % 60, tz);
        if (s.getTime() < now + 2 * 3600_000) continue;
        if (taken.includes(s.toISOString())) continue;
        if (hash(`${seed}|${s.toISOString()}`) < 0.48) continue;
        slots.push(s);
      }
    }
    out.push({ key, date: noon, slots, closed });
  }
  return out;
}

/** When a reply can be expected, given office hours. Returns e.g. "by 4:30 pm today". */
export function replyBy(minutes: number, hours: { start: number; end: number; days: number[] }, tz: string) {
  const t = todayIn(tz);
  for (let i = 0; i < 8; i++) {
    const noon = zoned(t.y, t.m, t.d + i, 12, 0, tz);
    if (!hours.days.includes(weekdayIndex(noon, tz))) continue;
    const p = partsIn(noon, tz);
    const open = zoned(p.y, p.m, p.d, hours.start, 0, tz).getTime();
    const close = zoned(p.y, p.m, p.d, hours.end, 0, tz).getTime();
    const start = Math.max(open, i === 0 ? Date.now() : open);
    if (start >= close) continue;
    let due = start + minutes * 60_000;
    if (due > close) continue;
    // Round up to the next quarter hour so the promise is a clean time.
    due = Math.ceil(due / 900_000) * 900_000;
    const d = new Date(due);
    return `by ${timeLabel(d, tz)} ${relativeDay(d, tz) === 'today' || relativeDay(d, tz) === 'tomorrow' ? relativeDay(d, tz) : 'on ' + relativeDay(d, tz)}`;
  }
  return 'within one business day';
}
