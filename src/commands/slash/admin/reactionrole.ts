import type { Client, ChatInputCommandInteraction, TextChannel } from 'discord.js';
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';
import { logger } from '../../../services/logger.js';

/** Normalises an emoji to the form reaction events report back. */
function emojiKey(input: string): string | null {
  const custom = input.match(/^<a?:(\w+):(\d+)>$/);
  if (custom) return custom[2]!;

  const trimmed = input.trim();
  // Unicode emoji arrive as the raw character in reaction events.
  return trimmed.length > 0 && trimmed.length <= 8 ? trimmed : null;
}

export const reactionrole = {
  data: { name: 'reactionrole' },
  category: 'admin',
  defaultMemberPermissions: PermissionFlagsBits.ManageRoles,

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    const prisma = getPrisma();
    const guildId = interaction.guildId!;

    if (subcommand === 'add') {
      const messageId = interaction.options.getString('message_id', true).trim();
      const rawEmoji = interaction.options.getString('emoji', true);
      const role = interaction.options.getRole('role', true);
      const channel = (interaction.options.getChannel('channel') ??
        interaction.channel) as TextChannel;

      const key = emojiKey(rawEmoji);
      if (!key) {
        await interaction.reply({
          content: 'That does not look like a usable emoji.',
          ephemeral: true,
        });
        return;
      }

      const me = interaction.guild!.members.me!;
      if (role.position >= me.roles.highest.position) {
        await interaction.reply({
          content: `I cannot assign **${role.name}** — it sits at or above my highest role.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) {
        await interaction.editReply(`Could not find message \`${messageId}\` in ${channel}.`);
        return;
      }

      try {
        await message.react(rawEmoji);
      } catch {
        await interaction.editReply(
          'I could not react with that emoji. Is it from a server I am not in?',
        );
        return;
      }

      await prisma.reactionRole.upsert({
        where: { messageId_emoji: { messageId, emoji: key } },
        create: { guildId, messageId, channelId: channel.id, emoji: key, roleId: role.id },
        update: { roleId: role.id, channelId: channel.id },
      });

      await interaction.editReply(
        `Reacting with ${rawEmoji} on that message now grants **${role.name}**.`,
      );
      return;
    }

    if (subcommand === 'remove') {
      const messageId = interaction.options.getString('message_id', true).trim();
      const rawEmoji = interaction.options.getString('emoji', true);
      const key = emojiKey(rawEmoji);

      const deleted = await prisma.reactionRole.deleteMany({
        where: { guildId, messageId, ...(key ? { emoji: key } : {}) },
      });

      await interaction.reply({
        content: deleted.count
          ? `Removed ${deleted.count} reaction role binding(s).`
          : 'No matching reaction role found.',
        ephemeral: true,
      });
      return;
    }

    const bindings = await prisma.reactionRole.findMany({ where: { guildId }, take: 25 });

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(`Reaction roles (${bindings.length})`)
      .setDescription(
        bindings.length
          ? bindings
              .map((b) => {
                const emoji = /^\d+$/.test(b.emoji) ? `<:e:${b.emoji}>` : b.emoji;
                return `${emoji} to <@&${b.roleId}> on [message](https://discord.com/channels/${guildId}/${b.channelId}/${b.messageId})`;
              })
              .join('\n')
          : 'No reaction roles configured. Use `/reactionrole add`.',
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
