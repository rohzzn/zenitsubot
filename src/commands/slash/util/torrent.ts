import type {
  Client,
  ChatInputCommandInteraction,
  ButtonInteraction,
  InteractionEditReplyOptions,
} from 'discord.js';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  escapeMarkdown,
  type Message,
} from 'discord.js';
import { brandEmbed, pagerRow, count, text, since } from '../../../utils/ui.js';
import { getPrisma } from '../../../services/db.js';
import { MAX_WATCHES_PER_USER } from '../../../services/torrentWatch.js';
import {
  searchArchive,
  magnetForArchiveItem,
  parseMagnet,
  formatBytes,
  TorrentError,
  type TorrentResult,
} from '../../../services/torrent.js';
import {
  scrape1337xTorrent,
  take1337xCooldown,
  Torrent1337xError,
  type Leetx1337xOrder,
  type Leetx1337xSort,
  type Torrent1337xDetails,
} from '../../../services/1337x.js';
import {
  completeResult,
  searchSources,
  sourceById,
  DEFAULT_SOURCE_IDS,
  PUBLIC_TRACKERS,
  SOURCES,
  type SourceId,
  type SourceResult,
} from '../../../services/sources/index.js';
import {
  parseReleaseName,
  qualityLabel,
  episodeLabel,
  titleFromRelease,
  type ParsedRelease,
} from '../../../services/releaseName.js';
import { rankByScore } from '../../../services/torrentRank.js';
import { lookupTitle, tmdbConfigured, type TmdbInfo } from '../../../services/tmdb.js';
import { planQuery, type QueryPlan } from '../../../services/torrentQuery.js';
import { logger } from '../../../services/logger.js';

const BROWSE_TIMEOUT_MS = 5 * 60 * 1000;
const GET_MAGNET_ID = 'torrent_magnet';

/**
 * Discord caps an embed description at 4096 characters and brandEmbed trims to
 * 4000. A magnet that would be cut is useless, so anything near the limit is
 * sent as a file instead of being truncated.
 */
const MAGNET_INLINE_LIMIT = 3800;
/** Embed field values are capped at 1024. */
const FIELD_LIMIT = 1024;
const FILE_PREVIEW_LIMIT = 12;

/** Scraped text is untrusted: escape it before it lands in a field value. */
function safe(value: string | undefined, max = 240): string {
  if (!value) return '-';
  const escaped = escapeMarkdown(value.replace(/\s+/g, ' ').trim());
  return escaped.length > max ? `${escaped.slice(0, max - 1)}…` : escaped || '-';
}

function bytes(value?: number): string {
  return value === undefined ? 'unknown' : formatBytes(value);
}

function timestamp(iso?: string): string {
  if (!iso) return '-';
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? since(parsed) : '-';
}

// ------------------------------------------------------------------- 1337x

/** Results kept in memory for filtering; only MAX_LISTED are ever shown. */
const FETCH_LIMIT = 40;
/** Select menus allow 25 options; 15 keeps the list embed readable. */
const MAX_LISTED = 15;

interface Listed extends SourceResult {
  release: ParsedRelease;
}

function enrich(result: SourceResult): Listed {
  return { ...result, release: parseReleaseName(result.title) };
}

/** The quality line under a result: what it is, in the words releases use. */
function qualityLine(entry: Listed): string {
  return (
    [
      episodeLabel(entry.release),
      qualityLabel(entry.release) || entry.type,
      entry.release.audio,
      entry.release.repack ? 'REPACK' : undefined,
      entry.trusted ? 'Trusted' : undefined,
      entry.release.lowQuality ? '⚠ cam/TS rip' : undefined,
    ]
      .filter(Boolean)
      .join(' · ') || '—'
  );
}

/**
 * Details for a result, from wherever they can be had.
 *
 * Only 1337x withholds the infohash until its page is scraped. Every other
 * index hands it over with the search results, so opening one of those costs
 * no request at all.
 */
async function detailsForResult(source: SourceResult): Promise<Torrent1337xDetails> {
  if (source.source === '1337x') return scrape1337xTorrent(source.pageUrl);

  // FitGirl keeps its magnet on the post rather than the listing.
  const result = await completeResult(source);

  return {
    // Only used to name the magnet attachment.
    id: Number(result.id) || 0,
    title: result.title,
    pageUrl: result.pageUrl,
    magnet: result.magnet,
    infoHash: result.infoHash,
    category: result.category,
    type: result.type,
    sizeBytes: result.sizeBytes,
    uploader: result.uploader,
    downloads: result.downloads,
    uploadedAt: result.uploadedAt,
    seeders: result.seeders,
    leechers: result.leechers,
    trackers: PUBLIC_TRACKERS,
    files: [],
    metadataCategories: [],
  };
}

