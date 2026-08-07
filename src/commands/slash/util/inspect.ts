import type { Client, ChatInputCommandInteraction } from 'discord.js';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  SectionBuilder,
  StringSelectMenuBuilder,
  type Message,
} from 'discord.js';
import { Jimp } from 'jimp';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import {
  card,
  paragraph,
  divider,
  gap,
  caption,
  facts,
  gallery,
  withThumbnail,
  v2,
  v2Update,
  type Block,
} from '../../../utils/layout.js';
import { inspectSite, InspectError, type SiteReport } from '../../../services/siteInspect.js';
import { logger } from '../../../services/logger.js';

const MENU_ID = 'inspect_page';
const MENU_TIMEOUT_MS = 5 * 60 * 1000;
const GALLERY_SIZE = 10;

type Page = 'overview' | 'colors' | 'fonts' | 'images' | 'tech';

/** Shared with /screenshot: the browser sits on the compose network. */
function validateUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, reason: 'That is not a valid URL.' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https URLs are supported.' };
  }

  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    !host.includes('.') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (blocked) return { ok: false, reason: 'That address is not publicly routable.' };
  return { ok: true, url };
}

function hexToInt(hex: string): number | null {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  return m ? parseInt(m[1]!, 16) : null;
}

/**
 * Picks a favicon Discord will render. Sites list .ico first and embeds cannot
 * display .ico or .svg, so prefer a raster icon and fall back to Google's
 * favicon service, which always returns a PNG.
 */
function icon(report: SiteReport): string {
  const raster = report.favicons.find((f) => /\.(png|jpe?g|webp)(\?|$)/i.test(f));
  if (raster) return raster;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(report.finalUrl).hostname)}&sz=128`;
}

function accent(report: SiteReport): number {
  return (
    (report.themeColor ? hexToInt(report.themeColor) : null) ??
    hexToInt(report.colors[0]?.hex ?? '') ??
    ZENITSU_THEME.PRIMARY
  );
}

/** Palette rendered as a strip of swatches. */
async function paletteImage(report: SiteReport): Promise<Buffer | null> {
  const colors = report.colors.slice(0, 10);
  if (colors.length === 0) return null;

  const swatch = 120;
  const image = new Jimp({ width: swatch * colors.length, height: swatch, color: 0xffffffff });

  colors.forEach((color, index) => {
    const value = hexToInt(color.hex);
    if (value === null) return;
    const rgba = (((value << 8) >>> 0) | 0xff) >>> 0;
    for (let x = 0; x < swatch; x++) {
      for (let y = 0; y < swatch; y++) image.setPixelColor(rgba, index * swatch + x, y);
    }
  });

  return image.getBuffer('image/png');
}

function header(report: SiteReport): string {
  return `## ${report.title.slice(0, 200)}\n[${new URL(report.finalUrl).hostname}](${report.finalUrl})`;
}

function overview(report: SiteReport): Block[] {
  const container = card(accent(report));

  // Title, link and favicon on one line: the layout an embed cannot express.
  // Falls back to plain text when the site has no renderable icon.
  const heading = withThumbnail(
    [header(report), report.description?.slice(0, 300) ?? ''].filter(Boolean).join('\n\n'),
    icon(report),
  );
  if (heading instanceof SectionBuilder) container.addSectionComponents(heading);
  else container.addTextDisplayComponents(heading);

  container.addSeparatorComponents(divider());

  container.addTextDisplayComponents(
    paragraph(
      facts([
        ['Theme', report.themeColor ?? report.colors[0]?.hex ?? 'none'],
        ['Server', report.headers['server'] ?? report.headers['x-powered-by'] ?? 'not disclosed'],
        ['Images', String(report.stats.images)],
        ['Scripts', String(report.stats.scripts)],
        ['Stylesheets', String(report.stats.stylesheets)],
        ['DOM nodes', report.stats.domNodes.toLocaleString()],
      ]),
    ),
  );

  if (report.tech.length) {
    container.addTextDisplayComponents(
      paragraph(`**Stack**\n${report.tech.map((t) => t.name).join(' · ')}`),
    );
  }

  return [container];
}

