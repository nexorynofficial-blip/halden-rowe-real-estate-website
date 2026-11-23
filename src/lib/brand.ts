/**
 * The re-skin lever. Every brand lives in src/data/brands/<id>.json.
 * Pick one at build time with BRAND=<id> (defaults to DEFAULT_BRAND below).
 *
 *   BRAND=calder-sloane npm run build
 */
import haldenRowe from '../data/brands/halden-rowe.json';

export type Brand = typeof haldenRowe;

const DEFAULT_BRAND = 'halden-rowe';

const brands = import.meta.glob<Brand>('../data/brands/*.json', { eager: true, import: 'default' });

function pick(): Brand {
  const id = (process.env.BRAND || import.meta.env.BRAND || DEFAULT_BRAND).trim();
  const match = Object.entries(brands).find(([path]) => path.endsWith(`/${id}.json`));
  if (!match) {
    const known = Object.keys(brands).map((p) => p.split('/').pop()?.replace('.json', ''));
    throw new Error(`Unknown BRAND "${id}". Available: ${known.join(', ')}`);
  }
  return match[1];
}

export const brand: Brand = pick();

/** Replace {{tokens}} in copy so content files don't hardcode the brokerage name. */
export function fill(text: string, extra: Record<string, string | number> = {}) {
  const values: Record<string, string | number> = {
    brokerageName: brand.brokerageName,
    market: brand.market,
    founded: brand.founded,
    ...extra,
  };
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? ''));
}
