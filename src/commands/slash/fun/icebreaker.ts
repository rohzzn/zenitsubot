import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';

const ICEBREAKERS = [
  'If you could have dinner with any fictional character, who would it be and why?',
  "What's a skill you'd love to master instantly?",
  'If you could live in any anime world, which one would you choose?',
  "What's the most interesting place you've ever visited?",
  'If you could have any superpower, what would it be?',
  "What's your favorite childhood memory?",
  'If you could time travel, would you go to the past or future?',
  "What's something you've always wanted to learn but haven't yet?",
  'If you could switch lives with someone for a day, who would it be?',
  "What's the best advice you've ever received?",
  'If you could eat only one food for the rest of your life, what would it be?',
  "What's your dream job if money wasn't an issue?",
  'If you could instantly become an expert in one thing, what would it be?',
  "What's the coolest thing about you that most people don't know?",
  'If you could befriend any anime character, who would you choose?',
  "What's something that always makes you smile?",
  'If you could create a new holiday, what would it celebrate?',
  "What's your favorite way to spend a weekend?",
  'If you could have any animal as a pet (real or mythical), what would it be?',
  "What's the most adventurous thing you've ever done?",
  'If you could master any Thunder Breathing form, which one? Just kidding! Or am I?',
  "What's your go-to karaoke song?",
  'If you could live in any time period, when would it be?',
  "What's something you're passionate about?",
  'If you could teleport anywhere right now, where would you go?',
  "What's your favorite thing about this server?",
  'If you could have a theme song that played whenever you entered a room, what would it be?',
  "What's the weirdest food combination you actually enjoy?",
  'If you were a character in an anime, what would your special ability be?',
  "What's something you've done that you're really proud of?",
];

export const icebreaker = {
  data: {
    name: 'icebreaker',
    description: 'Get a random conversation starter to break the ice!',
  },

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const question = ICEBREAKERS[Math.floor(Math.random() * ICEBREAKERS.length)]!;

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle('Icebreaker Question')
      .setDescription(`${question}`)
      .setFooter({ text: "I-I'm curious what everyone thinks!" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
