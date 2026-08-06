import { logger } from './logger.js';

const BROWSERLESS_URL = process.env.BROWSERLESS_URL ?? 'http://browserless:3000';
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN ?? 'zenitsu-local';
const TIMEOUT_MS = 60_000;

export class InspectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InspectError';
  }
}

export interface SiteImage {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
  kind: 'img' | 'background' | 'svg' | 'social';
}

export interface SiteFont {
  family: string;
  usage: number;
  weights: string[];
}

export interface SiteColor {
  hex: string;
  usage: number;
  /** Set when the colour came from a CSS custom property on :root. */
  variable?: string;
}

export interface DetectedTech {
  name: string;
  category: string;
  version?: string;
}

export interface SiteReport {
  url: string;
  finalUrl: string;
  title: string;
  description?: string;
  themeColor?: string;
  favicons: string[];
  socialImage?: string;
  colors: SiteColor[];
  fonts: SiteFont[];
  fontSources: string[];
  images: SiteImage[];
  tech: DetectedTech[];
  headers: Record<string, string>;
  stats: { images: number; scripts: number; stylesheets: number; domNodes: number };
}

/**
 * Runs inside the rendered page via browserless.
 *
 * It has to execute in-page rather than parse fetched HTML: computed styles are
 * the only way to learn the colours and fonts a site actually renders with, and
 * on any SPA the interesting markup does not exist until scripts have run.
 */