function colors(report: SiteReport, hasPalette: boolean): Block[] {
  const container = card(accent(report)).addTextDisplayComponents(
    paragraph(`## Colours\n${report.colors.length} found on ${new URL(report.finalUrl).hostname}`),
  );

  if (report.colors.length === 0) {
    container.addTextDisplayComponents(paragraph('Nothing could be read from this page.'));
    return [container];
  }

  if (hasPalette) {
    const strip = gallery(['attachment://palette.png']);
    if (strip) container.addMediaGalleryComponents(strip);
  }

  const declared = report.colors.filter((c) => c.variable);
  const computed = report.colors.filter((c) => !c.variable);

  if (declared.length) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(
      paragraph(
        `**Declared palette**\n${facts(declared.slice(0, 12).map((c) => [c.hex, c.variable!]))}`,
      ),
    );
  }

  if (computed.length) {
    container.addTextDisplayComponents(
      paragraph(
        `**Most used**\n\`${computed
          .slice(0, 12)
          .map((c) => c.hex)
          .join('  ')}\``,
      ),
    );
  }

  container.addTextDisplayComponents(
    caption('Declared colours come from CSS variables; the rest are measured from the page.'),
  );

  return [container];
}

function fonts(report: SiteReport): Block[] {
  const container = card(accent(report)).addTextDisplayComponents(paragraph('## Fonts'));

  if (report.fonts.length === 0) {
    container.addTextDisplayComponents(paragraph('Nothing could be read from this page.'));
    return [container];
  }

  container.addTextDisplayComponents(
    paragraph(
      facts(
        report.fonts.map((f) => [
          f.family,
          `${f.usage} elements${f.weights.length ? `, weights ${f.weights.join('/')}` : ''}`,
        ]),
      ),
    ),
  );

  if (report.fontSources.length) {
    const hosts = [
      ...new Set(
        report.fontSources.map((s) => {
          try {
            return new URL(s).hostname;
          } catch {
            return s;
          }
        }),
      ),
    ];
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(paragraph(`**Served from**\n${hosts.join(' · ')}`));
  }

  return [container];
}

/**
 * A grid of images rather than one at a time.
 *
 * Looking at a site's assets means comparing them, which paging through single
 * cards makes impossible. Ten per page is Discord's gallery maximum.
 */
function images(report: SiteReport, page: number): Block[] {
  const total = report.images.length;
  const container = card(accent(report));

  if (total === 0) {
    return [container.addTextDisplayComponents(paragraph('## Images\nNone found on this page.'))];
  }

  const pages = Math.ceil(total / GALLERY_SIZE);
  const clamped = Math.min(Math.max(page, 0), pages - 1);
  const slice = report.images.slice(clamped * GALLERY_SIZE, (clamped + 1) * GALLERY_SIZE);

  container.addTextDisplayComponents(
    paragraph(
      `## Images\n${total} found · showing ${clamped * GALLERY_SIZE + 1}-${clamped * GALLERY_SIZE + slice.length}`,
    ),
  );

  const grid = gallery(slice.map((i) => i.url));
  if (grid) container.addMediaGalleryComponents(grid);

  const named = slice
    .map((img, i) => {
      const name = decodeURIComponent(img.url.split('/').pop() ?? '')
        .split('?')[0]!
        .slice(0, 40);
      const dims = img.width && img.height ? `${img.width}x${img.height}` : img.kind;
      return `\`${String(clamped * GALLERY_SIZE + i + 1).padStart(2)}.\` [${name || 'image'}](${img.url}) · ${dims}`;
    })
    .join('\n');

  container.addSeparatorComponents(gap());
  container.addTextDisplayComponents(paragraph(named));

  return [container];
}

