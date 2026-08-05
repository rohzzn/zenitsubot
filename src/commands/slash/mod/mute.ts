import type { Client, ChatInputCommandInteraction, GuildMember } from 'discord.js';

export const mute = {
  data: { name: 'mute' },
  category: 'mod',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.options.getMember('user') as GuildMember | null;
    const minutes = interaction.options.getInteger('duration', true);
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (!member) {
      await interaction.reply({ content: 'User not found in this server.', ephemeral: true });
      return;
    }

    if (!member.moderatable) {
      await interaction.reply({
        content: 'I cannot timeout that member — their role is above mine, or they own the server.',
        ephemeral: true,
      });
      return;
    }

    await member.timeout(minutes * 60 * 1000, reason);

    const until = Math.floor((Date.now() + minutes * 60 * 1000) / 1000);
    await interaction.reply({
      content: `Timed out ${member.user.tag} until <t:${until}:f>. Reason: ${reason}`,
    });
  },
};
