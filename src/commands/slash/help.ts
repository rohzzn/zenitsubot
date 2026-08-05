import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } from 'discord.js';
import { ZENITSU_THEME } from '../../utils/constants.js';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  VISIBLE_COMMAND_COUNT,
  visibleCommands,
  type CommandCategory,
} from '../index.js';

const MENU_ID = 'help_category';
const OVERVIEW = 'overview';
const MENU_TIMEOUT_MS = 5 * 60 * 1000;

/** Discord caps a field value at 1024 characters, so long categories split. */
const FIELD_LIMIT = 1024;

function chunkLines(lines: string[]): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    if (current.length + line.length + 1 > FIELD_LIMIT) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function overviewEmbed(): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(ZENITSU_THEME.PRIMARY)
    .setTitle('Zenitsu — Command Reference')
    .setDescription(
      `**${VISIBLE_COMMAND_COUNT} commands** across ${CATEGORY_ORDER.length} categories.\n` +
        'Pick a category below to see its commands and what each one does.',
    )
    .setFooter({ text: 'This menu is only visible to you and expires after 5 minutes' });

  // Two columns of category summaries, so the overview stays scannable.
  const half = Math.ceil(CATEGORY_ORDER.length / 2);
  const columns = [CATEGORY_ORDER.slice(0, half), CATEGORY_ORDER.slice(half)];

  for (const column of columns) {
    embed.addFields({
      name: '​',
      value: column
        .map((category) => {
          const { label, blurb } = CATEGORY_LABELS[category];
          return `**${label}** · ${visibleCommands(category).length}\n${blurb}`;
        })
        .join('\n\n'),
      inline: true,
    });
  }

  return embed;
}

function categoryEmbed(category: CommandCategory): EmbedBuilder {
  const { label, blurb } = CATEGORY_LABELS[category];
  const commands = visibleCommands(category);

  const embed = new EmbedBuilder()
    .setColor(ZENITSU_THEME.PRIMARY)
    .setTitle(`${label} — ${commands.length} commands`)
    .setDescription(blurb)
    .setFooter({ text: 'Required options are marked with * in Discord as you type' });

  const lines = commands.map((c) => `**/${c.handler.data.name}** — ${c.summary}`);

  chunkLines(lines).forEach((chunk, index) => {
    embed.addFields({ name: index === 0 ? '​' : '​ (continued)', value: chunk, inline: false });
  });

  return embed;
}

function categoryMenu(selected: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(MENU_ID)
    .setPlaceholder('Choose a category')
    .addOptions([
      {
        label: 'Overview',
        value: OVERVIEW,
        description: 'All categories at a glance',
        default: selected === OVERVIEW,
      },
      ...CATEGORY_ORDER.map((category) => {
        const { label } = CATEGORY_LABELS[category];
        return {
          label,
          value: category,
          description: `${visibleCommands(category).length} commands`,
          default: category === selected,
        };
      }),
    ]);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export const help = {
  data: { name: 'help' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const response = await interaction.reply({
      embeds: [overviewEmbed()],
      components: [categoryMenu(OVERVIEW)],
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

      const choice = selectInteraction.values[0]!;
      const embed =
        choice === OVERVIEW ? overviewEmbed() : categoryEmbed(choice as CommandCategory);

      await selectInteraction.update({ embeds: [embed], components: [categoryMenu(choice)] });
    });

    collector.on('end', () => {
      void interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
