// Zenitsu Bot theme and personality.
// Output is deliberately emoji-free — embeds carry tone through colour and copy.

export const ZENITSU_THEME = {
  // Primary golden yellow
  PRIMARY: 0xf7c87b,
  LIGHT: 0xffe4a3,
  DARK: 0xd4a551,
  ACCENT: 0xfff4dc,
  ERROR: 0xff8c42,
  SUCCESS: 0xffd700,
};

/**
 * Retained so existing call sites keep compiling, but every value is empty.
 * Prefer writing plain text rather than reaching for one of these.
 *
 * @deprecated Emoji and custom emotes are no longer used in bot output.
 */
export const EMOTES = {
  ZENITSU_HEARTEYES: '',
  ZENITSU_DEAD: '',
  ZENITSU_CRYING: '',
  UPVOTE: '',
  DOWNVOTE: '',
  YES: '',
  YIKES: '',
  PAT: '',
  ANIME_BLUSH: '',
  ANIME_CRYING: '',
  ANIME_BLINK: '',
  CHIKKA_DANCE: '',
  CHIKKA_PANIC: '',
  ANIME_LAUGH: '',
  DEAD: '',
  IS_FINE: '',
  CONFUSED_CAT: '',
  THINK: '',
  NOT_LIKE_THIS: '',
  WUMPUS_NAP: '',
  FLUENT_SPARKLES: '',
  SHRUG: '',
  F: '',
  BULLET: '-',
};

const PERSONALITY = {
  SUCCESS: ['Done.', 'Success.', 'All set.', 'Complete.'],
  ERROR: ['Something went wrong.', 'An error occurred.', "That didn't work.", 'Error encountered.'],
  MUSIC: ['Now playing', 'Playing', 'Queued', 'Added to the queue'],
};

function pick(values: string[]): string {
  return values[Math.floor(Math.random() * values.length)] ?? '';
}

export function getRandomSuccess(): string {
  return pick(PERSONALITY.SUCCESS);
}

export function getRandomError(): string {
  return pick(PERSONALITY.ERROR);
}

export function getRandomMusic(): string {
  return pick(PERSONALITY.MUSIC);
}

export function getRandomIntro(): string {
  return '';
}

export function getRandomOutro(): string {
  return '';
}
