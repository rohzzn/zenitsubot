import type { Attachment } from 'discord.js';
import { UserError, UpstreamError } from './errors.js';
import type { SourceImage } from '../services/image.js';

/**
 * Pulls an attachment's bytes down.
 *
 * Only Discord's own CDN is accepted. The URL arrives inside an interaction
 * payload so it is not user-controlled in the usual sense, but a fetch that
 * will follow whatever it is handed is worth closing off regardless — this
 * process sits on the compose network alongside Lavalink and the database.
 */

const ALLOWED_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
const FETCH_TIMEOUT_MS = 20_000;

export async function fetchAttachment(
  attachment: Attachment,
  maxBytes: number,
): Promise<SourceImage> {
  let url: URL;
  try {
    url = new URL(attachment.url);
  } catch {
    throw new UserError('That attachment has no readable URL.');
  }

  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new UserError('That attachment is not hosted on Discord.');
  }

  // Discord reports the size up front, so an oversized file costs no download.
  if (attachment.size > maxBytes) {
    throw new UserError(
      `That file is ${(attachment.size / 1024 / 1024).toFixed(1)} MB. The limit is ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new UpstreamError('Discord', 'Could not download that attachment.');

    const data = Buffer.from(await response.arrayBuffer());

    // Checked again after the fact: the declared size is a claim, not a promise.
    if (data.length > maxBytes) {
      throw new UserError('That file is larger than it claimed to be.');
    }

    return {
      data,
      name: attachment.name,
      declaredType: attachment.contentType ?? undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Refetches an image the user attached earlier.
 *
 * Used by buttons, which outlive the interaction that produced them: keeping
 * the bytes in component state would blow past its size cap, and the CDN link
 * is small and still valid.
 */
export async function refetchImage(url: string, name: string, maxBytes: number): Promise<Buffer> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UserError('That image link is no longer valid.');
  }

  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new UserError('That image is not hosted on Discord.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(parsed, { signal: controller.signal, redirect: 'error' });

    // Attachment URLs carry a signed expiry, so this is a routine outcome
    // rather than a failure worth a stack trace.
    if (response.status === 404 || response.status === 403) {
      throw new UserError(`The link to ${name} has expired. Run the command again with the file.`);
    }
    if (!response.ok) throw new UpstreamError('Discord', 'Could not re-download that image.');

    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > maxBytes) throw new UserError('That image is too large to process.');

    return data;
  } finally {
    clearTimeout(timer);
  }
}
