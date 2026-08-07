import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  Torrent1337xError,
  bestSearchTerm,
  buildSearchPath,
  collapse,
  countMatchingTerms,
  dedupeTrackers,
  distinctiveTerms,
  essentialTerms,
  infoHashFromMagnet,
  is1337xChallengePage,
  is1337xNotFoundPage,
  matchesAllTerms,
  parse1337xDetails,
  parse1337xSearchResults,
  parseCount,
  parseSizeToBytes,
  parseTorrentDate,
  plainText,
  queryTerms,
  rankByRelevance,
  releaseKey,
  slugifyQuery,
  torrentIdFromUrl,
  torrentPath,
} from '../src/services/1337xParse.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

const SEARCH_URL = 'https://www.1337xx.to/sort-search/the-amateur/seeders/desc/1/';
const TORRENT_URL =
  'https://www.1337xx.to/torrent/6419201/The-Amateur-2025-1080p-WEB-DL-DDP5-1-x265-NeoNoir/';

/** Fixed clock so relative dates assert to an exact instant. */
const NOW = new Date('2026-08-06T12:00:00.000Z');

describe('parseSizeToBytes', () => {
  it('converts using binary units, matching the reference scraper', () => {
    expect(parseSizeToBytes('850 KB')).toBe(870_400);
    expect(parseSizeToBytes('1.4 MB')).toBe(1_468_006);
    expect(parseSizeToBytes('2.15 GB')).toBe(2_308_544_921);
    expect(parseSizeToBytes('1 TB')).toBe(1_099_511_627_776);
  });

  it('tolerates the shapes 1337x actually emits', () => {
    expect(parseSizeToBytes('1,024 MB')).toBe(1_073_741_824);
    expect(parseSizeToBytes('1.9GB')).toBe(2_040_109_465);
    expect(parseSizeToBytes(' 512 B ')).toBe(512);
    expect(parseSizeToBytes('1.5 GiB')).toBe(1_610_612_736);
  });

  it('returns undefined rather than a misleading zero', () => {
    expect(parseSizeToBytes('')).toBeUndefined();
    expect(parseSizeToBytes(undefined)).toBeUndefined();
    expect(parseSizeToBytes('unknown')).toBeUndefined();
    expect(parseSizeToBytes('12 QB')).toBeUndefined();
    // A bare number is not a size we can trust.
    expect(parseSizeToBytes('42')).toBeUndefined();
    expect(parseSizeToBytes('1.9 GB extra')).toBeUndefined();
  });
});

describe('parseTorrentDate', () => {
  it('reads the absolute form', () => {
    expect(parseTorrentDate("Jun. 10th '25", NOW)).toBe('2025-06-10T00:00:00.000Z');
    expect(parseTorrentDate("Dec. 16th '10", NOW)).toBe('2010-12-16T00:00:00.000Z');
    expect(parseTorrentDate("Jan. 1st '99", NOW)).toBe('1999-01-01T00:00:00.000Z');
    expect(parseTorrentDate('Mar. 3rd 2024', NOW)).toBe('2024-03-03T00:00:00.000Z');
  });

  it('reads the relative form', () => {
    expect(parseTorrentDate('1 hour ago', NOW)).toBe('2026-08-06T11:00:00.000Z');
    expect(parseTorrentDate('3 days ago', NOW)).toBe('2026-08-03T12:00:00.000Z');
    expect(parseTorrentDate('2 weeks ago', NOW)).toBe('2026-07-23T12:00:00.000Z');
    expect(parseTorrentDate('30 seconds ago', NOW)).toBe('2026-08-06T11:59:30.000Z');
    expect(parseTorrentDate('1 year ago', NOW)).toBe('2025-08-06T06:00:00.000Z');
  });

  it('reads the clock form as earlier the same day', () => {
    expect(parseTorrentDate('11:42 am', NOW)).toBe('2026-08-06T11:42:00.000Z');
    expect(parseTorrentDate('3:32pm', NOW)).toBe('2026-08-06T15:32:00.000Z');
    expect(parseTorrentDate('12:05am', NOW)).toBe('2026-08-06T00:05:00.000Z');
  });

  it('gives up quietly on anything it cannot read', () => {
    expect(parseTorrentDate('', NOW)).toBeUndefined();
    expect(parseTorrentDate(undefined, NOW)).toBeUndefined();
    expect(parseTorrentDate('sometime last winter', NOW)).toBeUndefined();
    expect(parseTorrentDate('7 fortnights ago', NOW)).toBeUndefined();
  });
});

