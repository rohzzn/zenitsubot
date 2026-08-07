import { search1337xDetailed } from '../1337x.js';
import type { SourceResult, TorrentSource } from './types.js';

/**
 * 1337x behind the common interface.
 *
 * The odd one out: its search pages carry no infohash, so a result here has no
 * magnet until its page is scraped. That is why `SourceResult.infoHash` is
 * optional and why the detail step still exists.
 */
export const leetxSource: TorrentSource = {
  id: '1337x',
  label: '1337x',
  blurb: 'Well-curated general index with upload dates and uploaders',
  categories: 'all',
  enabledByDefault: true,

  async search({ query, category, limit, sort }): Promise<SourceResult[]> {
    const outcome = await search1337xDetailed({
      query,
      category,
      sort: sort === 'recent' ? 'time' : 'seeders',
      limit,
    });

    return outcome.results.map((result) => ({
      source: '1337x',
      id: String(result.id),
      title: result.title,
      pageUrl: result.pageUrl,
      category: result.category,
      type: result.type,
      sizeBytes: result.sizeBytes,
      seeders: result.seeders,
      leechers: result.leechers,
      uploadedAt: result.uploadedAt,
      uploader: result.uploader,
      trusted: result.trusted,
    }));
  },
};
