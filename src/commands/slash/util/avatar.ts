import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { card, paragraph, gallery, caption, v2 } from '../../../utils/layout.js';

export const avatar = {
  data: { name: 'avatar' },

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const target = interaction.options.getUser('user') ?? interaction.user;

    // Animated avatars are gifs; asking for png would freeze them.
    const extension = target.avatar?.startsWith('a_') ? ('gif' as const) : ('png' as const);
    const full = target.displayAvatarURL({ size: 1024, extension });

    const container = card().addTextDisplayComponents(paragraph(`## ${target.tag}`));

    // A gallery rather than an embed image: it opens full size on click and
    // does not get letterboxed into the embed's aspect ratio.
    const image = gallery([full]);
    if (image) container.addMediaGalleryComponents(image);

    // Downloading the avatar is most of why anyone runs this.
    container.addTextDisplayComponents(
      paragraph(
        [512, 1024, 4096]
          .map(
            (size) => `[${size}px](${target.displayAvatarURL({ size: size as 512, extension })})`,
          )
          .join(' · '),
      ),
    );

    if (extension === 'gif') container.addTextDisplayComponents(caption('Animated avatar.'));

    await interaction.reply(v2([container]));
  },
};