describe('torrentIdFromUrl', () => {
  it('pulls the id out of every shape a link comes in', () => {
    expect(torrentIdFromUrl('/torrent/6419201/The-Amateur/')).toBe(6_419_201);
    expect(torrentIdFromUrl('https://www.1337xx.to/torrent/122701/x/')).toBe(122_701);
    expect(torrentIdFromUrl('/torrent/4711160')).toBe(4_711_160);
    expect(torrentIdFromUrl('/torrent/99?utm=1')).toBe(99);
  });

  it('rejects anything that is not a torrent link', () => {
    expect(torrentIdFromUrl('/user/NeoNoir/')).toBeUndefined();
    expect(torrentIdFromUrl('/torrent/abc/x/')).toBeUndefined();
    expect(torrentIdFromUrl('/torrent//x/')).toBeUndefined();
    expect(torrentIdFromUrl('')).toBeUndefined();
  });

  it('builds the canonical detail path', () => {
    expect(torrentPath(6_419_201)).toBe('/torrent/6419201/-/');
  });
});

describe('infoHashFromMagnet', () => {
  it('reads the hex form', () => {
    expect(
      infoHashFromMagnet('magnet:?xt=urn:btih:495df65f08fb18dfa91a881ec713cc8825865e4d&dn=x'),
    ).toBe('495DF65F08FB18DFA91A881EC713CC8825865E4D');
  });

  it('converts the base32 form', () => {
    // Same 20 bytes as 0x0102...14 in base32.
    expect(infoHashFromMagnet('magnet:?xt=urn:btih:AEBAGBAFAYDQQCIKBMGA2DQPCAIREEYU')).toBe(
      '0102030405060708090A0B0C0D0E0F1011121314',
    );
  });

  it('returns undefined when there is no infohash', () => {
    expect(infoHashFromMagnet('magnet:?dn=nothing')).toBeUndefined();
    expect(infoHashFromMagnet('not a magnet')).toBeUndefined();
    expect(infoHashFromMagnet(undefined)).toBeUndefined();
  });
});

describe('small helpers', () => {
  it('collapses the non-breaking spaces 1337x litters pages with', () => {
    expect(collapse('  a \u00a0 b \n c ')).toBe('a b c');
    expect(parseCount('4\u00a0559')).toBe(4_559);
    expect(slugifyQuery('the\u00a0amateur 2025')).toBe('the-amateur-2025');
  });

  it('parses counts with separators', () => {
    expect(parseCount('37,005')).toBe(37_005);
    expect(parseCount('0')).toBe(0);
    expect(parseCount('-')).toBeUndefined();
    expect(parseCount('')).toBeUndefined();
  });

  it('deduplicates trackers case-insensitively and drops non-URLs', () => {
    expect(
      dedupeTrackers([
        'udp://a.example:1337/announce',
        'UDP://A.EXAMPLE:1337/announce',
        'udp://b.example:80/announce',
        'Working trackers',
        '',
      ]),
    ).toEqual(['udp://a.example:1337/announce', 'udp://b.example:80/announce']);
  });

  it('flattens HTML into text safe for an embed', () => {
    expect(plainText('<p>one<br>two</p><div>three &amp; four</div>')).toBe(
      'one\ntwo\nthree & four',
    );
    expect(plainText('<script>alert(1)</script>')).toBe('alert(1)');
    expect(plainText('')).toBe('');
  });

  it('builds the search paths the site expects', () => {
    expect(slugifyQuery('The Amateur (2025) 1080p!')).toBe('the-amateur-2025-1080p');
    expect(buildSearchPath({ query: 'the amateur' })).toBe(
      '/sort-search/the-amateur/seeders/desc/1/',
    );
    expect(
      buildSearchPath({ query: 'the amateur', category: 'movies', sort: 'time', order: 'asc' }),
    ).toBe('/sort-category-search/the-amateur/Movies/time/asc/1/');
    expect(buildSearchPath({ query: 'x', page: 3 })).toBe('/sort-search/x/seeders/desc/3/');
  });

  it('refuses a query or category it cannot turn into a path', () => {
    expect(() => buildSearchPath({ query: '!!!' })).toThrow(Torrent1337xError);
    expect(() => buildSearchPath({ query: 'x', category: 'Warez' })).toThrow(Torrent1337xError);
  });
});