const EXTRACTOR = String.raw`
export default async ({ page }) => {
  const response = await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  const headers = response ? response.headers() : {};

  // Let late webfonts and lazy images settle.
  await new Promise((r) => setTimeout(r, 1200));

  const data = await page.evaluate(() => {
    const abs = (u) => { try { return new URL(u, location.href).href; } catch { return null; } };

    const rgbToHex = (value) => {
      const m = String(value).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(',').map((n) => parseFloat(n.trim()));
      const [r, g, b, a] = parts;
      if (parts.length > 3 && a < 0.1) return null;
      if ([r, g, b].some((n) => Number.isNaN(n))) return null;
      return '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
    };

    // ---------------------------------------------------------- identity
    const meta = (sel, attr) => document.querySelector(sel)?.getAttribute(attr || 'content') || null;

    const favicons = [...document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"], link[rel="mask-icon"]')]
      .map((l) => abs(l.getAttribute('href')))
      .filter(Boolean);
    favicons.push(abs('/favicon.ico'));

    // -------------------------------------------------------- CSS variables
    // Design systems usually declare their palette here, so these are the
    // most meaningful colours on the page.
    const rootStyle = getComputedStyle(document.documentElement);
    const cssVars = [];
    for (let i = 0; i < rootStyle.length; i++) {
      const prop = rootStyle[i];
      if (!prop.startsWith('--')) continue;
      const val = rootStyle.getPropertyValue(prop).trim();
      const hex = val.startsWith('#') ? val.slice(0, 7) : rgbToHex(val);
      if (hex) cssVars.push({ variable: prop, hex: hex.toLowerCase() });
    }

    // ------------------------------------------------- computed colours/fonts
    const colorCount = new Map();
    const fontCount = new Map();
    const fontWeights = new Map();
    const backgrounds = new Set();

    const nodes = [...document.querySelectorAll('body *')].slice(0, 3000);

    for (const el of nodes) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;

      const cs = getComputedStyle(el);
      const area = Math.min(rect.width * rect.height, 400000);

      for (const prop of ['color', 'backgroundColor', 'borderTopColor']) {
        const hex = rgbToHex(cs[prop]);
        if (!hex) continue;
        // Weight by painted area so a full-bleed hero outranks a tiny label.
        const weight = prop === 'backgroundColor' ? area : area / 20;
        colorCount.set(hex, (colorCount.get(hex) || 0) + weight);
      }

      const family = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
      if (family) {
        fontCount.set(family, (fontCount.get(family) || 0) + 1);
        if (!fontWeights.has(family)) fontWeights.set(family, new Set());
        fontWeights.get(family).add(cs.fontWeight);
      }

      const bg = cs.backgroundImage;
      if (bg && bg !== 'none') {
        for (const m of bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
          const u = abs(m[1]);
          if (u && !u.startsWith('data:')) backgrounds.add(u);
        }
      }
    }

    // ------------------------------------------------------------- images
    const images = [...document.images].slice(0, 200).map((img) => ({
      url: img.currentSrc || img.src,
      width: img.naturalWidth || undefined,
      height: img.naturalHeight || undefined,
      alt: img.alt || undefined,
      kind: 'img',
    })).filter((i) => i.url && !i.url.startsWith('data:'));

    for (const url of [...backgrounds].slice(0, 60)) {
      images.push({ url, kind: 'background' });
    }

    // ------------------------------------------------------- font sources
    const fontSources = new Set();
    for (const link of document.querySelectorAll('link[href]')) {
      const href = link.getAttribute('href') || '';
      if (/fonts\.googleapis|fonts\.gstatic|use\.typekit|fonts\.bunny|fontawesome/i.test(href)) {
        fontSources.add(abs(href));
      }
    }
    try {
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; } // cross-origin
        if (!rules) continue;
        for (const rule of rules) {
          if (rule.constructor?.name === 'CSSFontFaceRule' || rule.type === 5) {
            const src = rule.style?.getPropertyValue('src') || '';
            const m = src.match(/url\(["']?([^"')]+)["']?\)/);
            if (m) { const u = abs(m[1]); if (u) fontSources.add(u); }
          }
        }
      }
    } catch {}

    // ------------------------------------------------------ tech signals
    const scripts = [...document.scripts].map((s) => s.src).filter(Boolean);
    const links = [...document.querySelectorAll('link[href]')].map((l) => l.href);
    const globals = Object.keys(window).slice(0, 800);

    return {
      title: document.title || '',
      description: meta('meta[name="description"]') || meta('meta[property="og:description"]') || null,
      themeColor: meta('meta[name="theme-color"]'),
      generator: meta('meta[name="generator"]'),
      socialImage: abs(meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') || ''),
      favicons: [...new Set(favicons)],
      cssVars: cssVars.slice(0, 40),
      colors: [...colorCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24),
      fonts: [...fontCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([family, usage]) => ({ family, usage, weights: [...(fontWeights.get(family) || [])].sort() })),
      fontSources: [...fontSources].slice(0, 10),
      images,
      scripts: scripts.slice(0, 120),
      links: links.slice(0, 60),
      globals,
      html: document.documentElement.outerHTML.slice(0, 60000),
      stats: {
        images: document.images.length,
        scripts: document.scripts.length,
        stylesheets: document.styleSheets.length,
        domNodes: document.getElementsByTagName('*').length,
      },
      finalUrl: location.href,
    };
  });

  return { data: { ...data, headers }, type: 'application/json' };
};
`;

interface Fingerprint {
  name: string;
  category: string;
  scripts?: RegExp;
  html?: RegExp;
  globals?: string[];
  headers?: { name: string; pattern?: RegExp };
  generator?: RegExp;
}

/**
 * Hand-written fingerprints for the technologies that actually show up.
 *
 * Wappalyzer's own ruleset is roughly 2,500 entries and is no longer open
 * source, so this covers the common cases rather than claiming parity.
 */
