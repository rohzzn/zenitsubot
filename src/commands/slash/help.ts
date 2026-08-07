import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { card, paragraph, divider, caption, v2, v2Update, type Block } from '../../utils/layout.js';
import {
  attachState,
  componentId,
  registerComponentHandler,
  type ComponentHandler,
} from '../../listeners/componentRouter.js';
import {
  CATEGORY_LABELS,
  POPULATED_CATEGORIES,
  VISIBLE_COMMAND_COUNT,
  visibleCommands,
  type CommandCategory,
} from '../index.js';

const KIND = 'help';
const OVERVIEW = 'overview';
const DAY_MS = 24 * 60 * 60 * 1000;

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
    new StringSelectMenuBuilder().setCustomId(componentId(KIND, 'page')).addOptions([
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

function render(choice: string): Block[] {
  return [
    ...(choice === OVERVIEW ? overview() : categoryView(choice as CommandCategory)),
    menu(choice),
  ];
}

/**
 * The menu holds no state of its own — the chosen category arrives with the
 * interaction. The row exists so the router can find an owner and so an
 * expired message says so instead of failing silently.
 */
const handler: ComponentHandler<Record<string, never>> = {
  kind: KIND,
  ttlMs: DAY_MS,
  expiredMessage: 'This help menu has expired. Run `/help` again.',
  async handle({ interaction }) {
    if (!interaction.isStringSelectMenu()) return;
    await interaction.update(v2Update(render(interaction.values[0]!)));
  },
};

registerComponentHandler(handler);

export const help = {
  data: { name: 'help' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const response = await interaction.reply({
      ...v2(render(OVERVIEW), { ephemeral: true }),
      withResponse: true,
    });

    const message = response.resource?.message;
    if (message) await attachState(message.id, handler, interaction.user.id, {});
  },
};
