import type { APIRoute } from 'astro';
import { getImage } from 'astro:assets';
import { brand } from '../lib/brand';
import { img } from '../lib/images';
import {
  listings, agents, neighborhoods, content, formatPrice, shortAddress, fullAddress, listingUrl, agentUrl, mapsLink, statusLabel,
} from '../lib/data';
import chatbot from '../data/chatbot.json';

/**
 * Everything the site assistant knows, built from the same data files as the pages.
 * Fetched once, when a visitor first opens the chat, so it adds nothing to page load.
 */

const digits = (s: string) => s.replace(/\D/g, '');
const usd = (n: number) => `$${n.toLocaleString('en-US')}`;
const fillBrand = (text: string, extra: Record<string, string | number> = {}) =>
  text.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in extra ? String(extra[k]) : m));

const hoodNames = neighborhoods.map((n) => n.name.replace(/^The /, ''));
const hoodList = `${hoodNames.slice(0, -1).join(', ')} and ${hoodNames.at(-1)}`;
const hoursLower = brand.contact.hours.replace(/^Open/, 'open').replace(/^open/, 'open');

const forSale = listings.filter((l) => l.status === 'for-sale');
const rentals = listings.filter((l) => l.status === 'for-rent');
const byPrice = [...forSale].sort((a, b) => a.price - b.price);
const rentalSorted = [...rentals].sort((a, b) => a.price - b.price);
const top = byPrice.at(-1)!;
const low = byPrice[0];
const pendingLow = listings.filter((l) => l.status === 'pending').sort((a, b) => a.price - b.price)[0];

const priceRange =
  `Homes for sale run from ${usd(low.price)} (${shortAddress(low)}, ${neighborhoods.find((n) => n.slug === low.neighborhood)!.name.replace(/^The /, '')}) to ${usd(top.price)} (${shortAddress(top)}). ` +
  (pendingLow ? `One pending home is lower, at ${usd(pendingLow.price)} (${shortAddress(pendingLow)}), but it's in escrow. ` : '') +
  (rentalSorted.length ? `Leases run from ${usd(rentalSorted[0].price)} to ${usd(rentalSorted.at(-1)!.price)} per month.` : '');

const teamList = agents
  .map((a) => `**${a.name}**, ${a.title}. ${a.shortBio}`)
  .join('\n');

const t = content.testimonials[0];
const phones = Object.fromEntries(agents.map((a) => [`${a.firstName.toLowerCase()}Phone`, a.phone]));

const glossary = [
  { terms: ['pending', 'in escrow'], text: 'Pending: a home that is in escrow with a buyer. Tours have stopped.' },
  { terms: ['for lease', 'for rent'], text: 'For lease means available to rent. Lease prices are per month.' },
  { terms: ['escrow'], text: 'In general terms, escrow is the period after an offer is accepted when a neutral third party holds the money and documents until the sale closes.' },
  { terms: ['listing agent'], text: 'The listing agent represents the owner and lists the home. At our firm the same person also shows it and negotiates it.' },
  { terms: ['off market', 'off-market', 'private listing'], text: 'An off-market or private listing is a home sold without a public listing. About a third of our sales are like this.' },
  { terms: ['median days on market', 'days on market'], text: 'Median days on market is the middle value of how long homes took to sell. Ours was 17 days in 2025, against a county median of 34.' },
  { terms: ['median sale price', 'median price', 'median'], text: 'Median sale price is the middle sale price for single-family homes in an area in Q3 2026.' },
  { terms: ['mls', 'multiple listing service'], text: 'The MLS is the Multiple Listing Service, the shared database of listings. We cite the Santa Barbara MLS as the source for neighborhood medians.' },
  { terms: ['dre'], text: `DRE is the California Department of Real Estate. Our brokerage license is ${brand.license}.` },
  { terms: ['casita', 'guest casita'], text: 'A casita is a small separate guest house. 680 Picacho Lane has a two-bedroom guest casita with a kitchen.' },
  { terms: ['scullery'], text: 'A scullery is a secondary kitchen for prep and cleaning. 1190 Pepper Lane has one beside the main kitchen.' },
  { terms: ['pocketing glass'], text: 'Pocketing glass walls slide into the wall to open a room to the outdoors. 1190 Pepper Lane has them on three sides of the main level.' },
  { terms: ['easement'], text: 'An easement is a legal right for someone else to use part of a property, for example for access or utilities. For a specific property, ask the listing agent, or an attorney for legal advice.' },
  { terms: ['south coast'], text: 'The South Coast is the coastal strip of Santa Barbara County where we work.' },
  { terms: ['pink moment'], text: 'The Pink Moment is the local name for the pink glow on the Topa Topa bluffs at sunset, seen from Ojai.' },
];

