import type { Client, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SectionBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { createHash } from 'node:crypto';
import {
  card,
  paragraph,
  divider,
  gap,
  caption,
  facts,
  bar,
  clock,
  withThumbnail,
  v2Update,
  type Block,
} from '../../../utils/layout.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { UserError } from '../../../utils/errors.js';
import { shoukaku } from '../../../music/lavalink.js';
import { getPrisma } from '../../../services/db.js';
import { fetchAttachment } from '../../../utils/attachment.js';
import { parseEpub, type Book } from '../../../services/epub.js';
import {
  NARRATION_STYLES,
  NARRATOR_VOICES,
  geminiAvailable,
  styleById,
  voiceById,
  type NarrationStyle,
} from '../../../services/narration.js';
import {
  AudiobookPlayer,
  activePlayer,
  clearPlayer,
  registerPlayer,
  type TimedSentence,
} from '../../../services/audiobookPlayer.js';
import {
  attachState,
  componentId,
  registerComponentHandler,
  type ComponentHandler,
} from '../../../listeners/componentRouter.js';

const KIND = 'ab';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EPUB_BYTES = 60 * 1024 * 1024;

/** Sentences shown around the one being spoken. */
const TRANSCRIPT_BEFORE = 2;
const TRANSCRIPT_AFTER = 4;

/**
 * Minimum gap between transcript edits.
 *
 * Discord's measured bucket is five edits per five seconds per message, so one
 * a second is the sustained ceiling. Sentences arrive roughly every seven
 * seconds at narration pace, which is comfortably under — but a short sentence
 * or a burst after a seek could cluster, so edits are spaced regardless.
 */
const TRANSCRIPT_MIN_GAP_MS = 1500;
/** The player card changes less and can update less often. */
const CARD_MIN_GAP_MS = 3000;

type View = 'player' | 'chapters' | 'bookmarks' | 'voice' | 'speed';

interface AbState {
  guildId: string;
  bookId: string;
  view: View;
  /** Page of the chapter list, which can run to hundreds. */
  page: number;
}

// ---------------------------------------------------------------- rendering

function progressLine(current: number, total: number, width = 22): string {
  const fraction = total > 0 ? current / total : 0;
  return `\`${bar(fraction, width)}\`  ${clock(current)} / ${clock(total)}`;
}

function playerCard(player: AudiobookPlayer, note?: string): Block[] {
  const { book } = player;
  const chapter = player.chapter;
  const { ms } = player.position;
  const settings = player.options;

  const chapterMs = chapter.estimatedSeconds * 1000;
  const chaptersDone = chapter.index;
  const bookFraction = book.chapters.length > 1 ? chaptersDone / book.chapters.length : 0;

  const container = card(player.isPaused ? ZENITSU_THEME.PRIMARY : ZENITSU_THEME.SUCCESS);

  const heading = withThumbnail(
    `## ${book.title}\n${book.author ? `by ${book.author}` : 'Unknown author'}`,
    // Cover travels as an attachment with the same message.
    book.cover ? 'attachment://cover.png' : undefined,
  );
  if (heading instanceof SectionBuilder) container.addSectionComponents(heading);
  else container.addTextDisplayComponents(heading);

  container.addSeparatorComponents(divider());

  container.addTextDisplayComponents(
    paragraph(
      `**${chapter.title}**\n-# Chapter ${chapter.index + 1} of ${book.chapters.length}\n\n` +
        `${progressLine(ms, chapterMs)}`,
    ),
  );

  container.addSeparatorComponents(gap());

  container.addTextDisplayComponents(
    paragraph(
      facts([
        ['Book', `\`${bar(bookFraction, 14)}\` ${Math.round(bookFraction * 100)}%`],
        ['Voice', `${voiceById(settings.voice).label} · ${styleById(settings.style).label}`],
        ['Speed', `${settings.speed}x`],
        ['Volume', `${Math.round(settings.volume * 100)}%`],
        ['Narrated by', player.currentEngine === 'gemini' ? 'Gemini' : 'local voice'],
      ]),
    ),
  );

  if (note) container.addTextDisplayComponents(caption(note));

  return [container, ...playerControls(player)];
}

/**
 * The transport.
 *
 * Laid out the way a player is expected to be — chapter, scrub, play, scrub,
 * chapter — because muscle memory from every other player is worth more than
 * any ordering that might be more logical in the abstract.
 */
function playerControls(player: AudiobookPlayer): Block[] {
  const transport = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'prevch'))
      .setLabel('Prev ch')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(player.chapter.index === 0),
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'back15'))
      .setLabel('-15s')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'toggle'))
      .setLabel(player.isPaused ? 'Play' : 'Pause')
      .setStyle(player.isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'fwd30'))
      .setLabel('+30s')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'nextch'))
      .setLabel('Next ch')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(player.chapter.index >= player.book.chapters.length - 1),
  );

  const secondary = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'view', 'chapters'))
      .setLabel('Chapters')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'view', 'voice'))
      .setLabel('Voice')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'view', 'speed'))
      .setLabel('Speed')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'bookmark'))
      .setLabel('Bookmark')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'stop'))
      .setLabel('Stop')
      .setStyle(ButtonStyle.Danger),
  );

  // Discord has no draggable slider, so scrubbing is a menu of positions —
  // twenty-five points across the chapter, which is finer than most people
  // drag anyway.
  const scrub = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(componentId(KIND, 'scrub'))
      .setPlaceholder('Jump within this chapter…')
      .addOptions(
        Array.from({ length: 21 }, (_, i) => {
          const percent = i * 5;
          const at = (player.chapter.estimatedSeconds * 1000 * percent) / 100;
          return {
            label: `${percent}%`,
            description: clock(at),
            value: String(percent),
          };
        }),
      ),
  );

  return [transport, secondary, scrub];
}

