# ⚡ START HERE - ZenitsuBot Setup

## ✅ CURRENT STATUS

**BOT:** ✅ Running on your server  
**BACKEND API:** ✅ Running on `http://74.140.131.120`  
**WEBSITE:** ⏳ Ready to deploy to GitHub Pages with custom domain `zenitsu.rohan.host`

---

## 🎯 STEP-BY-STEP SETUP

### 1️⃣ Deploy Website to GitHub (5 minutes)

```bash
cd gh-pages
git init
git add .
git commit -m "ZenitsuBot website"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/zenitsubot-website.git
git push -u origin main
```

**Replace `YOUR_USERNAME` with your GitHub username!**

Then enable GitHub Pages:
1. Go to: `https://github.com/YOUR_USERNAME/zenitsubot-website/settings/pages`
2. Under **Source**, select **main** branch
3. Click **Save**

---

### 2️⃣ Configure Custom Domain on GitHub

Still in GitHub Pages settings:

1. Under **Custom domain**, enter: `zenitsu.rohan.host`
2. Click **Save**
3. ✅ Check **Enforce HTTPS** (wait 1-2 minutes for it to appear)
4. Done!

---

### 3️⃣ Update DNS on Porkbun

Go to: https://porkbun.com/account/domainsSpeedy (your domain DNS settings)

**For subdomain `zenitsu.rohan.host`:**

Delete the old A record and add a CNAME record:

- **Type:** `CNAME`
- **Host:** `zenitsu` (or `zenitsu.rohan.host`)
- **Answer:** `YOUR_GITHUB_USERNAME.github.io`
- **TTL:** `600`

Click **Add**

---

### 4️⃣ Update Discord Developer Portal

Go to: https://discord.com/developers/applications/766218598913146901

**In OAuth2 → General:**
- Add Redirect: `http://74.140.131.120/auth/callback`

**In General Information:**
- **Terms URL:** `https://zenitsu.rohan.host/terms.html`
- **Privacy URL:** `https://zenitsu.rohan.host/privacy.html`
- **Interactions URL:** `http://74.140.131.120/api/interactions`

Click **Save Changes**

---

## 🎉 DONE! Test It

Wait 5-10 minutes for DNS to propagate, then:

### Test Website:
1. Go to: **https://zenitsu.rohan.host**
2. Should show your beautiful website! ✨
3. Click **"Add to Server"** - works?
4. Click **"Login with Discord"** - works?
5. You should see your dashboard!

### Test Bot:
Open Discord and type: `/ping`

---

## 📁 Project Structure

```
zenitsubot/
├── START_HERE.md          ← You are here!
├── docker-compose.yml     ← Docker config
├── .env                   ← Configured ✅
├── src/                   ← Bot source code
├── gh-pages/              ← Website files
│   ├── CNAME              ← Custom domain config
│   ├── index.html
│   ├── app.js
│   └── style.css
└── dist/                  ← Compiled code
```

---

## 🚀 Quick Commands

```bash
# Check bot status
docker-compose ps

# View bot logs
docker-compose logs bot --tail=50

# Restart bot
docker-compose restart bot

# Rebuild after code changes
npm run build && docker-compose restart bot

# Push the slash command list to Discord (needed after adding/removing commands)
npm run register:commands

# Check that handlers, builders and what Discord has all agree
npm run verify:commands
```

## Adding a command

Every command is defined once, in `src/commands/index.ts`, which pairs the
Discord-facing `SlashCommandBuilder` with the handler that reads its options.
Keeping them together is deliberate — when they lived in separate files, option
names drifted apart and commands broke silently at runtime.

1. Write the handler in `src/commands/slash/<category>/<name>.ts`
2. Add one `CommandDefinition` entry to `COMMANDS` in `src/commands/index.ts`
3. `npm run verify:commands`, then `npm run register:commands`

`/help` and the register script both read from that list, so neither needs
updating by hand. Set `hidden: true` to keep a command out of `/help`.

