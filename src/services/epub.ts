import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import { UserError } from '../utils/errors.js';
import { logger } from './logger.js';

/**
 * Reading an EPUB.
 *
 * An EPUB is a zip of XHTML with a manifest, which sounds simple and is not:
 * EPUB2 and EPUB3 disagree about where the table of contents lives, publishers
 * disagree about what counts as a chapter, and roughly the first tenth of every
 * book is title pages, copyright notices and dedications that nobody wants read
 * aloud.
 *
 * What comes out the other side is a list of chapters, each split into
 * paragraphs and sentences, ready to narrate.
 */

/** A book this large is a corpus, not a novel; refuse before unzipping it. */
const MAX_EPUB_BYTES = 60 * 1024 * 1024;
/** Chapters shorter than this are section dividers, not chapters. */
const MIN_CHAPTER_CHARS = 400;
/** Text-to-speech input caps out well below this; longer paragraphs are split. */
const MAX_PARAGRAPH_CHARS = 1600;

export interface Sentence {
  text: string;
  /** Character offset within the chapter, for seeking and highlighting. */
  offset: number;
}

export interface Paragraph {
  text: string;
  sentences: Sentence[];
}

export interface Chapter {
  index: number;
  title: string;
  paragraphs: Paragraph[];
  /** Every sentence in the chapter, flattened, in reading order. */
  sentences: Sentence[];
  characters: number;
  /** Rough spoken length, before anything is synthesised. */
  estimatedSeconds: number;
}

export interface Book {
  title: string;
  author?: string;
  language?: string;
  chapters: Chapter[];
  totalCharacters: number;
  estimatedSeconds: number;
  /** Cover image, when the EPUB has one Discord can display. */
  coverType?: string;
  cover?: Buffer;
}

/**
 * Narration speed used for estimates, in characters per second.
 *
 * About 150 words a minute, which is the usual audiobook pace, at an average
 * of five characters plus a space per word. Only used for the progress bar
 * before real durations are known; once a chapter is synthesised the true
 * length replaces it.
 */
const CHARS_PER_SECOND = 14.5;

/**
 * Titles that are not chapters.
 *
 * Front and back matter is the single biggest thing between "drop an EPUB" and
 * "hear the book": left in, narration opens with a copyright notice and a list
 * of the publisher's other titles. Matched on the heading rather than position,
 * because books put these in wildly different places.
 */
const NOT_A_CHAPTER =
  /^(cover|title|title page|half title|copyright|colophon|imprint|dedication|epigraph|contents|table of contents|toc|list of \w+|illustrations?|preface|foreword|forward|introduction to this|publisher'?s note|translator'?s note|acknowledg(e)?ments?|about the author|about this book|also by|praise for|advance praise|front ?matter|back ?matter|index|glossary|bibliography|appendix|notes|footnotes|endnotes|permissions|credits|newsletter|excerpt|teaser|sample|advertisement|ads?)\b|the full project gutenberg|project gutenberg.{0,20}licen[sc]e|^\s*licen[sc]e\s*$/i;

/** Body text that is boilerplate wherever it appears. */
const BOILERPLATE =
  /all rights reserved|no part of this (book|publication) may be reproduced|isbn[\s:-]|first published|printed in the|a cip catalogue|library of congress/i;

/**
 * Project Gutenberg's licence, which is long, prepended to the first chapter,
 * and would otherwise be the first thing narrated.
 *
 * Found the hard way: Pride and Prejudice opened with "This eBook is for the
 * use of anyone anywhere in the United States…" instead of "It is a truth
 * universally acknowledged". Gutenberg is the most likely source of a free
 * EPUB, so this is worth handling by name rather than hoping a generic rule
 * catches it.
 */
const GUTENBERG_LINE =
  /project gutenberg|www\.gutenberg\.org|gutenberg\.org\/(license|donate)|this ebook is for the use of anyone|redistribution is subject to the trademark|updated editions will replace|creating the works from (print|public domain)|literary archive foundation|section [0-9]+\. *(information|general)|^\*\*\* *(start|end) of/i;

/**
 * A heading that names a chapter, as opposed to an illustration caption that
 * happens to be marked up as a heading.
 */