interface Filter {
  token: string;
  label: string;
  matches: (entry: Listed) => boolean;
}

/**
 * Filters are built from the results in hand, so a button only appears when it
 * would actually split them. Offering "2160p" when nothing is 2160p, or when
 * everything is, just wastes a click.
 */
function availableFilters(entries: Listed[]): Filter[] {
  const candidates: Filter[] = [];

  for (const resolution of ['2160p', '1080p', '720p']) {
    candidates.push({
      token: `res:${resolution}`,
      label: resolution,
      matches: (entry) => entry.release.resolution === resolution,
    });
  }
  for (const codec of ['x265', 'x264']) {
    candidates.push({
      token: `codec:${codec}`,
      label: codec,
      matches: (entry) => entry.release.codec === codec,
    });
  }
  candidates.push({
    token: 'trusted',
    label: 'Trusted',
    matches: (entry) => entry.trusted === true,
  });
  candidates.push({
    token: 'noCam',
    label: 'No cam rips',
    matches: (entry) => !entry.release.lowQuality,
  });
  // Only meaningful once a search has turned up episodic releases at all.
  candidates.push({
    token: 'pack',
    label: 'Season packs',
    matches: (entry) => entry.release.completePack === true,
  });

  return candidates
    .filter((filter) => {
      const hits = entries.filter(filter.matches).length;
      return hits > 0 && hits < entries.length;
    })
    .slice(0, 4);
}

function applyFilters(entries: Listed[], active: Set<string>, filters: Filter[]): Listed[] {
  const chosen = filters.filter((filter) => active.has(filter.token));
  if (chosen.length === 0) return entries;

  // Resolutions are alternatives to each other; everything else narrows.
  const resolutions = chosen.filter((filter) => filter.token.startsWith('res:'));
  const rest = chosen.filter((filter) => !filter.token.startsWith('res:'));

  return entries.filter(
    (entry) =>
      (resolutions.length === 0 || resolutions.some((filter) => filter.matches(entry))) &&
      rest.every((filter) => filter.matches(entry)),
  );
}

/**
 * All results in one embed rather than one card at a time.
 *
 * Choosing between torrents means comparing seeders and quality across them,
 * which paging through single cards makes impossible.
 */
function listEmbed(
  entries: Listed[],
  query: string,
  context: { plan?: QueryPlan; filtered: boolean; total: number },
): EmbedBuilder {
  const lines = entries.map((entry, index) => {
    const facts = [
      sourceById(entry.source)?.label ?? entry.source,
      bytes(entry.sizeBytes),
      `${count(entry.seeders)} seeders`,
      qualityLine(entry),
    ].join(' · ');

    return `\`${String(index + 1).padStart(2)}.\` **[${safe(entry.title, 80)}](${entry.pageUrl})**\n${facts}`;
  });

  const header = context.plan?.interpreted
    ? `Read as **${safe(context.plan.note ?? context.plan.search, 120)}**\n\n`
    : '';

  const embed = brandEmbed({
    author: { name: `${entries.length} of ${context.total} results` },
    title: `Search: ${query.slice(0, 200)}`,
    description: `${header}${lines.join('\n\n')}`.slice(0, 4000),
    footer: context.filtered
      ? 'Filtered. Pick one below for the magnet and full details'
      : 'Pick one below for the magnet and full details',
  });

  return embed;
}

function resultSelect(entries: Listed[], id: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder('Open a result…')
    .addOptions(
      entries.map((entry, index) => ({
        // Select labels and descriptions are both capped at 100 characters.
        label: `${index + 1}. ${entry.title}`.slice(0, 100),
        description:
          `${bytes(entry.sizeBytes)} · ${count(entry.seeders)} seeders · ${qualityLine(entry)}`.slice(
            0,
            100,
          ),
        value: String(index),
      })),
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/**
 * The source picker.
 *
 * A plain search asks the two broad indexes, because that is what answers an
 * ordinary question quickly. The specialised ones — anime, DHT, game repacks —
 * live here instead of in the default set: they are one click away when you
 * want them and cost nothing when you do not.
 */
function sourceRow(
  active: SourceId[],
  category: string | undefined,
  prefix: string,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = SOURCES.map((source) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(source.label)
      .setDescription(source.blurb.slice(0, 100))
      .setValue(source.id)
      .setDefault(active.includes(source.id)),
  );

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${prefix}src`)
    .setPlaceholder('Sources to search…')
    .setMinValues(1)
    .setMaxValues(options.length)
    .addOptions(options);

  // Naming the category makes it obvious why a source contributed nothing.
  if (category) menu.setPlaceholder(`Sources to search (${category})…`);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function filterRow(
  filters: Filter[],
  active: Set<string>,
  prefix: string,
): ActionRowBuilder<ButtonBuilder> | undefined {
  if (filters.length === 0) return undefined;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    filters.map((filter) =>
      new ButtonBuilder()
        .setCustomId(`${prefix}f:${filter.token}`)
        .setLabel(filter.label)
        .setStyle(active.has(filter.token) ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
  );

  if (active.size > 0) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}reset`)
        .setLabel('Clear')
        .setStyle(ButtonStyle.Danger),
    );
  }

  return row;
}

