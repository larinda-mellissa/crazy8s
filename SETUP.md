# Pool Hall Tournament Desk — Setup Guide

Same pattern as your WVEBL app: a **Netlify website** (plain HTML/JS) talking to a **Google Sheet + Apps Script** backend.

```
site/                 → upload to Netlify
  index.html  styles.css  app.js  config.js
  engine.js   service.js  local-backend.js
apps-script/          → paste into the Google Sheet's Apps Script editor
  Code.gs  Engine.gs  Service.gs
```

> `Engine.gs` and `Service.gs` are exact copies of `site/engine.js` and `site/service.js`. The same rules run on the website and the server. If you ever change one, copy it to the other.

---

## Try it first (demo mode, 2 minutes)

1. Drag the **site** folder onto Netlify (app.netlify.com → Add new site → Deploy manually).
2. Open the site. A yellow **Demo mode** bar appears, because `API_URL` is blank in `config.js`.
3. Click **Director**. Sign in with **demo / demo123**. There are 24 fake players to play with.
4. Open the site on your phone at the same time to see the player view. *(Demo data is stored per device, so for a phone test use the same browser on one device, or connect the real Sheet.)*

---

### Demo on the live site
Once the site is connected to your Sheet, anyone can still try it safely. On **Director**, sign in as **demo / demo123** (or tap **Open the demo**). That switches *their* browser to a private practice version with fake players. Nothing touches your real tournaments. **Exit demo** in the yellow bar takes them back.

---

## Connect the real Google Sheet

1. Create a **new blank Google Sheet** called something like *Pool Hall Tournaments DB*.
2. **Extensions → Apps Script.** Delete the starter code, then create three files and paste in each one:
   - `Code.gs`
   - `Engine.gs` (use **+ → Script**, name it `Engine`)
   - `Service.gs`
3. Choose `setup` in the function dropdown and press **Run**. Approve the permissions; it's your own script. All the tabs get created.
4. **Your owner login:** open `setOwnerLogin` in Code.gs and type your username, name and password. **Run** it, then change the password in the file back to `CHANGE-ME` and save. Your login is stored privately in the script, not in the Directors tab. Run it again any time to reset your own password.
5. **Deploy → New deployment → Web app.** Set *Execute as:* **Me** and *Who has access:* **Anyone**. Copy the URL that ends in `/exec`.
6. **Project Settings (⚙) → Script properties.** Set `SITE_URL` to your Netlify address, e.g. `https://yourhall-tournaments.netlify.app/`. The links in player messages use it.
7. In `site/config.js`, paste the `/exec` URL into `API_URL` and set `HALL_NAME`. Redeploy to Netlify. The demo bar disappears.
8. **Add your directors:** sign in, go to **Director → Directors → + Add director**, and enter their name, email, a username and a temporary password (one is suggested for you).
   - Leave **Email them** ticked, and they get an email with the sign-in link, their username and the temporary password.
   - The first time they sign in, they must choose their own password before they can do anything.
   - **Reset password** sends a new temporary password. **Edit → untick Active** blocks someone's sign-in.
   - Only you (the owner) can add or change directors.
   - Anyone can change their own password under **My password**.

**When you change Code.gs later:** Deploy → Manage deployments → ✏️ → Version: *New version*. The URL stays the same.

---

## Running a Saturday / Sunday tournament

1. **Players** tab: add everyone once (first, last, phone and/or email). They stay in the database for good.
2. **+ New tournament**, or pick a **template**. Set the game, format, races, tables and money. Tick *Also save as template* the first time, so next week is one click.
3. **Players (in the tournament)**: search and tap names to enter them, tick **Paid**, then press **Send everyone their player link**.
4. **Draw.** For a round robin, press **Draw groups → Create schedule**. For a knockout, press **Draw bracket**. All the matches now exist, but **nobody is called and nobody gets a message yet**. Players can already see the draw and their times on the public page. **Undo** removes the draw if you need to change something.
5. **Plan & times** tab (optional):
   - **Table:** book any match onto a table. Booking more than one match on the same table makes a queue, and the **#** sets the order.
   - **Time:** set a time on one match, or use **Time for whole round** to time a full round in one go (e.g. Round 1 12:00, Quarter-finals 1:30). Times show in the bracket, the match lists and on each player's page.
   - **Start play:** each table's first booked match goes on and those players are messaged. When a table frees up, its next booked match goes on first. With auto-call on, unbooked matches fill any free table.
   - **During play:** you can keep booking and re-timing matches on this tab. Any match can be moved on the **Tables** or **Matches** tab.
