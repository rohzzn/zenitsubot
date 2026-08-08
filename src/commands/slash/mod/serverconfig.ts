import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  Role,
} from 'discord.js';
import { AttachmentBuilder, ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { card, paragraph, divider, caption, facts, v2Update } from '../../../utils/layout.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { UserError } from '../../../utils/errors.js';
import { getPrisma } from '../../../services/db.js';
import { renderWelcomeCard } from '../../../services/welcomeCard.js';
import { searchAnime, searchSteamGames } from '../../../services/updates.js';

/**
 * Server setup, in one place.
 *
 * Welcome, auto-role and the two update channels are all "assign a channel or
 * a role and turn it on", so they share a command rather than scattering four
 * near-identical ones across the list.
 */

async function settings(guildId: string) {
  const prisma = getPrisma();
  return prisma.guildConfig.upsert({
    where: { guildId },
    create: { guildId },
    update: {},
  });
}

/** Whether the Server Members intent is actually on, since everything depends on it. */
function membersIntentOn(client: Client): boolean {
  // The intent bit is 1 << 1. Checked directly rather than assumed, because
  // its absence is silent — Discord simply never sends the join event.
  return Boolean(client.options.intents.has?.(2));
}

function intentWarning(client: Client): string | null {
  return membersIntentOn(client)
    ? null
    : 'The **Server Members Intent** is off, so I never see anyone join and none of this will fire. ' +
        'Turn it on at Developer Portal → your app → Bot → Privileged Gateway Intents, then restart me.';
}

export const serverconfig = {
  data: { name: 'serverconfig' },
  category: 'moderation',

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused(true);
    const typed = String(focused.value).trim();

    if (typed.length < 2) return interaction.respond([]);

    if (focused.name === 'anime') {
      const matches = await searchAnime(typed);
      await interaction.respond(
        matches.slice(0, 25).map((anime) => ({
          name: `${anime.title}${anime.episodes ? ` (${anime.episodes} eps)` : ''}`.slice(0, 100),
          value: String(anime.id),
        })),
      );
      return;
    }

    if (focused.name === 'game') {
      const matches = await searchSteamGames(typed);
      await interaction.respond(
        matches
          .slice(0, 25)
          .map((game) => ({ name: game.name.slice(0, 100), value: String(game.appId) })),
      );
      return;
    }

    await interaction.respond([]);
  },

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) throw new UserError('This only works in a server.');

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const prisma = getPrisma();

    // ------------------------------------------------------------- welcome
    if (group === 'welcome') {
      if (sub === 'set') {
        const channel = interaction.options.getChannel('channel', true);

        await prisma.guildConfig.upsert({
          where: { guildId },
          create: { guildId, welcomeChannelId: channel.id, welcomeEnabled: true },
          update: { welcomeChannelId: channel.id, welcomeEnabled: true },
        });

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // A sample of their own card, so "well made" is something they can see
        // rather than take on trust.
        const sample = await renderWelcomeCard({
          name: interaction.user.displayName,
          handle: `@${interaction.user.username}`,
          avatarUrl: interaction.user.displayAvatarURL({ size: 256, extension: 'png' }),
          accent: interaction.user.accentColor ?? undefined,
          memberCount: interaction.guild?.memberCount,
          guildName: interaction.guild?.name ?? 'this server',
        });

        const warning = intentWarning(client);

        await interaction.editReply({
          ...v2Update([
            card(warning ? ZENITSU_THEME.ERROR : ZENITSU_THEME.SUCCESS)
              .addTextDisplayComponents(
                paragraph(`## Welcome channel set\nNew members will be greeted in ${channel}.`),
              )
              .addSeparatorComponents(divider())
              .addTextDisplayComponents(paragraph('This is what it will look like:'))
              .addTextDisplayComponents(
                caption(warning ?? 'Their banner is used as the background when they have one.'),
              ),
          ]),
          files: [new AttachmentBuilder(sample, { name: 'welcome.png' })],
        });
        return;
      }

      if (sub === 'off') {
        await prisma.guildConfig.update({ where: { guildId }, data: { welcomeEnabled: false } });
        await interaction.reply({
          content: 'Welcome messages are off.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    // ------------------------------------------------------------ autorole
    if (group === 'autorole') {
      if (sub === 'set') {
        const role = interaction.options.getRole('role', true) as Role;
        const me = interaction.guild?.members.me;

        // Both checked now: Discord's failure for either is opaque, and
        // discovering it silently on somebody's first join is worse.
        if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          throw new UserError('I need the **Manage Roles** permission to assign roles.');
        }
        if (role.position >= me.roles.highest.position) {
          throw new UserError(
            `**${role.name}** sits above my own highest role, so I cannot assign it. ` +
              'Move my role above it in Server Settings → Roles.',
          );
        }
        if (role.managed) {
          throw new UserError(
            `**${role.name}** is managed by an integration and cannot be assigned.`,
          );
        }

        await prisma.guildConfig.upsert({
          where: { guildId },
          create: { guildId, autoRoleId: role.id, autoRoleEnabled: true },
          update: { autoRoleId: role.id, autoRoleEnabled: true },
        });

        const warning = intentWarning(client);

        await interaction.reply({
          ...v2Update([
            card(warning ? ZENITSU_THEME.ERROR : ZENITSU_THEME.SUCCESS)
              .addTextDisplayComponents(
                paragraph(`## Auto-role on\nEveryone who joins gets **${role.name}**.`),
              )
              .addTextDisplayComponents(
                caption(warning ?? 'Turn it off with `/serverconfig autorole off`.'),
              ),
          ]),
          flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
        return;
      }

      if (sub === 'off') {
        await prisma.guildConfig.update({ where: { guildId }, data: { autoRoleEnabled: false } });
        await interaction.reply({ content: 'Auto-role is off.', flags: MessageFlags.Ephemeral });
        return;
      }
    }

    // -------------------------------------------------------------- anime
    if (group === 'anime') {
      if (sub === 'channel') {
        const channel = interaction.options.getChannel('channel', true);
        await prisma.guildConfig.upsert({
          where: { guildId },
          create: { guildId, animeChannelId: channel.id },
          update: { animeChannelId: channel.id },
        });
        await interaction.reply({
          content: `New episodes will be posted in ${channel}. Follow shows with \`/serverconfig anime follow\`.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'follow') {
        const id = Number(interaction.options.getString('anime', true));
        if (!Number.isFinite(id)) throw new UserError('Pick a show from the suggestions.');

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const [match] = await searchAnime(String(id)).then((r) => r.filter((a) => a.id === id));

        // The autocomplete gives an id, so a lookup by that id is how the
        // title and cover are found; a search by number rarely returns it.
        const details =
          match ?? (await searchAnime(interaction.options.getString('anime', true)))[0];
        if (!details) throw new UserError('Could not find that show on AniList.');

        await prisma.animeFollow.upsert({
          where: { guildId_anilistId: { guildId, anilistId: id } },
          create: {
            guildId,
            anilistId: id,
            title: details.title,
            coverUrl: details.coverUrl,
            // Seeded to what has already aired, so following a running show
            // does not announce every past episode at once.
            lastEpisode: Math.max(0, (details.nextEpisode ?? 1) - 1),
            addedBy: interaction.user.id,
          },
          update: { title: details.title, coverUrl: details.coverUrl },
        });

        await interaction.editReply(
          `Following **${details.title}**. New episodes will be posted as they air.`,
        );
        return;
      }
    }

    // --------------------------------------------------------------- games
    if (group === 'game') {
      if (sub === 'channel') {
        const channel = interaction.options.getChannel('channel', true);
        await prisma.guildConfig.upsert({
          where: { guildId },
          create: { guildId, gameChannelId: channel.id },
          update: { gameChannelId: channel.id },
        });
        await interaction.reply({
          content: `Game news will be posted in ${channel}. Follow games with \`/serverconfig game follow\`.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'follow') {
        const appId = Number(interaction.options.getString('game', true));
        if (!Number.isFinite(appId)) throw new UserError('Pick a game from the suggestions.');

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const matches = await searchSteamGames(interaction.options.getString('game', true));
        const name = matches.find((g) => g.appId === appId)?.name ?? `App ${appId}`;

        await prisma.gameFollow.upsert({
          where: { guildId_appId: { guildId, appId } },
          create: { guildId, appId, name, addedBy: interaction.user.id },
          update: { name },
        });

        await interaction.editReply(`Following **${name}**. Patch notes and news will be posted.`);
        return;
      }
    }

    // ---------------------------------------------------------------- show
    const current = await settings(guildId);
    const [animeFollows, gameFollows] = await Promise.all([
      prisma.animeFollow.count({ where: { guildId } }),
      prisma.gameFollow.count({ where: { guildId } }),
    ]);

    const channelName = (id?: string | null) => (id ? `<#${id}>` : 'not set');
    const warning = intentWarning(client);

    const container = card()
      .addTextDisplayComponents(paragraph(`## ${interaction.guild?.name} setup`))
      .addSeparatorComponents(divider())
      .addTextDisplayComponents(
        paragraph(
          facts([
            ['Welcome', current.welcomeEnabled ? 'on' : 'off'],
            ['Auto-role', current.autoRoleEnabled ? 'on' : 'off'],
            ['Anime follows', String(animeFollows)],
            ['Game follows', String(gameFollows)],
          ]),
        ),
      )
      .addTextDisplayComponents(
        paragraph(
          `**Welcome** ${channelName(current.welcomeChannelId)}\n` +
            `**Auto-role** ${current.autoRoleId ? `<@&${current.autoRoleId}>` : 'not set'}\n` +
            `**Anime** ${channelName(current.animeChannelId)}\n` +
            `**Games** ${channelName(current.gameChannelId)}`,
        ),
      );

    if (warning) container.addTextDisplayComponents(caption(warning));

    await interaction.reply({
      ...v2Update([container]),
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
  },
};