function tech(report: SiteReport): Block[] {
  const container = card(accent(report)).addTextDisplayComponents(paragraph('## Tech stack'));

  if (report.tech.length === 0) {
    container.addTextDisplayComponents(
      paragraph('Nothing recognised. The site may be hand-rolled or heavily obfuscated.'),
    );
  } else {
    const byCategory = new Map<string, string[]>();
    for (const t of report.tech) {
      if (!byCategory.has(t.category)) byCategory.set(t.category, []);
      byCategory.get(t.category)!.push(t.name);
    }
    container.addTextDisplayComponents(
      paragraph(facts([...byCategory].map(([category, names]) => [category, names.join(', ')]))),
    );
  }

  const interesting = [
    'server',
    'x-powered-by',
    'content-security-policy',
    'strict-transport-security',
  ];
  const shown = interesting
    .filter((h) => report.headers[h])
    .map((h): [string, string] => [h, report.headers[h]!.slice(0, 60)]);

  if (shown.length) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(paragraph(`**Headers**\n${facts(shown)}`));
  }

  container.addTextDisplayComponents(caption('Signature based; absence is not proof.'));
  return [container];
}

function pageMenu(selected: Page, report: SiteReport): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(MENU_ID).addOptions([
      { label: 'Overview', value: 'overview', default: selected === 'overview' },
      {
        label: 'Colours',
        value: 'colors',
        description: `${report.colors.length} found`,
        default: selected === 'colors',
      },
      {
        label: 'Fonts',
        value: 'fonts',
        description: `${report.fonts.length} in use`,
        default: selected === 'fonts',
      },
      {
        label: 'Images',
        value: 'images',
        description: `${report.images.length} found`,
        default: selected === 'images',
      },
      {
        label: 'Tech stack',
        value: 'tech',
        description: `${report.tech.length} detected`,
        default: selected === 'tech',
      },
    ]),
  );
}

function galleryPager(page: number, total: number): ActionRowBuilder<ButtonBuilder> | null {
  const pages = Math.ceil(total / GALLERY_SIZE);
  if (pages <= 1) return null;

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('inspect_img_prev')
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId('inspect_img_next')
      .setLabel(`Next (${page + 1}/${pages})`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pages - 1),
  );
}

export const inspect = {
  data: { name: 'inspect' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const check = validateUrl(interaction.options.getString('url', true).trim());
    if (!check.ok) {
      await interaction.reply({ content: check.reason, ephemeral: true });
      return;
    }

    await interaction.deferReply();

    let report: SiteReport;
    try {
      report = await inspectSite(check.url);
    } catch (err) {
      if (err instanceof InspectError) {
        await interaction.editReply(err.message);
        return;
      }
      logger.error({ err }, 'Inspect failed');
      await interaction.editReply('Inspection failed.').catch(() => {});
      return;
    }

    const palette = await paletteImage(report).catch(() => null);
    let imagePage = 0;

    const render = (page: Page) => {
      const blocks: Block[] = (() => {
        switch (page) {
          case 'colors':
            return colors(report, Boolean(palette));
          case 'fonts':
            return fonts(report);
          case 'images':
            return images(report, imagePage);
          case 'tech':
            return tech(report);
          default:
            return overview(report);
        }
      })();

      if (page === 'images') {
        const pager = galleryPager(imagePage, report.images.length);
        if (pager) blocks.push(pager);
      }

      blocks.push(pageMenu(page, report));

      return {
        ...v2Update(blocks),
        files:
          page === 'colors' && palette
            ? [new AttachmentBuilder(palette, { name: 'palette.png' })]
            : [],
      };
    };

    const message = (await interaction.editReply(render('overview'))) as Message;

    const collector = message.createMessageComponentCollector({ time: MENU_TIMEOUT_MS });

    collector.on('collect', async (component) => {
      if (component.user.id !== interaction.user.id) {
        await component.reply({ content: 'Run your own `/inspect`.', ephemeral: true });
        return;
      }

      if (component.isStringSelectMenu()) {
        const page = component.values[0] as Page;
        if (page === 'images') imagePage = 0;
        await component.update(render(page));
        return;
      }

      if (component.isButton()) {
        const pages = Math.ceil(report.images.length / GALLERY_SIZE);
        if (component.customId === 'inspect_img_prev') imagePage = Math.max(0, imagePage - 1);
        else if (component.customId === 'inspect_img_next')
          imagePage = Math.min(pages - 1, imagePage + 1);
        else return;

        await component.update(render('images'));
      }
    });

    collector.on('end', () => {
      void interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
