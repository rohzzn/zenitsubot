import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import { clearTmdbCache, lookupTitle, tmdbConfigured } from '../src/services/tmdb.js';

const MOVIE = {
  results: [
    {
      id: 693134,
      title: 'Dune: Part Two',
      overview: 'Paul Atreides unites with the Fremen.',
      poster_path: '/poster.jpg',
      vote_average: 8.15,
      vote_count: 4321,
      release_date: '2024-02-27',
      genre_ids: [878, 12],
    },
  ],
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('tmdb', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearTmdbCache();
    process.env.TMDB_API_KEY = 'test-key';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TMDB_API_KEY;
  });

  it('is inert without a key', async () => {
    delete process.env.TMDB_API_KEY;
    expect(tmdbConfigured()).toBe(false);
    expect(await lookupTitle('Dune Part Two')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shapes a movie result', async () => {
    fetchMock.mockImplementation(() => json(MOVIE));

    const info = await lookupTitle('Dune Part Two', { year: 2024 });

    expect(info).toEqual({
      title: 'Dune: Part Two',
      year: 2024,
      overview: 'Paul Atreides unites with the Fremen.',
      posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
      rating: 8.2,
      votes: 4321,
      genres: ['Science Fiction', 'Adventure'],
      tmdbUrl: 'https://www.themoviedb.org/movie/693134',
    });

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('/search/movie');
    expect(url).toContain('primary_release_year=2024');
  });

  it('looks in the TV collection first for a show', async () => {
    fetchMock.mockImplementation(() =>
      json({ results: [{ id: 1, name: 'The Office', first_air_date: '2005-03-24' }] }),
    );

    const info = await lookupTitle('The Office', { kind: 'tv' });

    expect(String(fetchMock.mock.calls[0]![0])).toContain('/search/tv');
    expect(info?.title).toBe('The Office');
    expect(info?.tmdbUrl).toContain('/tv/1');
  });

  it('retries without the year before giving up on a collection', async () => {
    fetchMock
      .mockImplementationOnce(() => json({ results: [] }))
      .mockImplementationOnce(() => json(MOVIE));

    const info = await lookupTitle('Dune Part Two', { year: 1999 });

    expect(info?.title).toBe('Dune: Part Two');
    expect(String(fetchMock.mock.calls[1]![0])).not.toContain('primary_release_year');
  });

  it('caches a hit and a confirmed miss', async () => {
    fetchMock.mockImplementation(() => json(MOVIE));
    await lookupTitle('Dune Part Two');
    await lookupTitle('dune part two');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clearTmdbCache();
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => json({ results: [] }));

    expect(await lookupTitle('No Such Film')).toBeNull();
    const afterMiss = fetchMock.mock.calls.length;
    expect(await lookupTitle('No Such Film')).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(afterMiss);
  });

  it('never breaks the card when TMDb misbehaves', async () => {
    fetchMock.mockImplementation(() => new Response('nope', { status: 500 }));
    expect(await lookupTitle('Dune Part Two')).toBeNull();

    fetchMock.mockImplementation(() => Promise.reject(new TypeError('fetch failed')));
    expect(await lookupTitle('Something Else')).toBeNull();

    // A transient failure is not cached, so the next search tries again.
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => json(MOVIE));
    expect((await lookupTitle('Something Else'))?.title).toBe('Dune: Part Two');
  });
});