**Bot output contains no emoji.** `EMOTES` in `src/utils/constants.ts` is kept
only so old call sites compile — every value is an empty string. Write plain
text instead.

## Owner-only commands

`/status`, `/logs`, `/servers`, `/blacklist` and `/announce` are gated on
`OWNER_DISCORD_ID` in `.env`. **If that variable is unset, they deny everyone**,
including you — set it to your Discord user id.

```
OWNER_DISCORD_ID=your_discord_user_id
```

## Optional environment variables

| Variable | Effect if unset |
| --- | --- |
| `OWNER_DISCORD_ID` | Owner commands refuse everyone |
| `GITHUB_TOKEN` | `/gh` and `/ghuser` fall back to 60 requests/hour per IP instead of 5,000 |
| `TORRENT_1337X_DOMAINS` | `/torrent` uses `https://www.1337xx.to` |
| `OPENROUTER_API_KEY` | `/torrent search` skips query interpretation and searches your words literally |
| `TORRENT_QUERY_MODEL` | Query interpretation uses `meta-llama/llama-3.3-70b-instruct:free` |

## Torrent search (`/torrent`)

### Sources

A plain search asks **1337x and The Pirate Bay** — the two broad indexes, which
between them answer most questions quickly. The specialised ones are one click
away: every results message carries a **source picker** where you can add them
and the search re-runs.

| Source | Good for | On by default | How it is read |
| --- | --- | --- | --- |
| 1337x | General, with uploaders and real upload dates | yes | HTML, scraped |
| The Pirate Bay | Broadest coverage, and good for **games** | yes | JSON API |
| Nyaa | Anime, including fansubs and batches | no | RSS feed |
| SolidTorrents | DHT index — never posted to a tracker | no | JSON API |
| FitGirl Repacks | Compressed game repacks, a third the original size | no | HTML, scraped |

Whatever is selected is searched **at once** and the results merged and
deduplicated by infohash, taking the healthier swarm reading when two indexes
disagree. A dead index fails on its own without holding up the others, and the
reply names anything unreachable. Results are interleaved before the list is
cut, so one busy index cannot crowd the others out.

Sources are only asked what they can answer — a games search never waits on
Nyaa, and a film search never waits on FitGirl.

1337x and FitGirl need a second request to produce a magnet, because theirs
live on the torrent page rather than in the listing; the rest hand over the
infohash with the search results, so opening one of those costs nothing.

`source:` on the command picks a single index up front, or `Every source` opens
the lot. The Internet Archive stays its own thing under
`source: Internet Archive`. `/torrent watch` searches the default pair,
newest-first.


`/torrent search` queries 1337x by default and the Internet Archive with
`source: Internet Archive`. `/torrent scrape` reads a single 1337x torrent page
given its URL or numeric id. Both return the magnet privately.

```
TORRENT_1337X_DOMAINS=https://www.1337xx.to,https://mirror.example
```

Comma-separated, tried in order when one is unreachable. Everything after the
host is discarded, so only the origin matters. Rules the loader enforces:

- **https only** (plain `http` is accepted only while tests run)
- no credentials in the URL, no IP literals, no localhost or private addresses
- the list is the complete allowlist — a torrent URL you pass to
  `/torrent scrape` must be on one of these hosts, and so must every redirect
  the bot follows

Results come back as one list you can compare at a glance. Pick a result from
the dropdown to scrape its page and get the magnet; filter buttons for
resolution, codec and cam rips narrow the list instantly without hitting the
site again. Every mirror in the list is queried **in parallel** and the results
merged, so a release only one mirror carries still shows up, and the same
release listed twice is folded into one row.

Release names are parsed for resolution, source, codec, audio, HDR and
season/episode, which is where the quality line under each result and the
filter buttons come from. Cam and telesync rips are flagged rather than
silently ranked alongside real encodes.

### Understanding what you typed

If `OPENROUTER_API_KEY` is set, a plain-English search is translated into
search terms first — "that new villeneuve dune movie in 4k" becomes a search
for *Dune Part Two* filtered to 2160p. The reading is shown above the results
with a button to search your words verbatim instead.

