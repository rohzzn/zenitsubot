import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { ActionRowBuilder, StringSelectMenuBuilder, ComponentType, type Message } from 'discord.js';
import { card, paragraph, divider, caption, v2, v2Update, type Block } from '../../utils/layout.js';
import {
  CATEGORY_LABELS,
  POPULATED_CATEGORIES,
  VISIBLE_COMMAND_COUNT,
  visibleCommands,
  type CommandCategory,
} from '../index.js';

const MENU_ID = 'help_category';
const OVERVIEW = 'overview';
const MENU_TIMEOUT_MS = 5 * 60 * 1000;

function overview(): Block[] {
  const rows = POPULATED_CATEGORIES.map((category) => {
    const { label, blurb } = CATEGORY_LABELS[category];
    return `**${label}** · ${visibleCommands(category).length}\n${blurb}`;
  });

  return [
    card()
      .addTextDisplayComponents(
        paragraph(
          `## Commands\n${VISIBLE_COMMAND_COUNT} across ${POPULATED_CATEGORIES.length} categories.`,
        ),
      )
      .addSeparatorComponents(divider())
      .addTextDisplayComponents(paragraph(rows.join('\n\n')))
      .addTextDisplayComponents(caption('Only you can see this.')),
  ];
}

function categoryView(category: CommandCategory): Block[] {
  const { label, blurb } = CATEGORY_LABELS[category];
  const commands = visibleCommands(category);

  const container = card()
    .addTextDisplayComponents(paragraph(`## ${label}\n${blurb}`))
    .addSeparatorComponents(divider());

  // V2 has no 1024-character field cap, so the whole list goes in one block
  // instead of being chopped across fields.
  const lines = commands.map((c) => `**/${c.handler.data.name}** — ${c.summary}`);

  // Text displays cap at 4000; split only if a category ever grows past that.
  let buffer: string[] = [];
  let length = 0;

  for (const line of lines) {
    if (length + line.length + 1 > 3800) {
      container.addTextDisplayComponents(paragraph(buffer.join('\n')));
      buffer = [];
      length = 0;
    }
    buffer.push(line);
    length += line.length + 1;
  }
  if (buffer.length) container.addTextDisplayComponents(paragraph(buffer.join('\n')));

  return [container];
}

function menu(selected: string): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(MENU_ID).addOptions([
      { label: 'Overview', value: OVERVIEW, default: selected === OVERVIEW },
      ...POPULATED_CATEGORIES.map((category) => ({
        label: CATEGORY_LABELS[category].label,
        value: category,
        description: `${visibleCommands(category).length} commands`,
        default: category === selected,
      })),
    ]),
  );
}

export const help = {
  data: { name: 'help' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const render = (choice: string) =>
      v2(
        [
          ...(choice === OVERVIEW ? overview() : categoryView(choice as CommandCategory)),
          menu(choice),
        ],
        { ephemeral: true },
      );

    const message = (await interaction
      .reply({
        ...render(OVERVIEW),
        withResponse: true,
      })
      .then((r) => r.resource!.message!)) as Message;

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: MENU_TIMEOUT_MS,
    });

    collector.on('collect', async (select) => {
      if (select.user.id !== interaction.user.id) {
        await select.reply({ content: 'Not your menu.', ephemeral: true });
        return;
      }
      const choice = select.values[0]!;
      await select.update(
        v2Update([
          ...(choice === OVERVIEW ? overview() : categoryView(choice as CommandCategory)),
          menu(choice),
        ]),
      );
    });

    collector.on('end', () => {
      void interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
