import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';

const ZENITSU_RESPONSES = {
  yes: [
    'Y-yes! I think so!',
    "Definitely! I'm sure of it!",
    'Ahhh yes! Thunder Breathing says yes!',
    'Without a doubt! Even I can see that!',
    'Yes yes YES! *nervously*',
  ],
  no: [
    'Ehhhh?! N-no way!',
    "I don't think so... sorry!",
    "Nooo! Please don't make me say it!",
    'Unfortunately... no...',
    'Thunder Breathing says... no...',
  ],
  maybe: [
    "M-maybe? I'm not really sure!",
    "Ask me later when I'm less scared!",
    "It's... complicated...",
    "I-I can't tell! My Thunder Breathing is unclear!",
    "Perhaps? Don't quote me on that!",
  ],
};

export const eightball = {
  data: {
    name: '8ball',
    description: 'Ask Zenitsu a yes/no question',
  },

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const question = interaction.options.getString('question', true);

    // Randomly pick category
    const categories = ['yes', 'no', 'maybe'] as const;
    const category = categories[Math.floor(Math.random() * categories.length)]!;
    const responses = ZENITSU_RESPONSES[category];
    const answer = responses[Math.floor(Math.random() * responses.length)]!;

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle('Thunder Fortune Telling')
      .addFields([
        { name: 'Question', value: question },
        { name: 'Answer', value: answer },
      ])
      .setFooter({ text: "Zenitsu's Thunder Breathing Prediction" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