const toks = {
  name: brand.brokerageName,
  legalName: brand.legalName,
  market: brand.market,
  founded: brand.founded,
  years: new Date().getFullYear() - brand.founded,
  hoods: hoodList,
  phone: brand.contact.phone,
  phoneDigits: digits(brand.contact.phone),
  email: brand.contact.email,
  street: brand.contact.street,
  cityLine: brand.contact.city,
  hours: brand.contact.hours,
  hoursLower,
  mapsUrl: mapsLink(brand.contact.mapsQuery),
  license: brand.license,
  quote: t.quote,
  quoteBy: t.name,
  quoteDetail: t.detail.replace(/^./, (c) => c.toLowerCase()),
  teamList,
  priceRange,
  glossary: glossary.map((g) => g.text).join('\n'),
  ...phones,
};
const f = (s: string) => fillBrand(s, toks);

export const GET: APIRoute = async () => {
  const hoodBySlug = Object.fromEntries(neighborhoods.map((n) => [n.slug, n.name]));
  const listingsOut = await Promise.all(
    listings.map(async (l) => {
      const cover = l.images[0];
      const thumb = await getImage({ src: img(cover.src), width: 240, height: 170, fit: 'cover', format: 'webp', quality: 70 });
      return {
        id: l.id,
        ref: l.id.toUpperCase(),
        slug: l.slug,
        url: listingUrl(l),
        title: l.title,
        street: shortAddress(l),
        address: fullAddress(l),
        price: l.price,
        unit: l.priceUnit ?? null,
        priceLabel: formatPrice(l),
        status: l.status,
        statusLabel: statusLabel[l.status],
        beds: l.bedrooms,
        baths: l.bathrooms,
        sqft: l.sqft,
        lot: l.lotAcres,
        year: l.yearBuilt,
        type: l.propertyType,
        hood: l.neighborhood,
        hoodName: hoodBySlug[l.neighborhood],
        agentId: l.agentId,
        listed: l.listedDate,
        featured: l.featured,
        summary: l.summary,
        description: l.description.join(' '),
        features: l.features,
        thumb: thumb.src,
        thumbAlt: cover.alt,
      };
    }),
  );

  const body = {
    brand: {
      id: brand.id,
      name: brand.brokerageName,
      legalName: brand.legalName,
      market: brand.market,
      founded: brand.founded,
      license: brand.license,
      phone: brand.contact.phone,
      email: brand.contact.email,
      street: brand.contact.street,
      city: brand.contact.city,
      hours: brand.contact.hours,
      mapsUrl: mapsLink(brand.contact.mapsQuery),
      tz: brand.site.timezone,
      tourMinutes: brand.booking.tourLengthMinutes,
      callMinutes: brand.booking.callLengthMinutes,
      daysAhead: brand.booking.daysAhead,
      responseTime: brand.leads.responseTime,
      responseMinutes: brand.leads.responseMinutes,
    },
    stats: content.stats,
    listings: listingsOut,
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      first: a.firstName,
      title: a.title,
      short: a.shortBio,
      bio: a.bio.join(' '),
      areas: a.areas,
      languages: a.languages,
      phone: a.phone,
      email: a.email,
      license: a.license,
      years: a.yearsActive,
      homes: a.homesSold,
      volume: a.salesVolume,
      response: a.responseTime,
      hours: a.hours,
      listingIds: a.listingIds,
      url: agentUrl(a),
    })),
    hoods: neighborhoods.map((n) => ({
      slug: n.slug,
      name: n.name,
      plain: n.name.replace(/^The /, ''),
      median: n.medianPrice,
      days: n.medianDays,
      summary: n.summary,
      body: n.body,
      url: `/neighborhoods/#${n.slug}`,
    })),
    contactPaths: content.contactPaths.map((p) => ({ id: p.id, agentId: p.agentId })),
    glossary,
    welcome: f(chatbot.welcome),
    demoNote: chatbot.demoNote,
    starters: chatbot.starters.map((s) => ({ label: f(s.label), send: f(s.send) })),
    faqs: chatbot.faqs.map((q) => ({
      id: q.id,
      q: q.q.map(f),
      a: f(q.a),
      links: ((q as { links?: { label: string; href: string }[] }).links ?? []).map((l) => ({ label: f(l.label), href: f(l.href) })),
      actions: (q as { actions?: string[] }).actions ?? [],
      chips: ((q as { chips?: string[] }).chips ?? []).map(f),
    })),
  };

  const json = JSON.stringify(body);
  const unfilled = json.match(/\{\{\w+\}\}/g);
  if (unfilled) throw new Error(`chat-knowledge: unfilled tokens ${[...new Set(unfilled)].join(', ')}`);

  return new Response(json, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
