import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { brandEmbed, count, since } from '../../../utils/ui.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { logger } from '../../../services/logger.js';

const API = 'https://discord.com/api/v10';

const VERIFICATION = ['None', 'Low', 'Medium', 'High', 'Highest'];

/** Accepts a raw id, an invite code, or any form of invite link. */
function parseTarget(input: string): { kind: 'id' | 'invite'; value: string } | null {
  const text = input.trim();

  if (/^\d{17,20}$/.test(text)) return { kind: 'id', value: text };

  const invite = text.match(
    /(?:discord\.gg|discord(?:app)?\.com\/invite|discord\.com\/invite)\/([a-z0-9-]+)/i,
  );
  if (invite) return { kind: 'invite', value: invite[1]! };

  if (/^[a-z0-9-]{2,25}$/i.test(text)) return { kind: 'invite', value: text };

  return null;
}

function iconUrl(id: string, hash?: string | null): string | null {
  if (!hash) return null;
  const ext = hash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${id}/${hash}.${ext}?size=256`;
}

function bannerUrl(id: string, hash?: string | null): string | null {
  if (!hash) return null;
  return `https://cdn.discordapp.com/banners/${id}/${hash}.png?size=600`;
}

/** Snowflakes encode their creation time in the high bits. */
function createdAt(id: string): Date {
  return new Date(Number(BigInt(id) >> 22n) + 1420070400000);
}

async function discord<T>(path: string, token: string): Promise<T | null> {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

export const serverlookup = {
  data: { name: 'serverlookup' },
  category: 'utility',

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const target = parseTarget(interaction.options.getString('server', true));

    if (!target) {
      await interaction.reply({
        content: 'Give a server ID (17-20 digits) or an invite link.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const token = process.env.DISCORD_BOT_TOKEN!;

    try {
      // Best case: the bot shares the server, so everything including the
      // owner is readable.
      if (target.kind === 'id') {
        const known = client.guilds.cache.get(target.value);

        if (known) {
          const owner = await known.fetchOwner().catch(() => null);

          const embed = brandEmbed({
            author: { name: 'Server lookup' },
            title: known.name,
            description: known.description ?? undefined,
            thumbnail: known.iconURL({ size: 256 }),
            image: known.bannerURL({ size: 600 }),
            footer: 'Full details available: the bot is in this server',
          });

          embed.addFields(
            {
              name: 'Owner',
              value: owner
                ? `${owner.user.tag}\n<@${known.ownerId}>\n\`${known.ownerId}\``
                : `\`${known.ownerId}\``,
              inline: true,
            },
            { name: 'Members', value: count(known.memberCount), inline: true },
            { name: 'Created', value: since(known.createdAt), inline: true },
            { name: 'Channels', value: count(known.channels.cache.size), inline: true },
            { name: 'Roles', value: count(known.roles.cache.size), inline: true },
            {
              name: 'Boosts',
              value: `${known.premiumSubscriptionCount ?? 0} (tier ${known.premiumTier})`,
              inline: true,
            },
            { name: 'Server ID', value: `\`${known.id}\``, inline: false },
          );

          await interaction.editReply({ embeds: [embed] });
          return;
        }

        // Not a member. Preview works only for Discoverable/Community servers
        // and deliberately does not include the owner.
        const preview = await discord<any>(`/guilds/${target.value}/preview`, token);

        if (!preview) {
          const embed = brandEmbed({
            color: ZENITSU_THEME.ERROR,
            author: { name: 'Server lookup' },
            title: 'Nothing public for that ID',
            description:
              'The bot is not in that server and it is not publicly discoverable, so Discord returns nothing.\n\n' +
              'An invite link would give the name, icon, banner and member counts.',
            footer: `ID created ${createdAt(target.value).toISOString().slice(0, 10)}`,
          });
          await interaction.editReply({ embeds: [embed] });
          return;
        }

        const embed = brandEmbed({
          author: { name: 'Server lookup - public preview' },
          title: preview.name,
          description: preview.description ?? undefined,
          thumbnail: iconUrl(preview.id, preview.icon),
          image: bannerUrl(preview.id, preview.discovery_splash ?? preview.splash),
          footer: 'Owner is not exposed by Discord for servers the bot is not in',
        });

        embed.addFields(
          { name: 'Members', value: count(preview.approximate_member_count), inline: true },
          { name: 'Online', value: count(preview.approximate_presence_count), inline: true },
          { name: 'Created', value: since(createdAt(preview.id)), inline: true },
          { name: 'Emojis', value: count(preview.emojis?.length), inline: true },
          { name: 'Stickers', value: count(preview.stickers?.length), inline: true },
          { name: 'Server ID', value: `\`${preview.id}\``, inline: true },
        );

        if (preview.features?.length) {
          embed.addFields({
            name: 'Features',
            value: preview.features
              .slice(0, 12)
              .map((f: string) => f.toLowerCase().replace(/_/g, ' '))
              .join(', ')
              .slice(0, 1024),
            inline: false,
          });
        }

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Invite path.
      const invite = await discord<any>(
        `/invites/${encodeURIComponent(target.value)}?with_counts=true&with_expiration=true`,
        token,
      );

      if (!invite?.guild) {
        await interaction.editReply('That invite is invalid or has expired.');
        return;
      }

      const guild = invite.guild;
      const shared = client.guilds.cache.get(guild.id);

      const embed = brandEmbed({
        author: { name: 'Server lookup - invite' },
        title: guild.name,
        description: guild.description ?? undefined,
        thumbnail: iconUrl(guild.id, guild.icon),
        image: bannerUrl(guild.id, guild.banner ?? guild.splash),
        footer: shared
          ? 'The bot is in this server'
          : 'Owner is not exposed by Discord for servers the bot is not in',
      });

      embed.addFields(
        { name: 'Members', value: count(invite.approximate_member_count), inline: true },
        { name: 'Online', value: count(invite.approximate_presence_count), inline: true },
        { name: 'Created', value: since(createdAt(guild.id)), inline: true },
        {
          name: 'Verification',
          value: VERIFICATION[guild.verification_level] ?? 'Unknown',
          inline: true,
        },
        {
          name: 'Boosts',
          value: `${guild.premium_subscription_count ?? 0} (tier ${guild.premium_tier ?? 0})`,
          inline: true,
        },
        { name: 'Server ID', value: `\`${guild.id}\``, inline: true },
      );

      if (shared) {
        const owner = await shared.fetchOwner().catch(() => null);
        embed.addFields({
          name: 'Owner',
          value: owner ? `${owner.user.tag}\n<@${shared.ownerId}>` : `\`${shared.ownerId}\``,
          inline: false,
        });
      }

      if (invite.channel?.name) {
        embed.addFields({ name: 'Invite channel', value: `#${invite.channel.name}`, inline: true });
      }
      if (guild.vanity_url_code) {
        embed.addFields({
          name: 'Vanity',
          value: `discord.gg/${guild.vanity_url_code}`,
          inline: true,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err, target }, 'Server lookup failed');
      await interaction.editReply('Lookup failed. Try again shortly.').catch(() => {});
    }
  },
};