describe('relevance', () => {
  it('splits a query into the words a title has to contain', () => {
    expect(queryTerms('The Office S01.E02!')).toEqual(['the', 'office', 's01', 'e02']);
  });

  it('drops stopwords and bare numbers from what gets sent to the site', () => {
    // Searching 1337x for "the" would match most of the site.
    expect(distinctiveTerms('the office')).toEqual(['office']);
    expect(distinctiveTerms('ubuntu 24.04')).toEqual(['ubuntu']);
    // Nothing distinctive left: keep everything rather than search for nothing.
    expect(distinctiveTerms('the a of')).toEqual(['the', 'a', 'of']);
  });

  it('does not hold a title to words no release ever contains', () => {
    // The words to match on are a wider set than the words to search for, but
    // both drop the ones a filename would never carry.
    expect(essentialTerms('that new villeneuve dune movie in 4k')).toEqual([
      'new',
      'villeneuve',
      'dune',
    ]);
    expect(essentialTerms('the office')).toEqual(['office']);
    expect(essentialTerms('brand new day')).toEqual(['brand', 'new', 'day']);
    // Nothing left means the query was all filler: keep it as typed.
    expect(essentialTerms('the movie')).toEqual(['the', 'movie']);
  });

  it('picks one rare word to send rather than the whole phrase', () => {
    // The bug this exists for: "brand new day" sorted by seeders never
    // surfaces Spider-Man, because "new" and "day" drag in everything else.
    expect(bestSearchTerm('brand new day')).toBe('brand');
    expect(bestSearchTerm('spiderman brand new day')).toBe('spiderman');
    expect(bestSearchTerm('the office us season 3')).toBe('office');
    expect(bestSearchTerm('breaking bad')).toBe('breaking');
    expect(bestSearchTerm('oppenheimer')).toBe('oppenheimer');
    expect(bestSearchTerm('')).toBeUndefined();
  });

  it('matches words and word prefixes, not loose substrings', () => {
    const terms = queryTerms('the office');
    expect(matchesAllTerms('The.Office.AU.S01.COMPLETE.720p', terms)).toBe(true);
    expect(matchesAllTerms('Mr Bates vs The Post Office 2024', terms)).toBe(true);
    // "the" must not be found inside "Panther", which plain substring matching
    // would have accepted.
    expect(matchesAllTerms('Black Panther office space', terms)).toBe(false);
    expect(matchesAllTerms('The Lion King (2019)', terms)).toBe(false);
    // A prefix of one token still counts, so S01E04 answers "s01".
    expect(matchesAllTerms('Show.S01E04.1080p', queryTerms('show s01'))).toBe(true);
  });

  it('gives the same release the same key across mirrors', () => {
    // Different ids on different mirrors, one release.
    expect(releaseKey({ title: 'The.Amateur.2025.1080p', sizeBytes: 100 })).toBe(
      releaseKey({ title: 'The Amateur 2025 1080p', sizeBytes: 100 }),
    );
    // A different encode of the same title is a different release.
    expect(releaseKey({ title: 'The.Amateur.2025.1080p', sizeBytes: 100 })).not.toBe(
      releaseKey({ title: 'The.Amateur.2025.1080p', sizeBytes: 200 }),
    );
    expect(releaseKey({ title: 'No size' })).toContain('|0');
  });

  it('counts and ranks by how much of the query a title covers', () => {
    const terms = queryTerms('breaking bad');
    expect(countMatchingTerms('El Camino: A Breaking Bad Movie', terms)).toBe(2);
    expect(countMatchingTerms('Bad Boys for Life', terms)).toBe(1);
    expect(countMatchingTerms('The Lion King', terms)).toBe(0);

    const ranked = rankByRelevance(
      [
        { title: 'Bad Boys for Life' },
        { title: 'The Lion King' },
        { title: 'El Camino: A Breaking Bad Movie' },
      ],
      terms,
    );
    expect(ranked.map((r) => r.title)).toEqual([
      'El Camino: A Breaking Bad Movie',
      'Bad Boys for Life',
      'The Lion King',
    ]);
  });
});