function chaptersView(player: AudiobookPlayer, page: number): Block[] {
  const { book } = player;
  const perPage = 20;
  const pages = Math.max(1, Math.ceil(book.chapters.length / perPage));
  const clamped = Math.min(Math.max(page, 0), pages - 1);
  const slice = book.chapters.slice(clamped * perPage, (clamped + 1) * perPage);

  const container = card().addTextDisplayComponents(
    paragraph(`## Chapters\n${book.chapters.length} in ${book.title}`),
  );

  container.addSeparatorComponents(divider());

  container.addTextDisplayComponents(
    paragraph(
      slice
        .map((chapter) => {
          const here = chapter.index === player.chapter.index;
          const progress = here
            ? ` · ${Math.round((player.position.ms / (chapter.estimatedSeconds * 1000 || 1)) * 100)}%`
            : '';
          const line = `\`${String(chapter.index + 1).padStart(3)}\` ${chapter.title.slice(0, 60)} · ${clock(chapter.estimatedSeconds * 1000)}${progress}`;
          // The chapter you are in is bolded and marked, so the list answers
          // "where am I" without counting.
          return here ? `**${line}**  ◀ here` : line;
        })
        .join('\n'),
    ),
  );

  const jump = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(componentId(KIND, 'chapter'))
      .setPlaceholder('Jump to a chapter…')
      .addOptions(
        slice.slice(0, 25).map((chapter) => ({
          label: `${chapter.index + 1}. ${chapter.title}`.slice(0, 100),
          description:
            `${clock(chapter.estimatedSeconds * 1000)} · ${chapter.sentences.length} sentences`.slice(
              0,
              100,
            ),
          value: String(chapter.index),
          default: chapter.index === player.chapter.index,
        })),
      ),
  );

  const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'page', Math.max(0, clamped - 1)))
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clamped <= 0),
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'page', Math.min(pages - 1, clamped + 1)))
      .setLabel(`Next (${clamped + 1}/${pages})`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clamped >= pages - 1),
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'view', 'player'))
      .setLabel('Back to player')
      .setStyle(ButtonStyle.Primary),
  );

  return [container, jump, nav];
}

function voiceView(player: AudiobookPlayer): Block[] {
  const settings = player.options;

  const container = card().addTextDisplayComponents(
    paragraph(`## Narrator\nChanging either one restarts the current paragraph in the new voice.`),
  );

  container.addSeparatorComponents(divider());
  container.addTextDisplayComponents(
    paragraph(
      facts([
        ['Voice', `${voiceById(settings.voice).label} — ${voiceById(settings.voice).blurb}`],
        ['Style', `${styleById(settings.style).label} — ${styleById(settings.style).blurb}`],
      ]),
    ),
  );

  if (!geminiAvailable()) {
    container.addTextDisplayComponents(
      caption(
        'Gemini narration is unavailable right now, so the local voice is being used. Voice and style will apply again when it returns.',
      ),
    );
  }

  const voices = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(componentId(KIND, 'setvoice'))
      .setPlaceholder('Choose a narrator…')
      .addOptions(
        NARRATOR_VOICES.map((voice) => ({
          label: `${voice.label} · ${voice.gender}`,
          description: voice.blurb.slice(0, 100),
          value: voice.id,
          default: voice.id === settings.voice,
        })),
      ),
  );

  const styles = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(componentId(KIND, 'setstyle'))
      .setPlaceholder('Choose a narration style…')
      .addOptions(
        NARRATION_STYLES.map((style) => ({
          label: style.label,
          description: style.blurb,
          value: style.id,
          default: style.id === settings.style,
        })),
      ),
  );

  const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'preview'))
      .setLabel('Preview this voice')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'view', 'player'))
      .setLabel('Back to player')
      .setStyle(ButtonStyle.Primary),
  );

  return [container, voices, styles, nav];
}

