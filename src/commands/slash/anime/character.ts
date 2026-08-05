import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';

export const animecharacter = {
  data: {
    name: 'animecharacter',
    description: 'Search for anime characters',
  },

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const query = interaction.options.getString('name', true);

    await interaction.deferReply();

    try {
      const response = await fetch(
        `https://api.jikan.moe/v4/characters?q=${encodeURIComponent(query)}&limit=5&order_by=favorites&sort=desc`,
      );

      if (!response.ok) {
        await interaction.editReply('Failed to search characters.');
        return;
      }

      const data: any = await response.json();

      if (!data?.data || data.data.length === 0) {
        await interaction.editReply(`No character found for"${query}"`);
        return;
      }

      const character: any = data.data[0];

      // Get full character details
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Rate limit
      const detailsResponse = await fetch(
        `https://api.jikan.moe/v4/characters/${character.mal_id}/full`,
      );
      const details: any = await detailsResponse.json();
      const fullChar = details.data;

      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(fullChar.name)
        .setURL(fullChar.url)
        .setDescription(
          (fullChar.about?.substring(0, 600) || 'No description available.') +
            (fullChar.about && fullChar.about.length > 600 ? '...' : ''),
        )
        .addFields([
          { name: 'Favorites', value: fullChar.favorites?.toLocaleString() || '0', inline: true },
          { name: 'MAL ID', value: fullChar.mal_id.toString(), inline: true },
        ])
        .setImage(fullChar.images.jpg.image_url)
        .setTimestamp();

      // Add anime appearances
      if (fullChar.anime && fullChar.anime.length > 0) {
        const animeList = fullChar.anime
          .slice(0, 5)
          .map((a: any) => `• [${a.anime.title}](${a.anime.url}) (${a.role})`)
          .join('\n');

        embed.addFields({
          name: 'Appears in',
          value: animeList,
        });
      }

      // Add voice actors
      if (fullChar.voices && fullChar.voices.length > 0) {
        const voices = fullChar.voices
          .slice(0, 3)
          .map((v: any) => `• ${v.person.name} (${v.language})`)
          .join('\n');

        embed.addFields({
          name: 'Voice Actors',
          value: voices,
        });
      }

      // Show other results
      let otherResults = '';
      if (data.data.length > 1) {
        otherResults =
          '\n**Other Results:**\n' +
          data.data
            .slice(1, 4)
            .map(
              (c: any, i: number) =>
                `${i + 2}. [${c.name}](${c.url}) - ${c.favorites?.toLocaleString() || 0}`,
            )
            .join('\n');
      }

      embed.setFooter({ text: 'MyAnimeList' });

      await interaction.editReply({
        content: otherResults || undefined,
        embeds: [embed],
      });
    } catch (err: any) {
      console.error('Character search error:', err);
      await interaction.editReply('Error searching character. Please try again.');
    }
  },
};
