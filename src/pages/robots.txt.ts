import type { APIRoute } from 'astro';

// Generated per build so the sitemap URL follows the active brand's domain.
export const GET: APIRoute = ({ site }) =>
  new Response(`User-agent: *\nDisallow: /compare/\nDisallow: /chat-knowledge.json\n\nSitemap: ${new URL('/sitemap-index.xml', site)}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
