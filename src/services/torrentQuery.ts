import { chat, aiConfigured } from './ai.js';
import { logger } from './logger.js';
import { normaliseCategory } from './1337xParse.js';

/**
 * Turns how people actually talk into something a torrent index can answer.
 *
 * "that new villeneuve dune in 4k" has to become a search for `dune part two`
 * filtered to 2160p, because no release is ever named the way somebody asks
 * for it. That translation is the one part of the pipeline a language model is
 * genuinely better at than regexes.
 *
 * Three rules hold it in place:
 *
 *   - it never blocks a search. A model that is unconfigured, slow, rate
 *     limited or talking nonsense falls back to the literal query.
 *   - it only runs when the query looks like a sentence. `oppenheimer` and
 *     `Show.S01E04.1080p.WEB-DL` are already answerable, so they skip it and
 *     cost nothing.
 *   - whatever it decides is shown to the user, who can search literally
 *     instead. A silent wrong guess is worse than no guess.
 */

/** Well under the model's own 90s ceiling: a search cannot wait that long. */
const AI_TIMEOUT_MS = 10_000;
const CACHE_MAX_ENTRIES = 200;
const CACHE_TTL_MS = 60 * 60 * 1000;
/**
 * A reading that failed is remembered only briefly. Free models are rate
 * limited constantly, and holding on to "this could not be interpreted" for an
 * hour would keep punishing a query long after the quota came back.
 */
const FAILURE_TTL_MS = 90 * 1000;

/**
 * An instruction model, not the big reasoning one `/ask` uses — that answers
 * a request for JSON with several paragraphs of deliberation.
 *
 * Free model ids on OpenRouter come and go, so a missing model must degrade to
 * a literal search rather than break `/torrent`; that is what the catch in
 * `planQuery` is for. If interpretation stops happening, check `/aimodel list`
 * and set `TORRENT_QUERY_MODEL` to something current.
 */
const FALLBACK_QUERY_MODELS = [
  // Answers with clean JSON reliably, a few seconds per call.
  'google/gemma-4-26b-a4b-it:free',
  // Around a second, but rambles before the JSON often enough to be second.
  'inclusionai/ling-3.0-flash:free',
];

export interface QueryPlan {
  /** What to send to the indexer. */
  search: string;
  category?: string;
  resolution?: string;
  season?: number;
  episode?: number;
  year?: number;
  /** True when a model rewrote the query rather than passing it through. */
  interpreted: boolean;
  /** One line describing the reading, shown so the user can correct it. */
  note?: string;
}

const cache = new Map<string, { expires: number; plan: QueryPlan }>();

function cacheGet(key: string): QueryPlan | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.plan;
}

function cacheSet(key: string, plan: QueryPlan, ttl = CACHE_TTL_MS): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { expires: Date.now() + ttl, plan });
}

export function clearQueryPlanCache(): void {
  cache.clear();
}

const literal = (query: string): QueryPlan => ({ search: query, interpreted: false });

/**
 * Whether a query is worth spending a model call on.
 *
 * Short queries and anything already shaped like a release name are better
 * searched verbatim — rewriting them can only lose information.
 */
export function needsInterpretation(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length < 8) return false;

  // Already a release name: dots between words, an episode tag, a resolution.
  if (/\b(s\d{1,2} ?e\d{1,3}|\d{3,4}p|x26[45]|hevc|bluray|web ?dl|webrip)\b/i.test(trimmed)) {
    return false;
  }
  if (/\w\.\w+\./.test(trimmed)) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;

  // Sentence-ish: a phrase people would say rather than type into an indexer.
  return true;
}