/**
 * A page with an infohash but no magnet link still yields a usable magnet;
 * the reference scraper treats those two as interchangeable for that reason.
 */
function magnetFor(details: Torrent1337xDetails): string | undefined {
  if (details.magnet) return details.magnet;
  if (!details.infoHash) return undefined;

  const params = new URLSearchParams();
  params.set('dn', details.title);
  for (const tracker of details.trackers.slice(0, 20)) params.append('tr', tracker);

  return `magnet:?xt=urn:btih:${details.infoHash}&${params}`;
}

function filePreview(details: Torrent1337xDetails): string | undefined {
  if (details.files.length === 0) return undefined;

  const lines: string[] = [];
  let used = 0;

  for (const file of details.files.slice(0, FILE_PREVIEW_LIMIT)) {
    const size = file.sizeBytes ? ` (${formatBytes(file.sizeBytes)})` : '';
    const line = `- ${safe(file.name, 90)}${size}`;
    if (used + line.length + 1 > FIELD_LIMIT - 40) break;
    lines.push(line);
    used += line.length + 1;
  }

  if (lines.length === 0) return undefined;

  const remaining = details.files.length - lines.length;
  if (remaining > 0) lines.push(`…and ${remaining} more`);

  return lines.join('\n').slice(0, FIELD_LIMIT);
}

function detailsEmbed(details: Torrent1337xDetails, meta?: TmdbInfo | null): EmbedBuilder {
  const embed = brandEmbed({
    author: { name: '1337x torrent' },
    title: details.title.slice(0, 250),
    url: details.pageUrl,
    // TMDb's poster beats whatever thumbnail the mirror scraped, when we have one.
    thumbnail: meta?.posterUrl ?? details.coverUrl,
    footer: 'Only download material you are legally allowed to',
  });

  // What the release actually is, before the encode details of how it was made.
  if (meta) {
    const heading = [meta.title, meta.year ? `(${meta.year})` : undefined]
      .filter(Boolean)
      .join(' ');
    const facts = [
      meta.rating
        ? `${meta.rating}/10${meta.votes ? ` from ${count(meta.votes)} votes` : ''}`
        : undefined,
      meta.genres?.length ? meta.genres.slice(0, 3).join(', ') : undefined,
    ]
      .filter(Boolean)
      .join(' · ');

    embed.addFields({
      name: safe(heading, 200),
      value:
        [facts, meta.overview ? safe(meta.overview, 600) : undefined]
          .filter(Boolean)
          .join('\n\n')
          .slice(0, FIELD_LIMIT) || '—',
      inline: false,
    });
  }

  embed.addFields(
    { name: 'Category', value: safe(details.category, 60), inline: true },
    { name: 'Type', value: safe(details.type, 60), inline: true },
    { name: 'Language', value: safe(details.language, 60), inline: true },
    { name: 'Total size', value: bytes(details.sizeBytes), inline: true },
    { name: 'Seeders', value: text(count(details.seeders)), inline: true },
    { name: 'Leechers', value: text(count(details.leechers)), inline: true },
    { name: 'Downloads', value: text(count(details.downloads)), inline: true },
    { name: 'Uploader', value: safe(details.uploader, 80), inline: true },
    { name: 'Uploaded', value: timestamp(details.uploadedAt), inline: true },
    { name: 'Last checked', value: timestamp(details.checkedAt), inline: true },
    { name: 'Files', value: String(details.files.length), inline: true },
    { name: 'Trackers', value: String(details.trackers.length), inline: true },
  );

  if (details.infoHash) {
    embed.addFields({ name: 'Infohash', value: `\`${details.infoHash}\``, inline: false });
  }

  const preview = filePreview(details);
  if (preview) embed.addFields({ name: 'Contents', value: preview, inline: false });

  if (details.metadataDescription) {
    embed.addFields({
      name: safe(details.metadataTitle, 100) === '-' ? 'About' : safe(details.metadataTitle, 100),
      value: safe(details.metadataDescription, 400),
      inline: false,
    });
  }

  embed.addFields({ name: 'Source', value: details.pageUrl.slice(0, FIELD_LIMIT), inline: false });

  return embed;
}

export type MagnetDelivery =
  | { kind: 'none' }
  | { kind: 'inline'; magnet: string }
  | { kind: 'file'; magnet: string; filename: string };

