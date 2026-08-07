import type { Client, MessageComponentInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { loadState, saveState } from '../services/componentState.js';
import { isBlacklisted } from '../services/blacklist.js';
import { explain } from '../utils/errors.js';
import { logger } from '../services/logger.js';

/**
 * One persistent listener for every button and select menu in the bot.
 *
 * Commands used to attach their own collector, which meant their controls only
 * worked while the process that created them was alive. Routing centrally on
 * the custom id instead means a click is handled by whatever process is running
 * now, and the state comes from the database rather than a closure.
 *
 * Custom ids read `kind:action` with optional colon-separated arguments after
 * it. Discord caps them at 100 characters, so arguments carry indices and
 * short tokens; anything larger belongs in the state payload.
 */

export interface ComponentContext<T> {
  interaction: MessageComponentInteraction;
  action: string;
  /** Arguments split on the delimiter. Right for indices and single tokens. */
  args: string[];
  /**
   * Everything after the action, delimiters intact.
   *
   * Some tokens contain a colon of their own — `res:1080p` is one — and reading
   * `args[0]` for those silently yields `res`, which matches nothing. Use this
   * whenever the argument is one opaque value rather than a list.
   */
  rest: string;
  state: T;
  /** Persists the next state under the same message. */
  save: (next: T) => Promise<void>;
}

export interface ComponentHandler<T = unknown> {
  kind: string;
  /**
   * How long the controls keep working.
   *
   * This replaces the old five-minute collector window, and there is no reason
   * to be stingy: the row is small and a message that is still on screen should
   * still respond.
   */
  ttlMs: number;
  /** Shown when the state is gone. Should tell the reader how to get it back. */
  expiredMessage: string;
  /** Anyone may click, not just the person who ran the command. */
  shared?: boolean;
  handle: (ctx: ComponentContext<T>) => Promise<void>;
}

/**
 * The registry is type-erased: each handler knows the shape of its own payload
 * and no caller can know all of them at once. The cast is contained here, and
 * the row's `kind` is what guarantees a handler only ever sees its own state.
 */
const handlers = new Map<string, ComponentHandler<unknown>>();

export function registerComponentHandler<T>(handler: ComponentHandler<T>): void {
  handlers.set(handler.kind, handler as unknown as ComponentHandler<unknown>);
}

/** Builds a custom id the router can parse. */
export function componentId(kind: string, action: string, ...args: Array<string | number>): string {
  const id = [kind, action, ...args.map(String)].join(':');

  if (id.length > 100) {
    // Silently truncating produces a control that looks fine and does the wrong
    // thing, which is worse than a loud failure during development.
    throw new Error(`Custom id too long (${id.length}): ${id}`);
  }
  return id;
}

async function deny(interaction: MessageComponentInteraction, message: string): Promise<void> {
  await interaction
    .reply({ content: message, flags: MessageFlags.Ephemeral })
    .catch(() => interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }))
    .catch(() => {});
}

export function registerComponentRouter(client: Client): void {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isMessageComponent()) return;

    const [kind, action, ...args] = interaction.customId.split(':');
    if (!kind || !action) return;

    const handler = handlers.get(kind);
    if (!handler) return; // Not ours — the music and blackjack routers may want it.

    if (isBlacklisted(interaction.user.id, interaction.guildId)) {
      await deny(interaction, 'You do not have access to this bot.');
      return;
    }

    const state = await loadState<unknown>(interaction.message.id, kind);
    if (!state) {
      await deny(interaction, handler.expiredMessage);
      return;
    }

    if (!handler.shared && state.ownerId !== interaction.user.id) {
      await deny(interaction, 'These controls belong to someone else. Run the command yourself.');
      return;
    }

    try {
      await handler.handle({
        interaction,
        action,
        args,
        rest: args.join(':'),
        state: state.payload,
        save: (next) => saveState(interaction.message.id, kind, state.ownerId, next, handler.ttlMs),
      });
    } catch (err) {
      const explained = explain(err, { component: kind, action });
      logger.warn({ kind, action }, 'Component handler failed');
      await deny(interaction, explained.message);
    }
  });
}

/**
 * Records the state for a message that was just sent with components.
 *
 * Call this immediately after the reply — the message id does not exist before
 * then, and until the row is written the controls are dead.
 */
export async function attachState<T>(
  messageId: string,
  handler: ComponentHandler<T>,
  ownerId: string,
  payload: T,
): Promise<void> {
  await saveState(messageId, handler.kind, ownerId, payload, handler.ttlMs);
}
