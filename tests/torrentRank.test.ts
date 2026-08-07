import { describe, expect, it } from 'vitest';

import { parseReleaseName, titleFromRelease } from '../src/services/releaseName.js';
import { rankByScore, scoreRelease } from '../src/services/torrentRank.js';

const entry = (title: string, seeders?: number, sizeBytes?: number, trusted?: boolean) => ({
  seeders,
  sizeBytes,
  trusted,
  release: parseReleaseName(title),
});

describe('scoreRelease', () => {
  it('prefers the better encode when health is comparable', () => {
    const remux = entry('Dune.2021.2160p.UHD.BluRay.REMUX.HDR.TrueHD-GRP', 900, 60 * 1024 ** 3);
    const webrip = entry('Dune.2021.720p.WEBRip.x264-GRP', 900, 900 * 1024 ** 2);

    expect(scoreRelease(remux)).toBeGreaterThan(scoreRelease(webrip));
  });

  it('prefers the healthier torrent when quality is comparable', () => {
    const many = entry('Dune.2021.1080p.BluRay.x264-GRP', 5000, 8 * 1024 ** 3);
    const few = entry('Dune.2021.1080p.BluRay.x264-GRP', 3, 8 * 1024 ** 3);

    expect(scoreRelease(many)).toBeGreaterThan(scoreRelease(few));
  });

  it('does not let a cam rip win on seeders alone', () => {
    // The exact case raw seeder sorting gets wrong: a new film's camera rip
    // out-seeds every real encode for weeks.
    const cam = entry('Some.Movie.2026.1080p.HDCAM.x264-GRP', 9000, 2 * 1024 ** 3);
    const bluray = entry('Some.Movie.2026.1080p.BluRay.x264-GRP', 200, 8 * 1024 ** 3);

    expect(scoreRelease(bluray)).toBeGreaterThan(scoreRelease(cam));
  });

  it('marks down an encode far too small for what it claims', () => {
    const honest = entry('Movie.2024.1080p.BluRay.x264-GRP', 500, 8 * 1024 ** 3);
    const squeezed = entry('Movie.2024.1080p.BluRay.x264-GRP', 500, 400 * 1024 ** 2);

    expect(scoreRelease(honest)).toBeGreaterThan(scoreRelease(squeezed));
  });

  it('does not mark down an episode for being small', () => {
    const episode = entry('Show.S01E04.1080p.WEB-DL.x265-GRP', 500, 400 * 1024 ** 2);
    const movie = entry('Movie.2024.1080p.WEB-DL.x265-GRP', 500, 400 * 1024 ** 2);

    expect(scoreRelease(episode)).toBeGreaterThan(scoreRelease(movie));
  });

  it('gives a small edge to trusted uploaders and repacks', () => {
    const plain = entry('Movie.2024.1080p.BluRay.x264-GRP', 500, 8 * 1024 ** 3);
    const trusted = entry('Movie.2024.1080p.BluRay.x264-GRP', 500, 8 * 1024 ** 3, true);
    const repack = entry('Movie.2024.REPACK.1080p.BluRay.x264-GRP', 500, 8 * 1024 ** 3);

    expect(scoreRelease(trusted)).toBeGreaterThan(scoreRelease(plain));
    expect(scoreRelease(repack)).toBeGreaterThan(scoreRelease(plain));
  });

  it('stays inside its range whatever it is handed', () => {
    expect(scoreRelease(entry('', 0, 0))).toBeGreaterThanOrEqual(0);
    expect(scoreRelease(entry('x', 10_000_000, 1))).toBeLessThanOrEqual(100);
    expect(scoreRelease(entry('Unknown Release'))).toBeGreaterThan(0);
  });
});

describe('rankByScore', () => {
  it('puts the best download first and keeps ties stable', () => {
    const ranked = rankByScore([
      entry('Movie.2026.1080p.HDCAM.x264-GRP', 9000, 2 * 1024 ** 3),
      entry('Movie.2026.720p.WEBRip.x264-GRP', 300, 1024 ** 3),
      entry('Movie.2026.2160p.BluRay.REMUX.HDR-GRP', 400, 50 * 1024 ** 3),
    ]);

    expect(ranked[0]?.release.source).toBe('REMUX');
    expect(ranked[2]?.release.lowQuality).toBe(true);
  });
});

describe('titleFromRelease', () => {
  it('recovers what a person would call it', () => {
    expect(titleFromRelease('The.Amateur.2025.1080p.WEB-DL.DDP5.1.x265-NeoNoir')).toEqual({
      title: 'The Amateur',
      year: 2025,
    });
    expect(titleFromRelease('Spider-Man: Brand New Day (2026) 1080p H264 HDTS')).toEqual({
      title: 'Spider-Man: Brand New Day',
      year: 2026,
    });
    expect(titleFromRelease('Murderbot.S01E05.1080p.WEB.h264-ELiTE').title).toBe('Murderbot');
    expect(titleFromRelease('Breaking.Bad.S05.COMPLETE.1080p.BluRay').title).toBe('Breaking Bad');
  });

  it('copes with a name that is only tags', () => {
    expect(titleFromRelease('1080p.x265').title.length).toBeGreaterThan(0);
    expect(titleFromRelease('').title).toBe('');
  });
});
