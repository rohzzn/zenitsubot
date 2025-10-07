import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

const jobs = [
  { name: 'Developer', min: 200, max: 500, emoji: '💻' },
  { name: 'Designer', min: 180, max: 450, emoji: '🎨' },
  { name: 'Writer', min: 150, max: 400, emoji: '✍️' },
  { name: 'Chef', min: 170, max: 420, emoji: '👨‍🍳' },
  { name: 'Teacher', min: 160, max: 380, emoji: '👨‍🏫' },
  { name: 'Musician', min: 140, max: 360, emoji: '🎵' },
  { name: 'Artist', min: 130, max: 350, emoji: '🎭' },
  { name: 'Streamer', min: 190, max: 480, emoji: '🎮' }
];

export const work = {
  data: {
    name: 'work',
    description: 'Work to earn coins (1 hour cooldown)',
  },
  
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const prisma = getPrisma();
    const userId = interaction.user.id;
    
    let userEcon = await prisma.userEconomy.findUnique({
      where: { userId }
    });
    
    if (!userEcon) {
      userEcon = await prisma.userEconomy.create({
        data: { userId, coins: 1000 }
      });
    }
    
    // Check cooldown (1 hour)
    const now = new Date();
    const lastWork = userEcon.updatedAt;
    const cooldown = 60 * 60 * 1000; // 1 hour
    const timeSince = now.getTime() - lastWork.getTime();
    
    if (timeSince < cooldown) {
      const timeLeft = cooldown - timeSince;
      const minutesLeft = Math.ceil(timeLeft / (1000 * 60));
      
      await interaction.reply({ 
        content: `You're exhausted! Rest for **${minutesLeft} minutes** before working again.`,
        ephemeral: true 
      });
      return;
    }
    
    // Random job and earnings
    const job = jobs[Math.floor(Math.random() * jobs.length)]!;
    const earnings = Math.floor(Math.random() * (job.max - job.min + 1)) + job.min;
    
    // Update balance
    await prisma.userEconomy.update({
      where: { userId },
      data: { 
        coins: userEcon.coins + earnings,
        updatedAt: now
      }
    });
    
    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setAuthor({
        name: interaction.user.username,
        iconURL: interaction.user.displayAvatarURL()
      })
      .setTitle(`${job.emoji} ${job.name}`)
      .setDescription(`You earned **${earnings.toLocaleString()}** coins`)
      .addFields([
        {
          name: 'Balance',
          value: `${(userEcon.coins + earnings).toLocaleString()} 💛`,
          inline: true
        },
        {
          name: 'Next Work',
          value: '1 hour',
          inline: true
        }
      ])
      .setFooter({ text: 'Keep grinding!' })
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
  },
};

