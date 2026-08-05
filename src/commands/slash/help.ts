import type { Client, ChatInputCommandInteraction } from 'discord.js';
import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
} from 'discord.js';
import { ZENITSU_THEME, EMOTES } from '../../utils/constants.js';
import {
  COMMANDS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  commandsByCategory,
  type CommandCategory,
} from '../index.js';

const MENU_ID = 'help_category';
const MENU_TIMEOUT_MS = 5 * 60 * 1000;

function overviewEmbed() {
  const lines = CATEGORY_ORDER.map((category) => {
    const { label, emoji } = CATEGORY_LABELS[category];
    return `${emoji} **${label}** — ${commandsByCategory(category).length} commands`;
  });

  return new EmbedBuilder()
    .setColor(ZENITSU_THEME.PRIMARY)
    .setTitle(`${EMOTES.FLUENT_SPARKLES} Zenitsu — Help`)
    .setDescription(`Pick a category from the menu below.\n\n${lines.join('\n')}`)
    .setFooter({ text: `${COMMANDS.length} commands total` })
    .setTimestamp();
}

function categoryEmbed(category: CommandCategory) {
  const { label, emoji } = CATEGORY_LABELS[category];
  const commands = commandsByCategory(category);

  return new EmbedBuilder()
    .setColor(ZENITSU_THEME.PRIMARY)
    .setTitle(`${emoji} ${label}`)
    .setDescription(
      commands.map((c) => `\`/${c.handler.data.name}\` — ${c.summary}`).join('\n'),
    )
    .setFooter({ text: `${commands.length} commands in ${label}` })
    .setTimestamp();
}

function categoryMenu(selected?: CommandCategory) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(MENU_ID)
    .setPlaceholder('Choose a category')
    .addOptions(
      CATEGORY_ORDER.map((category) => {
        const { label, emoji } = CATEGORY_LABELS[category];
        return {
          label,
          value: category,
          emoji,
          description: `${commandsByCategory(category).length} commands`,
          default: category === selected,
        };
      }),
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export const help = {
  data: { name: 'help' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const response = await interaction.reply({
      embeds: [overviewEmbed()],
      components: [categoryMenu()],
      ephemeral: true,
      fetchReply: true,
    });

    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: MENU_TIMEOUT_MS,
    });

    collector.on('collect', async (selectInteraction) => {
      if (selectInteraction.user.id !== interaction.user.id) {
        await selectInteraction.reply({ content: 'This help menu is not yours.', ephemeral: true });
        return;
      }

      const category = selectInteraction.values[0] as CommandCategory;
      await selectInteraction.update({
        embeds: [categoryEmbed(category)],
        components: [categoryMenu(category)],
      });
    });

    collector.on('end', () => {
      // The menu is ephemeral, so it simply stops responding once it expires.
      void interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
