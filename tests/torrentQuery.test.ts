import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

const chatMock = vi.fn();
vi.mock('../src/services/ai.js', () => ({
  chat: (...args: unknown[]) => chatMock(...args),
  aiConfigured: () => Boolean(process.env.OPENROUTER_API_KEY),
}));

import {
  clearQueryPlanCache,
  describePlan,
  extractJson,
  needsInterpretation,
  planFromModel,
  planQuery,
} from '../src/services/torrentQuery.js';

afterEach(() => {
  clearQueryPlanCache();
  chatMock.mockReset();
  delete process.env.OPENROUTER_API_KEY;
});

describe('needsInterpretation', () => {
  it('skips queries that are already answerable', () => {
    // Short, or already a release name: rewriting can only lose information.
    expect(needsInterpretation('oppenheimer')).toBe(false);
    expect(needsInterpretation('breaking bad')).toBe(false);
    expect(needsInterpretation('The.Office.S01E04.1080p.WEB-DL')).toBe(false);
    expect(needsInterpretation('dune 2160p')).toBe(false);
    expect(needsInterpretation('ubuntu x265')).toBe(false);
  });

  it('takes on anything phrased like a sentence', () => {
    expect(needsInterpretation('that new villeneuve dune movie in 4k')).toBe(true);
    expect(needsInterpretation('the office us season 3')).toBe(true);
  });
});

describe('extractJson', () => {
  it('finds the object however the model wrapped it', () => {
    expect(extractJson('{"search":"Dune"}')).toEqual({ search: 'Dune' });
    expect(extractJson('```json\n{"search":"Dune"}\n```')).toEqual({ search: 'Dune' });
    expect(extractJson('Sure! Here you go: {"search":"Dune"} Hope that helps.')).toEqual({
      search: 'Dune',
    });
  });

  it('gives up rather than guessing', () => {
    expect(extractJson('no json at all')).toBeUndefined();
    expect(extractJson('{ broken')).toBeUndefined();
    expect(extractJson('')).toBeUndefined();
  });
});

describe('planFromModel', () => {
  it('keeps the fields it recognises', () => {
    const plan = planFromModel(
      { search: 'Dune Part Two', category: 'movies', resolution: '2160p', year: 2024 },
      'that new villeneuve dune in 4k',
    );

    expect(plan).toMatchObject({
      search: 'Dune Part Two',
      category: 'Movies',
      resolution: '2160p',
      year: 2024,
      interpreted: true,
    });
    expect(plan.note).toContain('Dune Part Two');
  });

  it('accepts the title under whatever key the model chose', () => {
    // A real answer from a live model: wrong key, and the value carrying a
    // year, a resolution and the site's own name.
    const plan = planFromModel(
      { query: 'Dune 2021 4K 1337x', site: '1337x.to' },
      'dune in 4k please',
    );

    expect(plan.interpreted).toBe(true);
    expect(plan.search).toBe('Dune');
    expect(plan.resolution).toBe('2160p');
    expect(plan.year).toBe(2021);

    for (const key of ['title', 'name', 'q']) {
      expect(planFromModel({ [key]: 'The Matrix' }, 'matrix film').search).toBe('The Matrix');
    }
  });

  it('strips quality and site noise out of the title', () => {
    expect(planFromModel({ search: 'Oppenheimer 2160p BluRay x265' }, 'x').search).toBe(
      'Oppenheimer',
    );
    expect(planFromModel({ search: 'torrent yts The Matrix' }, 'x').search).toBe('The Matrix');
    // Nothing but noise leaves no title, so search the words as typed.
    expect(planFromModel({ search: '1337x torrent download' }, 'the original')).toEqual({
      search: 'the original',
      interpreted: false,
    });
  });

  it('normalises 4K to a resolution the site understands', () => {
    expect(planFromModel({ search: 'Dune', resolution: '4K' }, 'x').resolution).toBe('2160p');
    expect(planFromModel({ search: 'Dune', resolution: 'UHD' }, 'x').resolution).toBe('2160p');
  });

  it('discards anything outside the values we asked for', () => {
    const plan = planFromModel(
      {
        search: 'Show',
        category: 'Warez',
        resolution: '8k',
        season: 'three',
        episode: -1,
        year: 1500,
      },
      'a show somewhere',
    );

    expect(plan.category).toBeUndefined();
    expect(plan.resolution).toBeUndefined();
    expect(plan.season).toBeUndefined();
    expect(plan.episode).toBeUndefined();
    expect(plan.year).toBeUndefined();
  });

  it('falls back to the literal query on junk', () => {
    for (const junk of [undefined, null, 'a string', {}, { search: '   ' }]) {
      expect(planFromModel(junk, 'the original')).toEqual({
        search: 'the original',
        interpreted: false,
      });
    }
  });

  it('does not claim an interpretation when nothing changed', () => {
    expect(planFromModel({ search: 'Oppenheimer' }, 'oppenheimer')).toEqual({
      search: 'oppenheimer',
      interpreted: false,
    });
  });

  it('describes a plan in one readable line', () => {
    expect(
      describePlan({
        search: 'The Office',
        season: 3,
        category: 'TV',
        resolution: '1080p',
        interpreted: true,
      }),
    ).toBe('The Office S03 — TV, 1080p');
  });
});

