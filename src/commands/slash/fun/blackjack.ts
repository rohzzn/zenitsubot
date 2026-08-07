import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';
import { UserError } from '../../../utils/errors.js';
import {
  attachState,
  componentId,
  registerComponentHandler,
  type ComponentHandler,
} from '../../../listeners/componentRouter.js';
import { clearState } from '../../../services/componentState.js';

const KIND = 'bj';
/**
 * A hand used to vanish after two minutes, and on every restart, while the
 * message kept showing Hit and Stand. A day is long enough that no one loses a
 * game to a deploy.
 */
const GAME_TTL_MS = 24 * 60 * 60 * 1000;

const MIN_BET = 10;
const MAX_BET = 10_000;

// Plain typographic suit glyphs — these render as monochrome text, not emoji.
const suits = ['♠', '♥', '♣', '♦'];
const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

interface Card {
  suit: string;
  value: string;
}

interface Game {
  deck: Card[];
  playerHand: Card[];
  dealerHand: Card[];
  bet: number;
  /** The stake actually at risk; a double-down puts up twice the original. */
  stake: number;
}

function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of suits) {
    for (const value of values) deck.push({ suit, value });
  }
  return deck.sort(() => Math.random() - 0.5);
}

function calculateHand(hand: Card[]): number {
  let total = 0;
  let aces = 0;

  for (const card of hand) {
    if (card.value === 'A') {
      aces++;
      total += 11;
    } else if (['J', 'Q', 'K'].includes(card.value)) {
      total += 10;
    } else {
      total += parseInt(card.value);
    }
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }

  return total;
}

function formatHand(hand: Card[]): string {
  return hand.map((c) => `${c.value}${c.suit}`).join(' ');
}

function controls(canDouble: boolean): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'hit'))
      .setLabel('Hit')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'stand'))
      .setLabel('Stand')
      .setStyle(ButtonStyle.Secondary),
  );

  // Doubling is only offered on the opening hand, which is when it is legal.
  if (canDouble) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(componentId(KIND, 'double'))
        .setLabel('Double Down')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  return row;
}

function inProgress(game: Game) {
  const embed = new EmbedBuilder()
    .setColor(ZENITSU_THEME.PRIMARY)
    .setTitle('Blackjack')
    .setDescription(`Bet: **${game.stake.toLocaleString()}** coins`)
    .addFields([
      {
        name: 'Your hand',
        value: `${formatHand(game.playerHand)}\nTotal: **${calculateHand(game.playerHand)}**`,
        inline: true,
      },
      {
        name: 'Dealer',
        value: `${game.dealerHand[0]!.value}${game.dealerHand[0]!.suit} [hidden]`,
        inline: true,
      },
    ]);

  return { embeds: [embed] };
}

function finished(game: Game, headline: string, colour: number) {
  const embed = new EmbedBuilder()
    .setColor(colour)
    .setTitle('Game over')
    .setDescription(headline)
    .addFields([
      {
        name: 'Your hand',
        value: `${formatHand(game.playerHand)}\nTotal: **${calculateHand(game.playerHand)}**`,
        inline: true,
      },
      {
        name: 'Dealer',
        value: `${formatHand(game.dealerHand)}\nTotal: **${calculateHand(game.dealerHand)}**`,
        inline: true,
      },
    ]);

  return { embeds: [embed], components: [] };
}

/**
 * Applies the outcome to the player's balance.
 *
 * `delta` is the change in coins: the stake won, the stake lost, or zero on a
 * push. Called exactly once per game, immediately before the state is cleared,
 * so a replayed click cannot settle the same hand twice.
 */
async function settle(userId: string, stake: number, delta: number): Promise<void> {
  await getPrisma().userEconomy.update({
    where: { userId },
    data: {
      coins: { increment: delta },
      totalWagered: { increment: stake },
      totalWon: { increment: delta > 0 ? delta : 0 },
      gamesPlayed: { increment: 1 },
    },
  });
}

