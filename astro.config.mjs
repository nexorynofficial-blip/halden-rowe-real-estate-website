// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import { readFileSync } from 'node:fs';

// The site URL comes from the active brand so sitemap and Open Graph tags are right per prospect.
const brandId = process.env.BRAND || 'halden-rowe';
const brand = JSON.parse(readFileSync(new URL(`./src/data/brands/${brandId}.json`, import.meta.url), 'utf8'));

export default defineConfig({
  site: process.env.SITE_URL || brand.site.url,
  trailingSlash: 'always',
  integrations: [sitemap({ filter: (page) => !page.includes('/compare/') })],
  image: {
    // Generate AVIF + WebP at these breakpoints; originals are never shipped.
    responsiveStyles: false,
  },
  build: { inlineStylesheets: 'always' },
  // Content Security Policy: Astro hashes every inline script and style it emits into a <meta> tag.
  // External origins are limited to what the site uses (analytics, Cal.com booking, map tiles).
  security: {
    csp: {
      algorithm: 'SHA-256',
      directives: [
        "default-src 'self'",
        "img-src 'self' data: https://tile.openstreetmap.org https://api.mapbox.com",
        "font-src 'self'",
        "connect-src 'self' https:",
        "frame-src https://app.cal.com https://cal.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
      scriptDirective: { resources: ["'self'", 'https://plausible.io', 'https://app.cal.com'] },
      // Inline style attributes carry animation timings (e.g. style="--d:0.2s"); no inline <style> needs it.
      styleDirective: { resources: ["'self'", { resource: "'unsafe-inline'", kind: 'attribute' }] },
    },
  },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  // Cast: @tailwindcss/vite ships types for a newer Vite than Astro 5 bundles. Runtime is fine.
  vite: { plugins: [/** @type {any} */ (tailwindcss())] },
});