describe('parse1337xSearchResults', () => {
  const results = parse1337xSearchResults(fixture('1337x-search.html'), SEARCH_URL, NOW);

  it('reads every torrent row once', () => {
    expect(results).toHaveLength(4);
    expect(results.map((r) => r.id)).toEqual([6_419_201, 6_416_873, 122_701, 4_711_160]);
  });

  it('reads a complete row', () => {
    expect(results[0]).toEqual({
      id: 6_419_201,
      title: 'The.Amateur.2025.1080p.WEB-DL.DDP5.1.x265-NeoNoir',
      pageUrl: `${TORRENT_URL}`,
      category: 'Movies',
      type: 'HEVC-x265',
      sizeBytes: 2_040_109_465,
      seeders: 4_559,
      leechers: 1_111,
      uploadedAt: '2025-06-10T00:00:00.000Z',
      uploader: 'NeoNoir',
      uploaderUrl: 'https://www.1337xx.to/user/NeoNoir/',
    });
  });

  it('takes the category and type from the icon link, not its flaticon class', () => {
    // /sub/tv/HD/1/ is the only place a row states either label in full, and it
    // is what the detail page agrees with. The flaticon names the type.
    expect(results[1]?.category).toBe('TV');
    expect(results[1]?.type).toBe('HD');
  });

  it('falls back to the icon class on the older numeric /sub/22/0/ form', () => {
    // No label in the href, so the type comes from the class and the category
    // stays empty rather than being guessed wrongly.
    expect(results[3]?.category).toBeUndefined();
    expect(results[3]?.type).toBe('Anime');
  });

  it('keeps the size out of the seeder duplicate the mobile layout injects', () => {
    expect(results[1]?.sizeBytes).toBe(891_289_600);
    expect(results[1]?.seeders).toBe(312);
    expect(results[1]?.uploadedAt).toBe('2026-08-03T12:00:00.000Z');
  });

  it('keeps a row whose optional cells are all empty', () => {
    expect(results[2]).toEqual({
      id: 122_701,
      title: 'Some Very Old Upload',
      pageUrl: 'https://www.1337xx.to/torrent/122701/Some-Very-Old-Upload/',
      category: undefined,
      type: undefined,
      sizeBytes: undefined,
      seeders: undefined,
      leechers: undefined,
      uploadedAt: undefined,
      uploader: undefined,
      uploaderUrl: undefined,
    });
  });

  it('returns an empty list for a page with no results', () => {
    expect(parse1337xSearchResults(fixture('1337x-search-empty.html'), SEARCH_URL, NOW)).toEqual(
      [],
    );
  });

  it('survives malformed markup', () => {
    const broken =
      '<table class="table-list"><tr><td class="coll-1 name"><a href="/torrent/99/x/">Broken row';
    expect(parse1337xSearchResults(broken, SEARCH_URL, NOW)).toEqual([
      {
        id: 99,
        title: 'Broken row',
        pageUrl: 'https://www.1337xx.to/torrent/99/x/',
        category: undefined,
        type: undefined,
        sizeBytes: undefined,
        seeders: undefined,
        leechers: undefined,
        uploadedAt: undefined,
        uploader: undefined,
        uploaderUrl: undefined,
      },
    ]);

    expect(parse1337xSearchResults('this is not html', SEARCH_URL, NOW)).toEqual([]);
    expect(parse1337xSearchResults('', SEARCH_URL, NOW)).toEqual([]);
  });

  it('still reads a cell whose value has been wrapped in an element', () => {
    const wrapped =
      '<table class="table-list"><tbody><tr>' +
      '<td class="coll-1 name"><a href="/torrent/7/x/">Wrapped</a></td>' +
      '<td class="coll-2 seeds"><span>42</span></td>' +
      '<td class="coll-4 size mob-vip"><span class="size-value">3.5 GB</span>' +
      '<span class="seeds mob-seeds">42</span></td>' +
      '</tr></tbody></table>';

    const [row] = parse1337xSearchResults(wrapped, SEARCH_URL, NOW);
    expect(row?.seeders).toBe(42);
    expect(row?.sizeBytes).toBe(3_758_096_384);
  });
});