const FINGERPRINTS: Fingerprint[] = [
  // Frameworks
  {
    name: 'Next.js',
    category: 'Framework',
    scripts: /\/_next\//,
    globals: ['__NEXT_DATA__'],
    html: /id="__next"/,
  },
  { name: 'Nuxt', category: 'Framework', scripts: /\/_nuxt\//, globals: ['__NUXT__'] },
  {
    name: 'React',
    category: 'Framework',
    globals: ['React', '__REACT_DEVTOOLS_GLOBAL_HOOK__'],
    html: /data-reactroot|data-reactid/,
  },
  { name: 'Vue', category: 'Framework', globals: ['__VUE__', 'Vue'], html: /data-v-[a-f0-9]{8}/ },
  {
    name: 'Angular',
    category: 'Framework',
    globals: ['ng', 'getAllAngularRootElements'],
    html: /ng-version=/,
  },
  { name: 'Svelte', category: 'Framework', scripts: /svelte/i, html: /class="svelte-/ },
  { name: 'Astro', category: 'Framework', html: /astro-island|<astro-/ },
  { name: 'Remix', category: 'Framework', globals: ['__remixContext'] },
  { name: 'Gatsby', category: 'Framework', globals: ['___gatsby'], html: /id="___gatsby"/ },
  { name: 'HTMX', category: 'Framework', scripts: /htmx/i, html: /hx-(get|post|swap)=/ },

  // CMS and platforms
  { name: 'WordPress', category: 'CMS', html: /wp-content|wp-includes/, generator: /WordPress/i },
  { name: 'Shopify', category: 'Ecommerce', globals: ['Shopify'], scripts: /cdn\.shopify\.com/ },
  { name: 'Webflow', category: 'CMS', generator: /Webflow/i, html: /w-mod-js|data-wf-page/ },
  { name: 'Squarespace', category: 'CMS', html: /squarespace/i, generator: /Squarespace/i },
  { name: 'Wix', category: 'CMS', html: /wix\.com|_wixCssStates/, generator: /Wix/i },
  { name: 'Ghost', category: 'CMS', generator: /Ghost/i },
  { name: 'Drupal', category: 'CMS', generator: /Drupal/i, globals: ['Drupal'] },
  { name: 'Sanity', category: 'CMS', scripts: /cdn\.sanity\.io/ },
  { name: 'Contentful', category: 'CMS', scripts: /ctfassets\.net/ },

  // Analytics
  {
    name: 'Google Analytics',
    category: 'Analytics',
    scripts: /google-analytics\.com|gtag\/js/,
    globals: ['gtag', 'ga', 'dataLayer'],
  },
  { name: 'Google Tag Manager', category: 'Analytics', scripts: /googletagmanager\.com\/gtm/ },
  { name: 'Plausible', category: 'Analytics', scripts: /plausible\.io/ },
  { name: 'Fathom', category: 'Analytics', scripts: /usefathom\.com/ },
  { name: 'Umami', category: 'Analytics', scripts: /umami/i },
  { name: 'Hotjar', category: 'Analytics', scripts: /hotjar\.com/, globals: ['hj'] },
  { name: 'Mixpanel', category: 'Analytics', scripts: /mixpanel/i, globals: ['mixpanel'] },
  { name: 'Segment', category: 'Analytics', scripts: /segment\.(com|io)/, globals: ['analytics'] },
  { name: 'PostHog', category: 'Analytics', scripts: /posthog/i, globals: ['posthog'] },
  { name: 'Amplitude', category: 'Analytics', scripts: /amplitude/i, globals: ['amplitude'] },
  { name: 'Vercel Analytics', category: 'Analytics', scripts: /\/_vercel\/insights/ },
  { name: 'Cloudflare Insights', category: 'Analytics', scripts: /cloudflareinsights\.com/ },

  // CSS and UI
  {
    name: 'Tailwind CSS',
    category: 'CSS',
    html: /class="[^"]*\b(flex|grid|text-(xs|sm|base|lg|xl)|bg-(white|black|gray-\d00)|p[xytblr]?-\d)\b/,
  },
  {
    name: 'Bootstrap',
    category: 'CSS',
    scripts: /bootstrap/i,
    html: /class="[^"]*\b(container-fluid|navbar-expand|col-md-\d)\b/,
  },
  { name: 'Bulma', category: 'CSS', html: /class="[^"]*\b(is-primary|column is-)\b/ },
  { name: 'Material UI', category: 'CSS', html: /class="[^"]*\bMui[A-Z]/ },
  { name: 'Styled Components', category: 'CSS', html: /class="[^"]*\bsc-[a-zA-Z0-9]{6}/ },
  {
    name: 'Font Awesome',
    category: 'Icons',
    html: /class="[^"]*\bfa[srlbd]?\s+fa-/,
    scripts: /fontawesome/i,
  },

  // Libraries
  { name: 'jQuery', category: 'Library', globals: ['jQuery', '$'], scripts: /jquery/i },
  { name: 'GSAP', category: 'Library', globals: ['gsap', 'TweenMax'], scripts: /gsap/i },
  { name: 'Three.js', category: 'Library', globals: ['THREE'], scripts: /three(\.min)?\.js/ },
  { name: 'Lottie', category: 'Library', scripts: /lottie/i, globals: ['lottie'] },
  { name: 'Alpine.js', category: 'Library', globals: ['Alpine'], html: /x-data=/ },
  { name: 'D3', category: 'Library', globals: ['d3'], scripts: /d3(\.min)?\.js/ },

  // Hosting and CDN
  { name: 'Cloudflare', category: 'CDN', headers: { name: 'cf-ray' } },
  { name: 'Vercel', category: 'Hosting', headers: { name: 'x-vercel-id' } },
  { name: 'Netlify', category: 'Hosting', headers: { name: 'x-nf-request-id' } },
  {
    name: 'GitHub Pages',
    category: 'Hosting',
    headers: { name: 'server', pattern: /GitHub\.com/i },
  },
  { name: 'Fastly', category: 'CDN', headers: { name: 'x-served-by', pattern: /cache-/ } },
  { name: 'Amazon CloudFront', category: 'CDN', headers: { name: 'x-amz-cf-id' } },
  { name: 'Akamai', category: 'CDN', headers: { name: 'x-akamai-transformed' } },

  // Servers
  { name: 'Nginx', category: 'Server', headers: { name: 'server', pattern: /nginx/i } },
  { name: 'Apache', category: 'Server', headers: { name: 'server', pattern: /apache/i } },
  { name: 'Caddy', category: 'Server', headers: { name: 'server', pattern: /caddy/i } },
  { name: 'Express', category: 'Server', headers: { name: 'x-powered-by', pattern: /express/i } },
  { name: 'PHP', category: 'Language', headers: { name: 'x-powered-by', pattern: /php/i } },
  {
    name: 'ASP.NET',
    category: 'Language',
    headers: { name: 'x-powered-by', pattern: /asp\.net/i },
  },

  // Payments and misc
  { name: 'Stripe', category: 'Payments', scripts: /js\.stripe\.com/, globals: ['Stripe'] },
  { name: 'PayPal', category: 'Payments', scripts: /paypal\.com\/sdk/ },
  { name: 'Intercom', category: 'Support', scripts: /intercom/i, globals: ['Intercom'] },
  { name: 'Crisp', category: 'Support', scripts: /crisp\.chat/ },
  { name: 'Sentry', category: 'Monitoring', scripts: /sentry/i, globals: ['Sentry', '__SENTRY__'] },
  { name: 'reCAPTCHA', category: 'Security', scripts: /recaptcha/i, globals: ['grecaptcha'] },
  { name: 'Cloudflare Turnstile', category: 'Security', scripts: /challenges\.cloudflare\.com/ },
];

