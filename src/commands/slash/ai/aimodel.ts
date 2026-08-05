import type { Client, ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import {
  listFreeModels,
  activeModel,
  setActiveModel,
  chat,
  DEFAULT_MODEL,
  AiUnavailableError,
} from '../../../services/ai.js';
import { requireOwner } from '../../../utils/owner.js';
import { logger } from '../../../services/logger.js';

/** Cached for autocomplete, which must answer within 3 seconds. */
let modelCache: { at: number; ids: string[] } = { at: 0, ids: [] };
const CACHE_MS = 10 * 60 * 1000;

async function cachedModelIds(): Promise<string[]> {
  if (Date.now() - modelCache.at < CACHE_MS && modelCache.ids.length) return modelCache.ids;

  try {
    const models = await listFreeModels();
    modelCache = { at: Date.now(), ids: models.map((m) => m.id) };
  } catch {
    // Keep whatever we had rather than emptying autocomplete on a blip.
  }
  return modelCache.ids;
}

export const aimodel = {
  data: { name: 'aimodel' },
  category: 'ai',

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const typed = interaction.options.getFocused().toLowerCase();
    const ids = await cachedModelIds();

    const matches = ids
      .filter((id) => id.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((id) => ({ name: id.length > 100 ? id.slice(0, 97) + '...' : id, value: id }));

    await interaction.respond(matches).catch(() => {});
  },

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list') {
      await interaction.deferReply({ ephemeral: true });

      try {
        const models = await listFreeModels();
        const current = await activeModel();

        const embed = new EmbedBuilder()
          .setColor(ZENITSU_THEME.PRIMARY)
          .setTitle(`Free models (${models.length})`)
          .setDescription(
            models
              .slice(0, 20)
              .map((m) => {
                const marker = m.id === current ? '**>** ' : '';
                return `${marker}\`${m.id}\` - ${m.contextLength.toLocaleString()} ctx`;
              })
              .join('\n')
              .slice(0, 4000),
          )
          .setFooter({ text: `Current: ${current}. Change with /aimodel set` });

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        logger.error({ err }, 'Model list failed');
        await interaction.editReply('Could not fetch the model list.').catch(() => {});
      }
      return;
    }

    if (subcommand === 'current') {
      const current = await activeModel();
      await interaction.reply({
        content: `Currently using \`${current}\`${current === DEFAULT_MODEL ? ' (default)' : ''}.`,
        ephemeral: true,
      });
      return;
    }

    // set - changes behaviour for everyone, so owner only.
    if (!(await requireOwner(interaction))) return;

    const model = interaction.options.getString('model', true).trim();
    await interaction.deferReply({ ephemeral: true });

    try {
      // Verify the model actually answers before saving, so a typo cannot
      // silently break every AI command until someone notices.
      const probe = await chat([{ role: 'user', content: 'Reply with: ok' }], {
        model,
        maxTokens: 30,
      });

      await setActiveModel(model);

      await interaction.editReply(
        `Model set to \`${model}\`.\nTest reply: ${probe.text.slice(0, 120)}`,
      );
    } catch (err) {
      const message =
        err instanceof AiUnavailableError ? err.message : 'Could not reach that model.';
      await interaction.editReply(`Not switching: ${message}`);
    }
  },
};
