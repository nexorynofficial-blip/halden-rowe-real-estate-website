import type { ImageMetadata } from 'astro';

// Every photo under src/assets is processed by Astro at build time
// (resized, converted to AVIF/WebP). Data files reference them by filename only.
const files = import.meta.glob<{ default: ImageMetadata }>('../assets/**/*.{jpg,jpeg,png,webp}', { eager: true });

export function img(name: string): ImageMetadata {
  const key = Object.keys(files).find((k) => k.endsWith(`/${name}`));
  if (!key) throw new Error(`Image not found in src/assets: ${name}`);
  return files[key].default;
}
