import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

let prismaInstance: PrismaClient | null = null;

/**
 * Returns the shared Prisma client, constructing it on first use.
 *
 * Connection is lazy on purpose: importing a command module must not open a
 * database connection as a side effect, or tooling that only reads command
 * definitions (the register/verify scripts) dies on a missing database.
 */
export function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient();
  }
  return prismaInstance;
}

/** Opens the connection eagerly so boot fails fast on a bad DATABASE_URL. */
export async function connectPrisma(): Promise<void> {
  await getPrisma().$connect();
  logger.info('Prisma connected');
}

export async function disconnectPrisma(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
}
