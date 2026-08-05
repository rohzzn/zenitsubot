import type {
  Client,
  MessageReaction,
  PartialMessageReaction,
  User,
  PartialUser,
} from 'discord.js';
import { getPrisma } from '../services/db.js';
import { logger } from '../services/logger.js';

/** Reaction events report custom emoji by id and unicode emoji by character. */
function emojiKey(reaction: MessageReaction | PartialMessageReaction): string {
  return reaction.emoji.id ?? reaction.emoji.name ?? '';
}

async function applyRole(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  add: boolean,
) {
  if (user.bot) return;

  try {
    // Reactions on messages from before the bot started arrive partial.
    if (reaction.partial) await reaction.fetch();

    const guildId = reaction.message.guildId;
    if (!guildId) return;

    const binding = await getPrisma().reactionRole.findUnique({
      where: { messageId_emoji: { messageId: reaction.message.id, emoji: emojiKey(reaction) } },
    });
    if (!binding) return;

    const guild = reaction.client.guilds.cache.get(guildId);
    const member = await guild?.members.fetch(user.id).catch(() => null);
    if (!member) return;

    if (add) await member.roles.add(binding.roleId);
    else await member.roles.remove(binding.roleId);
  } catch (err) {
    logger.warn({ err, user: user.id }, 'Reaction role update failed');
  }
}

export function registerReactionRoleListener(client: Client) {
  client.on('messageReactionAdd', (reaction, user) => void applyRole(reaction, user, true));
  client.on('messageReactionRemove', (reaction, user) => void applyRole(reaction, user, false));
}