describe('parse1337xDetails', () => {
  const details = parse1337xDetails(fixture('1337x-torrent.html'), TORRENT_URL, undefined, NOW);

  it('reads the headline metadata', () => {
    expect(details.id).toBe(6_419_201);
    expect(details.title).toBe('The.Amateur.2025.1080p.WEB-DL.DDP5.1.x265-NeoNoir');
    expect(details.infoHash).toBe('495DF65F08FB18DFA91A881EC713CC8825865E4D');
    expect(details.magnet).toContain(
      'magnet:?xt=urn:btih:495DF65F08FB18DFA91A881EC713CC8825865E4D',
    );
    // Entities in the href are decoded, not left as &amp;.
    expect(details.magnet).toContain('&dn=The.Amateur');
    expect(details.category).toBe('Movies');
    expect(details.type).toBe('HEVC/x265');
    expect(details.language).toBe('English');
    expect(details.sizeBytes).toBe(2_040_109_465);
    expect(details.uploader).toBe('NeoNoir');
    expect(details.uploaderUrl).toBe('https://www.1337xx.to/user/NeoNoir/');
    expect(details.downloads).toBe(37_005);
    expect(details.seeders).toBe(4_559);
    expect(details.leechers).toBe(1_111);
  });

  it('normalises both dates', () => {
    expect(details.uploadedAt).toBe('2026-08-05T12:00:00.000Z');
    expect(details.checkedAt).toBe('2026-08-06T11:00:00.000Z');
  });

  it('reads the file list, splitting the trailing size off each name', () => {
    expect(details.files).toEqual([
      { type: 'folder', name: 'The.Amateur.2025.1080p.WEB-DL', sizeBytes: undefined },
      {
        type: 'movies',
        name: 'The.Amateur.2025.1080p.WEB-DL.DDP5.1.x265-NeoNoir.mkv',
        sizeBytes: 2_040_109_465,
      },
      { type: 'text', name: 'RELEASE-INFO.nfo', sizeBytes: 4_198 },
      { type: 'text', name: 'readme-with-no-size.txt', sizeBytes: undefined },
    ]);
  });

  it('deduplicates trackers and ignores the list heading', () => {
    expect(details.trackers).toEqual([
      'udp://tracker.opentrackr.org:1337/announce',
      'udp://open.demonii.com:1337/announce',
    ]);
  });

  it('reads the cover, rating and catalogue block', () => {
    expect(details.coverUrl).toBe(
      'https://lx1.dyncdn.cc/cdn/e8/e80eeaaa5d37dbba3202db76aa2ea0df.jpg',
    );
    expect(details.rating).toBe(66);
    expect(details.metadataTitle).toBe('The Amateur');
    expect(details.metadataCategories).toEqual(['Thriller', 'Action']);
    expect(details.metadataDescription).toContain('CIA decoder');
  });

  it('flattens the description to plain text', () => {
    expect(details.description).toContain('Container.......: Matroska');
    expect(details.description).toContain('Greetings to all fellow encoders & p2p users!');
    expect(details.description).not.toContain('<br');
    expect(details.description).not.toContain('<span');
  });

  it('keeps a sparse page rather than discarding it', () => {
    const minimal = parse1337xDetails(
      fixture('1337x-torrent-minimal.html'),
      'https://www.1337xx.to/torrent/122701/Some-Very-Old-Upload/',
      undefined,
      NOW,
    );

    expect(minimal.id).toBe(122_701);
    expect(minimal.title).toBe('Some Very Old Upload');
    // No infohash box: it comes from the magnet instead.
    expect(minimal.infoHash).toBe('C9F7A4E3E1AF25E4F0EFCC38720F29E156F4CA1A');
    expect(minimal.category).toBe('Other');
    expect(minimal.sizeBytes).toBe(2_308_544_921);
    expect(minimal.uploadedAt).toBe('2010-12-16T00:00:00.000Z');
    expect(minimal.seeders).toBe(0);

    expect(minimal.type).toBeUndefined();
    expect(minimal.language).toBeUndefined();
    expect(minimal.uploader).toBeUndefined();
    expect(minimal.downloads).toBeUndefined();
    expect(minimal.checkedAt).toBeUndefined();
    expect(minimal.leechers).toBeUndefined();
    expect(minimal.coverUrl).toBeUndefined();
    expect(minimal.rating).toBeUndefined();
    expect(minimal.files).toEqual([]);
    expect(minimal.trackers).toEqual([]);
    expect(minimal.metadataCategories).toEqual([]);
  });

  it('falls back to the supplied id when the URL has none', () => {
    const withFallback = parse1337xDetails(
      fixture('1337x-torrent.html'),
      'https://www.1337xx.to/some/other/path',
      4_242,
      NOW,
    );
    expect(withFallback.id).toBe(4_242);
  });

  it('rejects a 404 page', () => {
    expect(() =>
      parse1337xDetails(fixture('1337x-404.html'), TORRENT_URL, undefined, NOW),
    ).toThrowError(/does not exist/i);
  });

  it('rejects an anti-bot interstitial without trying to solve it', () => {
    expect(() =>
      parse1337xDetails(fixture('1337x-challenge.html'), TORRENT_URL, undefined, NOW),
    ).toThrowError(/anti-bot/i);
  });

  it('rejects a page with neither a magnet nor an infohash', () => {
    const stripped = fixture('1337x-torrent.html')
      .replace(/<a\s+class="l1"[\s\S]*?<\/a>/, '')
      .replace(/<div class="infohash-box">[\s\S]*?<\/div>/, '');

    expect(() => parse1337xDetails(stripped, TORRENT_URL, undefined, NOW)).toThrowError(
      Torrent1337xError,
    );
  });

  it('rejects markup that is not a torrent page at all', () => {
    expect(() => parse1337xDetails('<html><body>hello</body></html>', TORRENT_URL)).toThrowError(
      Torrent1337xError,
    );
    expect(() => parse1337xDetails('', TORRENT_URL)).toThrowError(Torrent1337xError);
  });
});

describe('page classification', () => {
  it('spots a 404 page', () => {
    expect(is1337xNotFoundPage(fixture('1337x-404.html'))).toBe(true);
    expect(is1337xNotFoundPage(fixture('1337x-torrent.html'))).toBe(false);
    expect(is1337xNotFoundPage(fixture('1337x-search.html'))).toBe(false);
    expect(is1337xNotFoundPage('')).toBe(false);
  });

  it('spots a challenge page', () => {
    expect(is1337xChallengePage(fixture('1337x-challenge.html'))).toBe(true);
    expect(is1337xChallengePage(fixture('1337x-torrent.html'))).toBe(false);
    expect(is1337xChallengePage('')).toBe(false);
  });
});
