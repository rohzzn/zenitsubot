import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import { parsePirateBay } from '../src/services/sources/piratebay.js';
import { parseNyaa } from '../src/services/sources/nyaa.js';
import { parseSolidTorrents } from '../src/services/sources/solidtorrents.js';
import {
  DEFAULT_SOURCE_IDS,
  magnetFromHash,
  SOURCES,
  sourcesFor,
} from '../src/services/sources/index.js';
import { parseFitGirlPost, parseFitGirlSearch } from '../src/services/sources/fitgirl.js';

const HASH_A = '2770FE270845674966E184BE60ED1BE0FE494F3A';
const HASH_B = '3FDA0314469B5D30593265BF9CF168F27DA7B8AE';

describe('The Pirate Bay', () => {
  // Shaped exactly as apibay answers, strings and all.
  const rows = [
    {
      id: '75005578',
      name: 'Dune Part Two (2024) [1080p] [WEBRip]',
      info_hash: HASH_A,
      leechers: '258',
      seeders: '1160',
      size: '2968337547',
      num_files: '3',
      username: 'vtwin88cube',
      added: '1712378383',
      status: 'vip',
      category: '207',
      imdb: 'tt15239678',
    },
  ];

  it('reads a row, numbers and all', () => {
    const [result] = parsePirateBay(rows);

    expect(result).toMatchObject({
      source: 'piratebay',
      id: '75005578',
      title: 'Dune Part Two (2024) [1080p] [WEBRip]',
      infoHash: HASH_A,
      category: 'Movies',
      type: 'Movies HD',
      sizeBytes: 2_968_337_547,
      seeders: 1160,
      leechers: 258,
      uploader: 'vtwin88cube',
      trusted: true,
    });
    expect(result?.uploadedAt).toBe(new Date(1_712_378_383 * 1000).toISOString());
    expect(result?.magnet).toContain(`urn:btih:${HASH_A}`);
  });

  it('drops the sentinel row an empty search returns', () => {
    expect(
      parsePirateBay([
        {
          id: '0',
          name: 'No results returned',
          info_hash: '0000000000000000000000000000000000000000',
          leechers: '0',
          seeders: '0',
          size: '0',
          num_files: '0',
          username: '',
          added: '0',
          status: '',
          category: '0',
        },
      ]),
    ).toEqual([]);
  });

  it('maps the category ranges to something a person recognises', () => {
    const category = (id: string) => parsePirateBay([{ ...rows[0]!, category: id }])[0]?.category;

    expect(category('401')).toBe('Games');
    expect(category('101')).toBe('Music');
    expect(category('301')).toBe('Apps');
    expect(category('205')).toBe('TV');
    expect(category('207')).toBe('Movies');
    expect(category('505')).toBe('XXX');
  });

  it('ignores a row with no usable hash', () => {
    expect(parsePirateBay([{ ...rows[0]!, info_hash: 'nonsense' }])).toEqual([]);
  });
});

