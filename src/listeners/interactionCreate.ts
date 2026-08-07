import type {
  Client,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  RepliableInteraction,
} from 'discord.js';
import { MessageFlags } from 'discord.js';
import { logger } from '../services/logger.js';
import { isBlacklisted } from '../services/blacklist.js';
import { explain } from '../utils/errors.js';
import { CONTEXT_MENUS } from '../commands/context.js';

/**
 * Reports an error without assuming the interaction is still unanswered.
 * A command that already deferred cannot be replied to again — calling reply()
 * there throws inside the catch block and leaves the user on a stuck spinner.
 */
async function reportError(interaction: RepliableInteraction, content: string) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    logger.warn({ err }, 'Could not deliver error message to user');
  }
}

export function registerInteractionCreateListener(client: Client) {
  client.on('interactionCreate', async (interaction) => {
    // Autocomplete arrives as its own interaction type and must be answered
    // within 3 seconds, so it is handled before anything else.
    if (interaction.isAutocomplete()) {
      const command = client.commands?.get(interaction.commandName) as
        | { autocomplete?: (i: AutocompleteInteraction) => Promise<void> }
        | undefined;

      if (!command?.autocomplete) return;

      try {
        await command.autocomplete(interaction);
      } catch (err) {
        logger.warn({ err, command: interaction.commandName }, 'Autocomplete failed');
      }
      return;
    }

    if (interaction.isContextMenuCommand()) {
      if (isBlacklisted(interaction.user.id, interaction.guildId)) return;

      const entry = CONTEXT_MENUS.find((c) => c.name === interaction.commandName);
      if (!entry) return;

      try {
        await entry.execute(client, interaction);
      } catch (err) {
        const { message } = explain(err, {
          contextMenu: interaction.commandName,
          user: interaction.user.id,
        });
        await reportError(interaction, message);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (isBlacklisted(interaction.user.id, interaction.guildId)) {
      await interaction
        .reply({ content: 'You do not have access to this bot.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }

    const command = client.commands?.get(interaction.commandName);
    if (!command) {
      logger.warn({ command: interaction.commandName }, 'Received unregistered command');
      await reportError(interaction, 'That command is no longer available.');
      return;
    }

    try {
      await command.execute(client, interaction as ChatInputCommandInteraction);
    } catch (err) {
      // explain() decides what this was and logs it at the matching level, so a
      // user typo no longer looks the same as a crash in `/logs`.
      const { message } = explain(err, {
        command: interaction.commandName,
        user: interaction.user.id,
        guild: interaction.guildId,
      });
      await reportError(interaction, message);
    }
  });
}