describe('planQuery', () => {
  it('searches literally when no model is configured', async () => {
    const plan = await planQuery('that new villeneuve dune movie in 4k');

    expect(plan.interpreted).toBe(false);
    expect(plan.search).toBe('that new villeneuve dune movie in 4k');
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('never spends a call on a query that does not need one', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';

    const plan = await planQuery('oppenheimer');

    expect(plan.interpreted).toBe(false);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('uses the model when the query reads like a sentence', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    chatMock.mockResolvedValue({
      text: '{"search":"Dune Part Two","category":"Movies","resolution":"2160p","year":2024}',
    });

    const plan = await planQuery('that new villeneuve dune movie in 4k');

    expect(plan.interpreted).toBe(true);
    expect(plan.search).toBe('Dune Part Two');
    expect(plan.resolution).toBe('2160p');
  });

  it('caches so the same phrase costs one call', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    chatMock.mockResolvedValue({ text: '{"search":"Dune Part Two"}' });

    await planQuery('that new villeneuve dune movie in 4k');
    await planQuery('That New Villeneuve Dune Movie In 4K');

    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the literal query when every model fails', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    chatMock.mockRejectedValue(new Error('rate limited'));

    const plan = await planQuery('the office us season 3 please');

    expect(plan.interpreted).toBe(false);
    expect(plan.search).toBe('the office us season 3 please');
    // More than one model is tried before giving up: free ones are rate
    // limited constantly.
    expect(chatMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('moves on to the next model when the first is unavailable', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    chatMock
      .mockRejectedValueOnce(new Error('is rate limited right now'))
      .mockResolvedValueOnce({ text: '{"search":"The Office","category":"TV","season":3}' });

    const plan = await planQuery('the office us season 3 please');

    expect(plan.interpreted).toBe(true);
    expect(plan.search).toBe('The Office');
    expect(plan.season).toBe(3);
  });

  it('retries a rate-limited query sooner than a successful one', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    chatMock.mockRejectedValue(new Error('rate limited'));

    await planQuery('the office us season 3 please');
    expect(chatMock.mock.calls.length).toBeGreaterThan(0);

    // A failure is remembered only briefly, so a retry two minutes later asks
    // again rather than being served a cached "could not interpret".
    chatMock.mockReset();
    chatMock.mockResolvedValue({ text: '{"search":"The Office","season":3}' });

    const realNow = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(realNow + 2 * 60 * 1000);
    const retried = await planQuery('the office us season 3 please');
    clock.mockRestore();

    expect(retried.interpreted).toBe(true);
    expect(chatMock).toHaveBeenCalled();
  });

  it('falls back when the model answers with prose', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    chatMock.mockResolvedValue({ text: 'I think you mean the Dune film!' });

    const plan = await planQuery('that new villeneuve dune movie in 4k');

    expect(plan.interpreted).toBe(false);
  });
});
