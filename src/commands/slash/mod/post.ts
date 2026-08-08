import type { Client, ChatInputCommandInteraction, GuildTextBasedChannel, Role } from 'discord.js';
import { ChannelType, MessageFlags, PermissionFlagsBits, SectionBuilder } from 'discord.js';
import {
  card,
  paragraph,
  divider,
  gap,
  caption,
  gallery,
  withThumbnail,
  v2Update,
  type Block,
} from '../../../utils/layout.js';
import { UserError } from '../../../utils/errors.js';
import { previewLink, type LinkPreview } from '../../../services/linkPreview.js';

/**
 * Announcing something you posted somewhere else.
 *
 * The card is built from the link rather than typed out, because the useful
 * version of "just uploaded, check it out" is the one that shows the thumbnail
 * and the title without anybody having to paste them.
 */

/** Where the announcement is allowed to go. */
const POSTABLE = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.AnnouncementThread,
] as const;

/**
 * The announcement itself.
 *
 * Laid out so the eye lands on the thumbnail first, then the message, then the
 * link — which is the order people actually care about. The role ping sits
 * outside the card as plain content, because a mention inside a component does
 * not notify anyone.
 */
function announcement(options: {
  preview: LinkPreview;
  message: string;
  author: string;
  authorIcon?: string;
}): Block[] {
  const { preview, message } = options;
  const container = card(preview.accent);

  // Headline names what this is — "New video", "Live now" — so the card reads
  // as an announcement rather than as a link someone dropped.
  const heading = withThumbnail(
    `## ${preview.headline}\n${message}`,
    // The creator's avatar rather than the thumbnail: the big image goes in
    // the gallery below, and a duplicate would waste the width.
    options.authorIcon,
  );
  if (heading instanceof SectionBuilder) container.addSectionComponents(heading);
  else container.addTextDisplayComponents(heading);

  const image = gallery([preview.image]);
  if (image) {
    container.addSeparatorComponents(gap());
    container.addMediaGalleryComponents(image);
  }

  container.addSeparatorComponents(divider());

  if (preview.title) {
    container.addTextDisplayComponents(
      paragraph(
        `**[${preview.title.slice(0, 200)}](${preview.url})**` +
          (preview.author ? `\n-# ${preview.author}` : ''),
      ),
    );
  } else {
    // No metadata came back — X and Instagram routinely refuse. The link is
    // still the point, so it is shown plainly rather than dressed up.
    container.addTextDisplayComponents(paragraph(`**[${preview.url}](${preview.url})**`));
  }

  if (preview.description && preview.description.length > 20) {
    container.addTextDisplayComponents(paragraph(`-# ${preview.description.slice(0, 300)}`));
  }

  container.addTextDisplayComponents(caption(`Posted by ${options.author}`));

  return [container];
}

export const post = {
  data: { name: 'post' },
  category: 'moderation',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const channel = interaction.options.getChannel('channel', true);
    const link = interaction.options.getString('link', true);
    const message = interaction.options.getString('message', true);
    const role = interaction.options.getRole('ping') as Role | null;

    if (!POSTABLE.includes(channel.type as (typeof POSTABLE)[number])) {
      throw new UserError('Pick a text or announcement channel.');
    }

    const target = channel as GuildTextBasedChannel;

    // Checked before the work rather than after: fetching a preview and then
    // discovering the bot cannot post wastes several seconds of someone's time.
    const me = interaction.guild?.members.me;
    const permissions = me ? target.permissionsFor(me) : null;

    if (!permissions?.has(PermissionFlagsBits.SendMessages)) {
      throw new UserError(`I cannot send messages in ${target}.`);
    }
    if (role && !permissions.has(PermissionFlagsBits.MentionEveryone) && !role.mentionable) {
      throw new UserError(
        `**${role.name}** is not mentionable and I lack permission to mention it anyway. ` +
          'Either make the role mentionable in its settings, or give me Mention Everyone.',
      );
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const preview = await previewLink(link);

    const blocks = announcement({
      preview,
      message: message.slice(0, 1500),
      author: interaction.user.displayName,
      authorIcon: interaction.user.displayAvatarURL({ size: 128, extension: 'png' }),
    });

    // The ping is plain content outside the card. A role mention inside a
    // component renders as text and notifies nobody, which is the single
    // easiest way for an announcement to silently not announce anything.
    const sent = await target.send({
      ...v2Update(blocks),
      content: role ? `${role}` : undefined,
      allowedMentions: role ? { roles: [role.id] } : { parse: [] },
    });

    const notes: string[] = [];
    if (preview.sparse) {
      notes.push(
        `${new URL(preview.url).hostname.replace(/^www\./, '')} did not return any preview data, ` +
          'so the card shows your message and the link. That site usually requires a login to read.',
      );
    }

    await interaction.editReply(
      v2Update([
        card(preview.accent)
          .addTextDisplayComponents(
            paragraph(`## Posted\nIn ${target} — [jump to it](${sent.url})`),
          )
          .addTextDisplayComponents(
            paragraph(
              `**${preview.headline}**${preview.title ? ` · ${preview.title.slice(0, 80)}` : ''}` +
                (role ? `\n-# Pinged ${role.name}` : '\n-# No role pinged'),
            ),
          )
          .addTextDisplayComponents(notes.length ? caption(notes.join(' ')) : caption('​')),
      ]),
    );
  },
};