6. Players score on their phone from their link. One entry is enough.
7. Round robin: when groups finish, press **Generate finals**. Top players qualify, wild cards are drawn at random and the bracket is seeded.
8. **Finish tournament**: places, payouts, ranking points and stats lock in. **Money** tab: tick *Paid out* as you hand out prizes.

### Doubles, Jack & Jill, and team events
In tournament **Settings → Players or teams**, set **Entry type**:
- **Doubles (scotch):** partners alternate shots and the pair scores like one player. Tick **Jack & Jill** so every pair must be one Jack and one Jill.
- **Teams:** player vs player, one game each, in rounds. Pick the **Team format**: 3v3, 4v4, **5v4** (5 players, 4 rounds) or 5v5. Each round the opponents rotate (the small numbers on the card). The **home** team (listed first) breaks in rounds 1, 3 and 5, and **away** breaks in 2 and 4. Before the match, each side picks its line-up on the phone. Set **Team match won by**:
  - **Match card (points):** works like your league card. Each game is 10 for the winner and balls made for the loser (an ERO is still 10). **Round total** = points + handicap. The round goes to the higher round total; if that's tied, more game wins takes it. **+1** goes to the team with more total points overall (tie → more wins). The highest **Total** wins the match. If the Total is tied, the last round is replayed and the replay decides it. Each game can be tagged **ERO / BRO / 1ST**.
  - **Race to X game wins:** the races in Settings are team wins (e.g. race to 11). Rounds keep rotating until a team gets there.
  - **Handicap:** the director types it in each team's **Hcp** box on the Players tab. On the match card it's added **every round** (e.g. 5 per round). In a wins race it's the starting wins.

On the tournament's **Players** tab:
1. Add players. For Jack & Jill, tap **+ Jack** or **+ Jill** beside each name.
2. To pair by hand, tick the players, type a name if you want one, and press **Make pair / Make team**.
3. To pair at random, press **🎲 Draw random pairs / teams**. For Jack & Jill it always pairs a Jack with a Jill. Anyone left over stays in the list.
4. Type a team name in the box beside any pair or team. **Split** breaks a pair or team back into individuals (registration only). The **Hcp** box sets a team's handicap.

**Entry fee is per:** team or player. **Personal stats:** count finishes and winnings only, count everything (matches and EROs), or don't count. Team winnings are split evenly among members in the stats.

### Scoring rules built in
| | Round robin | Knockout |
|---|---|---|
| **8 ball** | Win **10**, ERO **13** (round robin only), loser = balls made (0–7). After an ERO, the opponent may answer with a **Response ERO (13)** | Race to X racks, or a points race (win 10, loser balls; an ERO is 10). EROs tracked, no response |
| **9 ball** | 1 per game won. Break & runs tracked | Race to X racks. Break & runs tracked |

**Standings tie-breakers** (from your workbook): total score → head-to-head score → total wins → total EROs → one-game playoff. For a playoff, the director enters the order on the **Standings** tab.

**Finals** (workbook defaults, changeable per event): 1 group → top 8. 2–3 groups → top 4 each + 4 wild cards. 4 groups → top 3 each + 4 wild cards. Byes fill out the bracket. Seeding: all 1st places, then 2nds, 3rds…, then wild cards in draw order.

**Races**: A-side, B-side, B-side final, and final / grand final are set separately. Any single match can be changed by opening it as a director.

---

## Messages to players: what's free and what isn't

- **Email** is free through Google, but a regular Gmail account can only email **100 recipients a day**. A 36-player round robin has about 290 match calls, so emailing every call won't fit.
- **The recommended way (free):** send each player their **personal link once** at check-in (36 messages). Their page updates by itself, shows **GO TO TABLE X**, and buzzes Android phones when they're called.
- **Text button (free):** on the Tables and Players tabs, **Text** opens *your* phone's messaging app with the message already written. One tap to send.
- **Automatic texts (optional, paid):** sign up for Twilio, buy a Canadian number, fill in `setTwilio()` in Code.gs and run it once. Every match call then texts both players automatically. Check Twilio's current pricing before turning it on.

If you use email for match calls on big days, untick *Message both players when their match is called* and rely on the player links.

---

## Where the data lives (Google Sheet tabs)
`Players` · `Directors` (passwords are stored hashed) · `Invites` · `Tournaments` · `Entries` (paid, group, seed, place, payout, team members & name) · `Matches` (current events) · `MatchHistory` (finished events, which feeds stats) · `Templates` · `Log` (who changed what).

## Stats kept per player
Ranking points (last 12 months, based on finish), events, titles, best finish, cashes, winnings, match W–L and %, game/rack W–L and %, EROs and ERO rate, average round-robin points, 8-ball vs 9-ball match %, recent results, and head-to-head against every opponent.
