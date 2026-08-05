import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { logger } from '../../../services/logger.js';

// nekos.best is free and key-less. Each endpoint returns a random anime GIF
// plus the source anime's name, which we surface in the footer.
const API_BASE = 'https://nekos.best/api/v2';

interface Reaction {
  /** Slash command name, and the nekos.best endpoint it maps to. */
  name: string;
  /** Present tense verb used in the message, e.g. "hugs". */
  verb: string;
  /** Shown when the command is used without a target. */
  solo: string;
}

const REACTIONS: Reaction[] = [
  { name: 'hug', verb: 'hugs', solo: 'hugs themselves' },
  { name: 'kiss', verb: 'kisses', solo: 'blows a kiss to the void' },
  { name: 'cuddle', verb: 'cuddles', solo: 'cuddles a pillow' },
  { name: 'pat', verb: 'pats', solo: 'pats themselves on the head' },
  { name: 'slap', verb: 'slaps', solo: 'slaps the air' },
  { name: 'punch', verb: 'punches', solo: 'punches the air' },
];

async function fetchGif(endpoint: string): Promise<{ url: string; animeName?: string } | null> {
  const response = await fetch(`${API_BASE}/${endpoint}`);
  if (!response.ok) return null;

  const data = (await response.json()) as {
    results?: Array<{ url?: string; anime_name?: string }>;
  };
  const result = data.results?.[0];
  if (!result?.url) return null;

  return { url: result.url, animeName: result.anime_name };
}

function buildReactionCommand(reaction: Reaction) {
  return {
    data: { name: reaction.name },
    category: 'fun',

    async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
      const target = interaction.options.getUser('user');
      await interaction.deferReply();

      try {
        const gif = await fetchGif(reaction.name);
        if (!gif) {
          await interaction.editReply(
            `Could not find a ${reaction.name} GIF right now. Try again!`,
          );
          return;
        }

        const actor = interaction.user.username;
        const description =
          !target || target.id === interaction.user.id
            ? `**${actor}** ${reaction.solo}!`
            : `**${actor}** ${reaction.verb} **${target.username}**!`;

        const embed = new EmbedBuilder()
          .setColor(ZENITSU_THEME.PRIMARY)
          .setDescription(description)
          .setImage(gif.url)
          .setFooter({ text: gif.animeName ? `From ${gif.animeName} • nekos.best` : 'nekos.best' })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        logger.error({ err, reaction: reaction.name }, 'Reaction command failed');
        await interaction
          .editReply(`Failed to get a ${reaction.name} GIF. Try again!`)
          .catch(() => {});
      }
    },
  };
}

export const reactionCommands = REACTIONS.map(buildReactionCommand);
export const REACTION_NAMES = REACTIONS.map((r) => r.name);
