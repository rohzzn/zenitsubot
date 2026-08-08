import type { Client, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import {
  card,
  paragraph,
  divider,
  caption,
  facts,
  v2,
  v2Update,
  type Block,
} from '../../../utils/layout.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { UserError } from '../../../utils/errors.js';
import { shoukaku } from '../../../music/lavalink.js';
import { isVoiceServiceUp, listVoices, warmUp } from '../../../services/voice.js';
import { activeVoiceModel } from '../../../services/ai.js';
import {
  TalkSession,
  activeSession,
  clearSession,
  registerSession,
} from '../../../services/talkSession.js';
import {
  attachState,
  componentId,
  registerComponentHandler,
  type ComponentHandler,
} from '../../../listeners/componentRouter.js';

const KIND = 'talk';
const HOUR_MS = 60 * 60 * 1000;

interface TalkState {
  guildId: string;
}

function sessionCard(options: {
  channelName: string;
  model: string;
  voice: string;
  lines: string[];
  ended?: boolean;
}): Block[] {
  const container = card(options.ended ? ZENITSU_THEME.ERROR : ZENITSU_THEME.SUCCESS);

  container.addTextDisplayComponents(
    paragraph(
      options.ended
        ? `## Conversation ended\nLeft ${options.channelName}.`
        : `## Listening in ${options.channelName}\nJust talk. I answer out loud.`,
    ),
  );

  container.addSeparatorComponents(divider());
  container.addTextDisplayComponents(
    paragraph(
      facts([
        ['Model', options.model],
        ['Voice', options.voice],
        ['Hears', 'only you'],
      ]),
    ),
  );

  // A running transcript, because a voice conversation otherwise leaves no
  // record of what was said or what the bot thought it heard — which is also
  // the fastest way to tell a mishearing from a bad answer.
  if (options.lines.length) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(paragraph(options.lines.slice(-8).join('\n')));
  }

  if (!options.ended) {
    container.addTextDisplayComponents(
      caption('Speech is transcribed on this machine and never leaves it. Replies use OpenRouter.'),
    );
  }

  const blocks: Block[] = [container];

  if (!options.ended) {
    blocks.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(componentId(KIND, 'stop'))
          .setLabel('End conversation')
          .setStyle(ButtonStyle.Danger),
      ),
    );
  }

  return blocks;
}

const handler: ComponentHandler<TalkState> = {
  kind: KIND,
  ttlMs: HOUR_MS,
  expiredMessage: 'That conversation has already ended.',

  async handle({ interaction, action, state }) {
    if (action !== 'stop') return;

    activeSession(state.guildId)?.stop('you ended it');
    clearSession(state.guildId);

    await interaction.update(
      v2Update(
        sessionCard({
          channelName: 'the voice channel',
          model: '-',
          voice: '-',
          lines: [],
          ended: true,
        }),
      ),
    );
  },
};

registerComponentHandler(handler);

export const talk = {
  data: { name: 'talk' },
  category: 'ai',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.member as GuildMember | null;
    const channel = member?.voice.channel;

    if (!channel) throw new UserError('Join a voice channel first.');
    if (!interaction.guildId) throw new UserError('This only works in a server.');

    if (activeSession(interaction.guildId)) {
      throw new UserError('A conversation is already running in this server.');
    }

    // Lavalink holds the guild's voice connection and will not share it.
    if (shoukaku?.connections.get(interaction.guildId)) {
      throw new UserError(
        'Music is playing. Stop it with `/stop` first — the two share one voice connection.',
      );
    }

    await interaction.deferReply();

    if (!(await isVoiceServiceUp())) {
      throw new UserError(
        'The speech models are not running.\n' +
          'Start them on the Mac with `npm run voice`, then try again. ' +
          'They run outside Docker because containers on macOS cannot reach the GPU.',
      );
    }

    // Warmed while joining, not on the first question. Cold, the first reply
    // takes about twenty seconds; warm, about two.
    const [model, voices] = await Promise.all([activeVoiceModel(), listVoices(), warmUp()]);
    const chosen = interaction.options.getString('voice') ?? voices[0] ?? 'af_heart';

    const lines: string[] = [];
    let message: { id: string } | undefined;

    const redraw = () => {
      void interaction
        .editReply(
          v2Update(sessionCard({ channelName: channel.name, model, voice: chosen, lines })),
        )
        .catch(() => {});
    };

    const session = new TalkSession(channel, member, chosen, {
      onTranscript: (text) => {
        lines.push(`**You:** ${text}`);
        redraw();
      },
      onReply: (text) => {
        lines.push(`**Bot:** ${text}`);
        redraw();
      },
      onError: (message) => {
        lines.push(`-# ${message}`);
        redraw();
      },
      onEnd: (reason) => {
        clearSession(interaction.guildId!);
        void interaction
          .editReply(
            v2Update(
              sessionCard({
                channelName: channel.name,
                model,
                voice: chosen,
                lines: [...lines, `-# Ended: ${reason}`],
                ended: true,
              }),
            ),
          )
          .catch(() => {});
      },
    });

    try {
      await session.start();
    } catch (err) {
      throw new UserError(`Could not join ${channel.name}: ${(err as Error).message}`);
    }

    registerSession(session);

    message = await interaction.editReply(
      v2Update(sessionCard({ channelName: channel.name, model, voice: chosen, lines })),
    );

    await attachState(message.id, handler, interaction.user.id, { guildId: interaction.guildId });
  },
};

export const talkStop = {
  data: { name: 'untalk' },
  category: 'ai',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const session = interaction.guildId ? activeSession(interaction.guildId) : undefined;
    if (!session) throw new UserError('No conversation is running.');

    session.stop('you ended it');
    clearSession(interaction.guildId!);

    await interaction.reply({
      content: 'Conversation ended.',
      flags: MessageFlags.Ephemeral,
    });
  },
};

/** Voice names come from the running server, so the list is never stale. */
Object.assign(talk, {
  async autocomplete(interaction: import('discord.js').AutocompleteInteraction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const voices = await listVoices();

    await interaction.respond(
      voices
        .filter((name) => name.includes(typed))
        .slice(0, 25)
        .map((name) => ({ name, value: name })),
    );
  },
});
