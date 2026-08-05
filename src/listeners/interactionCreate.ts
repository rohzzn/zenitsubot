import type { Client, ChatInputCommandInteraction, RepliableInteraction } from 'discord.js';
import { logger } from '../services/logger.js';

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
      await interaction.reply({ content, ephemeral: true });
    }
  } catch (err) {
    logger.warn({ err }, 'Could not deliver error message to user');
  }
}

export function registerInteractionCreateListener(client: Client) {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands?.get(interaction.commandName);
    if (!command) {
      logger.warn({ command: interaction.commandName }, 'Received unregistered command');
      await reportError(
        interaction,
        'That command is no longer available. Discord may take up to an hour to stop showing it.',
      );
      return;
    }

    try {
      await command.execute(client, interaction as ChatInputCommandInteraction);
    } catch (err) {
      logger.error({ err, command: interaction.commandName }, 'Command execution failed');
      await reportError(interaction, 'There was an error executing this command.');
    }
  });
}
