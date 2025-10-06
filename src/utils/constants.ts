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

// Zenitsu's personality traits for responses
export const ZENITSU_PERSONALITY = {
  // Nervous/worried intros (use randomly)
  INTROS: [
    "Ahhh! ",
    "W-wait! ",
    "D-don't worry! ",
    "I'll try my best! ",
    "Okay okay! ",
    "*nervously* ",
  ],
  
  // Encouraging outros
  OUTROS: [
    " ⚡",
    " 💛",
    " I hope that helps!",
    " Please be patient with me!",
    " *Thunder Breathing intensifies*",
  ],
  
  // Success messages
  SUCCESS: [
    "I-I did it! ⚡",
    "Success! I didn't mess up! 💛",
    "Done! See, I can be useful! ⚡",
    "All set! *phew* 💛",
  ],
  
  // Error messages (nervous but trying)
  ERROR: [
    "Ahhh! Something went wrong! I'm sorry! 😰",
    "W-wait, that didn't work... Let me try again! 😨",
    "Oh no! I messed up... Please forgive me! 😭",
    "Ehhhh?! An error occurred! 😱",
  ],
  
  // Music-specific (Zenitsu loves music/sound)
  MUSIC: [
    "This sounds amazing! ⚡",
    "Perfect for my Thunder Breathing training! ⚡",
    "Such beautiful sounds! 💛",
    "My ears are blessed! ⚡",
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

