import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keeps pino (and its pretty-print worker) out of the test process entirely.
vi.mock('../src/services/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import { DEFAULT_1337X_DOMAINS, parse1337xDomains } from '../src/services/config.js';
import {
  Torrent1337xError,
  assert1337xUrl,
  clear1337xCache,
  fetch1337xPage,
  resolve1337xTorrent,
  scrape1337xTorrent,
  search1337x,
  search1337xDetailed,
  take1337xCooldown,
} from '../src/services/1337x.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

const PRIMARY = 'https://a.mirror.test';
const SECONDARY = 'https://b.mirror.test';

function page(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/** A body that runs past the response-size cap without allocating it up front. */
function oversized(): Response {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;

  return new Response(
    new ReadableStream({
      pull(controller) {
        if (sent >= 6) {
          controller.close();
          return;
        }
        sent++;
        controller.enqueue(chunk);
      },
    }),
    { status: 200 },
  );
}

describe('parse1337xDomains', () => {
  it('defaults to the reference mirror', () => {
    expect(parse1337xDomains(undefined)).toEqual([DEFAULT_1337X_DOMAINS]);
  });

  it('normalises a comma-separated list', () => {
    expect(
      parse1337xDomains(' https://www.1337xx.to/ , https://1337x.to/search?q=x , 1337x.st '),
    ).toEqual(['https://www.1337xx.to', 'https://1337x.to', 'https://1337x.st']);
  });

  it('deduplicates equivalent origins', () => {
    expect(parse1337xDomains('https://www.1337xx.to,https://www.1337xx.to:443/')).toEqual([
      'https://www.1337xx.to',
    ]);
  });

  it('keeps an explicit non-default port', () => {
    expect(parse1337xDomains('https://mirror.test:8443')).toEqual(['https://mirror.test:8443']);
  });

  it('requires https outside tests', () => {
    expect(() => parse1337xDomains('http://mirror.test', { allowInsecure: false })).toThrow(
      /https/,
    );
    expect(parse1337xDomains('http://mirror.test', { allowInsecure: true })).toEqual([
      'http://mirror.test',
    ]);
  });

  it('rejects credentials, IP literals, private hosts and odd schemes', () => {
    const strict = { allowInsecure: false };
    expect(() => parse1337xDomains('https://user:pass@mirror.test', strict)).toThrow(/credentials/);
    expect(() => parse1337xDomains('https://93.184.216.34', strict)).toThrow(/IP address/);
    expect(() => parse1337xDomains('https://[::1]', strict)).toThrow(/IP address/);
    expect(() => parse1337xDomains('https://localhost', strict)).toThrow(/private or local/);
    expect(() => parse1337xDomains('https://redis.internal', strict)).toThrow(/private or local/);
    expect(() => parse1337xDomains('ftp://mirror.test', strict)).toThrow(/https/);
    expect(() => parse1337xDomains('   ', strict)).toThrow(/empty/);
  });
});

describe('assert1337xUrl', () => {
  const domains = [PRIMARY, SECONDARY];

  it('accepts a URL on a configured origin', () => {
    expect(assert1337xUrl(`${PRIMARY}/torrent/1/x/`, domains).toString()).toBe(
      `${PRIMARY}/torrent/1/x/`,
    );
  });

  it('rejects any host that is not configured, however close', () => {
    expect(() => assert1337xUrl('https://evil.test/torrent/1/', domains)).toThrow(
      Torrent1337xError,
    );
    expect(() => assert1337xUrl('https://a.mirror.test.evil.test/', domains)).toThrow(
      Torrent1337xError,
    );
    expect(() => assert1337xUrl('https://sub.a.mirror.test/', domains)).toThrow(Torrent1337xError);
  });

  it('rejects a different port on a configured host', () => {
    expect(() => assert1337xUrl('https://a.mirror.test:8443/x', domains)).toThrow(
      Torrent1337xError,
    );
    // A different scheme is a different origin too.
    expect(() => assert1337xUrl('http://a.mirror.test/x', domains)).toThrow(Torrent1337xError);
  });

  it('rejects credentials, IP literals, private hosts and non-HTTP schemes', () => {
    expect(() => assert1337xUrl('https://u:p@a.mirror.test/x', domains)).toThrow(/credentials/i);
    expect(() => assert1337xUrl('https://93.184.216.34/x', domains)).toThrow(/IP address/i);
    expect(() => assert1337xUrl('https://127.0.0.1/x', domains)).toThrow(/IP address/i);
    expect(() => assert1337xUrl('https://localhost/x', domains)).toThrow(/local or private/i);
    expect(() => assert1337xUrl('file:///etc/passwd', domains)).toThrow(/http/i);
    expect(() => assert1337xUrl('javascript:alert(1)', domains)).toThrow(/http/i);
    expect(() => assert1337xUrl('not a url', domains)).toThrow(/valid URL/i);
  });
});

describe('resolve1337xTorrent', () => {
  const domains = [PRIMARY];

  it('turns a numeric id into a detail path', () => {
    expect(resolve1337xTorrent(6_419_201, domains)).toEqual({
      id: 6_419_201,
      path: '/torrent/6419201/-/',
    });
    expect(resolve1337xTorrent(' 122701 ', domains).id).toBe(122_701);
  });

  it('accepts a full URL on a configured mirror and drops its query', () => {
    expect(
      resolve1337xTorrent(`${PRIMARY}/torrent/6419201/The-Amateur/?ref=x#top`, domains),
    ).toEqual({
      id: 6_419_201,
      path: '/torrent/6419201/The-Amateur/',
      preferredOrigin: PRIMARY,
    });
  });

  it('refuses anything else', () => {
    expect(() => resolve1337xTorrent('https://evil.test/torrent/1/', domains)).toThrow(
      Torrent1337xError,
    );
    expect(() => resolve1337xTorrent(`${PRIMARY}/user/NeoNoir/`, domains)).toThrow(
      /not a 1337x torrent page/i,
    );
    expect(() => resolve1337xTorrent('a.mirror.test/torrent/1/', domains)).toThrow(
      /numeric torrent id/i,
    );
    expect(() => resolve1337xTorrent('', domains)).toThrow(Torrent1337xError);
    expect(() => resolve1337xTorrent('0', domains)).toThrow(/valid torrent id/i);
  });
});

describe('take1337xCooldown', () => {
  it('lets the first call through and holds the next one back', () => {
    const user = `user-${Math.random()}`;
    expect(take1337xCooldown(user)).toBe(0);
    expect(take1337xCooldown(user)).toBeGreaterThan(0);
  });

  it('meters searching and opening a result separately', () => {
    const user = `scoped-${Math.random()}`;
    expect(take1337xCooldown(user, 'search')).toBe(0);
    // Clicking through to the details of a search you just ran is one action.
    expect(take1337xCooldown(user, 'details')).toBe(0);
    expect(take1337xCooldown(user, 'details')).toBeGreaterThan(0);
  });

  it('tracks users independently', () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    expect(take1337xCooldown(a)).toBe(0);
    expect(take1337xCooldown(b)).toBe(0);
  });
});

describe('HTTP safeguards', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clear1337xCache();
    process.env.TORRENT_1337X_DOMAINS = `${PRIMARY},${SECONDARY}`;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TORRENT_1337X_DOMAINS;
  });

  it('sends a descriptive User-Agent and does not let fetch follow redirects itself', async () => {
    fetchMock.mockResolvedValueOnce(page(fixture('1337x-search.html')));
    await fetch1337xPage('/sort-search/x/seeders/desc/1/');

    const init = fetchMock.mock.calls[0]![1] as RequestInit & {
      headers: Record<string, string>;
    };
    expect(init.redirect).toBe('manual');
    expect(init.headers['User-Agent']).toMatch(/ZenitsuBot/);
    expect(init.headers.Accept).toMatch(/text\/html/);
    expect(init.headers['Accept-Language']).toMatch(/en/);
    expect(init.signal).toBeDefined();
  });

  it('follows a redirect that stays on an allowed origin', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('/torrent/6419201/The-Amateur/'))
      .mockResolvedValueOnce(page(fixture('1337x-torrent.html')));

    const result = await fetch1337xPage('/torrent/6419201/-/');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.url).toBe(`${PRIMARY}/torrent/6419201/The-Amateur/`);
  });

  it('refuses a redirect that leaves the allowlist', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://evil.test/steal'));

    await expect(fetch1337xPage('/torrent/1/-/')).rejects.toThrow(/configured 1337x domains/i);
    // No second request: the hop was rejected before it could be made.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops after too many redirects', async () => {
    fetchMock.mockImplementation(() => redirect('/torrent/1/loop/'));

    await expect(fetch1337xPage('/torrent/1/-/')).rejects.toThrow(Torrent1337xError);
    // Bounded per mirror per attempt; never unbounded recursion.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it('reports a missing page without trying other mirrors', async () => {
    fetchMock.mockResolvedValueOnce(page('', 404));

    await expect(fetch1337xPage('/torrent/999/-/')).rejects.toThrow(/does not exist/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a block as temporary and never tries to work around it', async () => {
    fetchMock.mockImplementation(() => page('', 403));

    await expect(fetch1337xPage('/torrent/1/-/')).rejects.toThrow(/anti-bot check/i);
    // One request per mirror; a refusal is not retried.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recognises a challenge page served with a 200', async () => {
    fetchMock.mockImplementation(() => page(fixture('1337x-challenge.html')));
    await expect(fetch1337xPage('/torrent/1/-/')).rejects.toThrow(/anti-bot check/i);
  });

  it('falls through to the next configured mirror', async () => {
    fetchMock
      .mockResolvedValueOnce(page('', 403))
      .mockResolvedValueOnce(page(fixture('1337x-torrent.html')));

    const result = await fetch1337xPage('/torrent/6419201/-/');

    expect(result.url).toBe(`${SECONDARY}/torrent/6419201/-/`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a dropped connection once before giving up on a mirror', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(page(fixture('1337x-torrent.html')));

    const result = await fetch1337xPage('/torrent/6419201/-/');

    expect(result.url).toBe(`${PRIMARY}/torrent/6419201/-/`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses a response that runs past the size cap', async () => {
    fetchMock.mockImplementation(() => oversized());
    await expect(fetch1337xPage('/torrent/1/-/')).rejects.toThrow(Torrent1337xError);
  });
});