function speedView(player: AudiobookPlayer): Block[] {
  const settings = player.options;

  const container = card()
    .addTextDisplayComponents(paragraph('## Speed and volume'))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      paragraph(
        `**Speed** ${settings.speed}x\n` +
          `**Volume** \`${bar(settings.volume, 14)}\` ${Math.round(settings.volume * 100)}%`,
      ),
    );

  const speeds = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...[0.75, 1, 1.25, 1.5, 2].map((speed) =>
      new ButtonBuilder()
        .setCustomId(componentId(KIND, 'speed', String(speed)))
        .setLabel(`${speed}x`)
        .setStyle(settings.speed === speed ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
  );

  const volumes = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...[25, 50, 75, 100, 150].map((percent) =>
      new ButtonBuilder()
        .setCustomId(componentId(KIND, 'volume', String(percent)))
        .setLabel(`${percent}%`)
        .setStyle(
          Math.round(settings.volume * 100) === percent
            ? ButtonStyle.Primary
            : ButtonStyle.Secondary,
        ),
    ),
  );

  const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'view', 'player'))
      .setLabel('Back to player')
      .setStyle(ButtonStyle.Primary),
  );

  return [container, speeds, volumes, nav];
}

async function bookmarksView(player: AudiobookPlayer, userId: string): Promise<Block[]> {
  const marks = await getPrisma().audiobookBookmark.findMany({
    where: { bookId: player.bookId, userId },
    orderBy: [{ chapter: 'asc' }, { offset: 'asc' }],
    take: 25,
  });

  const container = card().addTextDisplayComponents(
    paragraph(
      marks.length
        ? `## Bookmarks\n${marks.length} in ${player.book.title}`
        : '## Bookmarks\nNone yet. Press **Bookmark** on the player to save where you are.',
    ),
  );

  if (marks.length) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(
      paragraph(
        marks
          .map((mark, index) => {
            const chapter = player.book.chapters[mark.chapter];
            const head = `\`${String(index + 1).padStart(2)}\` ${chapter?.title ?? `Chapter ${mark.chapter + 1}`} · ${clock(mark.offset * 1000)}`;
            const quote = mark.quote ? `\n-# "${mark.quote.slice(0, 140)}"` : '';
            const note = mark.note ? `\n-# ${mark.note.slice(0, 100)}` : '';
            return `${head}${quote}${note}`;
          })
          .join('\n\n'),
      ),
    );
  }

  const blocks: Block[] = [container];

  if (marks.length) {
    blocks.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(componentId(KIND, 'gomark'))
          .setPlaceholder('Jump to a bookmark…')
          .addOptions(
            marks.map((mark, index) => ({
              label:
                `${index + 1}. ${player.book.chapters[mark.chapter]?.title ?? 'Chapter'}`.slice(
                  0,
                  100,
                ),
              description: (mark.quote ?? clock(mark.offset * 1000)).slice(0, 100),
              value: mark.id,
            })),
          ),
      ),
    );
  }

  blocks.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(componentId(KIND, 'view', 'player'))
        .setLabel('Back to player')
        .setStyle(ButtonStyle.Primary),
    ),
  );

  return blocks;
}

/**
 * The live transcript.
 *
 * A window rather than the whole chapter: the point is to follow along, and a
 * wall of text with one bold line in it is harder to read than five lines with
 * one bold line in it.
 */
