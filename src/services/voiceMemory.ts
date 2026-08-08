import { getPrisma } from './db.js';
import { logger } from './logger.js';

/**
 * What Zenitsu remembers about the people in voice.
 *
 * Keyed on the Discord user id rather than on anything said aloud. The voice
 * receiver attributes every audio stream to an account before a word is
 * transcribed, so the right memory is loaded before the model is asked
 * anything — which is the difference between "who are you again" and picking
 * up where you left off.
 */

/** Facts shown to the model per person. Beyond this the prompt is noise. */
const MAX_FACTS = 12;
/** Recent turns replayed for continuity. */
const MAX_RECENT = 6;
/** Turns kept before they are folded into the summary and dropped. */
const EXCHANGE_RETENTION = 40;

export interface SpeakerMemory {
  userId: string;
  displayName?: string;
  preferences?: string;
  summary?: string;
  facts: Array<{ topic: string; fact: string }>;
  recent: Array<{ spoke: string; answered?: string }>;
  turns: number;
  returning: boolean;
}

export async function loadMemory(userId: string, fallbackName: string): Promise<SpeakerMemory> {
  const prisma = getPrisma();

  try {
    const profile = await prisma.voiceProfile.findUnique({
      where: { userId },
      include: {
        facts: { orderBy: { updatedAt: 'desc' }, take: MAX_FACTS },
        exchanges: { orderBy: { at: 'desc' }, take: MAX_RECENT },
      },
    });

    if (!profile) {
      return {
        userId,
        displayName: fallbackName,
        facts: [],
        recent: [],
        turns: 0,
        returning: false,
      };
    }

    return {
      userId,
      displayName: profile.displayName ?? fallbackName,
      preferences: profile.preferences ?? undefined,
      summary: profile.summary ?? undefined,
      facts: profile.facts.map((f) => ({ topic: f.topic, fact: f.fact })),
      // Stored newest-first for the query; replayed oldest-first so the model
      // reads them as a conversation.
      recent: profile.exchanges
        .reverse()
        .map((e) => ({ spoke: e.spoke, answered: e.answered ?? undefined })),
      turns: profile.turns,
      returning: profile.turns > 0,
    };
  } catch (err) {
    logger.warn({ err, userId }, 'Could not load voice memory');
    return { userId, displayName: fallbackName, facts: [], recent: [], turns: 0, returning: false };
  }
}

export async function ensureProfile(userId: string, displayName: string): Promise<void> {
  await getPrisma()
    .voiceProfile.upsert({
      where: { userId },
      create: { userId, displayName },
      update: { lastHeardAt: new Date() },
    })
    .catch((err) => logger.warn({ err, userId }, 'Could not create voice profile'));
}

export async function recordExchange(
  userId: string,
  spoke: string,
  answered: string | undefined,
  guildId?: string,
): Promise<void> {
  const prisma = getPrisma();

  try {
    await prisma.voiceExchange.create({ data: { userId, spoke, answered, guildId } });
    await prisma.voiceProfile.update({
      where: { userId },
      data: { turns: { increment: 1 }, lastHeardAt: new Date() },
    });

    // Bounded here rather than on a timer: this is the only place rows are
    // added, so it is the only place they can run away.
    const old = await prisma.voiceExchange.findMany({
      where: { userId },
      orderBy: { at: 'desc' },
      skip: EXCHANGE_RETENTION,
      select: { id: true },
    });

    if (old.length) {
      await prisma.voiceExchange.deleteMany({ where: { id: { in: old.map((e) => e.id) } } });
    }
  } catch (err) {
    logger.warn({ err, userId }, 'Could not record voice exchange');
  }
}

/**
 * Records something worth remembering.
 *
 * Upserted on topic so a later fact about the same subject replaces the older
 * one — someone who changes jobs should not accumulate two employers.
 */
export async function rememberFact(
  userId: string,
  topic: string,
  fact: string,
  inferred = true,
): Promise<void> {
  const key = topic.trim().toLowerCase().slice(0, 60);
  if (!key || !fact.trim()) return;

  await getPrisma()
    .voiceFact.upsert({
      where: { userId_topic: { userId, topic: key } },
      create: { userId, topic: key, fact: fact.trim().slice(0, 300), inferred },
      update: { fact: fact.trim().slice(0, 300), inferred },
    })
    .catch((err) => logger.warn({ err, userId, topic }, 'Could not remember fact'));
}

export async function forgetFact(userId: string, topic: string): Promise<boolean> {
  const { count } = await getPrisma()
    .voiceFact.deleteMany({ where: { userId, topic: topic.trim().toLowerCase() } })
    .catch(() => ({ count: 0 }));

  return count > 0;
}

export async function forgetEverything(userId: string): Promise<void> {
  await getPrisma()
    .voiceProfile.delete({ where: { userId } })
    .catch(() => {});
}

/**
 * Renders one person's memory for the system prompt.
 *
 * Written as prose rather than as a data dump: the model is being asked to
 * talk like someone who knows them, and a JSON blob produces an assistant
 * reciting a file.
 */
export function describeSpeaker(memory: SpeakerMemory): string {
  const lines: string[] = [`${memory.displayName ?? 'They'} (Discord id ${memory.userId})`];

  if (memory.returning) {
    lines.push(
      `You have talked with them ${memory.turns} time${memory.turns === 1 ? '' : 's'} before.`,
    );
  } else {
    lines.push('You have not spoken with them before.');
  }

  if (memory.preferences) lines.push(`How they like to be talked to: ${memory.preferences}`);
  if (memory.summary) lines.push(`Previously: ${memory.summary}`);

  if (memory.facts.length) {
    lines.push('You know:');
    for (const { topic, fact } of memory.facts) lines.push(`  - ${topic}: ${fact}`);
  }

  if (memory.recent.length) {
    lines.push('Recently:');
    for (const { spoke, answered } of memory.recent) {
      lines.push(`  - they said "${spoke}"${answered ? `, you said "${answered}"` : ''}`);
    }
  }

  return lines.join('\n');
}
