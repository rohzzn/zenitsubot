import { describe, expect, it } from 'vitest';

import { episodeLabel, parseReleaseName, qualityLabel } from '../src/services/releaseName.js';

describe('parseReleaseName', () => {
  it('reads a typical scene movie release', () => {
    const parsed = parseReleaseName('The.Amateur.2025.1080p.WEB-DL.DDP5.1.x265-NeoNoir');

    expect(parsed.resolution).toBe('1080p');
    expect(parsed.source).toBe('WEB-DL');
    expect(parsed.codec).toBe('x265');
    expect(parsed.audio).toBe('DDP5.1');
    expect(parsed.year).toBe(2025);
    expect(parsed.group).toBe('NeoNoir');
    expect(parsed.lowQuality).toBe(false);
  });

  it('reads an episode', () => {
    const parsed = parseReleaseName('Murderbot.S01E05.1080p.WEB.h264-ELiTE');

    expect(parsed.season).toBe(1);
    expect(parsed.episode).toBe(5);
    expect(parsed.codec).toBe('x264');
    expect(episodeLabel(parsed)).toBe('S01E05');
  });

  it('reads the alternative episode spellings', () => {
    expect(parseReleaseName('Show 3x07 720p HDTV').episode).toBe(7);
    expect(parseReleaseName('Show 3x07 720p HDTV').season).toBe(3);
    expect(parseReleaseName('Some Show Season 2 COMPLETE 1080p')).toMatchObject({
      season: 2,
      completePack: true,
    });
    expect(parseReleaseName('Dragon Ball S01-S05 BluRay').completePack).toBe(true);
  });

  it('recognises 4K, HDR and remuxes', () => {
    const parsed = parseReleaseName(
      'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR.TrueHD-FraMeSToR',
    );

    expect(parsed.resolution).toBe('2160p');
    // REMUX is checked before BluRay because it is the more specific claim.
    expect(parsed.source).toBe('REMUX');
    expect(parsed.hdr).toBe('Dolby Vision');
    expect(parsed.audio).toBe('TrueHD');
    expect(qualityLabel(parsed)).toBe('2160p REMUX Dolby Vision');
  });

  it('flags camera and telesync rips', () => {
    expect(parseReleaseName('Some.Movie.2024.HDCAM.x264').lowQuality).toBe(true);
    expect(parseReleaseName('Some.Movie.2024.HDTS.720p').lowQuality).toBe(true);
    expect(parseReleaseName('Some.Movie.2024.1080p.BluRay.x264').lowQuality).toBe(false);
  });

  it('spots a repack', () => {
    expect(parseReleaseName('Show.S01E01.REPACK.1080p.WEB-DL').repack).toBe(true);
    expect(parseReleaseName('Show.S01E01.1080p.WEB-DL').repack).toBe(false);
  });

  it('takes the release year, not the one in the title', () => {
    expect(parseReleaseName('Blade Runner 2049 2017 1080p BluRay').year).toBe(2017);
    expect(parseReleaseName('1917.2019.1080p.BluRay.x264').year).toBe(2019);
  });

  it('reads a bracketed group and the YTS style', () => {
    expect(parseReleaseName('The Lion King (2019) [BluRay] [1080p] [YTS]').group).toBe('YTS');
    expect(parseReleaseName('The Lion King (2019) [BluRay] [1080p] [YTS]').source).toBe('BluRay');
  });

  it('returns almost nothing for a name that is not a release', () => {
    const parsed = parseReleaseName('Ubuntu MATE armhf img.xz');

    expect(parsed.resolution).toBeUndefined();
    expect(parsed.codec).toBeUndefined();
    expect(parsed.season).toBeUndefined();
    expect(qualityLabel(parsed)).toBe('');
    expect(episodeLabel(parsed)).toBeUndefined();
  });

  it('never throws on odd input', () => {
    expect(() => parseReleaseName('')).not.toThrow();
    expect(() => parseReleaseName('...---...')).not.toThrow();
    expect(parseReleaseName('').resolution).toBeUndefined();
  });
});

describe('qualityLabel', () => {
  it('joins only what is known', () => {
    expect(qualityLabel(parseReleaseName('Movie.1080p.BluRay.x265'))).toBe('1080p BluRay x265');
    expect(qualityLabel(parseReleaseName('Movie.720p'))).toBe('720p');
  });
});
