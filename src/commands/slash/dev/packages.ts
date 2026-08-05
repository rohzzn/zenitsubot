import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { fetchJson, truncate, relativeTime } from '../../../utils/http.js';
import { logger } from '../../../services/logger.js';

const COLORS = { npm: 0xcb3837, pypi: 0x3775a9, crates: 0xe6b14c };

async function respond(
  interaction: ChatInputCommandInteraction,
  build: () => Promise<EmbedBuilder | string>,
  registry: string,
) {
  await interaction.deferReply();
  try {
    const result = await build();
    if (typeof result === 'string') {
      await interaction.editReply(result);
      return;
    }
    await interaction.editReply({ embeds: [result] });
  } catch (err) {
    logger.error({ err, registry }, 'Package lookup failed');
    await interaction
      .editReply(`Could not reach the ${registry} registry. Try again later.`)
      .catch(() => {});
  }
}

// ------------------------------------------------------------------- npm

interface NpmPackage {
  name: string;
  version: string;
  description?: string;
  license?: string;
  homepage?: string;
  dependencies?: Record<string, string>;
  dist?: { unpackedSize?: number; tarball?: string };
}

export const npm = {
  data: { name: 'npm' },
  category: 'dev',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const name = interaction.options.getString('package', true).trim();

    await respond(
      interaction,
      async () => {
        const pkg = await fetchJson<NpmPackage>(
          `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,
        );
        if (!pkg) return `No npm package named \`${name}\`.`;

        const downloads = await fetchJson<{ downloads?: number }>(
          `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`,
        ).catch(() => null);

        const deps = Object.keys(pkg.dependencies ?? {});

        const embed = new EmbedBuilder()
          .setColor(COLORS.npm)
          .setTitle(`${pkg.name}@${pkg.version}`)
          .setURL(`https://www.npmjs.com/package/${pkg.name}`)
          .setDescription(pkg.description ? truncate(pkg.description, 300) : 'No description.')
          .addFields(
            { name: 'License', value: pkg.license || 'Unknown', inline: true },
            {
              name: 'Weekly downloads',
              value: downloads?.downloads ? downloads.downloads.toLocaleString() : 'Unknown',
              inline: true,
            },
            { name: 'Dependencies', value: `${deps.length}`, inline: true },
          )
          .setFooter({ text: 'npm' });

        if (pkg.dist?.unpackedSize) {
          embed.addFields({
            name: 'Unpacked size',
            value: `${(pkg.dist.unpackedSize / 1024).toFixed(1)} KB`,
            inline: true,
          });
        }
        if (deps.length) {
          embed.addFields({
            name: 'Requires',
            value: truncate(deps.join(', '), 400),
            inline: false,
          });
        }
        if (pkg.homepage) embed.addFields({ name: 'Homepage', value: pkg.homepage, inline: false });

        return embed;
      },
      'npm',
    );
  },
};

// ------------------------------------------------------------------ PyPI

interface PypiPackage {
  info: {
    name: string;
    version: string;
    summary?: string;
    license?: string;
    home_page?: string;
    project_url?: string;
    requires_dist?: string[] | null;
    requires_python?: string;
  };
}

export const pypi = {
  data: { name: 'pypi' },
  category: 'dev',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const name = interaction.options.getString('package', true).trim();

    await respond(
      interaction,
      async () => {
        const pkg = await fetchJson<PypiPackage>(
          `https://pypi.org/pypi/${encodeURIComponent(name)}/json`,
        );
        if (!pkg) return `No PyPI package named \`${name}\`.`;

        const info = pkg.info;
        // requires_dist entries look like "certifi (>=2017.4.17)"; the bare name
        // is all that is useful at a glance.
        const deps = (info.requires_dist ?? [])
          .map((d) => d.split(/[\s(;<>=!]/)[0])
          .filter(Boolean);

        const embed = new EmbedBuilder()
          .setColor(COLORS.pypi)
          .setTitle(`${info.name} ${info.version}`)
          .setURL(info.project_url || `https://pypi.org/project/${info.name}/`)
          .setDescription(info.summary ? truncate(info.summary, 300) : 'No description.')
          .addFields(
            { name: 'License', value: truncate(info.license || 'Unknown', 60), inline: true },
            { name: 'Requires Python', value: info.requires_python || 'Any', inline: true },
            { name: 'Dependencies', value: `${deps.length}`, inline: true },
          )
          .setFooter({ text: 'PyPI' });

        if (deps.length) {
          embed.addFields({
            name: 'Requires',
            value: truncate([...new Set(deps)].join(', '), 400),
            inline: false,
          });
        }

        return embed;
      },
      'PyPI',
    );
  },
};

// ---------------------------------------------------------------- crates

interface CratesResponse {
  crate: {
    name: string;
    max_stable_version?: string;
    newest_version?: string;
    description?: string;
    downloads: number;
    recent_downloads?: number;
    homepage?: string;
    repository?: string;
    updated_at: string;
  };
}

export const crates = {
  data: { name: 'crates' },
  category: 'dev',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const name = interaction.options.getString('crate', true).trim();

    await respond(
      interaction,
      async () => {
        const data = await fetchJson<CratesResponse>(
          `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`,
        );
        if (!data) return `No crate named \`${name}\`.`;

        const c = data.crate;
        const version = c.max_stable_version || c.newest_version || 'unknown';

        const embed = new EmbedBuilder()
          .setColor(COLORS.crates)
          .setTitle(`${c.name} ${version}`)
          .setURL(`https://crates.io/crates/${c.name}`)
          .setDescription(c.description ? truncate(c.description, 300) : 'No description.')
          .addFields(
            { name: 'Total downloads', value: c.downloads.toLocaleString(), inline: true },
            {
              name: 'Recent downloads',
              value: c.recent_downloads ? c.recent_downloads.toLocaleString() : 'Unknown',
              inline: true,
            },
            { name: 'Updated', value: relativeTime(c.updated_at), inline: true },
          )
          .setFooter({ text: 'crates.io' });

        if (c.repository)
          embed.addFields({ name: 'Repository', value: c.repository, inline: false });

        return embed;
      },
      'crates.io',
    );
  },
};
