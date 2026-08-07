import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import { magnetDelivery, narrowToEpisode } from '../src/commands/slash/util/torrent.js';
import { COMMANDS } from '../src/commands/index.js';
import { parseReleaseName } from '../src/services/releaseName.js';
import type { Torrent1337xDetails } from '../src/services/1337x.js';

const SUBCOMMAND = 1;
const SUBCOMMAND_GROUP = 2;

function details(overrides: Partial<Torrent1337xDetails> = {}): Torrent1337xDetails {
  return {
    id: 6_419_201,
    title: 'The.Amateur.2025.1080p.WEB-DL.DDP5.1.x265-NeoNoir',
    pageUrl: 'https://www.1337xx.to/torrent/6419201/The-Amateur/',
    infoHash: '495DF65F08FB18DFA91A881EC713CC8825865E4D',
    trackers: [],
    files: [],
    metadataCategories: [],
    ...overrides,
  };
}

describe('magnetDelivery', () => {
  it('puts a normal magnet straight into the embed', () => {
    const magnet = `magnet:?xt=urn:btih:495DF65F08FB18DFA91A881EC713CC8825865E4D&dn=short`;
    expect(magnetDelivery(details({ magnet }))).toEqual({ kind: 'inline', magnet });
  });

  it('never truncates a long magnet — it attaches it instead', () => {
    const trackers = Array.from(
      { length: 90 },
      (_, i) => `&tr=udp%3A%2F%2Ftracker-with-a-long-hostname-${i}.example.org%3A6969%2Fannounce`,
    ).join('');
    const magnet = `magnet:?xt=urn:btih:495DF65F08FB18DFA91A881EC713CC8825865E4D&dn=a-very-long-release-name${trackers}`;

    expect(magnet.length).toBeGreaterThan(4096);

    const delivery = magnetDelivery(details({ magnet }));
    expect(delivery).toEqual({
      kind: 'file',
      magnet,
      filename: 'magnet-6419201.txt',
    });
    // The whole URI survives: a cut magnet is a broken magnet.
    if (delivery.kind === 'file') {
      expect(delivery.magnet).toBe(magnet);
      expect(Buffer.from(delivery.magnet, 'utf8').toString('utf8')).toBe(magnet);
    }
  });

  it('builds a magnet from the infohash when the page has no magnet link', () => {
    const delivery = magnetDelivery(
      details({
        magnet: undefined,
        trackers: ['udp://tracker.opentrackr.org:1337/announce'],
      }),
    );

    expect(delivery.kind).toBe('inline');
    if (delivery.kind !== 'none') {
      expect(delivery.magnet).toContain('urn:btih:495DF65F08FB18DFA91A881EC713CC8825865E4D');
      expect(delivery.magnet).toContain('tracker.opentrackr.org');
    }
  });

  it('reports nothing to deliver when both the magnet and the infohash are gone', () => {
    expect(magnetDelivery(details({ magnet: undefined, infoHash: undefined }))).toEqual({
      kind: 'none',
    });
  });
});

describe('narrowToEpisode', () => {
  const listed = (title: string) => ({ title, release: parseReleaseName(title) });

  const entries = [
    listed('Show.S01E04.1080p.WEB-DL.x265-GRP'),
    listed('Show.S01E05.1080p.WEB-DL.x265-GRP'),
    listed('Show.S02E04.1080p.WEB-DL.x265-GRP'),
    listed('Show.S01.COMPLETE.1080p.WEB-DL.x265-GRP'),
    listed('Show.Complete.Series.1080p.BluRay'),
  ];

  it('keeps everything when nothing was asked for', () => {
    expect(narrowToEpisode(entries)).toHaveLength(entries.length);
  });

  it('narrows to a season, keeping its packs', () => {
    const titles = narrowToEpisode(entries, 1).map((e) => e.title);
    expect(titles).toContain('Show.S01E04.1080p.WEB-DL.x265-GRP');
    expect(titles).toContain('Show.S01.COMPLETE.1080p.WEB-DL.x265-GRP');
    expect(titles).not.toContain('Show.S02E04.1080p.WEB-DL.x265-GRP');
  });

  it('narrows to an episode but keeps the packs that contain it', () => {
    const titles = narrowToEpisode(entries, 1, 4).map((e) => e.title);
    expect(titles).toContain('Show.S01E04.1080p.WEB-DL.x265-GRP');
    // A pack has the episode; a different single episode does not.
    expect(titles).toContain('Show.S01.COMPLETE.1080p.WEB-DL.x265-GRP');
    expect(titles).not.toContain('Show.S01E05.1080p.WEB-DL.x265-GRP');
  });

  it('keeps a whole-series pack for a season it does not name', () => {
    // The pack plausibly contains season 9; the season-1 episodes do not.
    expect(narrowToEpisode(entries, 9).map((e) => e.title)).toEqual([
      'Show.Complete.Series.1080p.BluRay',
    ]);
  });

  it('never narrows the list down to nothing', () => {
    // Nothing here could be season 9, and an empty screen helps nobody, so the
    // request is treated as a bad guess rather than a filter.
    const seasonOneOnly = entries.slice(0, 2);
    expect(narrowToEpisode(seasonOneOnly, 9)).toHaveLength(seasonOneOnly.length);
  });
});

