import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';

const LEGENDARY_QUOTES = [
  { quote: "It's not the face that makes someone a monster; it's the choices they make with their lives.", character: "Naruto Uzumaki", anime: "Naruto" },
  { quote: "If you don't take risks, you can't create a future.", character: "Monkey D. Luffy", anime: "One Piece" },
  { quote: "People's lives don't end when they die. It ends when they lose faith.", character: "Itachi Uchiha", anime: "Naruto" },
  { quote: "The world isn't perfect, but it's there for us doing the best it can. That's what makes it so damn beautiful.", character: "Roy Mustang", anime: "Fullmetal Alchemist" },
  { quote: "Fear is not evil. It tells you what your weakness is.", character: "Gildarts Clive", anime: "Fairy Tail" },
  { quote: "Hard work is worthless for those that don't believe in themselves.", character: "Naruto Uzumaki", anime: "Naruto" },
  { quote: "If you don't like your destiny, don't accept it. Instead, have the courage to change it the way you want it to be.", character: "Naruto Uzumaki", anime: "Naruto" },
  { quote: "The ticket to the future is always open.", character: "Vash the Stampede", anime: "Trigun" },
  { quote: "I don't want to conquer anything. I just think the guy with the most freedom in this whole ocean is the Pirate King!", character: "Monkey D. Luffy", anime: "One Piece" },
  { quote: "It's just pathetic to give up on something before you even give it a shot.", character: "Reiko Mikami", anime: "Another" },
  { quote: "If you can't find a reason to fight, then you shouldn't be fighting.", character: "Akame", anime: "Akame ga Kill" },
  { quote: "We are all like fireworks: we climb, we shine and always go our separate ways and become further apart.", character: "Hitsugaya Toshiro", anime: "Bleach" },
  { quote: "Life is not a game of luck. If you wanna win, work hard.", character: "Sora", anime: "No Game No Life" },
  { quote: "Whatever you lose, you'll find it again. But what you throw away you'll never get back.", character: "Kenshin Himura", anime: "Rurouni Kenshin" },
  { quote: "Don't live life making excuses. The one making your choices is yourself!", character: "Mugen", anime: "Samurai Champloo" },
  { quote: "A person grows up when he's able to overcome hardships. Protection is important, but there are some things that a person must learn on his own.", character: "Jiraiya", anime: "Naruto" },
  { quote: "If you don't share someone's pain, you can never understand them.", character: "Nagato", anime: "Naruto" },
  { quote: "The moment you think of giving up, think of the reason why you held on so long.", character: "Natsu Dragneel", anime: "Fairy Tail" },
  { quote: "Being weak is nothing to be ashamed of. Staying weak is.", character: "Fuegoleon Vermillion", anime: "Black Clover" },
  { quote: "Even if we forget the faces of our friends, we will never forget the bonds that were carved into our souls.", character: "Otonashi Yuzuru", anime: "Angel Beats" }
];

export const animequote = {
  data: {
    name: 'animequote',
    description: 'Get an inspirational anime quote',
  },
  
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const randomQuote = LEGENDARY_QUOTES[Math.floor(Math.random() * LEGENDARY_QUOTES.length)]!;
    
    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle('⚡ Anime Quote')
      .setDescription(`*"${randomQuote.quote}"*`)
      .addFields([
        { name: '🎭 Character', value: randomQuote.character, inline: true },
        { name: '📺 Anime', value: randomQuote.anime, inline: true }
      ])
      .setFooter({ text: 'Such inspiring words! 💛' })
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
  },
};

