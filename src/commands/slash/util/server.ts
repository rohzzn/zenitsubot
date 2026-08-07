import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { ChannelType, SectionBuilder } from 'discord.js';
import { card, withThumbnail, paragraph, divider, facts, v2 } from '../../../utils/layout.js';

export const server = {
  data: { name: 'server' },
  category: 'util',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild!;
    const channels = guild.channels.cache;

    const container = card();

    const heading = withThumbnail(
      `## ${guild.name}\n${guild.description ?? `${guild.memberCount.toLocaleString()} members`}`,
      guild.iconURL({ size: 256, extension: 'png' }),
    );
    if (heading instanceof SectionBuilder) container.addSectionComponents(heading);
    else container.addTextDisplayComponents(heading);

    container.addSeparatorComponents(divider());

    container.addTextDisplayComponents(
      paragraph(
        facts([
          ['Members', guild.memberCount.toLocaleString()],
          ['Text', String(channels.filter((c) => c.type === ChannelType.GuildText).size)],
          ['Voice', String(channels.filter((c) => c.type === ChannelType.GuildVoice).size)],
          ['Roles', String(guild.roles.cache.size)],
          ['Emoji', String(guild.emojis.cache.size)],
          ['Boosts', `${guild.premiumSubscriptionCount ?? 0} (tier ${guild.premiumTier})`],
        ]),
      ),
    );

    // Kept out of the monospace block: <t:> and <@> do not render in a fence.
    container.addTextDisplayComponents(
      paragraph(
        `**Owner**  <@${guild.ownerId}>\n` +
          `**Created**  <t:${Math.floor(guild.createdTimestamp / 1000)}:D> ` +
          `(<t:${Math.floor(guild.createdTimestamp / 1000)}:R>)`,
      ),
    );

    await interaction.reply(v2([container]));
  },
};