function isChapterHeading(text: string): boolean {
  return /^\s*(chapter|part|book|section)\b|^\s*[IVXLCDM]+\.?\s*$|^\s*\d+\.?\s*$/i.test(
    text.trim(),
  );
}

/**
 * The chapter part of a heading that also contains something else.
 *
 * Illustrated editions put the plate caption and the chapter number in one
 * heading, which produced titles like "A note for Miss Bennet. CHAPTER VII."
 * Taking from the marker onward recovers the half that names the chapter.
 */
function cleanHeading(text: string): string {
  const marker = /(chapter|part|book)\s+[IVXLCDM\d]+\.?/i.exec(text);
  if (marker && marker.index > 0) return text.slice(marker.index).trim();
  return text.trim();
}

/** Illustration captions and rights lines, which are not prose. */
const CAPTION = /^\[.*\]$|^\s*(fig(ure)?|plate|illustration)\b.{0,40}$|^copyright \d{4}/i;

/** Where the real text starts and ends in a Gutenberg file. */
const GUTENBERG_START = /\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG EBOOK/i;
const GUTENBERG_END = /\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i;

function normalise(text: string): string {
  return (
    text
      .replace(/ /g, ' ')
      // Typographic quotes and dashes survive; they affect how a line is read.
      .replace(/\s*\n\s*/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  );
}

/**
 * Splits a paragraph into sentences.
 *
 * Deliberately conservative about abbreviations and initials: breaking "Dr.
 * Mallory" into two sentences puts a highlight on half a name and a pause in
 * the middle of it.
 */
export function splitSentences(text: string, baseOffset = 0): Sentence[] {
  /**
   * Split at the boundary rather than by matching sentences.
   *
   * A sentence only ends where terminal punctuation is followed by whitespace
   * and then the start of another sentence. That single requirement keeps
   * decimals and version numbers intact — "3.5 miles" has no space after the
   * point, so there is nothing to split on — where a pattern that matched any
   * full stop cut it into three.
   */
  const pieces: Array<{ text: string; at: number }> = [];
  let start = 0;

  const boundary = /([.!?]+["'”’)\]]*)\s+(?=["'“(\[A-Z])/g;
  let match: RegExpExecArray | null;

  while ((match = boundary.exec(text))) {
    const end = match.index + match[1]!.length;
    pieces.push({ text: text.slice(start, end), at: start });
    start = boundary.lastIndex;
  }

  if (start < text.length) pieces.push({ text: text.slice(start), at: start });

  // Abbreviations and initials look exactly like a sentence end followed by a
  // capital — "Dr. Mallory", "A. B. Smith" — so those pieces are joined back
  // onto the next one.
  const sentences: Sentence[] = [];
  let pending = '';
  let pendingAt = 0;

  for (const piece of pieces) {
    if (!pending) pendingAt = piece.at;
    pending += piece.text;

    const trimmed = pending.trim();

    const endsInAbbreviation =
      /\b(mr|mrs|ms|dr|prof|sr|jr|st|rev|hon|capt|lt|sgt|col|gen|vs|etc|e\.g|i\.e|no|vol|ch|pp|fig|approx)\.$/i.test(
        trimmed,
      ) || /\b[A-Z]\.$/.test(trimmed);

    if (endsInAbbreviation) {
      pending += ' ';
      continue;
    }

    if (trimmed) sentences.push({ text: trimmed, offset: baseOffset + pendingAt });
    pending = '';
  }

  const rest = pending.trim();
  if (rest) sentences.push({ text: rest, offset: baseOffset + pendingAt });

  return sentences;
}

/** Splits an over-long paragraph on sentence boundaries, never mid-sentence. */
function capParagraph(text: string): string[] {
  if (text.length <= MAX_PARAGRAPH_CHARS) return [text];

  const parts: string[] = [];
  let current = '';

  for (const sentence of splitSentences(text)) {
    if (current && current.length + sentence.text.length + 1 > MAX_PARAGRAPH_CHARS) {
      parts.push(current.trim());
      current = '';
    }
    current += `${sentence.text} `;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

interface Section {
  title: string;
  paragraphs: string[];
}

/**
 * Pulls readable prose out of one XHTML document, split at its headings.
 *
 * Splitting matters because a spine document is not a chapter. Plenty of books
 * — every Gutenberg one — put the whole text in a handful of files, so treating
 * one file as one chapter produced fifteen "chapters" for a sixty-one chapter
 * novel, each titled after whichever heading happened to be found first.
 * Walking the document in order and starting a new section at every heading
 * gives the real structure.
 */
function extractSections(html: string): Section[] {
  const $ = cheerio.load(html);

  // Anything that is not prose. Removed before reading rather than filtered
  // after, so a caption never lands mid-sentence.
  $(
    'script, style, nav, svg, img, figure, figcaption, table, sup, sub, aside, header, footer',
  ).remove();

  const documentTitle = normalise($('title').first().text()).slice(0, 120);

  const sections: Section[] = [];
  let current: Section = { title: '', paragraphs: [] };
  let inLicence = false;

  const push = () => {
    if (current.paragraphs.length) sections.push(current);
  };

  $('body')
    .find('h1, h2, h3, h4, p, blockquote, li, div')
    .each((_, element) => {
      const node = $(element);

      // Only leaf-ish blocks: a div wrapping ten paragraphs would otherwise
      // duplicate all of them.
      if (node.is('div') && node.find('p, blockquote, li, h1, h2, h3').length > 0) return;

      const text = normalise(node.text());
      if (text.length < 2) return;

      // Everything between the Gutenberg end marker and the end of the file is
      // licence; everything before the start marker is a header.
      if (GUTENBERG_END.test(text)) {
        inLicence = true;
        return;
      }
      if (GUTENBERG_START.test(text)) {
        inLicence = false;
        // The real book begins here, so anything gathered so far was header.
        current = { title: current.title, paragraphs: [] };
        return;
      }
      if (inLicence || GUTENBERG_LINE.test(text) || BOILERPLATE.test(text)) return;

      if (node.is('h1, h2, h3')) {
        // A heading starts a new section — unless nothing has been collected
        // yet, in which case it is this section's own title.
        if (current.paragraphs.length) {
          push();
          current = { title: cleanHeading(text).slice(0, 120), paragraphs: [] };
        } else if (!current.title || isChapterHeading(text)) {
          // A real chapter heading beats whatever was there. Illustrated
          // editions put the plate caption in a heading tag immediately before
          // the chapter number, which produced titles like "A note for Miss
          // Bennet. CHAPTER VII."
          current.title = cleanHeading(text).slice(0, 120);
        }
        return;
      }

      // Plate captions and rights lines sit in the body of illustrated books
      // and are not part of the prose.
      if (CAPTION.test(text)) return;

      current.paragraphs.push(text);
    });

  push();

  // Some books are one long block with <br> between paragraphs and no <p> at
  // all, which the pass above finds nothing in.
  if (sections.length === 0) {
    const whole = normalise($('body').text());
    const usable = whole.replace(GUTENBERG_LINE, '').trim();

    if (usable.length > 0) {
      const paragraphs = usable
        .split(/(?<=[.!?])\s{2,}/)
        .map((block) => block.trim())
        .filter((block) => block.length > 1 && !GUTENBERG_LINE.test(block));

      if (paragraphs.length) sections.push({ title: documentTitle, paragraphs });
    }
  }

  for (const section of sections) if (!section.title) section.title = documentTitle;

  return sections;
}

/**
 * Whether a section is a list rather than prose.
 *
 * Matching on the title is not enough: a table of contents whose heading reads
 * "Chapter I." passes every name check and then gets narrated as
 * "Chapter: I., II., III., IV." — which is what happened.
 *
 * Sentence length is the giveaway. Prose runs 60 to 150 characters a sentence;
 * a contents page, a list of illustrations or an index runs under twenty,
 * because every entry is a fragment.
 */
function looksLikeAList(sentences: Sentence[]): boolean {
  if (sentences.length === 0) return true;

  // Median rather than mean. A contents page with one long line of chapter
  // numbers in it — "Chapter: I., II., III., IV." — drags the average above
  // any sensible threshold while every other entry is three words long. The
  // median ignores that line and reports what the page is actually made of.
  const lengths = sentences.map((s) => s.text.length).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)]!;

  // Prose runs 60 to 150 characters a sentence. Anything whose typical line is
  // under forty is a contents page, a list of illustrations, or an index.
  if (median < 40) return true;
  if (sentences.length < 8) return false;

  // A run of roman numerals or bare numbers is a contents page even when the
  // entries carry chapter titles and the median creeps up.
  const fragments = sentences.filter((s) => /^(?:[ivxlcdm]+|\d+)\.?$/i.test(s.text.trim())).length;
  return fragments / sentences.length > 0.4;
}

function buildChapter(index: number, title: string, rawParagraphs: string[]): Chapter {
  const paragraphs: Paragraph[] = [];
  const sentences: Sentence[] = [];
  let offset = 0;

  for (const raw of rawParagraphs) {
    for (const piece of capParagraph(raw)) {
      const own = splitSentences(piece, offset);
      paragraphs.push({ text: piece, sentences: own });
      sentences.push(...own);
      offset += piece.length + 1;
    }
  }

  return {
    index,
    title: title || `Chapter ${index + 1}`,
    paragraphs,
    sentences,
    characters: offset,
    estimatedSeconds: Math.round(offset / CHARS_PER_SECOND),
  };
}

/** Resolves a manifest href against the OPF's own directory. */
function resolve(base: string, href: string): string {
  const clean = href.split('#')[0]!;
  if (!base) return clean;

  const parts = base.split('/');
  parts.pop();

  for (const segment of clean.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }

  return parts.join('/');
}

export async function parseEpub(data: Buffer, fallbackName: string): Promise<Book> {
  if (data.length > MAX_EPUB_BYTES) {
    throw new UserError(
      `That file is ${(data.length / 1024 / 1024).toFixed(0)} MB. The limit is ${MAX_EPUB_BYTES / 1024 / 1024} MB.`,
    );
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new UserError('That file is not a readable EPUB. It may be corrupt.');
  }

  // DRM is detectable and worth naming: "could not parse" would send someone
  // looking for a bug in the parser instead of at their file.
  if (zip.file('META-INF/encryption.xml') || zip.file('META-INF/rights.xml')) {
    throw new UserError(
      'That EPUB is DRM protected, so its text cannot be read. Only unencrypted EPUBs work.',
    );
  }

  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXml) throw new UserError('That EPUB has no container.xml, so it is not valid.');

  const opfPath = cheerio
    .load(containerXml, { xmlMode: true })('rootfile')
    .first()
    .attr('full-path');

  if (!opfPath) throw new UserError('That EPUB does not say where its contents are.');

  const opfXml = await zip.file(opfPath)?.async('text');
  if (!opfXml) throw new UserError('That EPUB is missing the file it points at.');

  const $opf = cheerio.load(opfXml, { xmlMode: true });

  const title =
    normalise($opf('metadata > dc\\:title, metadata > title').first().text()) ||
    fallbackName.replace(/\.epub$/i, '');
  const author =
    normalise($opf('metadata > dc\\:creator, metadata > creator').first().text()) || undefined;
  const language =
    normalise($opf('metadata > dc\\:language, metadata > language').first().text()) || undefined;

  // Manifest id to href, so the spine can be followed.
  const manifest = new Map<string, { href: string; type: string; properties: string }>();
  $opf('manifest > item').each((_, item) => {
    const id = $opf(item).attr('id');
    const href = $opf(item).attr('href');
    if (!id || !href) return;
    manifest.set(id, {
      href: resolve(opfPath, href),
      type: $opf(item).attr('media-type') ?? '',
      properties: $opf(item).attr('properties') ?? '',
    });
  });

  // Titles from the navigation, which are far better than the ones inside the
  // documents — many chapter files have no heading at all.
  const navTitles = await readNavigation(zip, $opf, manifest, opfPath);

  const chapters: Chapter[] = [];
  let skipped = 0;

  const spine = $opf('spine > itemref').toArray();

  for (const ref of spine) {
    const idref = $opf(ref).attr('idref');
    if (!idref) continue;

    const entry = manifest.get(idref);
    if (!entry || !/html|xml/i.test(entry.type)) continue;

    const html = await zip.file(entry.href)?.async('text');
    if (!html) continue;

    const sections = extractSections(html);

    for (const [position, section] of sections.entries()) {
      // The navigation title is better than a heading scraped from the page,
      // but only for the first section — later ones are this file's own
      // chapters and have their own headings.
      const named = (position === 0 ? navTitles.get(entry.href) : undefined) ?? section.title;

      const characters = section.paragraphs.reduce((sum, p) => sum + p.length, 0);

      // Front and back matter, by name or by being too short to be a chapter.
      if (NOT_A_CHAPTER.test(named.trim()) || characters < MIN_CHAPTER_CHARS) {
        skipped++;
        continue;
      }

      const built = buildChapter(chapters.length, named, section.paragraphs);

      // Built first, because the test is on the sentences rather than the raw
      // text — a contents page is only obvious once it is split up.
      if (looksLikeAList(built.sentences)) {
        skipped++;
        continue;
      }

      // A section that is mostly licence is licence. The start and end markers
      // are per-document, so a licence living in its own file never sees one —
      // which is how four hundred sentences of Gutenberg terms became the
      // longest "chapter" in Frankenstein.
      const licenceLines = section.paragraphs.filter((p) => GUTENBERG_LINE.test(p)).length;
      if (licenceLines / Math.max(1, section.paragraphs.length) > 0.25) {
        skipped++;
        continue;
      }

      chapters.push(built);
    }
  }

  if (chapters.length === 0) {
    throw new UserError(
      'No readable chapters were found in that EPUB. It may be image-only, or structured in a way this cannot read.',
    );
  }

  logger.info({ title, chapters: chapters.length, skipped }, 'Parsed EPUB');

  const cover = await readCover(zip, $opf, manifest);

  return {
    title: title.slice(0, 200),
    author: author?.slice(0, 120),
    language,
    chapters,
    totalCharacters: chapters.reduce((sum, c) => sum + c.characters, 0),
    estimatedSeconds: chapters.reduce((sum, c) => sum + c.estimatedSeconds, 0),
    cover: cover?.data,
    coverType: cover?.type,
  };
}

/**
 * Chapter titles from whichever navigation format the book uses.
 *
 * EPUB3 has nav.xhtml, EPUB2 has an NCX, and plenty of files in the wild carry
 * both or neither. Both are read, EPUB3 winning where they disagree.
 */
async function readNavigation(
  zip: JSZip,
  $opf: cheerio.CheerioAPI,
  manifest: Map<string, { href: string; type: string; properties: string }>,
  opfPath: string,
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();

  // EPUB2: the NCX named by the spine's toc attribute.
  const ncxId = $opf('spine').attr('toc');
  const ncxHref = ncxId ? manifest.get(ncxId)?.href : undefined;

  if (ncxHref) {
    const ncx = await zip.file(ncxHref)?.async('text');
    if (ncx) {
      const $ncx = cheerio.load(ncx, { xmlMode: true });
      $ncx('navPoint').each((_, point) => {
        const label = normalise($ncx(point).find('navLabel > text').first().text());
        const src = $ncx(point).find('content').first().attr('src');
        if (label && src) titles.set(resolve(ncxHref, src), label);
      });
    }
  }

  // EPUB3: the manifest item marked with the nav property.
  for (const entry of manifest.values()) {
    if (!entry.properties.includes('nav')) continue;

    const nav = await zip.file(entry.href)?.async('text');
    if (!nav) continue;

    const $nav = cheerio.load(nav);
    $nav('nav a').each((_, anchor) => {
      const label = normalise($nav(anchor).text());
      const href = $nav(anchor).attr('href');
      if (label && href) titles.set(resolve(entry.href, href), label);
    });
    break;
  }

  return titles;
}

async function readCover(
  zip: JSZip,
  $opf: cheerio.CheerioAPI,
  manifest: Map<string, { href: string; type: string; properties: string }>,
): Promise<{ data: Buffer; type: string } | undefined> {
  let href: string | undefined;
  let type = '';

  for (const entry of manifest.values()) {
    if (entry.properties.includes('cover-image')) {
      href = entry.href;
      type = entry.type;
      break;
    }
  }

  if (!href) {
    const metaId = $opf('metadata > meta[name="cover"]').attr('content');
    const entry = metaId ? manifest.get(metaId) : undefined;
    if (entry) {
      href = entry.href;
      type = entry.type;
    }
  }

  if (!href || !/jpeg|jpg|png|webp/i.test(type)) return undefined;

  const data = await zip.file(href)?.async('nodebuffer');
  // Discord will not render anything larger, and a cover is decoration.
  return data && data.length < 8 * 1024 * 1024 ? { data, type } : undefined;
}