const SYSTEM_PROMPT = [
  'You convert a user request into torrent search parameters.',
  'Reply with ONE JSON object and nothing else. No prose, no explanation, no code fences.',
  'The key for the title is exactly "search". Other allowed keys: category, resolution, season, episode, year.',
  '"search" must be the plain title ONLY.',
  'Never put a year, resolution, codec, source, episode tag or website name inside "search".',
  'Resolve a description to the actual title when you are confident.',
  'Example: "that new villeneuve dune movie in 4k" -> {"search":"Dune Part Two","category":"Movies","resolution":"2160p","year":2024}',
  'Example: "the office us season 3" -> {"search":"The Office","category":"TV","season":3}',
  'Example: "spiderman brand new day" -> {"search":"Spider-Man Brand New Day","category":"Movies"}',
  'category must be one of Movies, TV, Games, Music, Apps, Anime, Documentaries, Other, or omitted.',
  'resolution must be one of 2160p, 1080p, 720p, 480p, or omitted.',
  'season, episode and year are integers or omitted.',
  'Omit any key you are not confident about. Never invent a title you do not recognise:',
  'if unsure, copy the user text into "search" unchanged.',
].join(' ');

/** Models like to wrap JSON in prose or fences however firmly you ask them not to. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced?.[1] ?? text;

  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;

  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

const RESOLUTIONS = new Set(['2160p', '1080p', '720p', '480p']);

function wholeNumber(value: unknown, max: number): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) return undefined;
  return parsed;
}

/**
 * Turns whatever the model said into a plan, discarding any field that is not
 * one of the values we asked for. A model is never trusted to stay in range.
 */
/**
 * Models pick their own key names however plainly you name one, so the title
 * is accepted under any of the obvious spellings before giving up.
 */
const TITLE_KEYS = ['search', 'query', 'title', 'name', 'q'];

/** Site names and quality tags a model leaves in the title and should not. */
const SEARCH_NOISE =
  /\b(1337x(\.to)?|torrents?|yts|yify|rarbg|piratebay|thepiratebay|magnet|download|\d{3,4}p|4k|uhd|hdr|x26[45]|hevc|blu-?ray|web-?dl|web-?rip|remux)\b/gi;

/**
 * Pulls the title back out of whatever the model wrote in the title field.
 *
 * `{"query":"Dune 2021 4K 1337x"}` is a real answer a model gave: the key was
 * wrong and the value carried a year, a resolution and the site's own name.
 * Searching that verbatim finds nothing, so the extras are lifted into the
 * fields they belong in and stripped from the title.
 */
