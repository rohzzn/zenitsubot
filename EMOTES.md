# 🎭 Custom Emotes Integration

## ✅ Emotes Successfully Integrated!

Your custom Discord emotes are now integrated throughout the bot's personality and commands!

---

## 📋 Available Emotes

### Zenitsu-Specific
- `zenitsuhearteyes` <:zenitsuhearteyes:1424770244429353041> - Used for success/wins
- `zenitsudead` <:zenitsudead:1424770215790776481> - Used for failures/deaths
- `zenitsucrying` <:zenitsucrying:1424770194957664397> - Used for errors/losses

### Reactions
- `UPVOTE` <:UPVOTE:1424770294647623761> - **Blackjack "Hit" button**
- `DOWNVOTE` <:downvote:1424770321399152795> - **Blackjack "Stand" button**
- `yes` <:yes:1424770366164959353> - Success confirmations
- `yikes` <:yikes:1424770351476248676> - Errors
- `pat` <:pat:1424770713432227962> - Comfort/support

### Animated Anime Expressions
- `a_animecuteblush` - Cute/shy moments
- `a_animecrying` - Sad/emotional
- `a_animeblink` - Casual reactions
- `a_chikkadance` - Music playing!
- `a_chikkapanic` - Panic/rush
- `animelaugh` - Happy/funny

### Status/Mood
- `Dead` - Game over/failed
- `isFine` - Everything is fine (maybe not)
- `confusedcat` - Confused/uncertain
- `Think` - Thinking/processing
- `notLikeThis` - Disappointment/failure

### Other
- `WumpusNap` - Sleeping/idle
- `FluentSparkles` ✨ - Success/highlights
- `002shrug` - Uncertainty
- `_f` - Pay respects
- `bulletpoint` - Lists/bullets

---

## 🎮 Where Emotes Are Used

### Blackjack Game
```
/blackjack bet:100
```
- **Hit Button**: Shows UPVOTE emote
- **Stand Button**: Shows DOWNVOTE emote
- **Wins**: zenitsuhearteyes
- **Losses**: zenitsucrying or Dead
- **Title**: FluentSparkles

### Music Commands
```
/play <song>
```
- **Now Playing**: chikkadance
- **Queued**: FluentSparkles or ANIME_BLUSH
- **Error**: notLikeThis or confusedcat

### Success Messages
- `Done! <:yes:...>`
- `Success! <:FluentSparkles:...>`
- `All set! <:zenitsuhearteyes:...>`

### Error Messages
- `Something went wrong <:confusedcat:...>`
- `An error occurred <:yikes:...>`
- `That didn't work <:notLikeThis:...>`
- `Error encountered <:zenitsucrying:...>`

---

## 🔧 How to Add More Emotes

1. **Add emote to Discord server**
2. **Get emote format**:
   - Type `\:emotename:` in Discord
   - Copy the result: `<:emotename:123456789>`
   - For animated: `<a:emotename:123456789>`

3. **Add to `src/utils/constants.ts`**:
```typescript
export const EMOTES = {
  // ... existing emotes
  YOUR_EMOTE: '<:emotename:123456789>',
};
```

4. **Use in commands**:
```typescript
import { EMOTES } from '../../../utils/constants.js';

await interaction.reply(`Success! ${EMOTES.YOUR_EMOTE}`);
```

5. **Rebuild and deploy**:
```bash
npm run build
docker compose up -d --build
```

---

## 📊 Emote Usage Statistics

**Total Emotes**: 24
**Animated**: 5
**Static**: 19

**Used in**:
- ✅ Blackjack buttons (upvote/downvote)
- ✅ Music commands (dance, blush, sparkles)
- ✅ Success messages (yes, hearteyes, sparkles)
- ✅ Error messages (crying, confused, yikes, notLikeThis)
- ✅ General personality (sparkles, think, etc.)

---

## 🎨 Personality Balance

The bot now has a perfect balance:
- **Professional**: Clean responses, not overly dramatic
- **Personality**: Custom emotes add character
- **Zenitsu Theme**: Golden colors + lightning theme
- **Fun**: Emotes make interactions engaging

**Before**: Too dramatic text ("Ahhh! W-wait! I'm nervous!")
**After**: Minimal text + expressive emotes <:FluentSparkles:...>

---

## 🧪 Test the Emotes

### Blackjack (UPVOTE/DOWNVOTE buttons):
```
/balance
/daily
/blackjack bet:50
```
Click "Hit" (UPVOTE) or "Stand" (DOWNVOTE)!

### Music (dance emotes):
```
/play never gonna give you up
```
Watch for the dancing emote when queued!

### Errors (confused/crying):
```
/play asdfghjklqwertyuiop123456789
```
You'll see the confused cat or "not like this" emote!

---

## 💡 Tips

1. **Emotes are server-specific**: Make sure the bot is in the server that has these emotes
2. **Nitro required**: Some animated emotes may require Nitro for the bot
3. **Fallback**: If an emote doesn't work, the bot will still function (just without the emote)
4. **Balance**: We kept it minimal - emotes enhance, don't overwhelm

---

## 🎯 Future Enhancements

Potential emote uses:
- Economy commands (coin emote for balance)
- Level up notifications (sparkles)
- Moderation actions (warning emote)
- Welcome messages (wave emote)
- Game outcomes (trophy/medal emotes)
- Music controls (play/pause emotes)

---

Made with <:FluentSparkles:1424770271088214228> by Zenitsu Bot

