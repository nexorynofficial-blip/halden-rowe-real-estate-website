/**
 * The chat panel: loads the knowledge file, runs the engine and draws the conversation.
 * Loaded the first time someone opens the assistant, never with the page.
 */
import { createBot, type Knowledge, type Reply, type Session, type Chip, type ChatBooking } from './engine';
import { store, profile, track, submitLead, FieldError } from '../core';
import { formatPhone } from '../forms';

interface Entry { role: 'user' | 'bot'; text?: string; reply?: Reply }
interface Saved { v: 1; entries: Entry[]; session: Session }

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MAX_ENTRIES = 40;

let resolveReady!: () => void;
let rejectReady!: (e: unknown) => void;
const ready = new Promise<void>((res, rej) => { resolveReady = res; rejectReady = rej; });
let focusInput: () => void = () => {};
let scrollEnd: () => void = () => {};
let greetIfEmpty: () => Promise<void> = async () => {};

/** Called by the launcher each time the panel opens. */
export async function onOpen(focus: boolean) {
  await ready;
  await greetIfEmpty();
  scrollEnd();
  if (focus && !window.matchMedia('(max-width: 640px)').matches) focusInput();
  track('chat_open', { page: location.pathname });
}

export function mount(root: HTMLElement) {
  const log = root.querySelector<HTMLElement>('[data-chat-log]')!;
  const form = root.querySelector<HTMLFormElement>('[data-chat-form]')!;
  const input = form.querySelector<HTMLInputElement>('input')!;
  const sendBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const brandId = (window as unknown as { __SITE__?: { brand?: string } }).__SITE__?.brand ?? 'site';
  const SAVE_KEY = `${brandId}:chat`;

  init().catch((e) => { rejectReady(e); });

  async function init() {
    const res = await fetch('/chat-knowledge.json');
    if (!res.ok) throw new Error(`knowledge ${res.status}`);
    const k = (await res.json()) as Knowledge;

    const bookings = {
      list(): ChatBooking[] {
        const all = store.get<ChatBooking[]>('chat-bookings') ?? [];
        const live = all.filter((b) => new Date(b.slot).getTime() > Date.now() - 3600_000);
        if (live.length !== all.length) store.set('chat-bookings', live);
        return live;
      },
      add(b: ChatBooking) { store.set('chat-bookings', [...bookings.list(), b]); },
      remove(ref: string) { store.set('chat-bookings', bookings.list().filter((b) => b.ref !== ref)); },
    };
    const bot = createBot(k, {
      submitLead,
      profile,
      bookings,
      FieldError: FieldError as unknown as new (...a: unknown[]) => Error & { field: string },
      formatPhone,
      track,
    });

    // Where the visitor is, so the assistant can speak to the home or person on screen.
    const page: Session['page'] = {};
    const lm = location.pathname.match(/^\/listings\/([^/]+)\/?$/);
    if (lm) page.listingId = k.listings.find((l) => l.slug === lm[1])?.id;
    const am = location.pathname.match(/^\/agents\/([^/]+)\/?$/);
    if (am) page.agentId = k.agents.find((a) => a.id === am[1])?.id;
    if (location.pathname.startsWith('/neighborhoods')) page.hood = k.hoods.find((h) => `#${h.slug}` === location.hash)?.slug;

    let entries: Entry[] = [];
    let session: Session = bot.newSession(page);
    try {
      const raw = sessionStorage.getItem(SAVE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Saved;
        if (saved.v === 1 && Array.isArray(saved.entries)) {
          entries = saved.entries;
          session = { ...bot.newSession(page), ...saved.session, page, flow: saved.session.flow ?? null };
          if (page.listingId) session.ctx = { ...session.ctx, listingId: page.listingId };
          if (page.agentId) session.ctx = { ...session.ctx, agentId: page.agentId };
        }
      }
    } catch { /* start fresh */ }

    const save = () => {
      try { sessionStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, entries: entries.slice(-MAX_ENTRIES), session } satisfies Saved)); } catch { /* private mode */ }
    };

    // ---------- drawing ----------

    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    };

    const INLINE = /(\*\*[^*]+\*\*)|(\(\d{3}\) \d{3}-\d{4})|([\w.+-]+@[\w-]+\.[\w.-]+)/g;
    const inline = (parent: HTMLElement, text: string) => {
      let last = 0;
      for (const m of text.matchAll(INLINE)) {
        const i = m.index ?? 0;
        if (i > last) parent.append(text.slice(last, i));
        if (m[1]) parent.append(el('strong', undefined, m[1].slice(2, -2)));
        else if (m[2]) { const a = el('a', undefined, m[2]); a.href = `tel:${m[2].replace(/\D/g, '')}`; parent.append(a); }
        else if (m[3]) { const a = el('a', undefined, m[3]); a.href = `mailto:${m[3]}`; parent.append(a); }
        last = i + m[0].length;
      }
      if (last < text.length) parent.append(text.slice(last));
    };
    const rich = (parent: HTMLElement, text: string, linkify: boolean) => {
      if (!linkify) { text.split('\n').forEach((line, i) => { if (i) parent.append(el('br')); parent.append(line); }); return; }
      for (const block of text.split(/\n{2,}/)) {
        const lines = block.split('\n');
        let i = 0;
        while (i < lines.length) {
          if (lines[i].startsWith('- ')) {
            const ul = el('ul');
            while (i < lines.length && lines[i].startsWith('- ')) { const li = el('li'); inline(li, lines[i].slice(2)); ul.append(li); i++; }
            parent.append(ul);
          } else {
            const p = el('p');
            const chunk: string[] = [];
            while (i < lines.length && !lines[i].startsWith('- ')) chunk.push(lines[i++]);
            chunk.forEach((line, n) => { if (n) p.append(el('br')); inline(p, line); });
            parent.append(p);
          }
        }
      }
    };

    const chipKind = (label: string) =>
      /^(Confirm booking|Send it|Sign me up|Yes, cancel it|Use these)$/.test(label) ? 'primary' : /^(Cancel|Keep it|Keep them)$/.test(label) ? 'quiet' : undefined;

    let chipsEl: HTMLElement | null = null;
    const clearChips = () => { chipsEl?.remove(); chipsEl = null; };
    const drawChips = (chips: Chip[], extra: HTMLElement[] = []) => {
      clearChips();
      if (!chips.length && !extra.length) return;
      const wrap = el('div', 'chat-chips');
      wrap.setAttribute('role', 'group');
      wrap.setAttribute('aria-label', 'Suggested replies');
      for (const c of chips) {
        const b = el('button', 'chat-chip', c.label);
        b.type = 'button';
        const kind = chipKind(c.label);
        if (kind) b.dataset.kind = kind;
        b.addEventListener('click', () => send(c.send ?? c.label));
        wrap.append(b);
      }
      extra.forEach((x) => wrap.append(x));
      log.append(wrap);
      chipsEl = wrap;
    };

    const icsButton = (ics: { filename: string; content: string }) => {
      const b = el('button', 'chat-chip', 'Add to calendar');
      b.type = 'button';
      b.addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([ics.content], { type: 'text/calendar' }));
        const a = el('a');
        a.href = url; a.download = ics.filename;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      });
      return b;
    };

    const addUser = (text: string) => {
      const m = el('div', 'chat-msg');
      m.dataset.role = 'user';
      const b = el('div', 'chat-bubble');
      rich(b, text, false);
      m.append(b);
      log.append(m);
      return b;
    };

    const addBot = (r: Reply, last: boolean) => {
      const m = el('div', 'chat-msg');
      m.dataset.role = 'bot';
      if (r.tone) m.dataset.tone = r.tone;
      const bubble = el('div', 'chat-bubble');
      rich(bubble, r.text, true);
      m.append(bubble);
      if (r.facts?.length) {
        const dl = el('dl', 'chat-facts');
        for (const [a, b] of r.facts) { dl.append(el('dt', undefined, a)); dl.append(el('dd', undefined, b)); }
        m.append(dl);
      }
      if (r.cards?.length) {
        const wrap = el('div', 'chat-cards');
        for (const c of r.cards) {
          const a = el('a', 'chat-card');
          a.href = c.href;
          const img = el('img');
          img.src = c.thumb; img.alt = ''; img.width = 240; img.height = 170; img.loading = 'lazy'; img.decoding = 'async';
          const t = el('span');
          t.append(el('span', 'chat-card-title', c.title), el('span', 'chat-card-meta', c.meta), el('span', 'chat-card-sub', c.sub));
          a.append(img, t);
          wrap.append(a);
        }
        m.append(wrap);
      }
      if (r.links?.length) {
        const wrap = el('div', 'chat-links');
        for (const l of r.links) {
          const a = el('a', undefined, l.label);
          a.href = l.href;
          if (/^https?:/.test(l.href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
          wrap.append(a);
        }
        m.append(wrap);
      }
      if (r.note) m.append(el('p', 'chat-note', r.note));
      log.append(m);
      if (last) drawChips(r.chips ?? [], r.ics ? [icsButton(r.ics)] : []);
      return m;
    };

    let typingEl: HTMLElement | null = null;
    const showTyping = () => {
      if (typingEl) return;
      typingEl = el('div', 'chat-typing');
      typingEl.setAttribute('aria-hidden', 'true');
      typingEl.append(el('span'), el('span'), el('span'));
      log.append(typingEl);
      toEnd();
    };
    const hideTyping = () => { typingEl?.remove(); typingEl = null; };

    const toEnd = () => { log.scrollTo({ top: log.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' }); };
    scrollEnd = () => { log.scrollTop = log.scrollHeight; };
    // Long answers start at their first line; short ones sit at the bottom.
    const revealMsg = (m: HTMLElement) => {
      if (m.offsetHeight > log.clientHeight * 0.75) log.scrollTo({ top: Math.max(0, m.offsetTop - 12), behavior: reduced() ? 'auto' : 'smooth' });
      else toEnd();
    };

    const delayFor = (text: string, first: boolean) => (reduced() ? 80 : Math.min(first ? 1300 : 900, (first ? 420 : 320) + text.length * (first ? 5 : 3)));

    // ---------- conversation ----------

    let busy = false;
    async function send(raw: string) {
      const text = raw.trim();
      if (!text || busy) return;
      busy = true;
      sendBtn.disabled = true;
      clearChips();
      const userBubble = addUser(text);
      const userEntry: Entry = { role: 'user', text };
      entries.push(userEntry);
      toEnd();
      showTyping();
      input.value = '';
      root.dispatchEvent(new CustomEvent('chat:chatted'));
      const started = performance.now();
      try {
        const replies = await bot.respond(text, session);
        if (replies[0]?.redactUser) {
          userBubble.textContent = 'Details hidden';
          userEntry.text = 'Details hidden';
        }
        for (let i = 0; i < replies.length; i++) {
          const r = replies[i];
          const elapsed = performance.now() - started;
          await wait(Math.max(0, delayFor(r.text, i === 0) - (i === 0 ? elapsed : 0)));
          hideTyping();
          const m = addBot(r, i === replies.length - 1);
          entries.push({ role: 'bot', reply: r });
          revealMsg(m);
          if (i < replies.length - 1) { showTyping(); }
        }
        track('chat_message', { intent: replies[0]?.intent ?? 'unknown' });
      } catch {
        hideTyping();
        const r: Reply = { text: `Something went wrong on my side. You can reach us on ${k.brand.phone}, or try again.`, tone: 'error', chips: [{ label: 'Try again', send: text }] };
        addBot(r, true);
        entries.push({ role: 'bot', reply: r });
      } finally {
        busy = false;
        sendBtn.disabled = false;
        save();
        if (document.activeElement === input || document.activeElement === document.body) { /* keep the keyboard where it was */ }
      }
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });

    root.querySelector('[data-chat-restart]')!.addEventListener('click', async () => {
      if (busy) return;
      entries = [];
      session = bot.newSession(page);
      log.replaceChildren();
      chipsEl = null;
      save();
      await greetIfEmpty();
      focusInput();
    });

    focusInput = () => input.focus({ preventScroll: true });

    // Bring back the conversation, or start one.
    const restore = () => {
      log.replaceChildren();
      log.classList.add('chat-restored');
      entries.forEach((e, i) => {
        if (e.role === 'user') { const b = addUser(e.text ?? ''); void b; }
        else if (e.reply) addBot(e.reply, i === entries.length - 1);
      });
      requestAnimationFrame(() => log.classList.remove('chat-restored'));
    };
    let greeted = false;
    greetIfEmpty = async () => {
      if (entries.length) {
        if (!greeted) { greeted = true; restore(); }
        return;
      }
      if (greeted && log.querySelector('.chat-msg')) return;
      greeted = true;
      log.replaceChildren();
      showTyping();
      await wait(reduced() ? 60 : 450);
      hideTyping();
      const g = bot.greeting(session);
      g.note = k.demoNote;
      addBot(g, true);
      entries.push({ role: 'bot', reply: g });
      save();
    };

    document.querySelectorAll('[data-chat-loading]').forEach((n) => n.remove());
    resolveReady();
  }
}