This never blocks a search. It is skipped for short queries and for anything
already shaped like a release name, it times out after 10 seconds, and any
failure falls back to searching literally.

**Free models are rate limited constantly**, so interpretation is often
unavailable — searches still work, they just use your words as typed. A short
list of models is tried in turn; set `TORRENT_QUERY_MODEL` to put your own
first. Use an *instruction* model, not the reasoning model `/ask` uses: asked
for JSON, a reasoning model replies with several paragraphs of deliberation.
Free model ids on OpenRouter are also retired without notice — if interpretation
stops happening entirely, check `/aimodel list` and set a current one.

Two things the bot compensates for, because the mirror's own search is weak:

- **It ORs the search words together and matches descriptions, not just
  titles**, and then ranks by whatever sort you asked for. The whole phrase
  sorted by seeders is therefore the worst case: `brand new day` fills page one
  with popular torrents containing "day" and never reaches Spider-Man at all.
  So a search sends the site *one rare word* (`brand`), not the phrase, and
  filters locally on the rest. Up to five differently-aimed requests are made
  per mirror — the phrase, the rare word, and the rare word sorted by upload
  time so brand-new releases with few seeders still surface.
- **Titles are matched on the words that could plausibly be in a filename.**
  "that new villeneuve dune movie in 4k" is held to *villeneuve* and *dune*,
  not to "that", "in" or "4k" — demanding those returns nothing. Exact matches
  are listed first, then the closest partial ones, so a search rarely comes
  back empty when the site had anything relevant.
- **Adult releases are indexed alongside everything else.** They are hidden
  unless the channel is age-restricted.

Nothing tries to defeat Cloudflare, a captcha or any other access control. When
the site answers a scripted request with a challenge, the command says it is
temporarily unavailable and stops there. Which mirrors work changes over time;
if searches start failing, point `TORRENT_1337X_DOMAINS` at a working one.

Both variables are read from `.env` / `.env.local`, which compose already passes
into the container — no `docker-compose.yml` change is needed to set them.

The 1337x parser in `src/services/1337xParse.ts` reimplements the behaviour of
[TUVIMEN/1337x-scraper](https://github.com/TUVIMEN/1337x-scraper) by Dominik
Stanisław Suchora, which is licensed **GNU GPLv3**. That attribution is repeated
in the file headers and must stay with the code.

---

## 🔗 Important Links

- **Your Website:** https://zenitsu.rohan.host
- **Bot Invite:** https://discord.com/oauth2/authorize?client_id=766218598913146901&permissions=8&scope=bot%20applications.commands
- **Support Server:** https://discord.gg/h2y7FnH4bp
- **Discord Dev Portal:** https://discord.com/developers/applications/766218598913146901
- **Porkbun DNS:** https://porkbun.com/account/domainsSpeedy

---

## ❓ Troubleshooting

### Website shows 404:
- Wait 5-10 minutes for DNS to propagate
- Check GitHub Pages settings has `zenitsu.rohan.host` as custom domain
- Check CNAME file exists in gh-pages folder

### DNS not working:
- Make sure you added CNAME record on Porkbun pointing to `YOUR_USERNAME.github.io`
- Wait up to 1 hour for DNS propagation
- Test with: `nslookup zenitsu.rohan.host 8.8.8.8`

### Can't login:
- Make sure Discord OAuth has `http://74.140.131.120/auth/callback`
- Check `.env` has: `OAUTH_CALLBACK_URL=http://74.140.131.120/auth/callback`

### CORS errors:
- Backend already configured for `zenitsu.rohan.host` ✅
- If issues, check browser console (F12)

---

## 🎊 That's It!

Your setup:
- ✅ **Frontend:** `https://zenitsu.rohan.host` (GitHub Pages)
- ✅ **Backend:** `http://74.140.131.120` (Your server)
- ✅ **Bot:** Running in Discord

Follow steps 1-4 above and you're live! 🚀

Questions? Join: https://discord.gg/h2y7FnH4bp
