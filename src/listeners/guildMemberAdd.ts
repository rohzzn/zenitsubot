import type { Client, GuildMember } from 'discord.js';
import { AttachmentBuilder, PermissionFlagsBits } from 'discord.js';
import { logger } from '../services/logger.js';
import { getPrisma } from '../services/db.js';
import { welcomeCardFor } from '../services/welcomeCard.js';

/**
 * Somebody joined.
 *
 * Requires the Server Members privileged intent. Without it this listener is
 * registered and simply never fires — Discord does not send the event at all —
 * so a silent welcome channel is almost always that intent being off in the
 * Developer Portal rather than anything here being wrong.
 */
export function registerGuildMemberAddListener(client: Client): void {
  client.on('guildMemberAdd', async (member) => {
    // Deliberately parallel and independent. A missing role must not stop the
    // welcome, and a failed image must not stop the role.
    await Promise.allSettled([assignAutoRole(member), postWelcome(member)]);
  });
}

async function config(guildId: string) {
  return getPrisma()
    .guildConfig.findUnique({ where: { guildId } })
    .catch(() => null);
}

async function assignAutoRole(member: GuildMember): Promise<void> {
  const settings = await config(member.guild.id);
  if (!settings?.autoRoleEnabled || !settings.autoRoleId) return;

  const role = member.guild.roles.cache.get(settings.autoRoleId);

  if (!role) {
    logger.warn({ guild: member.guild.id }, 'Auto-role is set to a role that no longer exists');
    return;
  }

  const me = member.guild.members.me;

  // Checked rather than caught: Discord's error for this is opaque, and the
  // cause is nearly always the role sitting above the bot's own.
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    logger.warn({ guild: member.guild.id }, 'Auto-role set but I lack Manage Roles');
    return;
  }
  if (role.position >= me.roles.highest.position) {
    logger.warn(
      { guild: member.guild.id, role: role.name },
      'Auto-role is above my highest role, so I cannot assign it',
    );
    return;
  }

  await member.roles
    .add(role, 'Automatic role on join')
    .catch((err) => logger.warn({ err, guild: member.guild.id }, 'Could not assign auto-role'));
}

async function postWelcome(member: GuildMember): Promise<void> {
  const settings = await config(member.guild.id);
  if (!settings?.welcomeEnabled || !settings.welcomeChannelId) return;

  const channel = member.guild.channels.cache.get(settings.welcomeChannelId);
  if (!channel?.isSendable()) {
    logger.warn({ guild: member.guild.id }, 'Welcome channel is missing or unwritable');
    return;
  }

  try {
    if (settings.welcomeCard) {
      const card = await welcomeCardFor(member);

      if (card) {
        // The mention rides as content so the new member actually gets pinged;
        // an image alone notifies nobody. Restricted to that one user so a
        // welcome can never mass-ping.
        await channel.send({
          content: settings.welcomeMessage ? undefined : `${member}`,
          files: [new AttachmentBuilder(card, { name: 'welcome.png' })],
          allowedMentions: { users: [member.id] },
        });
        return;
      }
    }

    // No card, or rendering failed: a line of text still greets them.
    const text = (settings.welcomeMessage ?? 'Welcome {user} to {server}.')
      .replace(/\{user\}/g, `${member}`)
      .replace(/\{name\}/g, member.displayName)
      .replace(/\{server\}/g, member.guild.name)
      .replace(/\{count\}/g, String(member.guild.memberCount));

    await channel.send({ content: text, allowedMentions: { users: [member.id] } });
  } catch (err) {
    logger.warn({ err, guild: member.guild.id }, 'Could not post welcome');
  }
}