describe('search1337x', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clear1337xCache();
    process.env.TORRENT_1337X_DOMAINS = PRIMARY;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TORRENT_1337X_DOMAINS;
  });

  /** Page 1 serves the fixture; later pages are empty, which ends the walk. */
  function paginated(first: string) {
    return (url: URL | string) =>
      page(String(url).endsWith('/1/') ? fixture(first) : fixture('1337x-search-empty.html'));
  }

  /** Four rows sharing a word, so ordering can be asserted independently. */
  function demoRows(): string {
    const row = (id: number, title: string, size: string, seeds: number, date: string) =>
      `<tr><td class="coll-1 name"><a href="/sub/movies/HD/1/" class="icon"><i class="flaticon-movie"></i></a>` +
      `<a href="/torrent/${id}/x/">${title}</a></td>` +
      `<td class="coll-2 seeds">${seeds}</td><td class="coll-3 leeches">1</td>` +
      `<td class="coll-date">${date}</td><td class="coll-4 size mob-vip">${size}</td>` +
      `<td class="coll-5 uploader"><a href="/user/u/">u</a></td></tr>`;

    return (
      '<table class="table-list"><tbody>' +
      row(1, 'Demo Alpha', '1 GB', 500, "Jun. 10th '25") +
      row(2, 'Demo Bravo', '3 GB', 100, "Jun. 12th '25") +
      row(3, 'Demo Charlie', '2 GB', 300, "Jun. 11th '25") +
      row(4, 'Demo Delta', '', 50, '') +
      '</tbody></table>'
    );
  }

  it('walks a bounded number of pages and keeps only real matches', async () => {
    fetchMock.mockImplementation(paginated('1337x-search.html'));

    const results = await search1337x({ query: 'the amateur' });

    // Stopwords are dropped from what the site is asked for.
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `${PRIMARY}/sort-search/amateur/seeders/desc/1/`,
    );
    // Never a crawl: page 1, then one empty page that ends the walk.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);

    // Only the row whose title carries both words survives; the site's other
    // loose matches are dropped.
    expect(results.map((r) => r.id)).toEqual([6_419_201]);
    expect(results[0]?.title).toBe('The.Amateur.2025.1080p.WEB-DL.DDP5.1.x265-NeoNoir');
  });

  it('sorts consistently and honours the limit', async () => {
    fetchMock.mockImplementation((url: URL | string) =>
      page(String(url).endsWith('/1/') ? demoRows() : fixture('1337x-search-empty.html')),
    );

    const bySeeders = await search1337x({ query: 'demo' });
    expect(bySeeders.map((r) => r.id)).toEqual([1, 3, 2, 4]);

    const bySize = await search1337x({ query: 'demo', sort: 'size', order: 'asc' });
    // The row with no size sinks to the bottom regardless of direction.
    expect(bySize.map((r) => r.id)).toEqual([1, 3, 2, 4]);

    const byNewest = await search1337x({ query: 'demo', sort: 'time' });
    expect(byNewest.map((r) => r.id)).toEqual([2, 3, 1, 4]);

    const top = await search1337x({ query: 'demo', limit: 2 });
    expect(top.map((r) => r.id)).toEqual([1, 3]);
  });

  it('serves a repeat search from the cache', async () => {
    fetchMock.mockImplementation(paginated('1337x-search.html'));

    await search1337x({ query: 'the amateur' });
    const before = fetchMock.mock.calls.length;
    await search1337x({ query: 'the amateur' });

    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('puts the category into the path', async () => {
    fetchMock.mockImplementation(() => page(fixture('1337x-search-empty.html')));

    const results = await search1337x({ query: 'nothing here', category: 'anime', sort: 'time' });

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `${PRIMARY}/sort-category-search/nothing-here/Anime/time/desc/1/`,
    );
    expect(results).toEqual([]);
  });

  it('rejects an unsupported category before making a request', async () => {
    await expect(search1337x({ query: 'x', category: 'Warez' })).rejects.toThrow(Torrent1337xError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports what it actually searched for', async () => {
    fetchMock.mockImplementation(paginated('1337x-search.html'));

    const outcome = await search1337xDetailed({ query: 'the amateur' });

    expect(outcome.searchedFor).toBe('amateur');
    expect(outcome.results.map((r) => r.id)).toEqual([6_419_201]);
  });
});

