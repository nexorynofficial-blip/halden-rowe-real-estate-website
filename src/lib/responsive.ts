import { getImage } from 'astro:assets';
import { img } from './images';

/**
 * Builds AVIF/WebP/JPG srcsets for an above-the-fold image so the exact same
 * URLs can be used in a <link rel="preload"> and in the <picture> element.
 */
export async function pictureSources(name: string, widths = [640, 960, 1280, 1600, 2000, 2560], quality = 58) {
  const meta = img(name);
  const ws = widths.filter((w) => w <= meta.width);
  const build = async (format: 'avif' | 'webp' | 'jpg', q: number) => {
    const out = await Promise.all(ws.map((w) => getImage({ src: meta, width: w, format, quality: q })));
    return out.map((o, i) => `${o.src} ${ws[i]}w`).join(', ');
  };
  const [avif, webp, jpg] = await Promise.all([build('avif', quality), build('webp', quality + 12), build('jpg', quality + 18)]);
  const fallback = await getImage({ src: meta, width: Math.min(1600, meta.width), format: 'jpg', quality: quality + 18 });
  return { avif, webp, jpg, fallback: fallback.src, width: meta.width, height: meta.height };
}