export function transcriptBlocks(
  player: AudiobookPlayer,
  current: TimedSentence | undefined,
): Block[] {
  const chapter = player.chapter;
  const sentences = chapter.sentences;

  const index = current ? sentences.findIndex((s) => s.offset === current.offset) : 0;
  const at = index >= 0 ? index : 0;

  const from = Math.max(0, at - TRANSCRIPT_BEFORE);
  const to = Math.min(sentences.length, at + TRANSCRIPT_AFTER + 1);

  const lines = sentences.slice(from, to).map((sentence, i) => {
    const actual = from + i;
    const text = sentence.text.slice(0, 300);
    if (actual === at) return `**${text}**`;
    // Read sentences are dimmed, upcoming ones plain, so the eye lands on the
    // bold line without having to search for it.
    return actual < at ? `-# ${text}` : text;
  });

  const container = card(ZENITSU_THEME.PRIMARY)
    .addTextDisplayComponents(paragraph(`### ${chapter.title}`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(paragraph(lines.join('\n\n') || 'Starting…'))
    .addTextDisplayComponents(
      caption(`Sentence ${at + 1} of ${sentences.length} · pick one below to jump there`),
    );

  // Twenty-five nearby sentences to jump to. Exact, because the timings come
  // from the generated audio rather than an estimate.
  const window = sentences.slice(Math.max(0, at - 5), Math.max(0, at - 5) + 25);

  const jump = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(componentId(KIND, 'gosentence'))
      .setPlaceholder('Jump to a sentence…')
      .addOptions(
        window.map((sentence) => ({
          label: sentence.text.slice(0, 100) || '…',
          value: String(sentence.offset),
        })),
      ),
  );

  return [container, jump];
}

// ------------------------------------------------------------------ routing

async function renderView(
  player: AudiobookPlayer,
  state: AbState,
  userId: string,
  note?: string,
): Promise<Block[]> {
  switch (state.view) {
    case 'chapters':
      return chaptersView(player, state.page);
    case 'voice':
      return voiceView(player);
    case 'speed':
      return speedView(player);
    case 'bookmarks':
      return bookmarksView(player, userId);
    default:
      return playerCard(player, note);
  }
}

const handler: ComponentHandler<AbState> = {
  kind: KIND,
  ttlMs: DAY_MS,
  expiredMessage: 'This player has expired. Run `/audiobook` again.',
  // Shared: a book playing in a voice channel belongs to the room, so anyone
  // listening can pause it or skip a chapter.
  shared: true,

  async handle({ interaction, action, args, rest, state, save }) {
    const player = activePlayer(state.guildId);
    if (!player) throw new UserError('Nothing is playing any more.');

    const userId = interaction.user.id;
    let note: string | undefined;
    let next = { ...state };

    switch (action) {
      case 'toggle':
        player.isPaused ? player.resume() : player.pause();
        break;

      case 'back15':
        await player.skip(-15);
        break;

      case 'fwd30':
        await player.skip(30);
        break;

      case 'prevch':
        await player.goToChapter(player.chapter.index - 1);
        break;

      case 'nextch':
        await player.goToChapter(player.chapter.index + 1);
        break;

      case 'view':
        next = { ...next, view: (args[0] as View) ?? 'player', page: 0 };
        break;

      case 'page':
        next = { ...next, page: Number(args[0] ?? 0) };
        break;

      case 'speed':
        await player.setSpeed(Number(args[0] ?? 1));
        note = `Speed is now ${args[0]}x.`;
        break;

      case 'volume':
        player.setVolume(Number(args[0] ?? 100) / 100);
        note = `Volume is now ${args[0]}%.`;
        break;

      case 'stop':
        await player.stop('you asked');
        clearPlayer(state.guildId);
        await interaction.update(
          v2Update([
            card(ZENITSU_THEME.ERROR).addTextDisplayComponents(
              paragraph(
                `## Stopped\n**${player.book.title}** — your place is saved. Run \`/audiobook resume\` to pick it up.`,
              ),
            ),
          ]),
        );
        return;

      case 'bookmark': {
        const sentence = player.currentSentence();
        await getPrisma().audiobookBookmark.create({
          data: {
            bookId: player.bookId,
            userId,
            chapter: player.chapter.index,
            offset: player.position.ms / 1000,
            quote: sentence?.text.slice(0, 300),
          },
        });
        note = 'Bookmarked here.';
        break;
      }

      case 'scrub': {
        if (!interaction.isStringSelectMenu()) break;
        const percent = Number(interaction.values[0] ?? 0);
        await player.seek(
          player.chapter.index,
          (player.chapter.estimatedSeconds * 1000 * percent) / 100,
        );
        break;
      }

      case 'chapter': {
        if (!interaction.isStringSelectMenu()) break;
        await player.goToChapter(Number(interaction.values[0] ?? 0));
        next = { ...next, view: 'player' };
        break;
      }

      case 'setvoice': {
        if (!interaction.isStringSelectMenu()) break;
        await player.setVoice(interaction.values[0]!, player.options.style);
        note = `Narrator is now ${voiceById(interaction.values[0]!).label}.`;
        break;
      }

      case 'setstyle': {
        if (!interaction.isStringSelectMenu()) break;
        await player.setVoice(player.options.voice, interaction.values[0] as NarrationStyle);
        note = `Style is now ${styleById(interaction.values[0]!).label}.`;
        break;
      }

      case 'gomark': {
        if (!interaction.isStringSelectMenu()) break;
        const mark = await getPrisma().audiobookBookmark.findUnique({
          where: { id: interaction.values[0]! },
        });
        if (mark) await player.seek(mark.chapter, mark.offset * 1000);
        next = { ...next, view: 'player' };
        break;
      }

      case 'gosentence': {
        if (!interaction.isStringSelectMenu()) break;
        // Sentence offsets are character positions; the player converts to
        // time using the same estimate the progress bar uses.
        const offset = Number(interaction.values[0] ?? 0);
        await player.seek(player.chapter.index, (offset / 14.5) * 1000);
        break;
      }

      default:
        break;
    }

    await interaction.update(v2Update(await renderView(player, next, userId, note)));
    await save(next);
  },
};

registerComponentHandler(handler);

// ------------------------------------------------------------------ command

export const audiobook = {
  data: { name: 'audiobook' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand(false) ?? 'play';
    const guildId = interaction.guildId;
    if (!guildId) throw new UserError('This only works in a server.');

    if (subcommand === 'library') return showLibrary(interaction);
    if (subcommand === 'stop') {
      const player = activePlayer(guildId);
      if (!player) throw new UserError('Nothing is playing.');
      await player.stop('you asked');
      clearPlayer(guildId);
      await interaction.reply({
        content: 'Stopped. Your place is saved.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = interaction.member as GuildMember | null;
    const channel = member?.voice.channel;
    if (!channel) throw new UserError('Join a voice channel first.');

    if (activePlayer(guildId)) {
      throw new UserError('A book is already playing here. Stop it first with `/audiobook stop`.');
    }
    if (shoukaku?.connections.get(guildId)) {
      throw new UserError(
        'Music is playing. Stop it with `/stop` first — they share one connection.',
      );
    }

    await interaction.deferReply();

    const { book, bookId } = await loadBook(interaction, subcommand);
    const saved = await getPrisma().audiobookPosition.findUnique({
      where: { bookId_userId: { bookId, userId: interaction.user.id } },
    });

    await startPlaying(interaction, channel, book, bookId, saved);
  },
};

/** Either the attached EPUB, or the last book this person was reading. */
async function loadBook(
  interaction: ChatInputCommandInteraction,
  subcommand: string,
): Promise<{ book: Book; bookId: string }> {
  const prisma = getPrisma();

  if (subcommand === 'resume') {
    const last = await prisma.audiobookPosition.findFirst({
      where: { userId: interaction.user.id, finished: false },
      orderBy: { updatedAt: 'desc' },
      include: { book: true },
    });

    if (!last)
      throw new UserError('You have not started a book yet. Attach an EPUB to `/audiobook play`.');
    return { book: JSON.parse(last.book.content) as Book, bookId: last.bookId };
  }

  const attachment = interaction.options.getAttachment('file');
  if (!attachment) {
    throw new UserError(
      'Attach an EPUB file, or use `/audiobook resume` to continue your last one.',
    );
  }

  if (!/\.epub$/i.test(attachment.name)) {
    throw new UserError('That is not an EPUB. Only .epub files can be read.');
  }

  const source = await fetchAttachment(attachment, MAX_EPUB_BYTES);

  // Same file uploaded twice is the same book, so a re-upload resumes rather
  // than starting over with a fresh position.
  const fileHash = createHash('sha256').update(source.data).digest('hex');
  const existing = await prisma.audiobook.findUnique({ where: { fileHash } });

  if (existing) {
    return { book: JSON.parse(existing.content) as Book, bookId: existing.id };
  }

  const book = await parseEpub(source.data, attachment.name);

  // The cover is dropped before storing: it is decoration, and a base64 image
  // in a SQLite text column is not.
  const stored: Book = { ...book, cover: undefined };

  const row = await prisma.audiobook.create({
    data: {
      fileHash,
      title: book.title,
      author: book.author,
      language: book.language,
      content: JSON.stringify(stored),
      chapters: book.chapters.length,
      seconds: book.estimatedSeconds,
      addedBy: interaction.user.id,
    },
  });

  return { book, bookId: row.id };
}

async function startPlaying(
  interaction: ChatInputCommandInteraction,
  channel: NonNullable<GuildMember['voice']['channel']>,
  book: Book,
  bookId: string,
  saved: { chapter: number; offset: number; voice: string; style: string; speed: number } | null,
): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  let transcriptMessage: import('discord.js').Message | undefined;
  let lastTranscriptAt = 0;
  let lastCardAt = 0;
  let currentSentence: TimedSentence | undefined;
  let note: string | undefined;

  const state: AbState = { guildId, bookId, view: 'player', page: 0 };

  const redrawCard = () => {
    if (Date.now() - lastCardAt < CARD_MIN_GAP_MS) return;
    lastCardAt = Date.now();

    const active = activePlayer(guildId);
    if (!active) return;

    void interaction.editReply(v2Update(playerCard(active, note))).catch(() => {});
  };

  const player = new AudiobookPlayer(
    channel,
    userId,
    bookId,
    book,
    {
      voice: saved?.voice ?? 'Kore',
      style: (saved?.style as NarrationStyle) ?? 'natural',
      speed: saved?.speed ?? 1,
      volume: 1,
    },
    {
      onSentence: (sentence) => {
        currentSentence = sentence;

        // Spaced regardless of how fast sentences arrive; Discord's bucket is
        // five edits per five seconds and a short sentence could outrun it.
        if (Date.now() - lastTranscriptAt < TRANSCRIPT_MIN_GAP_MS) return;
        lastTranscriptAt = Date.now();

        const active = activePlayer(guildId);
        if (!active || !transcriptMessage) return;

        void transcriptMessage
          .edit(v2Update(transcriptBlocks(active, currentSentence)))
          .catch(() => {});
      },
      onChapter: () => redrawCard(),
      onState: () => redrawCard(),
      onEngineChange: (engine) => {
        note =
          engine === 'kokoro'
            ? 'Gemini narration is unavailable right now, so this is the local voice. It will switch back on its own.'
            : undefined;
        redrawCard();
      },
      onFinished: () => {
        note = 'Finished. That was the last chapter.';
        redrawCard();
      },
      onError: (message) => {
        note = message;
        redrawCard();
      },
    },
  );

  try {
    await player.start(saved?.chapter ?? 0, (saved?.offset ?? 0) * 1000);
  } catch (err) {
    await player.stop('failed to start');
    throw new UserError(`Could not join ${channel.name}: ${(err as Error).message}`);
  }

  registerPlayer(player);

  const files = book.cover ? [new AttachmentBuilder(book.cover, { name: 'cover.png' })] : [];

  const message = await interaction.editReply({
    ...v2Update(playerCard(player, note)),
    files,
  });

  await attachState(message.id, handler, userId, state);

  // The transcript is its own message so the player card stays put while the
  // text moves — and so the two have separate edit budgets.
  if (interaction.channel?.isSendable()) {
    const sent = await interaction.channel
      .send(v2Update(transcriptBlocks(player, undefined)))
      .catch(() => undefined);

    if (sent) {
      transcriptMessage = sent;
      await attachState(sent.id, handler, userId, state);
    }
  }
}

async function showLibrary(interaction: ChatInputCommandInteraction): Promise<void> {
  const positions = await getPrisma().audiobookPosition.findMany({
    where: { userId: interaction.user.id },
    orderBy: { updatedAt: 'desc' },
    include: { book: true },
    take: 20,
  });

  const container = card().addTextDisplayComponents(
    paragraph(
      positions.length
        ? `## Your library\n${positions.length} book${positions.length === 1 ? '' : 's'}`
        : '## Your library\nEmpty. Attach an EPUB to `/audiobook play` to start one.',
    ),
  );

  if (positions.length) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(
      paragraph(
        positions
          .map((position) => {
            const percent = Math.round(
              (position.chapter / Math.max(1, position.book.chapters)) * 100,
            );
            const status = position.finished ? 'finished' : `${percent}%`;
            return `**${position.book.title}**\n-# ${position.book.author ?? 'Unknown'} · chapter ${position.chapter + 1} of ${position.book.chapters} · ${status}`;
          })
          .join('\n\n'),
      ),
    );
    container.addTextDisplayComponents(
      caption('`/audiobook resume` picks up the most recent one.'),
    );
  }

  await interaction.reply({
    ...v2Update([container]),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });
}