const handler: ComponentHandler<Game> = {
  kind: KIND,
  ttlMs: GAME_TTL_MS,
  expiredMessage: 'That hand has expired. Start a new one with `/blackjack`.',

  async handle({ interaction, action, state: game, save }) {
    const userId = interaction.user.id;

    if (action === 'hit') {
      game.playerHand.push(game.deck.pop()!);

      if (calculateHand(game.playerHand) > 21) {
        await settle(userId, game.stake, -game.stake);
        await clearState(interaction.message.id);
        await interaction.update(
          finished(
            game,
            `Bust. Lost **${game.stake.toLocaleString()}** coins.`,
            ZENITSU_THEME.ERROR,
          ),
        );
        return;
      }

      // Doubling after taking a card is not a thing.
      await interaction.update({ ...inProgress(game), components: [controls(false)] });
      await save(game);
      return;
    }

    if (action !== 'stand' && action !== 'double') return;

    if (action === 'double') {
      const balance = await getPrisma().userEconomy.findUnique({ where: { userId } });

      // Checked now rather than at deal time: the balance can have moved since.
      if (!balance || balance.coins < game.stake * 2) {
        await interaction.reply({
          content: 'You cannot cover a double down any more.',
          ephemeral: true,
        });
        return;
      }

      game.stake *= 2;
      game.playerHand.push(game.deck.pop()!);
    }

    while (calculateHand(game.dealerHand) < 17) {
      game.dealerHand.push(game.deck.pop()!);
    }

    const player = calculateHand(game.playerHand);
    const dealer = calculateHand(game.dealerHand);

    const [headline, colour, delta] =
      player > 21
        ? [`Bust. Lost **${game.stake.toLocaleString()}** coins.`, ZENITSU_THEME.ERROR, -game.stake]
        : dealer > 21 || player > dealer
          ? [`You win **${game.stake.toLocaleString()}** coins.`, ZENITSU_THEME.SUCCESS, game.stake]
          : player < dealer
            ? [
                `Dealer wins. Lost **${game.stake.toLocaleString()}** coins.`,
                ZENITSU_THEME.ERROR,
                -game.stake,
              ]
            : ['Push. Your bet is returned.', ZENITSU_THEME.PRIMARY, 0];

    await settle(userId, game.stake, delta as number);
    await clearState(interaction.message.id);
    await interaction.update(finished(game, headline as string, colour as number));
  },
};

registerComponentHandler(handler);

export const blackjack = {
  data: {
    name: 'blackjack',
    description: 'Play blackjack and bet your coins!',
  },

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const bet = interaction.options.getInteger('bet', true);

    if (bet < MIN_BET) throw new UserError(`Minimum bet is ${MIN_BET} coins.`);
    if (bet > MAX_BET) throw new UserError(`Maximum bet is ${MAX_BET.toLocaleString()} coins.`);

    const prisma = getPrisma();
    const userId = interaction.user.id;

    const balance =
      (await prisma.userEconomy.findUnique({ where: { userId } })) ??
      (await prisma.userEconomy.create({ data: { userId, coins: 1000 } }));

    if (balance.coins < bet) {
      throw new UserError(`You only have ${balance.coins.toLocaleString()} coins.`);
    }

    const deck = createDeck();
    const game: Game = {
      deck,
      playerHand: [deck.pop()!, deck.pop()!],
      dealerHand: [deck.pop()!, deck.pop()!],
      bet,
      stake: bet,
    };

    // A natural pays three to two and ends the hand immediately.
    if (calculateHand(game.playerHand) === 21) {
      const winnings = Math.floor(bet * 1.5);
      await settle(userId, bet, winnings);
      await interaction.reply(
        finished(
          game,
          `Blackjack. You win **${winnings.toLocaleString()}** coins.`,
          ZENITSU_THEME.SUCCESS,
        ),
      );
      return;
    }

    const response = await interaction.reply({
      ...inProgress(game),
      components: [controls(balance.coins >= bet * 2)],
      withResponse: true,
    });

    const message = response.resource?.message;
    if (message) await attachState(message.id, handler, userId, game);
  },
};