describe('command registration', () => {
  const torrentCommand = COMMANDS.find((c) => c.handler.data.name === 'torrent');

  it('every builder still resolves to a handler of the same name', () => {
    for (const { builder, handler } of COMMANDS) {
      expect(builder.toJSON().name).toBe(handler.data.name);
      expect(typeof handler.execute).toBe('function');
    }
  });

  it('exposes /torrent as search and scrape subcommands', () => {
    const json = torrentCommand!.builder.toJSON();
    const subcommands = (json.options ?? []).filter((o) => o.type === SUBCOMMAND);

    expect(subcommands.map((o) => o.name)).toEqual(['search', 'scrape']);
  });

  it('declares the documented search options and choices', () => {
    const json = torrentCommand!.builder.toJSON();
    const search = (json.options ?? []).find((o) => o.name === 'search') as
      | {
          options?: Array<{ name: string; required?: boolean; choices?: Array<{ value: string }> }>;
        }
      | undefined;

    const options = search?.options ?? [];
    expect(options.map((o) => o.name)).toEqual([
      'query',
      'source',
      'category',
      'sort',
      'order',
      'season',
      'episode',
    ]);
    expect(options.find((o) => o.name === 'query')?.required).toBe(true);

    const values = (name: string) =>
      options.find((o) => o.name === name)?.choices?.map((c) => c.value);

    expect(values('source')).toEqual([
      'all',
      '1337x',
      'piratebay',
      'nyaa',
      'solidtorrents',
      'fitgirl',
      'archive',
    ]);
    // "best" is a local ranking and has to be offered alongside the raw sorts.
    expect(values('sort')).toEqual(['best', 'seeders', 'time', 'size']);
    expect(values('order')).toEqual(['desc', 'asc']);
    expect(values('category')).toContain('Anime');
  });

  it('exposes the watch group', () => {
    const json = torrentCommand!.builder.toJSON();
    const group = (json.options ?? []).find((o) => o.name === 'watch') as
      | { type: number; options?: Array<{ name: string }> }
      | undefined;

    expect(group?.type).toBe(SUBCOMMAND_GROUP);
    expect(group?.options?.map((o) => o.name)).toEqual(['add', 'list', 'remove']);
  });

  it('requires a torrent on /torrent scrape', () => {
    const json = torrentCommand!.builder.toJSON();
    const scrape = (json.options ?? []).find((o) => o.name === 'scrape') as
      | { options?: Array<{ name: string; required?: boolean }> }
      | undefined;

    expect(scrape?.options?.map((o) => o.name)).toEqual(['torrent']);
    expect(scrape?.options?.[0]?.required).toBe(true);
  });

  it('leaves the neighbouring torrent commands alone', () => {
    const magnet = COMMANDS.find((c) => c.handler.data.name === 'magnet');
    expect(magnet?.builder.toJSON().options?.map((o) => o.name)).toEqual(['link']);

    const qbit = COMMANDS.find((c) => c.handler.data.name === 'qbit');
    expect(
      qbit?.builder
        .toJSON()
        .options?.filter((o) => o.type === SUBCOMMAND)
        .map((o) => o.name),
    ).toEqual(['status', 'list', 'add', 'pause', 'resume', 'remove']);
  });
});
