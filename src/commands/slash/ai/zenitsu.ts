import type { Client, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import {
  card,
  paragraph,
  divider,
  caption,
  facts,
  v2Update,
  type Block,
} from '../../../utils/layout.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { UserError } from '../../../utils/errors.js';
import { shoukaku } from '../../../music/lavalink.js';
import { isVoiceServiceUp, warmUp } from '../../../services/voice.js';
import { GEMINI_LIVE_MODEL } from '../../../services/geminiLive.js';
import {
  ZenitsuVoice,
  activeZenitsu,
  clearZenitsu,
  registerZenitsu,
} from '../../../services/zenitsuVoice.js';
import { forgetEverything, loadMemory } from '../../../services/voiceMemory.js';
import {
  attachState,
  componentId,
  registerComponentHandler,
  type ComponentHandler,
} from '../../../listeners/componentRouter.js';

const KIND = 'zen';
const HOUR_MS = 60 * 60 * 1000;
/** Lines of conversation kept on the status card. */
const LOG_LINES = 10;

interface ZenState {
  guildId: string;
}

function statusCard(options: {
  channelName: string;
  state: string;
  log: string[];
  left?: boolean;
}): Block[] {
  const container = card(options.left ? ZENITSU_THEME.ERROR : ZENITSU_THEME.SUCCESS);

  container.addTextDisplayComponents(
    paragraph(
      options.left
        ? `## Left ${options.channelName}`
        : `## In ${options.channelName}\nTalk normally. Say **Zenitsu** when you want me.`,
    ),
  );

  container.addSeparatorComponents(divider());
  container.addTextDisplayComponents(
    paragraph(
      facts([
        ['Status', options.state],
        ['Model', GEMINI_LIVE_MODEL],
        ['Wake word', 'Zenitsu'],
      ]),
    ),
  );

  if (options.log.length) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(paragraph(options.log.slice(-LOG_LINES).join('\n')));
  }

  if (!options.left) {
    container.addTextDisplayComponents(
      caption(
        'Everything is transcribed on this machine first. Only what follows your wake word is sent on.',
      ),
    );
  }

  const blocks: Block[] = [container];

  if (!options.left) {
    blocks.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(componentId(KIND, 'leave'))
          .setLabel('Leave')
          .setStyle(ButtonStyle.Danger),
      ),
    );
  }

  return blocks;
}

const handler: ComponentHandler<ZenState> = {
  kind: KIND,
  ttlMs: HOUR_MS,
  expiredMessage: 'That session has already ended.',

  async handle({ interaction, action, state }) {
    if (action !== 'leave') return;

    activeZenitsu(state.guildId)?.leave('you asked');
    clearZenitsu(state.guildId);

    await interaction.update(
      v2Update(statusCard({ channelName: 'the channel', state: 'left', log: [], left: true })),
    );
  },
};

registerComponentHandler(handler);

export const zenitsu = {
  data: { name: 'zenitsu' },
  category: 'ai',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand(false) ?? 'join';
    const guildId = interaction.guildId;
    if (!guildId) throw new UserError('This only works in a server.');

    if (subcommand === 'leave') {
      const session = activeZenitsu(guildId);
      if (!session) throw new UserError('I am not in a voice channel.');

      session.leave('you asked');
      clearZenitsu(guildId);

      await interaction.reply({ content: 'Left the channel.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (subcommand === 'memory') {
      const memory = await loadMemory(interaction.user.id, interaction.user.displayName);

      const container = card().addTextDisplayComponents(
        paragraph(
          `## What I remember about you\n${
            memory.returning
              ? `We have talked ${memory.turns} time${memory.turns === 1 ? '' : 's'}.`
              : 'We have not talked in voice yet.'
          }`,
        ),
      );

      if (memory.facts.length) {
        container.addSeparatorComponents(divider());
        container.addTextDisplayComponents(
          paragraph(facts(memory.facts.map((f) => [f.topic, f.fact]))),
        );
      }

      if (memory.recent.length) {
        container.addSeparatorComponents(divider());
        container.addTextDisplayComponents(
          paragraph(
            `**Recently**\n${memory.recent.map((r) => `- ${r.spoke || r.answered}`).join('\n')}`,
          ),
        );
      }

      await interaction.reply({
        ...v2Update([container]),
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      });
      return;
    }

    if (subcommand === 'forget') {
      await forgetEverything(interaction.user.id);
      await interaction.reply({
        content: 'Forgotten. I no longer know anything about you.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // join
    const member = interaction.member as GuildMember | null;
    const channel = member?.voice.channel;

    if (!channel) throw new UserError('Join a voice channel first.');
    if (activeZenitsu(guildId)) throw new UserError('I am already in a channel here.');

    if (shoukaku?.connections.get(guildId)) {
      throw new UserError(
        'Music is playing. Stop it with `/stop` first — they share one connection.',
      );
    }

    await interaction.deferReply();

    if (!(await isVoiceServiceUp())) {
      throw new UserError(
        'The local speech models are not running, and they are what keeps ordinary conversation ' +
          'off the wire. Start them on the Mac with `npm run voice`, then try again.',
      );
    }

    // Warmed while joining. Cold, the first wake-word check takes seconds.
    await warmUp();

    const log: string[] = [];
    let state = 'listening';

    const redraw = () => {
      void interaction
        .editReply(v2Update(statusCard({ channelName: channel.name, state, log })))
        .catch(() => {});
    };

    const session = new ZenitsuVoice(channel, {
      onHeard: (name, text, addressed) => {
        // Unaddressed speech is shown greyed rather than hidden, so it is
        // obvious the wake word is being checked and nothing is being sent.
        log.push(addressed ? `**${name}:** ${text}` : `-# ${name}: ${text}`);
        redraw();
      },
      onReply: (text) => {
        log.push(`**Zenitsu:** ${text}`);
        redraw();
      },
      onTool: (tool, detail) => {
        log.push(`-# ${tool}: ${detail}`);
        redraw();
      },
      onState: (next) => {
        state = next;
        redraw();
      },
      onError: (message) => {
        log.push(`-# ${message}`);
        redraw();
      },
    });

    try {
      await session.join();
    } catch (err) {
      throw new UserError(`Could not join ${channel.name}: ${(err as Error).message}`);
    }

    registerZenitsu(session);

    const message = await interaction.editReply(
      v2Update(statusCard({ channelName: channel.name, state, log })),
    );

    await attachState(message.id, handler, interaction.user.id, { guildId });
  },
};
