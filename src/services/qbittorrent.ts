import { logger } from './logger.js';

/**
 * Client for the qBittorrent Web API (v2).
 *
 * Auth is a session cookie from /auth/login, cached until it is rejected. The
 * instance is expected to be private to the host or the compose network; this
 * never exposes it.
 */

const TIMEOUT_MS = 15_000;
const SESSION_TTL_MS = 30 * 60 * 1000;

export class QbitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QbitError';
  }
}

export interface QbitTorrent {
  hash: string;
  name: string;
  size: number;
  progress: number;
  dlspeed: number;
  upspeed: number;
  eta: number;
  state: string;
  num_seeds: number;
  num_leechs: number;
  ratio: number;
  category?: string;
  added_on: number;
  completion_on?: number;
}

export interface QbitTransfer {
  dl_info_speed: number;
  up_info_speed: number;
  dl_info_data: number;
  up_info_data: number;
  connection_status: string;
}

export function qbitConfigured(): boolean {
  return Boolean(process.env.QBIT_URL);
}

function baseUrl(): string {
  const url = process.env.QBIT_URL;
  if (!url) throw new QbitError('QBIT_URL is not set.');
  return url.replace(/\/+$/, '');
}

let session: { cookie: string; at: number } | null = null;

async function login(): Promise<string> {
  if (session && Date.now() - session.at < SESSION_TTL_MS) return session.cookie;

  const body = new URLSearchParams({
    username: process.env.QBIT_USER ?? 'admin',
    password: process.env.QBIT_PASS ?? '',
  });

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}/api/v2/auth/login`, {
      method: 'POST',
      body,
      // qBittorrent rejects requests whose Referer does not match its own host.
      headers: { Referer: baseUrl(), 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn({ err }, 'qBittorrent unreachable');
    throw new QbitError('Cannot reach qBittorrent. Check QBIT_URL and that it is running.');
  }

  const text = (await response.text()).trim();

  if (response.status === 403) {
    throw new QbitError('qBittorrent refused the login. Too many failed attempts, or IP banned.');
  }
  if (text !== 'Ok.') {
    throw new QbitError('qBittorrent rejected the credentials. Check QBIT_USER and QBIT_PASS.');
  }

  const cookie = response.headers.getSetCookie?.().find((c) => c.startsWith('SID='));
  if (!cookie) {
    // Some builds with auth bypassed for local subnets return Ok. and no cookie.
    session = { cookie: '', at: Date.now() };
    return '';
  }

  session = { cookie: cookie.split(';')[0]!, at: Date.now() };
  return session.cookie;
}

async function call<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: URLSearchParams; raw?: boolean } = {},
): Promise<T> {
  const cookie = await login();

  const response = await fetch(`${baseUrl()}/api/v2${path}`, {
    method: options.method ?? 'GET',
    body: options.body,
    headers: {
      Referer: baseUrl(),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (response.status === 403) {
    // Session expired; drop it so the next call logs in again.
    session = null;
    throw new QbitError('qBittorrent session expired. Try again.');
  }
  if (!response.ok) {
    throw new QbitError(`qBittorrent returned ${response.status} for ${path}.`);
  }

  if (options.raw) return (await response.text()) as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function version(): Promise<string> {
  return call<string>('/app/version', { raw: true });
}

export async function listTorrents(filter = 'all'): Promise<QbitTorrent[]> {
  const params = new URLSearchParams({ filter, sort: 'added_on', reverse: 'true', limit: '25' });
  return (await call<QbitTorrent[]>(`/torrents/info?${params}`)) ?? [];
}

export async function transferInfo(): Promise<QbitTransfer> {
  return call<QbitTransfer>('/transfer/info');
}

export async function addMagnet(magnet: string, category?: string): Promise<void> {
  const body = new URLSearchParams({ urls: magnet });
  if (category) body.set('category', category);
  await call('/torrents/add', { method: 'POST', body, raw: true });
}

export async function pauseTorrent(hash: string): Promise<void> {
  await call('/torrents/pause', {
    method: 'POST',
    body: new URLSearchParams({ hashes: hash }),
    raw: true,
  });
}

export async function resumeTorrent(hash: string): Promise<void> {
  await call('/torrents/resume', {
    method: 'POST',
    body: new URLSearchParams({ hashes: hash }),
    raw: true,
  });
}

export async function deleteTorrent(hash: string, deleteFiles: boolean): Promise<void> {
  await call('/torrents/delete', {
    method: 'POST',
    body: new URLSearchParams({ hashes: hash, deleteFiles: String(deleteFiles) }),
    raw: true,
  });
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond) return '0 B/s';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let value = bytesPerSecond;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatEta(seconds: number): string {
  // qBittorrent uses 8640000 to mean "unknown".
  if (!seconds || seconds >= 8640000) return 'unknown';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** A ten-cell bar, since Discord has no progress element. */
export function progressBar(fraction: number): string {
  const filled = Math.round(Math.min(Math.max(fraction, 0), 1) * 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${(fraction * 100).toFixed(0)}%`;
}

const STATE_LABELS: Record<string, string> = {
  downloading: 'Downloading',
  stalledDL: 'Stalled (down)',
  stalledUP: 'Seeding (stalled)',
  uploading: 'Seeding',
  pausedDL: 'Paused',
  pausedUP: 'Paused (done)',
  queuedDL: 'Queued',
  queuedUP: 'Queued (seed)',
  checkingDL: 'Checking',
  checkingUP: 'Checking',
  metaDL: 'Fetching metadata',
  error: 'Error',
  missingFiles: 'Missing files',
};

export function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}
