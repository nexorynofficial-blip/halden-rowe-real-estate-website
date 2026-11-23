import listingsRaw from '../data/listings.json';
import agentsRaw from '../data/agents.json';
import neighborhoodsRaw from '../data/neighborhoods.json';
import content from '../data/content.json';
import { brand } from './brand';

export type ListingStatus = 'for-sale' | 'for-rent' | 'pending';

export interface ListingImage {
  src: string;
  alt: string;
}

export interface Listing {
  id: string;
  slug: string;
  title: string;
  address: { street: string; unit?: string; city: string; state: string; zip: string };
  price: number;
  priceUnit?: 'month';
  status: ListingStatus;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  lotAcres: number | null;
  yearBuilt: number;
  propertyType: string;
  neighborhood: string;
  lat: number;
  lng: number;
  featured: boolean;
  listedDate: string;
  agentId: string;
  summary: string;
  description: string[];
  features: string[];
  images: ListingImage[];
}

export type Agent = (typeof agentsRaw)[number];
export type Neighborhood = (typeof neighborhoodsRaw)[number];

export const listings = listingsRaw as Listing[];
export const agents = agentsRaw as Agent[];
export const neighborhoods = neighborhoodsRaw as Neighborhood[];
export { content };

// Fail the build early if the data files disagree with each other.
for (const l of listings) {
  const agent = agents.find((a) => a.id === l.agentId);
  if (!agent) throw new Error(`Listing ${l.id} references unknown agent "${l.agentId}"`);
  if (!agent.listingIds.includes(l.id))
    throw new Error(`Agent ${agent.id} is missing listing ${l.id} in listingIds`);
  if (!neighborhoods.some((n) => n.slug === l.neighborhood))
    throw new Error(`Listing ${l.id} references unknown neighborhood "${l.neighborhood}"`);
}

export const getAgent = (id: string) => agents.find((a) => a.id === id)!;
export const getListing = (id: string) => listings.find((l) => l.id === id);
export const getNeighborhood = (slug: string) => neighborhoods.find((n) => n.slug === slug)!;
export const listingsFor = (agentId: string) => sortListings(listings.filter((l) => l.agentId === agentId));
export const listingsIn = (slug: string) => listings.filter((l) => l.neighborhood === slug);

const statusRank: Record<ListingStatus, number> = { 'for-sale': 0, 'for-rent': 1, pending: 2 };

/** Default order: featured first, then available before pending, then newest. */
export function sortListings(list: Listing[]) {
  return [...list].sort(
    (a, b) =>
      Number(b.featured) - Number(a.featured) ||
      statusRank[a.status] - statusRank[b.status] ||
      b.listedDate.localeCompare(a.listedDate),
  );
}

export const heroListing = getListing(brand.heroListingId) ?? sortListings(listings)[0];

// ---------- formatting ----------

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-US');

export const formatPrice = (l: Pick<Listing, 'price' | 'priceUnit'>) =>
  l.priceUnit === 'month' ? `${usd.format(l.price)}/mo` : usd.format(l.price);

export const formatCompactPrice = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2).replace(/\.?0+$/, '')}M` : usd.format(n);

export const formatNumber = (n: number) => num.format(n);

export const formatBaths = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export const statusLabel: Record<ListingStatus, string> = {
  'for-sale': 'For sale',
  'for-rent': 'For lease',
  pending: 'Pending',
};

export const fullAddress = (l: Listing) =>
  `${l.address.street}${l.address.unit ? `, ${l.address.unit}` : ''}, ${l.address.city}, ${l.address.state} ${l.address.zip}`;

export const shortAddress = (l: Listing) => `${l.address.street}${l.address.unit ? `, ${l.address.unit}` : ''}`;

export const listingUrl = (l: Listing) => `/listings/${l.slug}/`;
export const agentUrl = (a: Agent) => `/agents/${a.id}/`;

export const mapsLink = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
export const directionsLink = (q: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;