describe('Nyaa', () => {
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:nyaa="https://nyaa.si/xmlns/nyaa">
<channel>
  <item>
    <title>[SubsPlease] Some Show - 04 (1080p) [ABCD1234].mkv</title>
    <link>https://nyaa.si/download/2142568.torrent</link>
    <guid isPermaLink="true">https://nyaa.si/view/2142568</guid>
    <pubDate>Thu, 06 Aug 2026 06:37:19 -0000</pubDate>
    <nyaa:seeders>24</nyaa:seeders>
    <nyaa:leechers>4</nyaa:leechers>
    <nyaa:downloads>51</nyaa:downloads>
    <nyaa:infoHash>${HASH_B.toLowerCase()}</nyaa:infoHash>
    <nyaa:categoryId>1_2</nyaa:categoryId>
    <nyaa:category>Anime - English-translated</nyaa:category>
    <nyaa:size>1.4 GiB</nyaa:size>
    <nyaa:trusted>Yes</nyaa:trusted>
  </item>
  <item>
    <title>Broken entry with no hash</title>
    <guid isPermaLink="true">https://nyaa.si/view/99</guid>
    <nyaa:seeders>1</nyaa:seeders>
  </item>
</channel></rss>`;

  it('reads the feed, hash and all', () => {
    const results = parseNyaa(feed);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      source: 'nyaa',
      id: '2142568',
      title: '[SubsPlease] Some Show - 04 (1080p) [ABCD1234].mkv',
      pageUrl: 'https://nyaa.si/view/2142568',
      infoHash: HASH_B,
      category: 'Anime',
      // The "Anime - " prefix is noise once the category is already Anime.
      type: 'English-translated',
      sizeBytes: 1_503_238_553,
      seeders: 24,
      leechers: 4,
      downloads: 51,
      trusted: true,
    });
    expect(results[0]?.uploadedAt).toBe('2026-08-06T06:37:19.000Z');
  });

  it('survives an empty or malformed feed', () => {
    expect(parseNyaa('<rss><channel></channel></rss>')).toEqual([]);
    expect(parseNyaa('not xml at all')).toEqual([]);
    expect(parseNyaa('')).toEqual([]);
  });
});

describe('SolidTorrents', () => {
  it('reads a row', () => {
    const [result] = parseSolidTorrents([
      {
        id: '66108c767a868426cec15eed',
        infohash: HASH_A,
        title: 'Dune Part Two (2024) [1080p] [WEBRip] [YTS.MX]',
        size: 2_968_337_547,
        seeders: 1495,
        leechers: 679,
        verified: true,
        updatedAt: '2026-08-06T15:47:14.616Z',
      },
    ]);

    expect(result).toMatchObject({
      source: 'solidtorrents',
      infoHash: HASH_A,
      sizeBytes: 2_968_337_547,
      seeders: 1495,
      trusted: true,
    });
    // The index reports when it last saw the swarm, which is not an upload date.
    expect(result?.uploadedAt).toBeUndefined();
  });

  it('skips rows without a usable hash or title', () => {
    expect(parseSolidTorrents([{ title: 'No hash' }, { infohash: HASH_A }])).toEqual([]);
    expect(parseSolidTorrents([])).toEqual([]);
  });
});

describe('FitGirl', () => {
  const search = `
    <h1 class="entry-title"><a href="https://fitgirl-repacks.site/elden-ring/">ELDEN RING: Shadow of the Erdtree, v1.12</a></h1>
    <h1 class="entry-title"><a href="https://fitgirl-repacks.site/updates-digest-for-july-27-2026/">Updates Digest for July 27, 2026</a></h1>
    <h1 class="entry-title"><a href="https://fitgirl-repacks.site/upcoming-repacks/">Upcoming repacks</a></h1>
    <h1 class="entry-title"><a href="https://example.com/elsewhere/">Somewhere else entirely</a></h1>`;

  it('keeps the repacks and drops the announcements', () => {
    const results = parseFitGirlSearch(search);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      source: 'fitgirl',
      id: 'elden-ring',
      title: 'ELDEN RING: Shadow of the Erdtree, v1.12',
      pageUrl: 'https://fitgirl-repacks.site/elden-ring/',
      category: 'Games',
      type: 'Repack',
      // One person checking every release by hand is the site's whole point.
      trusted: true,
    });
    // A search result has no magnet yet; the post holds it.
    expect(results[0]?.infoHash).toBeUndefined();
  });

  it('reads the magnet and sizes off a post', () => {
    // Hrefs come HTML-escaped, which is what makes the magnet unusable raw.
    const post = `
      <a href="magnet:?xt=urn:btih:DDC2E96C8654141A9C9161DF7EA0AB77125F0F93&#038;dn=ELDEN+RING">Download</a>
      <p><strong>Original Size:</strong> 26.1 GB</p>
      <p><strong>Repack Size:</strong> 18 GB</p>`;

    const parsed = parseFitGirlPost(post);

    expect(parsed.infoHash).toBe('DDC2E96C8654141A9C9161DF7EA0AB77125F0F93');
    expect(parsed.magnet).toContain('&dn=ELDEN+RING');
    expect(parsed.magnet).not.toContain('&#038;');
    expect(parsed.sizeBytes).toBe(19_327_352_832);
    expect(parsed.originalSizeBytes).toBe(28_024_661_606);
  });

  it('copes with a post that has no magnet at all', () => {
    expect(parseFitGirlPost('<p>Coming soon</p>')).toEqual({
      magnet: undefined,
      infoHash: undefined,
      sizeBytes: undefined,
      originalSizeBytes: undefined,
    });
    expect(parseFitGirlSearch('')).toEqual([]);
  });
});

describe('the source registry', () => {
  it('offers every index and knows what each is for', () => {
    expect(SOURCES.map((s) => s.id)).toEqual([
      '1337x',
      'piratebay',
      'nyaa',
      'solidtorrents',
      'fitgirl',
    ]);
    for (const source of SOURCES) {
      expect(source.label.length).toBeGreaterThan(0);
      expect(source.blurb.length).toBeGreaterThan(0);
    }
  });

  it('searches the two broad indexes unless told otherwise', () => {
    // The specialised ones are a click away in the results, not a cost every
    // ordinary search pays.
    expect(DEFAULT_SOURCE_IDS).toEqual(['1337x', 'piratebay']);
  });

  it('does not ask a source a question it cannot answer', () => {
    const ids = SOURCES.map((s) => s.id);

    // Nyaa has nothing but anime, so a games search must not wait on it.
    expect(sourcesFor('Games', ids).map((s) => s.id)).not.toContain('nyaa');
    expect(sourcesFor('Anime', ids).map((s) => s.id)).toContain('nyaa');
    // FitGirl is the mirror image: games only.
    expect(sourcesFor('Games', ids).map((s) => s.id)).toContain('fitgirl');
    expect(sourcesFor('Movies', ids).map((s) => s.id)).not.toContain('fitgirl');
  });

  it('builds a magnet that can actually find peers', () => {
    const magnet = magnetFromHash(HASH_A.toLowerCase(), 'Some Release');

    expect(magnet).toContain(`magnet:?xt=urn:btih:${HASH_A}`);
    expect(magnet).toContain('dn=Some+Release');
    // A magnet with no trackers depends entirely on the DHT.
    expect(magnet).toContain('tr=udp');
  });
});

describe('searchSources', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.TORRENT_1337X_DOMAINS = 'https://mirror.test';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TORRENT_1337X_DOMAINS;
  });

  it('merges the same release found on two indexes into one row', async () => {
    const { searchSources } = await import('../src/services/sources/index.js');

    fetchMock.mockImplementation((url: URL | string) => {
      const href = String(url);

      if (href.includes('apibay')) {
        return new Response(
          JSON.stringify([
            {
              id: '1',
              name: 'Dune Part Two 2024 1080p',
              info_hash: HASH_A,
              leechers: '10',
              seeders: '900',
              size: '100',
              num_files: '1',
              username: 'u',
              added: '1712378383',
              status: 'vip',
              category: '207',
            },
          ]),
        );
      }
      if (href.includes('solidtorrents')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'x',
                infohash: HASH_A,
                title: 'Dune Part Two 2024 1080p',
                size: 100,
                seeders: 1500,
                leechers: 20,
              },
            ],
          }),
        );
      }
      // 1337x and Nyaa contribute nothing to this one.
      return new Response('', { status: 404 });
    });

    const outcome = await searchSources({
      query: 'dune part two',
      // SolidTorrents is not in the default pair, so it has to be asked for.
      sources: ['1337x', 'piratebay', 'solidtorrents'],
      limit: 10,
    });

    expect(outcome.results).toHaveLength(1);
    // The healthier swarm reading wins when two indexes disagree.
    expect(outcome.results[0]?.seeders).toBe(1500);
    expect(outcome.failures.length).toBeGreaterThan(0);
  });

  it('answers from whichever indexes are up', async () => {
    const { searchSources } = await import('../src/services/sources/index.js');
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('fetch failed')));

    const outcome = await searchSources({ query: 'anything at all', limit: 5 });

    expect(outcome.results).toEqual([]);
    expect(outcome.failures.length).toBeGreaterThan(0);
    // A total outage is reported, not thrown.
    expect(outcome.contributions).toEqual([]);
  });
});