/**
 * Decides how a magnet reaches the user.
 *
 * A truncated magnet is a broken magnet, so anything that would not survive an
 * embed description intact goes out as a file instead.
 */
export function magnetDelivery(details: Torrent1337xDetails): MagnetDelivery {
  const magnet = magnetFor(details);
  if (!magnet) return { kind: 'none' };
  if (magnet.length <= MAGNET_INLINE_LIMIT) return { kind: 'inline', magnet };

  return { kind: 'file', magnet, filename: `magnet-${details.id}.txt` };
}

/**
 * TMDb for a scraped torrent, keyed on the title recovered from the release
 * name. Never blocks the card: a failure just means less context.
 */
async function metadataFor(details: Torrent1337xDetails): Promise<TmdbInfo | null> {
  if (!tmdbConfigured()) return null;

  // The site's own catalogue heading is already a clean title when present;
  // otherwise it has to be recovered from the release name.
  const parsed = parseReleaseName(details.title);
  const recovered = titleFromRelease(details.title);
  const title = details.metadataTitle ?? recovered.title;

  const episodic = parsed.season !== undefined || details.category === 'TV';

  return lookupTitle(title, {
    year: recovered.year,
    kind: episodic ? 'tv' : 'movie',
  });
}

function magnetReply(
  details: Torrent1337xDetails,
  meta?: TmdbInfo | null,
): InteractionEditReplyOptions {
  const embed = detailsEmbed(details, meta);
  const delivery = magnetDelivery(details);

  if (delivery.kind === 'none') {
    embed.setDescription('That page has no magnet link or infohash.');
    return { embeds: [embed], files: [] };
  }

  if (delivery.kind === 'inline') {
    embed.setDescription(`\`\`\`\n${delivery.magnet}\n\`\`\``);
    return { embeds: [embed], files: [] };
  }

  embed.setDescription('The magnet is too long for an embed, so it is attached as a text file.');
  const file = new AttachmentBuilder(Buffer.from(delivery.magnet, 'utf8'), {
    name: delivery.filename,
  });

  return { embeds: [embed], files: [file] };
}

/**
 * Scrapes a torrent page, reporting failure in place.
 *
 * Returns the details rather than replying with them, so the caller decides
 * how they are presented.
 */
async function fetchDetails(
  interaction: ButtonInteraction | ChatInputCommandInteraction,
  torrent: string | number,
): Promise<Torrent1337xDetails | null> {
  try {
    return await scrape1337xTorrent(torrent);
  } catch (err) {
    if (!(err instanceof Torrent1337xError)) logger.error({ err }, '1337x scrape failed');

    await interaction.editReply({
      content: err instanceof Torrent1337xError ? err.message : 'Could not read that torrent page.',
      embeds: [],
      files: [],
      components: [],
    });
    return null;
  }
}

/** The ephemeral magnet on its own; the metadata is already on screen. */
function magnetOnlyReply(details: Torrent1337xDetails) {
  const delivery = magnetDelivery(details);

  if (delivery.kind === 'none') {
    return { content: 'That page has no magnet link or infohash.', ephemeral: true as const };
  }
  if (delivery.kind === 'inline') {
    return {
      content: `**${safe(details.title, 120)}**\n\`\`\`\n${delivery.magnet}\n\`\`\``.slice(0, 1990),
      ephemeral: true as const,
    };
  }

  return {
    content: 'That magnet is too long for a message, so here it is as a file.',
    files: [
      new AttachmentBuilder(Buffer.from(delivery.magnet, 'utf8'), { name: delivery.filename }),
    ],
    ephemeral: true as const,
  };
}

/** "best" is a local ranking, not something 1337x can sort by. */
export type TorrentSort = 'best' | Leetx1337xSort;

interface SearchContext {
  query: string;
  plan: QueryPlan;
  category?: string;
  /** Which indexes to ask; the default pair unless changed in the message. */
  sources: SourceId[];
  sort: TorrentSort;
  order: Leetx1337xOrder;
  season?: number;
  episode?: number;
  allowAdult: boolean;
}

/**
 * Keeps only what belongs to the season or episode asked for.
 *
 * A season pack contains the episode, so it stays; a release with no episode
 * information at all is ambiguous rather than wrong, so it stays too. Never
 * allowed to empty the list — if nothing matches, the request was probably a
 * misreading and the unfiltered results are more use than none.
 */
