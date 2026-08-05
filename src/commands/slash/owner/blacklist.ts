import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';
import { requireOwner, isOwner } from '../../../utils/owner.js';
import { refreshBlacklist } from '../../../services/blacklist.js';

export const blacklist = {
  data: { name: 'blacklist' },
  category: 'owner',

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    if (!(await requireOwner(interaction))) return;

    const subcommand = interaction.options.getSubcommand();
    const prisma = getPrisma();

    if (subcommand === 'add') {
      const targetId = interaction.options.getString('id', true).trim();
      const type = interaction.options.getString('type', true);
      const reason = interaction.options.getString('reason');

      if (isOwner(targetId)) {
        await interaction.reply({ content: 'You cannot blacklist yourself.', ephemeral: true });
        return;
      }

      await prisma.blacklist.upsert({
        where: { targetId },
        create: { targetId, type, reason },
        update: { type, reason },
      });
      await refreshBlacklist();

      let extra = '';
      if (type === 'guild') {
        const guild = client.guilds.cache.get(targetId);
        if (guild) {
          await guild.leave().catch(() => {});
          extra = ` Left **${guild.name}**.`;
        }
      }

      await interaction.reply({
        content: `Blacklisted ${type} \`${targetId}\`.${extra}`,
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'remove') {
      const targetId = interaction.options.getString('id', true).trim();
      const deleted = await prisma.blacklist.deleteMany({ where: { targetId } });
      await refreshBlacklist();

      await interaction.reply({
        content: deleted.count
          ? `Removed \`${targetId}\` from the blacklist.`
          : `\`${targetId}\` was not blacklisted.`,
        ephemeral: true,
      });
      return;
    }

    const entries = await prisma.blacklist.findMany({ orderBy: { createdAt: 'desc' }, take: 25 });

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(`Blacklist (${entries.length})`)
      .setDescription(
        entries.length
          ? entries
              .map(
                (e) =>
                  `\`${e.targetId}\` — ${e.type}${e.reason ? ` — ${e.reason}` : ''} · <t:${Math.floor(
                    e.createdAt.getTime() / 1000,
                  )}:R>`,
              )
              .join('\n')
          : 'Nothing blacklisted.',
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
