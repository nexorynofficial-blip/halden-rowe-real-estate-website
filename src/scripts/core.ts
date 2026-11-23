/** Shared browser helpers: storage, analytics, lead delivery. */

declare global {
  interface Window {
    __SITE__: { brand: string; plausible: string; ga4: string; webhook: string; timezone: string };
    plausible?: (event: string, opts?: { props?: Record<string, unknown> }) => void;
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

const ns = () => `${window.__SITE__?.brand ?? 'site'}:`;

export const store = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(ns() + key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try { localStorage.setItem(ns() + key, JSON.stringify(value)); } catch { /* private mode */ }
  },
  remove(key: string) {
    try { localStorage.removeItem(ns() + key); } catch { /* ignore */ }
  },
};

export interface Profile { name?: string; email?: string; phone?: string; replyBy?: string }
export const profile = {
  get: () => store.get<Profile>('profile') ?? {},
  save: (p: Profile) => store.set('profile', { ...profile.get(), ...p }),
  clear: () => store.remove('profile'),
};

/** Analytics: forwards to Plausible / GA4 when configured and always emits a DOM event. */
export function track(event: string, props: Record<string, unknown> = {}) {
  try {
    window.plausible?.(event, { props });
    window.gtag?.('event', event, props);
    (window.dataLayer ??= []).push({ event, ...props });
    document.dispatchEvent(new CustomEvent('site:track', { detail: { event, props } }));
  } catch { /* never let analytics break a flow */ }
}

/** Query flags used to demonstrate error states live: ?demo=slot-taken or ?demo=submit-error */
export const demoFlag = (name: string) => new URLSearchParams(location.search).getAll('demo').includes(name);

export class FieldError extends Error {
  constructor(public field: string, message: string) { super(message); }
}

/**
 * Sends a lead to the CRM webhook (same pipeline as the missed-lead follow-up bot).
 * Without a webhook configured the demo simulates delivery.
 */
export async function submitLead(payload: Record<string, unknown>) {
  const body = {
    ...payload,
    source: location.href,
    brand: window.__SITE__?.brand,
    submittedAt: new Date().toISOString(),
  };
  const url = window.__SITE__?.webhook;
  if (url) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
    return;
  }
  await new Promise((r) => setTimeout(r, 650));
  if (demoFlag('submit-error') && !sessionStorage.getItem('demo-error-shown')) {
    sessionStorage.setItem('demo-error-shown', '1');
    throw new FieldError('email', 'This address bounced when we tried it. Check it for a typo, or choose text instead.');
  }
}

export const reference = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

/** Expand/collapse helper shared by booking and inquiry panels. Only one panel per group stays open. */
export function setPanel(panel: HTMLElement, trigger: HTMLElement | null, open: boolean) {
  panel.dataset.open = String(open);
  panel.toggleAttribute('inert', !open);
  trigger?.setAttribute('aria-expanded', String(open));
  if (open) {
    const group = panel.dataset.group;
    if (group) {
      document.querySelectorAll<HTMLElement>(`[data-group="${group}"][data-open="true"]`).forEach((other) => {
        if (other !== panel) other.dispatchEvent(new CustomEvent('panel:close'));
      });
    }
  }
}
