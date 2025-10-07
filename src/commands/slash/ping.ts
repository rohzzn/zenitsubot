import type { Client, ChatInputCommandInteraction } from 'discord.js';

export const ping = {
  data: { name: 'ping' },
  async execute(client: Client, interaction: ChatInputCommandInteraction) {
    const sent = await interaction.reply({ content: 'Pinging...', ephemeral: true, fetchReply: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(`Pong! Latency: ${latency}ms`);
  },
};

export type PingCommand = typeof ping;


