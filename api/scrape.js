export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // ── OO RESOURCE LINK FINDER ───────────────────────────────────────────────
  if (req.query.action === 'oo-resources') {
    const base = 'https://www.ollyolly.com';
    const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; OllyOllyBot/1.0)' };
    const sig = AbortSignal.timeout(8000);
    const allUrls = new Set();

    const extractLinks = (text, base) => {
      const fromHref = [...text.matchAll(/href=["']([^"'#]+)["']/g)].map(m => m[1]);
      const fromLoc  = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
      return [...fromHref, ...fromLoc]
        .map(u => u.startsWith('http') ? u : u.startsWith('/') ? base + u : null)
        .filter(u => u && u.includes('ollyolly.com'));
    };

    // Try sitemaps
    const sitemapPaths = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-0.xml', '/server-sitemap.xml', '/page-sitemap.xml'];
    await Promise.allSettled(sitemapPaths.map(async path => {
      try {
        const text = await fetch(base + path, { headers, signal: sig }).then(r => r.ok ? r.text() : '');
        extractLinks(text, base).forEach(u => allUrls.add(u));
      } catch {}
    }));

    // Try case study / results pages directly
    const pagePaths = ['/case-studies', '/results', '/client-stories', '/work', '/success-stories', '/clients'];
    await Promise.allSettled(pagePaths.map(async path => {
      try {
        const text = await fetch(base + path, { headers, signal: sig }).then(r => r.ok ? r.text() : '');
        extractLinks(text, base).forEach(u => allUrls.add(u));
      } catch {}
    }));

    // Try homepage too
    try {
      const text = await fetch(base, { headers, signal: sig }).then(r => r.text());
      extractLinks(text, base).forEach(u => allUrls.add(u));
    } catch {}

    // Filter to likely case study / resource URLs
    const keywords = /accent|forte|greenoak|green-oak|case-stud|result|client|success|stor|work|blog|resource/i;
    const resourceUrls = [...allUrls].filter(u => keywords.test(u));
    const allOO = [...allUrls].filter(u => !u.includes('/_next') && !u.includes('/api/'));

    return res.status(200).json({
      resourceUrls,
      allUrls: allOO.slice(0, 60),
    });
  }

  const { website, name, city, state } = req.query;
  const out = { schemaType: '', title: '', description: '', h1: '', gbpCategory: '', gbpRating: null, gbpReviews: null, gbpWebsite: '', gbpFound: false };

  await Promise.all([
    // ── Website HTML scrape ─────────────────────────────────────────────────
    website ? (async () => {
      try {
        const url = website.startsWith('http') ? website : `https://${website}`;
        const html = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OllyOllyBot/1.0)' },
          signal: AbortSignal.timeout(6000),
        }).then(r => r.text());

        out.title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '';
        out.description = (
          html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
          html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1] || ''
        ).trim().slice(0, 300);
        out.h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim().slice(0, 120) || '';

        // Schema.org @type — prefer specific types over generic ones
        const skip = new Set(['WebPage','WebSite','Organization','LocalBusiness','BreadcrumbList','ItemList','SiteLinksSearchBox','SearchAction']);
        const types = [...html.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map(m => m[1]).filter(t => !skip.has(t));
        out.schemaType = types[0] || '';

        // Extract links if requested (for resource lookups)
        if (req.query.links === '1') {
          const base = url.replace(/\/$/, '');
          const seen = new Set();
          out.links = [...html.matchAll(/href=["']([^"'#?]+)["']/g)]
            .map(m => m[1].startsWith('http') ? m[1] : m[1].startsWith('/') ? base + m[1] : null)
            .filter(l => l && !seen.has(l) && seen.add(l))
            .filter(l => l.includes(new URL(base).hostname))
            .slice(0, 40);
        }
      } catch {}
    })() : Promise.resolve(),

    // ── Google Places API ───────────────────────────────────────────────────
    (name && process.env.GOOGLE_PLACES_API_KEY) ? (async () => {
      try {
        const q = [name, city, state].filter(Boolean).join(' ');
        const search = await fetch(
          `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&key=${process.env.GOOGLE_PLACES_API_KEY}`
        ).then(r => r.json());

        const placeId = search.results?.[0]?.place_id;
        if (!placeId) return;

        const details = await fetch(
          `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=types,rating,user_ratings_total,website,business_status&key=${process.env.GOOGLE_PLACES_API_KEY}`
        ).then(r => r.json());

        const p = details.result || {};
        const skip = new Set(['point_of_interest', 'establishment', 'local_business', 'general_contractor']);
        const category = (p.types || []).find(t => !skip.has(t))?.replace(/_/g, ' ') || '';
        out.gbpCategory = category;
        out.gbpRating = p.rating || null;
        out.gbpReviews = p.user_ratings_total ?? null;
        out.gbpWebsite = p.website || '';
        out.gbpFound = !!p.business_status;
      } catch {}
    })() : Promise.resolve(),
  ]);

  res.status(200).json(out);
}
