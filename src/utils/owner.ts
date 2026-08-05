import type { ChatInputCommandInteraction } from 'discord.js';

/**
 * Owner-only gate for operator commands.
 *
 * OWNER_DISCORD_ID is optional in config, so an unset value must deny rather
 * than allow — otherwise a missing env var would expose operator commands to
 * every user.
 */
export function isOwner(userId: string): boolean {
  const ownerId = process.env.OWNER_DISCORD_ID;
  return Boolean(ownerId) && userId === ownerId;
}

/** Replies with a refusal and returns false when the caller is not the owner. */
export async function requireOwner(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (isOwner(interaction.user.id)) return true;

  await interaction.reply({
    content: 'This command is restricted to the bot owner.',
    ephemeral: true,
  });
  return false;
}
