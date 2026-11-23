/**
 * Turns the brand's six raw colours into the CSS custom properties the site uses.
 *
 * Text-bearing tokens are derived, not hand-picked: each one is nudged toward
 * ink (or toward the light base) until it clears WCAG AA against the surface it
 * sits on. Swapping in a new prospect's palette therefore can't silently break
 * contrast — the worst case is a slightly deeper accent than the raw hex.
 */
import type { Brand } from './brand';

type RGB = [number, number, number];

const hexToRgb = (hex: string): RGB => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const rgbToHex = ([r, g, b]: RGB) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export const luminance = (hex: string) => {
  const [r, g, b] = hexToRgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Linear mix: t=0 returns a, t=1 returns b. */
export const mix = (a: string, b: string, t: number) => {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t) as RGB);
};

/** Move `color` toward `toward` in small steps until it reaches `min` contrast on every background. */
const ensure = (color: string, toward: string, backgrounds: string[], min = 4.5) => {
  for (let t = 0; t <= 1; t += 0.02) {
    const c = mix(color, toward, t);
    if (backgrounds.every((bg) => contrast(c, bg) >= min)) return c;
  }
  return toward;
};

export interface ThemeReportRow {
  pair: string;
  ratio: number;
  min: number;
}

export function buildTheme(brand: Brand) {
  const base = brand.baseColor;
  const ink = brand.primaryColor;
  const accent = brand.accentColor;
  const secondary = brand.secondaryColor;
  const tertiary = brand.tertiaryColor;
  const surface = brand.surfaceColor;

  const baseDeep = (brand as { mutedColor?: string }).mutedColor ?? mix(base, ink, 0.05);
  // Body copy that is quieter than ink but still AA on every light surface, including the muted band.
  const inkMuted = ensure(mix(ink, base, 0.42), ink, [base, surface, baseDeep], 4.6);
  // Accent used as text (links, prices) on light backgrounds.
  const accentText = ensure(accent, ink, [base, surface, baseDeep], 4.6);
  // Accent used as a filled button. Light accents (e.g. a sand or blush) keep their colour
  // and take ink text; dark accents take light text. Either way the pair clears AA.
  const accentTakesInk = contrast(ink, accent) >= contrast(surface, accent);
  const accentFill = accentTakesInk ? ensure(accent, surface, [ink], 4.6) : ensure(accent, ink, [surface], 4.6);
  const accentFillText = accentTakesInk ? ink : surface;
  const accentFillHover = mix(accentFill, accentTakesInk ? surface : ink, 0.18);
  // Dark-mode brands (dark page, light text) use the page tokens for their dark sections too.
  const isDark = luminance(base) < 0.2;
  // Accent used as text on dark sections.
  const accentOnDark = isDark ? accentText : ensure(accent, base, [secondary, ink], 4.6);
  // Quiet text on dark sections.
  const onDarkMuted = isDark ? inkMuted : ensure(mix(base, secondary, 0.35), base, [secondary, ink], 4.6);
  // Status tag fills: tertiary tint with ink text.
  const tertiaryTint = mix(tertiary, surface, 0.72);
  const tertiaryText = ensure(tertiary, ink, [base, surface, tertiaryTint], 4.6);
  const line = mix(base, ink, 0.16);
  const lineStrong = mix(base, ink, 0.32);

  const vars: Record<string, string> = {
    '--c-base': base,
    '--c-base-deep': baseDeep,
    '--c-ink': ink,
    '--c-ink-muted': inkMuted,
    '--c-accent': accent,
    '--c-accent-text': accentText,
    '--c-accent-fill': accentFill,
    '--c-accent-fill-hover': accentFillHover,
    '--c-accent-fill-text': accentFillText,
    '--c-accent-on-dark': accentOnDark,
    '--c-secondary': secondary,
    '--c-tertiary': tertiary,
    '--c-tertiary-tint': tertiaryTint,
    '--c-tertiary-text': tertiaryText,
    '--c-surface': surface,
    '--c-on-dark-muted': onDarkMuted,
    '--c-line': line,
    '--c-line-strong': lineStrong,
    // Fixed colours that don't flip with the theme: text over photographs, and the deepest band.
    '--c-on-photo': '#FFFFFF',
    '--c-deep': isDark ? secondary : ink,
    '--c-deep-text': isDark ? ink : surface,
    '--f-display': `"${brand.fontHeading}", "Iowan Old Style", Georgia, serif`,
    '--f-body': `"${brand.fontBody}", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`,
  };

  const report: ThemeReportRow[] = [
    { pair: 'ink on base', ratio: contrast(ink, base), min: 4.5 },
    { pair: 'ink on surface', ratio: contrast(ink, surface), min: 4.5 },
    { pair: 'muted ink on base', ratio: contrast(inkMuted, base), min: 4.5 },
    { pair: 'muted ink on muted band', ratio: contrast(inkMuted, baseDeep), min: 4.5 },
    { pair: 'accent text on base', ratio: contrast(accentText, base), min: 4.5 },
    { pair: 'text on accent button', ratio: contrast(accentFillText, accentFill), min: 4.5 },
    { pair: 'ink on muted band', ratio: contrast(ink, baseDeep), min: 4.5 },
    { pair: 'text on deep band', ratio: contrast(isDark ? ink : surface, secondary), min: 4.5 },
    { pair: 'accent on secondary', ratio: contrast(accentOnDark, secondary), min: 4.5 },
    { pair: 'muted on secondary', ratio: contrast(onDarkMuted, secondary), min: 4.5 },
    { pair: 'ink on tertiary tag', ratio: contrast(ink, tertiaryTint), min: 4.5 },
    // Focus rings use ink on light surfaces and the on-dark accent on dark ones (see global.css).
    { pair: 'focus ring (ink) on base', ratio: contrast(ink, base), min: 3 },
    { pair: 'focus ring (accent) on secondary', ratio: contrast(accentOnDark, secondary), min: 3 },
  ];

  return { vars, report };
}

export const cssVarBlock = (vars: Record<string, string>) =>
  `:root{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')}}`;
