import type { Client, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { SectionBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { card, withThumbnail, paragraph, divider, facts, v2 } from '../../../utils/layout.js';

/** Discord date, e.g. "7 August 2026", with the relative form beside it. */
function on(timestamp: number | null): string {
  if (!timestamp) return '-';
  const seconds = Math.floor(timestamp / 1000);
  return `<t:${seconds}:D> (<t:${seconds}:R>)`;
}

export const user = {
  data: { name: 'user' },
  category: 'util',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const member =
      (interaction.options.getMember('target') as GuildMember | null) ??
      (interaction.member as GuildMember);

    const roles = member.roles.cache
      .filter((role) => role.id !== interaction.guildId)
      .sort((a, b) => b.position - a.position);

    const container = card(member.displayColor || ZENITSU_THEME.PRIMARY);

    const heading = withThumbnail(
      `## ${member.user.tag}${member.user.bot ? ' · bot' : ''}\n${member.nickname ? `Known here as ${member.nickname}` : member.user.displayName}`,
      member.user.displayAvatarURL({ size: 256, extension: 'png' }),
    );
    if (heading instanceof SectionBuilder) container.addSectionComponents(heading);
    else container.addTextDisplayComponents(heading);

    container.addSeparatorComponents(divider());

    // Timestamps are left out of the monospace block on purpose: Discord's
    // <t:> markup does not render inside a code fence.
    container.addTextDisplayComponents(
      paragraph(
        facts([
          ['ID', member.id],
          ['Highest role', roles.first()?.name ?? 'none'],
          ['Roles', String(roles.size)],
        ]),
      ),
    );

    container.addTextDisplayComponents(
      paragraph(
        `**Joined**  ${on(member.joinedTimestamp)}\n**Created**  ${on(member.user.createdTimestamp)}`,
      ),
    );

    if (roles.size) {
      const mentions = roles.map((role) => role.toString());
      const shown = mentions.slice(0, 20).join(' ');
      container.addSeparatorComponents(divider());
      container.addTextDisplayComponents(
        paragraph(
          `**Roles**\n${shown}${mentions.length > 20 ? ` and ${mentions.length - 20} more` : ''}`,
        ),
      );
    }

    await interaction.reply(v2([container]));
  },
};