export function narrowToEpisode<T extends { release: ParsedRelease }>(
  entries: T[],
  season?: number,
  episode?: number,
): T[] {
  if (season === undefined && episode === undefined) return entries;

  const narrowed = entries.filter(({ release }) => {
    if (season !== undefined && release.season !== undefined && release.season !== season) {
      return false;
    }
    if (episode !== undefined && release.episode !== undefined && release.episode !== episode) {
      return false;
    }
    // Asked for one episode: a pack has it, a different single episode does not.
    if (episode !== undefined && release.episode === undefined && !release.completePack) {
      return release.season === season;
    }
    return true;
  });

  return narrowed.length > 0 ? narrowed : entries;
}

/**
 * Runs a search and hands back a browsable message.
 *
 * Re-entrant: "search literally" calls it again on the same reply, so the old
 * collector is stopped and a fresh one takes over the same message.
 */
async function renderSearch(
  interaction: ChatInputCommandInteraction,
  context: SearchContext,
): Promise<void> {
  const { plan } = context;

  let outcome;
  try {
    outcome = await searchSources({
      query: plan.search,
      category: plan.category ?? context.category,
      sources: context.sources,
      limit: FETCH_LIMIT,
    });
  } catch (err) {
    logger.error({ err, query: context.query }, 'Torrent search failed');
    await interaction.editReply({ content: 'Search failed.', embeds: [], components: [] });
    return;
  }

  // Every index carries adult releases, and a plain search does surface them.
  // They stay out unless the channel is age-restricted or the category was
  // asked for by name.
  const keep = (result: SourceResult) => context.allowAdult || result.category !== 'XXX';

  let entries = outcome.results.filter(keep).map(enrich);

  // A resolution the model inferred narrows the results but must never empty
  // them: if nothing matches, the request was a guess and the rest still count.
  if (plan.resolution) {
    const narrowed = entries.filter((entry) => entry.release.resolution === plan.resolution);
    if (narrowed.length > 0) entries = narrowed;
  }

  entries = narrowToEpisode(
    entries,
    context.season ?? plan.season,
    context.episode ?? plan.episode,
  );

  // Ranked here rather than in the service, because scoring needs the parsed
  // release name and the service deals in raw rows.
  if (context.sort === 'best') entries = rankByScore(entries);

  if (entries.length === 0) {
    // Naming the indexes that failed matters: "nothing found" and "three of
    // four sources were down" deserve different reactions from the user.
    const down = outcome.failures.length
      ? `\n\nUnreachable right now: ${outcome.failures.map((f) => f.label).join(', ')}.`
      : '';

    await interaction.editReply({
      content: `Nothing matched **${escapeMarkdown(context.query)}**.${down}`,
      embeds: [],
      components: [],
    });
    return;
  }

  const prefix = `tx${interaction.id}:`;
  const selectId = `${prefix}sel`;
  const filters = availableFilters(entries);
  const active = new Set<string>();

  let view: 'list' | 'detail' = 'list';
  let detail: Torrent1337xDetails | null = null;
  let detailMeta: TmdbInfo | null = null;
  let superseded = false;

  const visible = () => applyFilters(entries, active, filters).slice(0, MAX_LISTED);

  const payload = () => {
    if (view === 'detail' && detail) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${prefix}magnet`)
          .setLabel('Get magnet')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${prefix}back`)
          .setLabel('Back to results')
          .setStyle(ButtonStyle.Secondary),
      );

      return { content: '', embeds: [detailsEmbed(detail, detailMeta)], components: [row] };
    }

    const shown = visible();
    const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

    if (shown.length > 0) {
      rows.push(
        resultSelect(shown, selectId) as ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>,
      );
    }

    const filterButtons = filterRow(filters, active, prefix);
    if (filterButtons) {
      rows.push(filterButtons as ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>);
    }

    rows.push(
      sourceRow(context.sources, context.category, prefix) as ActionRowBuilder<
        StringSelectMenuBuilder | ButtonBuilder
      >,
    );

    if (plan.interpreted) {
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`${prefix}literal`)
            .setLabel('Search my words instead')
            .setStyle(ButtonStyle.Secondary),
        ) as ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>,
      );
    }

    return {
      content: '',
      embeds: [
        listEmbed(shown, context.query, {
          plan,
          filtered: active.size > 0,
          total: entries.length,
        }),
      ],
      components: rows,
    };
  };

  const message = (await interaction.editReply(payload())) as Message;

  const collector = message.createMessageComponentCollector({ time: BROWSE_TIMEOUT_MS });

  collector.on('collect', async (component) => {
    if (component.user.id !== interaction.user.id) {
      await component.reply({
        content: 'Run `/torrent search` yourself to browse.',
        ephemeral: true,
      });
      return;
    }

    const id = component.customId;

    if (component.isStringSelectMenu() && id === selectId) {
      const index = Number(component.values[0]);
      const chosen = visible()[index];
      if (!chosen) {
        await component.deferUpdate();
        return;
      }

      const cooldown = take1337xCooldown(component.user.id, 'details');
      if (cooldown > 0) {
        await component.reply({
          content: `Slow down — try again in ${Math.ceil(cooldown / 1000)}s.`,
          ephemeral: true,
        });
        return;
      }

      // Scraping the detail page takes a moment.
      await component.deferUpdate();
      try {
        detail = await detailsForResult(chosen);
        detailMeta = await metadataFor(detail);
        view = 'detail';
      } catch (err) {
        const reason =
          err instanceof Torrent1337xError ? err.message : 'Could not read that torrent page.';
        if (!(err instanceof Torrent1337xError)) logger.error({ err }, '1337x scrape failed');
        await component.followUp({ content: reason, ephemeral: true });
      }

      await interaction.editReply(payload());
      return;
    }

    if (component.isStringSelectMenu() && id === `${prefix}src`) {
      const chosen = component.values as SourceId[];
      // Re-running is the honest response: a different set of indexes is a
      // different search, not a filter over what is already on screen.
      await component.deferUpdate();
      superseded = true;
      collector.stop('sources changed');
      await renderSearch(interaction, { ...context, sources: chosen });
      return;
    }

    if (!component.isButton()) return;

    if (id === `${prefix}magnet`) {
      if (!detail) {
        await component.deferUpdate();
        return;
      }
      await component.reply(magnetOnlyReply(detail));
      return;
    }

    if (id === `${prefix}back`) {
      view = 'list';
      detail = null;
      detailMeta = null;
      await component.update(payload());
      return;
    }

    if (id === `${prefix}reset`) {
      active.clear();
      view = 'list';
      await component.update(payload());
      return;
    }

    if (id.startsWith(`${prefix}f:`)) {
      const token = id.slice(`${prefix}f:`.length);
      if (active.has(token)) active.delete(token);
      else active.add(token);

      // A filter combination with nothing left in it helps no one.
      if (visible().length === 0) active.delete(token);

      view = 'list';
      detail = null;
      await component.update(payload());
      return;
    }

    if (id === `${prefix}literal`) {
      await component.deferUpdate();
      superseded = true;
      collector.stop('superseded');
      await renderSearch(interaction, {
        ...context,
        plan: { search: context.query, interpreted: false },
      });
      return;
    }
  });

  collector.on('end', () => {
    if (superseded) return;
    // Disabled rather than stripped, so an expired message still reads as one
    // that used to work instead of looking half-rendered.
    void interaction
      .editReply({
        components: [],
        embeds: [
          (payload().embeds[0] as EmbedBuilder).setFooter({
            text: 'This search expired. Run /torrent search again.',
          }),
        ],
      })
      .catch(() => {});
  });
}

