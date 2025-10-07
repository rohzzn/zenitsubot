# ⚡ START HERE - ZenitsuBot Setup

## ✅ CURRENT STATUS

**BOT:** ✅ Running on your server  
**BACKEND API:** ✅ Running on `http://74.140.131.120`  
**WEBSITE:** ⏳ Ready to deploy to GitHub Pages

---

## 🎯 WHAT YOU NEED TO DO NOW

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

Then:
1. Go to: https://github.com/YOUR_USERNAME/zenitsubot-website/settings/pages
2. Under **Source**, select **main** branch
3. Click **Save**
4. Wait 2 minutes
5. Your site: `https://YOUR_USERNAME.github.io/zenitsubot-website/`

---

### 2️⃣ Update Backend CORS

Edit this file: `src/web/server.ts`

Find line 27 and change:
```typescript
'https://YOUR_GITHUB_USERNAME.github.io',  // ← Put your GitHub username here
```

Then rebuild:
```bash
npm run build
docker-compose restart bot
```

---

### 3️⃣ Update Discord Developer Portal

Go to: https://discord.com/developers/applications/766218598913146901

**In OAuth2 → General:**
- Add Redirect: `http://74.140.131.120/auth/callback`

**In General Information:**
- Terms URL: `https://YOUR_USERNAME.github.io/zenitsubot-website/terms.html`
- Privacy URL: `https://YOUR_USERNAME.github.io/zenitsubot-website/privacy.html`
- Interactions URL: `http://74.140.131.120/api/interactions`

Click **Save Changes**

---

## 🎉 DONE! Test It

### Test Bot:
Open Discord and type: `/ping`

### Test Website:
1. Go to: `https://YOUR_USERNAME.github.io/zenitsubot-website/`
2. Click "Add to Server" - works?
3. Click "Login with Discord" - works?
4. You should see your dashboard!

---

## 📁 Project Structure

```
zenitsubot/
├── src/              ← Bot source code
├── gh-pages/         ← Website files (deploy this to GitHub)
├── docker-compose.yml
├── .env              ← Your secrets (already configured)
└── START_HERE.md     ← You are here!
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

# Stop everything
docker-compose down

# Start everything
docker-compose up -d

# Rebuild after code changes
npm run build && docker-compose restart bot
```

---

## 🔗 Important Links

- **Bot Invite**: https://discord.com/oauth2/authorize?client_id=766218598913146901&permissions=8&scope=bot%20applications.commands
- **Support Server**: https://discord.gg/h2y7FnH4bp
- **Discord Dev Portal**: https://discord.com/developers/applications/766218598913146901

---

## ❓ Problems?

### Bot not responding:
```bash
docker-compose logs bot --tail=50
```

### Website not loading:
- Make sure you updated `src/web/server.ts` with your GitHub username
- Rebuild: `npm run build && docker-compose restart bot`

### Can't login on website:
- Check Discord Dev Portal has correct redirect URL
- Check `.env` has: `OAUTH_CALLBACK_URL=http://74.140.131.120/auth/callback`

---

## 🎊 That's It!

Follow steps 1-3 above and you're done!

Questions? Join: https://discord.gg/h2y7FnH4bp

