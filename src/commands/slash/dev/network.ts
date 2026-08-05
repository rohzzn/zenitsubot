import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import tls from 'node:tls';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { fetchJson } from '../../../utils/http.js';
import { logger } from '../../../services/logger.js';

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'] as const;

/** DNS RCODEs worth explaining rather than showing as a bare number. */
const RCODE_MEANING: Record<number, string> = {
  0: 'OK',
  2: 'SERVFAIL — the authoritative server failed',
  3: 'NXDOMAIN — the domain does not exist',
  5: 'REFUSED',
};

interface DohAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
  Authority?: DohAnswer[];
}

/** Strips scheme/path so users can paste a URL instead of a bare hostname. */
function normaliseHost(input: string): string {
  return input
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .split('/')[0]!
    .split('?')[0]!
    .replace(/:\d+$/, '')
    .toLowerCase();
}

export const dns = {
  data: { name: 'dns' },
  category: 'dev',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const host = normaliseHost(interaction.options.getString('domain', true));
    const requested = interaction.options.getString('type');
    await interaction.deferReply();

    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) {
      await interaction.editReply(`\`${host}\` does not look like a domain name.`);
      return;
    }

    const types = requested ? [requested] : RECORD_TYPES;

    try {
      const lookups = await Promise.all(
        types.map(async (type) => {
          const data = await fetchJson<DohResponse>(
            `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
            { headers: { Accept: 'application/dns-json' } },
          );
          return { type, data };
        }),
      );

      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(`DNS — ${host}`)
        .setFooter({ text: 'Cloudflare DNS over HTTPS' })
        .setTimestamp();

      let found = 0;

      for (const { type, data } of lookups) {
        const answers = data?.Answer ?? [];
        if (answers.length === 0) continue;

        found += answers.length;
        embed.addFields({
          name: type,
          value: answers
            .slice(0, 8)
            .map((a) => `\`${a.data}\`  ·  TTL ${a.TTL}s`)
            .join('\n')
            .slice(0, 1024),
          inline: false,
        });
      }

      if (found === 0) {
        // A non-zero RCODE explains *why* nothing resolved, which is the whole
        // point of running this against a domain you think should work.
        const status = lookups.find((l) => l.data && l.data.Status !== 0)?.data?.Status;
        const explanation =
          status !== undefined ? (RCODE_MEANING[status] ?? `RCODE ${status}`) : undefined;

        embed.setDescription(
          explanation
            ? `No records returned.\n**${explanation}**`
            : 'No records found for the requested types.',
        );
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err, host }, 'DNS lookup failed');
      await interaction.editReply('DNS lookup failed. Try again later.').catch(() => {});
    }
  },
};

interface CertInfo {
  subject: string;
  issuer: string;
  validFrom: Date;
  validTo: Date;
  altNames: string[];
  protocol: string | null;
}

/** Opens a TLS connection just far enough to read the peer certificate. */
function inspectCertificate(host: string, timeoutMs = 10_000): Promise<CertInfo> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port: 443, servername: host, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();

        if (!cert || Object.keys(cert).length === 0) {
          socket.destroy();
          reject(new Error('No certificate presented'));
          return;
        }

        resolve({
          subject: cert.subject?.CN ?? host,
          issuer: cert.issuer?.O ?? cert.issuer?.CN ?? 'Unknown',
          validFrom: new Date(cert.valid_from),
          validTo: new Date(cert.valid_to),
          altNames: (cert.subjectaltname ?? '')
            .split(',')
            .map((n) => n.trim().replace(/^DNS:/, ''))
            .filter(Boolean),
          protocol: socket.getProtocol(),
        });
        socket.end();
      },
    );

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error('Connection timed out'));
    });
    socket.on('error', (err) => {
      socket.destroy();
      reject(err);
    });
  });
}

export const ssl = {
  data: { name: 'ssl' },
  category: 'dev',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const host = normaliseHost(interaction.options.getString('domain', true));
    await interaction.deferReply();

    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) {
      await interaction.editReply(`\`${host}\` does not look like a domain name.`);
      return;
    }

    try {
      const cert = await inspectCertificate(host);
      const daysLeft = Math.floor((cert.validTo.getTime() - Date.now()) / 86_400_000);

      const status = daysLeft < 0 ? 'Expired' : daysLeft < 15 ? 'Expiring soon' : 'Valid';

      const embed = new EmbedBuilder()
        .setColor(daysLeft < 0 ? 0xff4444 : daysLeft < 15 ? 0xffa500 : 0x44bb44)
        .setTitle(`TLS certificate — ${host}`)
        .setDescription(`**${status}**`)
        .addFields(
          { name: 'Subject', value: cert.subject, inline: true },
          { name: 'Issuer', value: cert.issuer, inline: true },
          { name: 'Protocol', value: cert.protocol ?? 'Unknown', inline: true },
          {
            name: 'Issued',
            value: `<t:${Math.floor(cert.validFrom.getTime() / 1000)}:D>`,
            inline: true,
          },
          {
            name: 'Expires',
            value: `<t:${Math.floor(cert.validTo.getTime() / 1000)}:D>`,
            inline: true,
          },
          { name: 'Days left', value: `${daysLeft}`, inline: true },
        )
        .setTimestamp();

      if (cert.altNames.length) {
        embed.addFields({
          name: `Alt names (${cert.altNames.length})`,
          value: cert.altNames.slice(0, 20).join(', ').slice(0, 1024),
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.warn({ err, host }, 'TLS inspection failed');
      const reason = err instanceof Error ? err.message : 'unknown error';
      await interaction.editReply(`Could not read a certificate from \`${host}\` — ${reason}.`);
    }
  },
};