async function runLeetxSearch(interaction: ChatInputCommandInteraction): Promise<void> {
  const query = interaction.options.getString('query', true).trim();
  const category = interaction.options.getString('category') ?? undefined;
  const sort = (interaction.options.getString('sort') ?? 'best') as TorrentSort;
  const order = (interaction.options.getString('order') ?? 'desc') as Leetx1337xOrder;
  const season = interaction.options.getInteger('season') ?? undefined;
  const episode = interaction.options.getInteger('episode') ?? undefined;

  // "all" and the Internet Archive are handled before this point, so anything
  // left names one of the indexes.
  // The Internet Archive is routed away before this point, so anything left
  // names an index. "all" opens the lot; otherwise it is the default pair, and
  // the picker on the results message changes it from there.
  const chosen = interaction.options.getString('source');
  const sources: SourceId[] =
    chosen === 'all'
      ? SOURCES.map((source) => source.id)
      : chosen
        ? [chosen as SourceId]
        : DEFAULT_SOURCE_IDS;

  const wait = take1337xCooldown(interaction.user.id);
  if (wait > 0) {
    await interaction.reply({
      content: `Slow down — try again in ${Math.ceil(wait / 1000)}s.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const channel = interaction.channel;
  const allowAdult =
    category?.toLowerCase() === 'xxx' || (channel !== null && 'nsfw' in channel && channel.nsfw);

  // Best effort, never blocking: an unconfigured or slow model just means the
  // words get searched as typed.
  const plan = await planQuery(query);

  await renderSearch(interaction, {
    query,
    plan,
    category,
    sources,
    sort,
    order,
    season,
    episode,
    allowAdult,
  });
}

async function runLeetxScrape(interaction: ChatInputCommandInteraction): Promise<void> {
  const input = interaction.options.getString('torrent', true).trim();

  const wait = take1337xCooldown(interaction.user.id, 'details');
  if (wait > 0) {
    await interaction.reply({
      content: `Slow down — try again in ${Math.ceil(wait / 1000)}s.`,
      ephemeral: true,
    });
    return;
  }

  // Ephemeral throughout: the magnet has to be, and splitting the reply in two
  // would only make the metadata harder to read alongside it.
  await interaction.deferReply({ ephemeral: true });

  const details = await fetchDetails(interaction, input);
  if (!details) return;

  await interaction.editReply(magnetReply(details, await metadataFor(details)));
}

// ------------------------------------------------------------------- watches

async function runWatch(interaction: ChatInputCommandInteraction): Promise<void> {
  const prisma = getPrisma();
  const action = interaction.options.getSubcommand();

  if (action === 'list') {
    const watches = await prisma.torrentWatch.findMany({
      where: { userId: interaction.user.id, active: true },
      orderBy: { createdAt: 'asc' },
    });

    if (watches.length === 0) {
      await interaction.reply({
        content: 'You are not watching anything. Add one with `/torrent watch add`.',
        ephemeral: true,
      });
      return;
    }

    const embed = brandEmbed({
      author: { name: 'Torrent watches' },
      description: watches
        .map((watch, index) => {
          const extras = [
            watch.category,
            watch.resolution,
            watch.minSeeders ? `${watch.minSeeders}+ seeders` : undefined,
          ]
            .filter(Boolean)
            .join(' · ');
          const checked = watch.lastCheckedAt
            ? `last checked ${since(watch.lastCheckedAt)}`
            : 'not checked yet';
          return `\`${index + 1}.\` **${safe(watch.query, 90)}**\n${extras || 'any quality'} — ${checked}\n\`${watch.id}\``;
        })
        .join('\n\n')
        .slice(0, 4000),
      footer: `${watches.length} of ${MAX_WATCHES_PER_USER} — remove with /torrent watch remove`,
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (action === 'remove') {
    const id = interaction.options.getString('watch', true).trim();

    // Scoped to the caller, so an id from someone else's list does nothing.
    const { count: removed } = await prisma.torrentWatch.deleteMany({
      where: { id, userId: interaction.user.id },
    });

    await interaction.reply({
      content: removed > 0 ? 'Watch removed.' : 'No watch of yours has that id.',
      ephemeral: true,
    });
    return;
  }

  // add
  const query = interaction.options.getString('query', true).trim();
  const category = interaction.options.getString('category') ?? null;
  const resolution = interaction.options.getString('resolution') ?? null;
  const minSeeders = interaction.options.getInteger('min_seeders') ?? 0;

  const existing = await prisma.torrentWatch.count({
    where: { userId: interaction.user.id, active: true },
  });

  if (existing >= MAX_WATCHES_PER_USER) {
    await interaction.reply({
      content: `You already have ${MAX_WATCHES_PER_USER} watches. Remove one first.`,
      ephemeral: true,
    });
    return;
  }

  const watch = await prisma.torrentWatch.create({
    data: {
      guildId: interaction.guildId ?? '',
      channelId: interaction.channelId ?? '',
      userId: interaction.user.id,
      query,
      category,
      resolution,
      minSeeders,
    },
  });

  const filters = [category, resolution, minSeeders ? `${minSeeders}+ seeders` : undefined]
    .filter(Boolean)
    .join(' · ');

  await interaction.reply({
    content: [
      `Watching **${escapeMarkdown(query)}**${filters ? ` (${filters})` : ''}.`,
      'Checked every half hour; anything new gets posted here.',
      `Remove it with \`/torrent watch remove watch:${watch.id}\`.`,
    ].join('\n'),
    ephemeral: true,
  });
}

// -------------------------------------------------------- Internet Archive

function archiveResultEmbed(result: TorrentResult, index: number, total: number) {
  const embed = brandEmbed({
    author: { name: `Internet Archive - ${index + 1} of ${total}` },
    title: text(result.title, result.identifier),
    url: result.pageUrl,
    footer: 'Public domain and openly licensed material',
  });

  embed.addFields(
    { name: 'Type', value: text(result.mediatype, 'unknown'), inline: true },
    { name: 'Size', value: text(formatBytes(result.size)), inline: true },
    { name: 'Downloads', value: text(count(result.downloads)), inline: true },
  );

  if (result.creator) {
    embed.addFields({ name: 'Creator', value: text(result.creator).slice(0, 200), inline: true });
  }
  if (result.year) {
    embed.addFields({ name: 'Year', value: text(result.year), inline: true });
  }

  embed.addFields({ name: 'Identifier', value: `\`${result.identifier}\``, inline: false });

  return embed;
}

function archiveControls(index: number, total: number) {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  if (total > 1) rows.push(pagerRow(index, total));

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(GET_MAGNET_ID)
        .setLabel('Get magnet link')
        .setStyle(ButtonStyle.Success),
    ),
  );

  return rows;
}

