import type { Client, ChatInputCommandInteraction } from 'discord.js';
import {
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { Jimp } from 'jimp';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { inspectSite, InspectError, type SiteReport } from '../../../services/siteInspect.js';
import { logger } from '../../../services/logger.js';

const MENU_ID = 'inspect_page';
const MENU_TIMEOUT_MS = 5 * 60 * 1000;

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
 * Picks a favicon Discord will actually render.
 *
 * Embeds do not display .ico or .svg, which is what most sites list first, so
 * a raster icon is preferred and Google's favicon service is the fallback —
 * it always returns a PNG for any domain.
 */
function displayableIcon(report: SiteReport): string {
  const raster = report.favicons.find((f) => /\.(png|jpe?g|webp)(\?|$)/i.test(f));
  if (raster) return raster;

  const host = new URL(report.finalUrl).hostname;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
}

/** Renders the palette as a strip of labelled swatches. */
async function paletteImage(report: SiteReport): Promise<Buffer | null> {
  const colors = report.colors.slice(0, 10);
  if (colors.length === 0) return null;

  const swatch = 120;
  const image = new Jimp({ width: swatch * colors.length, height: swatch, color: 0xffffffff });

  colors.forEach((color, index) => {
    const value = hexToInt(color.hex);
    if (value === null) return;
    // Jimp wants RGBA; shift the RGB up and pin alpha opaque.
    const rgba = ((value << 8) >>> 0) | 0xff;
    for (let x = 0; x < swatch; x++) {
      for (let y = 0; y < swatch; y++) {
        image.setPixelColor(rgba, index * swatch + x, y);
      }
    }
  });

  return image.getBuffer('image/png');
}

function overviewEmbed(report: SiteReport): EmbedBuilder {
  const themeInt = report.themeColor ? hexToInt(report.themeColor) : null;
  const brandInt = report.colors.length ? hexToInt(report.colors[0]!.hex) : null;

  const embed = new EmbedBuilder()
    .setColor(themeInt ?? brandInt ?? ZENITSU_THEME.PRIMARY)
    .setTitle(report.title.slice(0, 250))
    .setURL(report.finalUrl)
    .setFooter({ text: 'Pick a section below for colours, fonts, images or tech' });

  if (report.description) embed.setDescription(report.description.slice(0, 500));

  // Favicon front and centre, and repeated on the author line so it reads as
  // the site's own identity rather than a generic embed.
  const icon = displayableIcon(report);
  embed.setThumbnail(icon);
  embed.setAuthor({ name: new URL(report.finalUrl).hostname, iconURL: icon, url: report.finalUrl });

  const server = report.headers['server'];
  const poweredBy = report.headers['x-powered-by'];
  const topTech = report.tech.slice(0, 6).map((t) => t.name);

  embed.addFields(
    { name: 'Host', value: new URL(report.finalUrl).hostname, inline: true },
    {
      name: 'Theme colour',
      value: report.themeColor ?? report.colors[0]?.hex ?? 'none',
      inline: true,
    },
    { name: 'Server', value: server ?? poweredBy ?? 'not disclosed', inline: true },
    {
      name: 'Stack',
      value: topTech.length ? topTech.join(', ') : 'nothing recognised',
      inline: false,
    },
    {
      name: 'Page',
      value:
        `${report.stats.images} images · ${report.stats.scripts} scripts · ` +
        `${report.stats.stylesheets} stylesheets · ${report.stats.domNodes.toLocaleString()} nodes`,
      inline: false,
    },
  );

  if (report.favicons.length) {
    embed.addFields({
      name: `Icons (${report.favicons.length})`,
      value: report.favicons
        .slice(0, 4)
        .map((f, i) => `[icon ${i + 1}](${f})`)
        .join(' · ')
        .slice(0, 1024),
      inline: false,
    });
  }

  return embed;
}

function siteAuthor(report: SiteReport) {
  return {
    name: new URL(report.finalUrl).hostname,
    iconURL: displayableIcon(report),
    url: report.finalUrl,
  };
}

function colorsEmbed(report: SiteReport): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(hexToInt(report.colors[0]?.hex ?? '') ?? ZENITSU_THEME.PRIMARY)
    .setAuthor(siteAuthor(report))
    .setTitle('Colours')
    .setFooter({ text: 'Variables come from CSS custom properties; the rest are computed styles' });

  if (report.colors.length === 0) {
    embed.setDescription('No colours could be read from this page.');
    return embed;
  }

  const declared = report.colors.filter((c) => c.variable);
  const computed = report.colors.filter((c) => !c.variable);

  if (declared.length) {
    embed.addFields({
      name: `Declared palette (${declared.length})`,
      value: declared
        .slice(0, 12)
        .map((c) => `\`${c.hex}\`  ${c.variable}`)
        .join('\n')
        .slice(0, 1024),
      inline: false,
    });
  }

  if (computed.length) {
    embed.addFields({
      name: `Most used on screen (${computed.length})`,
      value: computed
        .slice(0, 12)
        .map((c) => `\`${c.hex}\``)
        .join('  ')
        .slice(0, 1024),
      inline: false,
    });
  }

  embed.setImage('attachment://palette.png');
  return embed;
}

