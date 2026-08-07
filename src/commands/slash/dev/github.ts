import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { fetchJson, truncate, relativeTime } from '../../../utils/http.js';
import { logger } from '../../../services/logger.js';

const GITHUB_COLOR = 0x24292f;

/**
 * Unauthenticated GitHub allows 60 requests/hour per IP, which one busy server
 * can exhaust. Set GITHUB_TOKEN (any classic PAT, no scopes needed for public
 * data) to raise it to 5,000/hour.
 */
function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return {
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

interface Repo {
  full_name: string;
  html_url: string;
  description?: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language?: string | null;
  license?: { spdx_id?: string } | null;
  pushed_at: string;
  topics?: string[];
  archived?: boolean;
  owner: { avatar_url: string };
}

interface User {
  login: string;
  name?: string | null;
  html_url: string;
  avatar_url: string;
  bio?: string | null;
  public_repos: number;
  followers: number;
  following: number;
  location?: string | null;
  blog?: string | null;
  created_at: string;
}

export const gh = {
  data: { name: 'gh' },
  category: 'dev',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const input = interaction.options
      .getString('repo', true)
      .trim()
      .replace(/^https?:\/\/github\.com\//, '');
    await interaction.deferReply();

    if (!/^[\w.-]+\/[\w.-]+$/.test(input)) {
      await interaction.editReply('Use the `owner/repo` format, for example `rohzzn/zenitsubot`.');
      return;
    }

    try {
      const repo = await fetchJson<Repo>(`https://api.github.com/repos/${input}`, {
        headers: githubHeaders(),
      });

      if (!repo) {
        await interaction.editReply(`No public repository found at \`${input}\`.`);
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(GITHUB_COLOR)
        .setTitle(repo.archived ? `${repo.full_name} (archived)` : repo.full_name)
        .setURL(repo.html_url)
        .setThumbnail(repo.owner.avatar_url)
        .setDescription(repo.description ? truncate(repo.description, 300) : 'No description.')
        .addFields(
          { name: 'Stars', value: repo.stargazers_count.toLocaleString(), inline: true },
          { name: 'Forks', value: repo.forks_count.toLocaleString(), inline: true },
          { name: 'Open issues', value: repo.open_issues_count.toLocaleString(), inline: true },
          { name: 'Language', value: repo.language || 'Unknown', inline: true },
          { name: 'License', value: repo.license?.spdx_id || 'None', inline: true },
          { name: 'Last push', value: relativeTime(repo.pushed_at), inline: true },
        );

      if (repo.topics?.length) {
        embed.addFields({
          name: 'Topics',
          value: truncate(repo.topics.join(', '), 300),
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err, repo: input }, 'GitHub repo lookup failed');
      await interaction
        .editReply('GitHub lookup failed — the API rate limit may be exhausted. Try again later.')
        .catch(() => {});
    }
  },
};

export const ghuser = {
  data: { name: 'ghuser' },
  category: 'dev',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const username = interaction.options.getString('username', true).trim();
    await interaction.deferReply();

    try {
      const user = await fetchJson<User>(
        `https://api.github.com/users/${encodeURIComponent(username)}`,
        { headers: githubHeaders() },
      );

      if (!user) {
        await interaction.editReply(`No GitHub user named \`${username}\`.`);
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(GITHUB_COLOR)
        .setTitle(user.name ? `${user.name} (${user.login})` : user.login)
        .setURL(user.html_url)
        .setThumbnail(user.avatar_url)
        .setDescription(user.bio ? truncate(user.bio, 300) : 'No bio.')
        .addFields(
          { name: 'Repos', value: user.public_repos.toLocaleString(), inline: true },
          { name: 'Followers', value: user.followers.toLocaleString(), inline: true },
          { name: 'Following', value: user.following.toLocaleString(), inline: true },
          { name: 'Joined', value: relativeTime(user.created_at), inline: true },
        );

      if (user.location) embed.addFields({ name: 'Location', value: user.location, inline: true });
      if (user.blog) embed.addFields({ name: 'Website', value: user.blog, inline: true });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err, username }, 'GitHub user lookup failed');
      await interaction
        .editReply('GitHub lookup failed — the API rate limit may be exhausted. Try again later.')
        .catch(() => {});
    }
  },
};