function detectTech(raw: any): DetectedTech[] {
  const found: DetectedTech[] = [];
  const scripts: string = (raw.scripts ?? []).join(' ') + ' ' + (raw.links ?? []).join(' ');
  const html: string = raw.html ?? '';
  const globals: string[] = raw.globals ?? [];
  const headers: Record<string, string> = raw.headers ?? {};
  const generator: string = raw.generator ?? '';

  for (const fp of FINGERPRINTS) {
    let hit = false;

    if (fp.scripts?.test(scripts)) hit = true;
    if (!hit && fp.html?.test(html)) hit = true;
    if (!hit && fp.generator?.test(generator)) hit = true;
    if (!hit && fp.globals?.some((g) => globals.includes(g))) hit = true;

    if (!hit && fp.headers) {
      const value = headers[fp.headers.name.toLowerCase()];
      if (value !== undefined && (!fp.headers.pattern || fp.headers.pattern.test(value)))
        hit = true;
    }

    if (hit) found.push({ name: fp.name, category: fp.category });
  }

  // A framework implies React; listing both is noise.
  const implied: Record<string, string[]> = {
    'Next.js': ['React'],
    Gatsby: ['React'],
    Remix: ['React'],
    Nuxt: ['Vue'],
  };
  const names = new Set(found.map((f) => f.name));
  const suppressed = new Set<string>();
  for (const [parent, children] of Object.entries(implied)) {
    if (names.has(parent)) children.forEach((c) => suppressed.add(c));
  }

  return found.filter((f) => !suppressed.has(f.name));
}

