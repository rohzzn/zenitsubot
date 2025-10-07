import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../services/logger.js';

export function registerInteractionCreateListener(client: Client) {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands?.get(interaction.commandName);
    if (!command) {
      await interaction.reply({ content: 'Unknown command', ephemeral: true });
      return;
    }
    try {
      await command.execute(client, interaction as ChatInputCommandInteraction);
    } catch (err) {
      logger.error({ err, command: interaction.commandName }, 'Command execution failed');
      if (!interaction.replied) {
        await interaction.reply({ content: 'There was an error executing this command.', ephemeral: true });
      }
    }
  });
}


