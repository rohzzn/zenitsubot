import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

let prismaInstance: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (prismaInstance) return prismaInstance;
  prismaInstance = new PrismaClient();

  prismaInstance
    .$connect()
    .then(() => logger.info('Prisma connected'))
    .catch((err) => {
      logger.error({ err }, 'Prisma connection failed');
      process.exit(1);
    });

  return prismaInstance;
}