async function runArchiveSearch(interaction: ChatInputCommandInteraction): Promise<void> {
  const query = interaction.options.getString('query', true).trim();
  await interaction.deferReply();

  let results: TorrentResult[];
  try {
    results = await searchArchive(query, 8);
  } catch (err) {
    await interaction.editReply(err instanceof TorrentError ? err.message : 'Search failed.');
    return;
  }

  if (results.length === 0) {
    await interaction.editReply(`Nothing found for **${query}**.`);
    return;
  }

  let index = 0;
  const payload = () => ({
    embeds: [archiveResultEmbed(results[index]!, index, results.length)],
    components: archiveControls(index, results.length),
  });

  const message = (await interaction.editReply(payload())) as Message;

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: BROWSE_TIMEOUT_MS,
  });

  collector.on('collect', async (button) => {
    if (button.user.id !== interaction.user.id) {
      await button.reply({ content: 'Run `/torrent` yourself to browse.', ephemeral: true });
      return;
    }

    if (button.customId === GET_MAGNET_ID) {
      // Fetching and parsing the .torrent takes a moment.
      await button.deferReply({ ephemeral: true });

      try {
        const details = await magnetForArchiveItem(results[index]!);

        const embed = brandEmbed({
          author: { name: 'Magnet link' },
          title: details.name.slice(0, 240),
          description: `\`\`\`\n${details.magnet}\n\`\`\``,
          footer: 'Copy the link above into your torrent client',
        });

        embed.addFields(
          { name: 'Infohash', value: `\`${details.infoHash}\``, inline: false },
          { name: 'Size', value: formatBytes(details.totalBytes), inline: true },
          { name: 'Files', value: String(details.fileCount), inline: true },
          { name: 'Trackers', value: String(details.trackers.length), inline: true },
        );

        await button.editReply({ embeds: [embed] });
      } catch (err) {
        await button.editReply(
          err instanceof TorrentError ? err.message : 'Could not build a magnet for that item.',
        );
      }
      return;
    }

    switch (button.customId) {
      case 'pager_first':
        index = 0;
        break;
      case 'pager_prev':
        index = Math.max(0, index - 1);
        break;
      case 'pager_next':
        index = Math.min(results.length - 1, index + 1);
        break;
      case 'pager_last':
        index = results.length - 1;
        break;
      default:
        return;
    }

    await button.update(payload());
  });

  collector.on('end', () => {
    void interaction.editReply({ components: [] }).catch(() => {});
  });
}

