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
```

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