function cleanSearch(raw: string): { search: string; resolution?: string; year?: number } {
  let text = raw.trim();
  let resolution: string | undefined;
  let year: number | undefined;

  const resolutionMatch = /\b(2160p|1080p|720p|480p|4k|uhd)\b/i.exec(text);
  if (resolutionMatch) {
    const found = resolutionMatch[1]!.toLowerCase();
    resolution = found === '4k' || found === 'uhd' ? '2160p' : found;
  }

  const yearMatch = /\b(19\d{2}|20\d{2})\b/.exec(text);
  if (yearMatch) year = Number(yearMatch[1]);

  text = text
    .replace(SEARCH_NOISE, ' ')
    .replace(/\b(19\d{2}|20\d{2})\b/g, ' ')
    .replace(/[[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { search: text, resolution, year };
}

export function planFromModel(raw: unknown, original: string): QueryPlan {
  if (typeof raw !== 'object' || raw === null) return literal(original);

  const shaped = raw as Record<string, unknown>;

  const titleKey = TITLE_KEYS.find((key) => typeof shaped[key] === 'string' && shaped[key]);
  if (!titleKey) return literal(original);

  const cleaned = cleanSearch(shaped[titleKey] as string);
  // Everything was noise, so there is no title left to search for.
  if (!cleaned.search) return literal(original);

  const declared =
    typeof shaped.resolution === 'string' ? shaped.resolution.toLowerCase() : undefined;
  const resolution =
    declared && RESOLUTIONS.has(declared)
      ? declared
      : declared === '4k' || declared === 'uhd'
        ? '2160p'
        : cleaned.resolution;

  const plan: QueryPlan = {
    search: cleaned.search,
    category: normaliseCategory(typeof shaped.category === 'string' ? shaped.category : undefined),
    resolution,
    season: wholeNumber(shaped.season, 99),
    episode: wholeNumber(shaped.episode, 999),
    year: wholeNumber(shaped.year, 2099) ?? cleaned.year,
    interpreted: true,
  };

  if (plan.year !== undefined && plan.year < 1900) plan.year = undefined;

  // Nothing was actually added, so do not claim an interpretation happened.
  const changed =
    plan.search.toLowerCase() !== original.trim().toLowerCase() ||
    plan.category !== undefined ||
    plan.resolution !== undefined ||
    plan.season !== undefined ||
    plan.year !== undefined;

  if (!changed) return literal(original);

  plan.note = describePlan(plan);
  return plan;
}

export function describePlan(plan: QueryPlan): string {
  const parts = [plan.search];
  if (plan.year !== undefined) parts.push(`(${plan.year})`);
  if (plan.season !== undefined) {
    const season = `S${String(plan.season).padStart(2, '0')}`;
    parts.push(
      plan.episode !== undefined
        ? `${season}E${String(plan.episode).padStart(2, '0')}`
        : `${season}`,
    );
  }

  const tail = [plan.category, plan.resolution].filter(Boolean).join(', ');
  return tail ? `${parts.join(' ')} — ${tail}` : parts.join(' ');
}

/**
 * Best-effort reading of a query. Always resolves; never throws.
 */
export async function planQuery(query: string): Promise<QueryPlan> {
  const trimmed = query.trim();
  if (!aiConfigured() || !needsInterpretation(trimmed)) return literal(trimmed);

  const key = trimmed.toLowerCase();
  const cached = cacheGet(key);
  if (cached) return cached;

  /**
   * Free models are unavailable often — rate limited, or quietly retired from
   * OpenRouter's catalogue — so a short ordered list beats one hard-coded id.
   * The whole loop shares one deadline, so trying a second never doubles the
   * wait a user actually sees.
   */
  const models = [process.env.TORRENT_QUERY_MODEL, ...FALLBACK_QUERY_MODELS].filter(
    (model): model is string => Boolean(model),
  );

  const deadline = Date.now() + AI_TIMEOUT_MS;

  const attempt = async (): Promise<QueryPlan> => {
    let lastError: unknown;

    for (const model of models) {
      const remaining = deadline - Date.now();
      if (remaining <= 500) break;

      try {
        const result = await Promise.race([
          chat(
            [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: trimmed },
            ],
            {
              model,
              // Headroom so a model that thinks out loud before the JSON does
              // not get cut off mid-object.
              maxTokens: 400,
              temperature: 0,
            },
          ),
          // The underlying call has a 90s timeout it cannot be talked out of;
          // losing this race just means the literal search goes ahead.
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('query interpretation timed out')), remaining),
          ),
        ]);

        const plan = planFromModel(extractJson(result.text), trimmed);
        // A model that answered but told us nothing is not worth caching for
        // an hour; another one may do better in a moment.
        cacheSet(key, plan, plan.interpreted ? CACHE_TTL_MS : FAILURE_TTL_MS);
        logger.debug({ query: trimmed, model, plan: plan.note ?? 'literal' }, 'Query interpreted');
        return plan;
      } catch (err) {
        lastError = err;
        logger.debug({ err, model }, 'Query interpretation model unavailable, trying the next');
      }
    }

    throw lastError ?? new Error('no query model available');
  };

  try {
    return await attempt();
  } catch (err) {
    logger.debug({ err, query: trimmed }, 'Query interpretation unavailable, searching literally');
    const fallback = literal(trimmed);
    // Briefly, so a passing rate limit does not disable interpretation for an
    // hour on a query somebody is retrying right now.
    cacheSet(key, fallback, FAILURE_TTL_MS);
    return fallback;
  }
}