export const torrent = {
  data: { name: 'torrent' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    // Tolerant of a stale registration: until Discord has the subcommand form,
    // an old `/torrent query:` invocation arrives with no subcommand at all,
    // and a required getSubcommand() would throw rather than search.
    const subcommand = interaction.options.getSubcommand(false) ?? 'search';

    if (interaction.options.getSubcommandGroup(false) === 'watch') {
      await runWatch(interaction);
      return;
    }

    if (subcommand === 'scrape') {
      await runLeetxScrape(interaction);
      return;
    }

    // The Internet Archive is a different kind of thing — it distributes its
    // own material and needs its own flow — so it stays a separate branch
    // rather than joining the aggregated indexes.
    if (interaction.options.getString('source') === 'archive') {
      await runArchiveSearch(interaction);
      return;
    }

    await runLeetxSearch(interaction);
  },
};

export const magnet = {
  data: { name: 'magnet' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const input = interaction.options.getString('link', true);

    try {
      const parsed = parseMagnet(input);

      const embed = brandEmbed({
        author: { name: 'Magnet decoded' },
        title: parsed.name ?? 'Unnamed torrent',
        footer: 'Read from the link text alone; nothing was contacted',
      });

      embed.addFields(
        { name: 'Infohash', value: `\`${parsed.infoHash}\``, inline: false },
        {
          name: 'Declared size',
          value: parsed.sizeBytes ? formatBytes(parsed.sizeBytes) : 'not declared',
          inline: true,
        },
        { name: 'Trackers', value: String(parsed.trackers.length), inline: true },
        { name: 'Web seeds', value: String(parsed.webSeeds.length), inline: true },
      );

      if (parsed.trackers.length) {
        embed.addFields({
          name: 'Announce URLs',
          value: parsed.trackers
            .slice(0, 8)
            .map((t) => `- ${t}`)
            .join('\n')
            .slice(0, 1024),
          inline: false,
        });
      }

      // Ephemeral: whatever someone is decoding is their business.
      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      if (err instanceof TorrentError) {
        await interaction.reply({ content: err.message, ephemeral: true });
        return;
      }
      logger.error({ err }, 'Magnet decode failed');
      await interaction.reply({ content: 'Could not read that magnet link.', ephemeral: true });
    }
  },
};