describe('multiple mirrors', () => {
  const SEARCH_PATH = '/sort-search/amateur/seeders/desc/1/';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clear1337xCache();
    process.env.TORRENT_1337X_DOMAINS = `${PRIMARY},${SECONDARY}`;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TORRENT_1337X_DOMAINS;
  });

  /** A single row, so each mirror's catalogue can be told apart. */
  function onlyRow(id: number, title: string): string {
    return (
      '<table class="table-list"><tbody><tr>' +
      `<td class="coll-1 name"><a href="/torrent/${id}/x/">${title}</a></td>` +
      '<td class="coll-2 seeds">10</td><td class="coll-3 leeches">1</td>' +
      '<td class="coll-date">3 days ago</td><td class="coll-4 size mob-vip">1.9 GB</td>' +
      '<td class="coll-5 uploader"><a href="/user/u/">u</a></td>' +
      '</tr></tbody></table>'
    );
  }

  it('asks every mirror and merges what each one has', async () => {
    fetchMock.mockImplementation((url: URL | string) => {
      const href = String(url);
      if (!href.endsWith('/1/')) return page(fixture('1337x-search-empty.html'));
      return page(
        href.startsWith(PRIMARY)
          ? onlyRow(1, 'Amateur Release One')
          : onlyRow(2, 'Amateur Release Two'),
      );
    });

    const results = await search1337x({ query: 'amateur' });

    expect(results.map((r) => r.title).sort()).toEqual([
      'Amateur Release One',
      'Amateur Release Two',
    ]);

    // Both were asked for page 1, rather than one being a fallback.
    const asked = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(asked).toContain(`${PRIMARY}${SEARCH_PATH}`);
    expect(asked).toContain(`${SECONDARY}${SEARCH_PATH}`);
  });

  it('folds the same release listed on two mirrors into one row', async () => {
    fetchMock.mockImplementation((url: URL | string) => {
      const href = String(url);
      if (!href.endsWith('/1/')) return page(fixture('1337x-search-empty.html'));
      // Same title and size under different ids: one release, two listings.
      return page(onlyRow(href.startsWith(PRIMARY) ? 11 : 22, 'Amateur Identical Release'));
    });

    expect(await search1337x({ query: 'amateur' })).toHaveLength(1);
  });

  it('still answers when one mirror is down', async () => {
    fetchMock.mockImplementation((url: URL | string) => {
      const href = String(url);
      if (href.startsWith(SECONDARY)) return Promise.reject(new TypeError('fetch failed'));
      return page(
        href.endsWith('/1/') ? onlyRow(1, 'Amateur Survivor') : fixture('1337x-search-empty.html'),
      );
    });

    const results = await search1337x({ query: 'amateur' });
    expect(results.map((r) => r.title)).toEqual(['Amateur Survivor']);
  });

  it('reports a failure only when every mirror failed', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('fetch failed')));
    await expect(search1337x({ query: 'amateur' })).rejects.toThrow(Torrent1337xError);
  });
});

