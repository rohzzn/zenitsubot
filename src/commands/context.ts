import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  MessageFlags,
  SectionBuilder,
  type Client,
  type GuildMember,
  type MessageContextMenuCommandInteraction,
  type RESTPostAPIContextMenuApplicationCommandsJSONBody,
  type UserContextMenuCommandInteraction,
} from 'discord.js';
import { ZENITSU_THEME } from '../utils/constants.js';
import { card, withThumbnail, paragraph, divider, facts, v2 } from '../utils/layout.js';
import { UserError } from '../utils/errors.js';
import { runInspect } from './slash/util/inspect.js';

/**
 * Right-click commands.
 *
 * These exist because the two things people most often want are already on
 * screen when they want them: a link someone posted, and the person who posted
 * it. Typing a command to name something you are looking at is friction with
 * nothing on the other side of it.
 */

export interface ContextMenuDefinition {
  builder: { toJSON(): RESTPostAPIContextMenuApplicationCommandsJSONBody };
  name: string;
  execute: (
    client: Client,
    interaction: MessageContextMenuCommandInteraction | UserContextMenuCommandInteraction,
  ) => Promise<void>;
}

/** Discord's own link grammar, near enough: stop at whitespace and angle brackets. */
const URL_PATTERN = /https?:\/\/[^\s<>"')]+/gi;

const inspectLinks: ContextMenuDefinition = {
  name: 'Inspect links',
  builder: new ContextMenuCommandBuilder()
    .setName('Inspect links')
    .setType(ApplicationCommandType.Message),

  async execute(_client, interaction) {
    const message = (interaction as MessageContextMenuCommandInteraction).targetMessage;

    // Embed URLs count: a link posted as an embed is still a link in the message.
    const found = [
      ...(message.content.match(URL_PATTERN) ?? []),
      ...message.embeds.map((embed) => embed.url).filter((url): url is string => Boolean(url)),
    ];

    const unique = [...new Set(found)];
    if (unique.length === 0) throw new UserError('That message has no links in it.');

    // The shared entry point, not a reimplementation: runInspect owns the
    // address checks, and a second path that forgot them would be a hole.
    await runInspect(interaction, unique[0]!);
  },
};

const userInfo: ContextMenuDefinition = {
  name: 'User info',
  builder: new ContextMenuCommandBuilder()
    .setName('User info')
    .setType(ApplicationCommandType.User),

  async execute(_client, interaction) {
    const target = interaction as UserContextMenuCommandInteraction;
    const member = target.targetMember as GuildMember | null;
    const account = target.targetUser;

    const roles = member
      ? member.roles.cache
          .filter((role) => role.id !== interaction.guildId)
          .sort((a, b) => b.position - a.position)
      : null;

    const container = card(member?.displayColor || ZENITSU_THEME.PRIMARY);

    const heading = withThumbnail(
      `## ${account.tag}${account.bot ? ' · bot' : ''}\n${member?.nickname ?? account.displayName}`,
      account.displayAvatarURL({ size: 256, extension: 'png' }),
    );
    if (heading instanceof SectionBuilder) container.addSectionComponents(heading);
    else container.addTextDisplayComponents(heading);

    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(
      paragraph(
        facts([
          ['ID', account.id],
          ['Highest role', roles?.first()?.name ?? '-'],
          ['Roles', roles ? String(roles.size) : '-'],
        ]),
      ),
    );

    const created = Math.floor(account.createdTimestamp / 1000);
    const joined = member?.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;

    container.addTextDisplayComponents(
      paragraph(
        `${joined ? `**Joined**  <t:${joined}:D> (<t:${joined}:R>)\n` : ''}` +
          `**Created**  <t:${created}:D> (<t:${created}:R>)`,
      ),
    );

    // Private by default: this is usually a quick check on someone, and the
    // channel does not need a card about them every time.
    await interaction.reply({ ...v2([container]), flags: MessageFlags.Ephemeral });
  },
};

export const CONTEXT_MENUS: ContextMenuDefinition[] = [inspectLinks, userInfo];
