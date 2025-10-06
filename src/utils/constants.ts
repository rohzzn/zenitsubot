// Zenitsu Bot Theme & Personality
// Based on Zenitsu Agatsuma from Demon Slayer

export const ZENITSU_THEME = {
  // Primary golden yellow color
  PRIMARY: 0xF7C87B,
  // Shades for variety
  LIGHT: 0xFFE4A3,
  DARK: 0xD4A551,
  ACCENT: 0xFFF4DC,
  ERROR: 0xFF8C42,
  SUCCESS: 0xFFD700,
};

// Custom server emotes
export const EMOTES = {
  // Zenitsu-specific
  ZENITSU_HEARTEYES: '<:zenitsuhearteyes:1424770244429353041>',
  ZENITSU_DEAD: '<:zenitsudead:1424770215790776481>',
  ZENITSU_CRYING: '<:zenitsucrying:1424770194957664397>',
  
  // Reactions
  UPVOTE: '<:UPVOTE:1424770294647623761>',
  DOWNVOTE: '<:downvote:1424770321399152795>',
  YES: '<:yes:1424770366164959353>',
  YIKES: '<:yikes:1424770351476248676>',
  PAT: '<:pat:1424770713432227962>',
  
  // Anime expressions
  ANIME_BLUSH: '<a:a_animecuteblush:1424770410788028590>',
  ANIME_CRYING: '<a:a_animecrying:1424770420292194304>',
  ANIME_BLINK: '<a:a_animeblink:1424770158790049862>',
  CHIKKA_DANCE: '<a:a_chikkadance:1424770430652121129>',
  CHIKKA_PANIC: '<a:a_chikkapanic:1424770446217183353>',
  ANIME_LAUGH: '<:animelaugh:1424770503226167347>',
  
  // Status/Mood
  DEAD: '<:Dead:1424770520464883825>',
  IS_FINE: '<:isFine:1424770540698079333>',
  CONFUSED_CAT: '<:confusedcat:1424770556632371252>',
  THINK: '<:Think:1424770628434526250>',
  NOT_LIKE_THIS: '<:notLikeThis:1424770657152929804>',
  
  // Other
  WUMPUS_NAP: '<:WumpusNap:1424770384355659958>',
  FLUENT_SPARKLES: '<:FluentSparkles:1424770271088214228>',
  SHRUG: '<:002shrug:1424770078968254484>',
  F: '<:_f:1424770043534901310>',
  BULLET: '<:bulletpoint:1424770482129076297>',
};

// Zenitsu's personality traits for responses (subtle/minimal with emotes)
export const ZENITSU_PERSONALITY = {
  // Minimal intros (only occasionally)
  INTROS: [
    "",
    "",
    "",
    `${EMOTES.FLUENT_SPARKLES} `,
  ],
  
  // Simple outros
  OUTROS: [
    ` ${EMOTES.FLUENT_SPARKLES}`,
    " ⚡",
    "",
    "",
  ],
  
  // Success messages (minimal)
  SUCCESS: [
    `Done! ${EMOTES.YES}`,
    `Success! ${EMOTES.FLUENT_SPARKLES}`,
    `All set! ${EMOTES.ZENITSU_HEARTEYES}`,
    "Complete! ⚡",
  ],
  
  // Error messages (less dramatic)
  ERROR: [
    `Something went wrong ${EMOTES.CONFUSED_CAT}`,
    `An error occurred ${EMOTES.YIKES}`,
    `That didn't work ${EMOTES.NOT_LIKE_THIS}`,
    `Error encountered ${EMOTES.ZENITSU_CRYING}`,
  ],
  
  // Music-specific
  MUSIC: [
    `Now playing ${EMOTES.CHIKKA_DANCE}`,
    `Playing ${EMOTES.ANIME_BLUSH}`,
    `Queued! ${EMOTES.FLUENT_SPARKLES}`,
    "Added to queue ⚡",
  ],
};

// Helper to get random personality element
export function getRandomIntro(): string {
  return ZENITSU_PERSONALITY.INTROS[Math.floor(Math.random() * ZENITSU_PERSONALITY.INTROS.length)] || "";
}

export function getRandomOutro(): string {
  return ZENITSU_PERSONALITY.OUTROS[Math.floor(Math.random() * ZENITSU_PERSONALITY.OUTROS.length)] || "";
}

export function getRandomSuccess(): string {
  return ZENITSU_PERSONALITY.SUCCESS[Math.floor(Math.random() * ZENITSU_PERSONALITY.SUCCESS.length)] || "";
}

export function getRandomError(): string {
  return ZENITSU_PERSONALITY.ERROR[Math.floor(Math.random() * ZENITSU_PERSONALITY.ERROR.length)] || "";
}

export function getRandomMusic(): string {
  return ZENITSU_PERSONALITY.MUSIC[Math.floor(Math.random() * ZENITSU_PERSONALITY.MUSIC.length)] || "";
}