describe('scrape1337xTorrent', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clear1337xCache();
    process.env.TORRENT_1337X_DOMAINS = `${PRIMARY},${SECONDARY}`;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TORRENT_1337X_DOMAINS;
  });

  it('scrapes by numeric id', async () => {
    fetchMock.mockImplementation(() => page(fixture('1337x-torrent.html')));

    const details = await scrape1337xTorrent(6_419_201);

    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${PRIMARY}/torrent/6419201/-/`);
    expect(details.infoHash).toBe('495DF65F08FB18DFA91A881EC713CC8825865E4D');
    expect(details.files).toHaveLength(4);
    expect(details.trackers).toHaveLength(2);
  });

  it('tries the mirror the user named first', async () => {
    fetchMock.mockImplementation(() => page(fixture('1337x-torrent.html')));

    await scrape1337xTorrent(`${SECONDARY}/torrent/6419201/The-Amateur/`);

    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${SECONDARY}/torrent/6419201/The-Amateur/`);
  });

  it('caches a detail page', async () => {
    fetchMock.mockImplementation(() => page(fixture('1337x-torrent.html')));

    await scrape1337xTorrent(6_419_201);
    await scrape1337xTorrent(6_419_201);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a URL outside the allowlist without making a request', async () => {
    await expect(scrape1337xTorrent('https://evil.test/torrent/1/x/')).rejects.toThrow(
      Torrent1337xError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