function fontsEmbed(report: SiteReport): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(hexToInt(report.colors[0]?.hex ?? '') ?? ZENITSU_THEME.PRIMARY)
    .setAuthor(siteAuthor(report))
    .setTitle('Fonts');

  if (report.fonts.length === 0) {
    embed.setDescription('No fonts could be read from this page.');
    return embed;
  }

  embed.addFields({
    name: 'In use',
    value: report.fonts
      .map((f) => {
        const weights = f.weights.length ? ` · weights ${f.weights.join(', ')}` : '';
        return `**${f.family}**\n${f.usage} elements${weights}`;
      })
      .join('\n\n')
      .slice(0, 1024),
    inline: false,
  });

  if (report.fontSources.length) {
    embed.addFields({
      name: 'Loaded from',
      value: report.fontSources
        .slice(0, 6)
        .map((s) => {
          try {
            return `[${new URL(s).hostname}](${s})`;
          } catch {
            return s;
          }
        })
        .join('\n')
        .slice(0, 1024),
      inline: false,
    });
  }

  return embed;
}

/**
 * One image per page, shown full size.
 *
 * A list of links is not much use for looking at assets, which is the whole
 * point of this section, so each image gets the embed to itself and the
 * buttons step through them.
 */
function imagesEmbed(report: SiteReport, index: number): EmbedBuilder {
  const total = report.images.length;

  const embed = new EmbedBuilder()
    .setColor(hexToInt(report.colors[0]?.hex ?? '') ?? ZENITSU_THEME.PRIMARY)
    .setAuthor(siteAuthor(report));

  if (total === 0) {
    return embed.setTitle('Images').setDescription('No images found on this page.');
  }

  const clamped = Math.min(Math.max(index, 0), total - 1);
  const image = report.images[clamped]!;
  const name = decodeURIComponent(image.url.split('/').pop() ?? '')
    .split('?')[0]!
    .slice(0, 60);

  const facts = [
    image.width && image.height ? `${image.width} x ${image.height}` : null,
    image.kind,
    (image.url.match(/\.(png|jpe?g|webp|gif|svg|avif)(\?|$)/i)?.[1] ?? '').toUpperCase() || null,
  ].filter(Boolean);

  embed
    .setTitle(`Image ${clamped + 1} of ${total}`)
    .setURL(image.url)
    .setDescription(`**${name || 'untitled'}**\n${facts.join('  ·  ')}`)
    .setImage(image.url)
    .setFooter({ text: image.alt ? `alt: ${image.alt.slice(0, 200)}` : 'no alt text' });

  return embed;
}

function imageButtons(index: number, total: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('inspect_img_first')
      .setLabel('First')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index <= 0),
    new ButtonBuilder()
      .setCustomId('inspect_img_prev')
      .setLabel('Previous')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(index <= 0),
    new ButtonBuilder()
      .setCustomId('inspect_img_next')
      .setLabel('Next')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(index >= total - 1),
    new ButtonBuilder()
      .setCustomId('inspect_img_last')
      .setLabel('Last')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index >= total - 1),
  );
}