export async function inspectSite(url: URL): Promise<SiteReport> {
  const script = EXTRACTOR.replace('TARGET_URL', JSON.stringify(url.toString()));

  let payload: any;
  try {
    const response = await fetch(
      `${BROWSERLESS_URL}/function?token=${encodeURIComponent(BROWSERLESS_TOKEN)}`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'Content-Type': 'application/javascript' },
        body: script,
      },
    );

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      logger.warn({ status: response.status, detail }, 'Site inspection failed');
      throw new InspectError(
        response.status === 408
          ? 'That page took too long to load.'
          : 'Could not load that page. It may be blocking automated browsers.',
      );
    }

    payload = ((await response.json()) as { data?: unknown }).data;
  } catch (err) {
    if (err instanceof InspectError) throw err;
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new InspectError('That page took too long to inspect.');
    }
    logger.error({ err, url: url.toString() }, 'Site inspection threw');
    throw new InspectError('Could not inspect that page.');
  }

  // CSS custom properties come first: they are the declared palette, so they
  // are more meaningful than whatever happens to cover the most pixels.
  const varColors: SiteColor[] = (payload.cssVars ?? [])
    .filter((v: any) => /^#[0-9a-f]{6}$/i.test(v.hex))
    .map((v: any) => ({ hex: v.hex.toLowerCase(), usage: 0, variable: v.variable }));

  const computed: SiteColor[] = (payload.colors ?? []).map(([hex, usage]: [string, number]) => ({
    hex: hex.toLowerCase(),
    usage,
  }));

  const seen = new Set<string>();
  const colors: SiteColor[] = [];
  for (const c of [...varColors, ...computed]) {
    if (seen.has(c.hex)) continue;
    seen.add(c.hex);
    colors.push(c);
  }

  const images: SiteImage[] = (payload.images ?? []).filter(
    (i: SiteImage, idx: number, all: SiteImage[]) => all.findIndex((x) => x.url === i.url) === idx,
  );

  if (payload.socialImage) {
    images.unshift({ url: payload.socialImage, kind: 'social', alt: 'Social preview' });
  }

  return {
    url: url.toString(),
    finalUrl: payload.finalUrl ?? url.toString(),
    title: payload.title || url.hostname,
    description: payload.description ?? undefined,
    themeColor: payload.themeColor ?? undefined,
    favicons: (payload.favicons ?? []).filter(Boolean),
    socialImage: payload.socialImage ?? undefined,
    colors: colors.slice(0, 24),
    fonts: payload.fonts ?? [],
    fontSources: payload.fontSources ?? [],
    images,
    tech: detectTech(payload),
    headers: payload.headers ?? {},
    stats: payload.stats ?? { images: 0, scripts: 0, stylesheets: 0, domNodes: 0 },
  };
}