function techEmbed(report: SiteReport): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(hexToInt(report.colors[0]?.hex ?? '') ?? ZENITSU_THEME.PRIMARY)
    .setAuthor(siteAuthor(report))
    .setTitle('Tech stack')
    .setFooter({ text: 'Signature based; absence is not proof a technology is unused' });

  if (report.tech.length === 0) {
    embed.setDescription('Nothing recognised. The site may be hand-rolled or heavily obfuscated.');
  } else {
    const byCategory = new Map<string, string[]>();
    for (const t of report.tech) {
      if (!byCategory.has(t.category)) byCategory.set(t.category, []);
      byCategory.get(t.category)!.push(t.name);
    }

    for (const [category, names] of byCategory) {
      embed.addFields({ name: category, value: names.join(', ').slice(0, 1024), inline: true });
    }
  }

  const interesting = [
    'server',
    'x-powered-by',
    'content-type',
    'strict-transport-security',
    'content-security-policy',
  ];
  const shown = interesting
    .filter((h) => report.headers[h])
    .map((h) => `\`${h}\`: ${report.headers[h]!.slice(0, 80)}`);

  if (shown.length) {
    embed.addFields({ name: 'Headers', value: shown.join('\n').slice(0, 1024), inline: false });
  }

  return embed;
}

function pageMenu(selected: Page, report: SiteReport): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder().setCustomId(MENU_ID).addOptions([
    {
      label: 'Overview',
      value: 'overview',
      description: 'Identity, icons and stack',
      default: selected === 'overview',
    },
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
  ]);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
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
      logger.error({ err }, 'Inspect command failed');
      await interaction.editReply('Inspection failed.').catch(() => {});
      return;
    }

    const palette = await paletteImage(report).catch(() => null);
    let imagePage = 0;

    const render = (page: Page) => {
      switch (page) {
        case 'colors': {
          const files = palette ? [new AttachmentBuilder(palette, { name: 'palette.png' })] : [];
          const embed = colorsEmbed(report);
          if (!palette) embed.setImage(null);
          return { embeds: [embed], files, components: [pageMenu(page, report)] };
        }
        case 'fonts':
          return { embeds: [fontsEmbed(report)], files: [], components: [pageMenu(page, report)] };
        case 'images':
          return {
            embeds: [imagesEmbed(report, imagePage)],
            files: [],
            // Pager sits above the section menu so stepping through images is
            // the obvious action once you are on this page.
            components: report.images.length
              ? [imageButtons(imagePage, report.images.length), pageMenu(page, report)]
              : [pageMenu(page, report)],
          };
        case 'tech':
          return { embeds: [techEmbed(report)], files: [], components: [pageMenu(page, report)] };
        default:
          return {
            embeds: [overviewEmbed(report)],
            files: [],
            components: [pageMenu('overview', report)],
          };
      }
    };

    const message = await interaction.editReply(render('overview'));

    // No componentType filter: this collects both the section menu and the
    // image pager buttons.
    const collector = message.createMessageComponentCollector({ time: MENU_TIMEOUT_MS });

    collector.on('collect', async (component) => {
      if (component.user.id !== interaction.user.id) {
        await component.reply({
          content: 'Run your own `/inspect` to browse this.',
          ephemeral: true,
        });
        return;
      }

      if (component.isStringSelectMenu()) {
        const page = component.values[0] as Page;
        // Start from the top each time the images page is opened.
        if (page === 'images') imagePage = 0;
        await component.update(render(page));
        return;
      }

      if (component.isButton()) {
        const last = report.images.length - 1;

        switch (component.customId) {
          case 'inspect_img_first':
            imagePage = 0;
            break;
          case 'inspect_img_prev':
            imagePage = Math.max(0, imagePage - 1);
            break;
          case 'inspect_img_next':
            imagePage = Math.min(last, imagePage + 1);
            break;
          case 'inspect_img_last':
            imagePage = last;
            break;
          default:
            return;
        }

        await component.update(render('images'));
      }
    });

    collector.on('end', () => {
      void interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
