# Importing your own Nikke roster

[한국어](USER_GUIDE.md) · **English** · [日本語](USER_GUIDE.ja.md)

This is how to read **your own account's Nikke data** — the data you can already see
once you log in to Blablalink (Shiftypad) — and load it into the
[MechaShifty CP calculator](https://radm90.github.io/MechaShifty/#tab=calc).
Once it is in, you get the corrected combat power of every Nikke you own at a glance,
and clicking any of them drops it straight into the calculator form.

This project started because the combat power Shiftypad shows disagrees with the
in-game value, so **the collector script does no maths of its own.** It only carries
across the values the game hands it; the combat power is computed by MechaShifty with
a formula verified against the reference workbook (`COMBAT_POWER.md`).

The collector window speaks Korean, English and Japanese. It starts from your browser language,
but **the 한국어 / English / 日本語 buttons at the top of the window switch it at any time, and the
choice is remembered.** A browser's language *order* is separate from its display language — an
English entry often sits above Korean or Japanese — so auto-detection can land on the wrong one,
and an explicit choice always wins.

---

## Which one should I use?

|  | Tampermonkey userscript (recommended) | Bookmarklet |
|---|---|---|
| Where the code lives | Stored in your browser | Downloaded on every run |
| Install | Needs a browser extension | One bookmark |
| Running it | Pick it from the extension menu | Click the bookmark |
| If the code changes | Stays as-is until you update | Hash mismatch → **refuses to run** |
| Mobile | Difficult | Possible in some browsers |

Both do exactly the same thing and share one file, `mechashifty.user.js`.

---

## 1. Tampermonkey (recommended)

### 1-1. Install the extension

Get it for your browser from [tampermonkey.net](https://www.tampermonkey.net/).
Chrome, Edge, Firefox, Safari and Opera are supported.

### 1-2. ⚠️ Turn on "Allow user scripts" — required on Chrome / Edge

When Chrome moved extensions to MV3, running userscripts started to need **one extra
permission that is off by default.** Without it Tampermonkey installs fine and its icon
shows up, but **no script ever runs.** "I installed it and the menu is empty" is almost
always this.

**Chrome 138+ and current Edge**

1. Open `chrome://extensions` (`edge://extensions` on Edge) in the address bar.
   Right-clicking the Tampermonkey icon → *Manage extension* gets you to the same place.
2. Find **Tampermonkey** in the list and click **Details**.
3. Turn **Allow user scripts** **on**.
4. Reload the Tampermonkey dashboard once.

**Chrome older than 138**

Turn on **Developer mode** with the toggle at the top right of that same
`chrome://extensions` page, then restart the browser once.

> A common trap: Tampermonkey may say "developer mode is required" when what is actually
> missing is the **"Allow user scripts" toggle**, not developer mode. If you enabled
> developer mode and it still does not work, go back to step 3.

**Firefox and Safari** do not need this step. On Safari, give the Tampermonkey extension
**Always Allow** access to `blablalink.com` instead.

### 1-3. Install the script

1. Open **[mechashifty.user.js](https://radm90.github.io/MechaShifty/userscript/mechashifty.user.js)**.
   Tampermonkey shows its install screen.
2. **Read the code before you install it.** Everything this script does is on that screen —
   in particular, the five `API_` constants are the complete list of addresses it contacts.
3. Click **Install**.

### 1-4. Run it

1. **Log in** at [blablalink.com](https://www.blablalink.com/).
   Run it from that logged-in tab, not a different one.
2. Click the Tampermonkey icon in the toolbar. If you cannot see it, open the browser's
   extensions puzzle-piece menu and **pin** it.
3. Choose **Export my Nikke roster**.

> If that entry is not in the menu, check in this order: (a) the toggle from 1-2,
> (b) that the page you are on is `www.blablalink.com`, (c) that the script is **Enabled**
> in the Tampermonkey dashboard.

### About automatic updates

Tampermonkey periodically re-checks the address you installed from and pulls new versions.
If you would rather that never happen — so that nothing changes in your browser even if
the author changes the code later — do one of these:

- Tampermonkey → the script → **Settings** tab → set *Check for updates* to **Never**.
- Or do not install from the URL at all: create a **new script** in the dashboard and paste
  the source in. With no install URL there is no update check to begin with.

---

## 2. Bookmarklet

For places where Tampermonkey is not an option (work machines, some mobile browsers).
Create a new **bookmark** and paste the whole line below into its **URL** field. Any name will do.

```
javascript:(async()=>{const U='https://radm90.github.io/MechaShifty/userscript/mechashifty.user.js',E='559c8589e0d06ad0035cabcf094d8ceab25c5978254ce359491ab3529b04b41d',l=(navigator.language||'en').toLowerCase(),M=l.startsWith('ko')?{b:'MechaShifty: 스크립트가 배포본과 다릅니다. 실행하지 않았습니다. USER_GUIDE 에서 북마클릿을 다시 복사하세요.',e:'MechaShifty: 불러오지 못했습니다 - '}:l.startsWith('ja')?{b:'MechaShifty: スクリプトが配布物と異なります。実行しませんでした。USER_GUIDE からブックマークレットをコピーし直してください。',e:'MechaShifty: 読み込めませんでした - '}:{b:'MechaShifty: the script differs from the release. Nothing was run. Copy the bookmarklet again from the USER_GUIDE.',e:'MechaShifty: could not load - '};try{const s=await(await fetch(U,{cache:'no-store'})).text();const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));const g=[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');if(g!==E){alert(M.b);return}(0,eval)(s)}catch(e){alert(M.e+e.message)}})();
```

Click the bookmark while you are logged in to blablalink.

All that line does is fetch the script and run it **only if its SHA-256 matches the hash
baked into the line above.** If the released file differs by a single character, it refuses
to run. That means the bookmark stops working whenever the script is updated and you have to
copy a fresh line from here. **That is the point, not an inconvenience** — code you have not
reviewed does not run.

A readable version lives in [`bookmarklet.js`](bookmarklet.js).

---

## 3. Getting it into the calculator

When collection finishes, the window offers three routes.

- **Send to the MechaShifty calculator** — opens a new tab and loads straight in.
  The hand-off names `https://radm90.github.io` as the target origin, so no other site
  can intercept it.
- **Save as a JSON file** — then pick it from *My account → Open JSON* in the calculator.
  This route touches the network not at all.
- **Copy to clipboard** — paste it into the *Paste* box. Convenient on mobile.

What you import stays in **this browser's localStorage only**. Nothing is sent to a server.
Press *Clear* in the calculator to delete it.

---

## What is taken, and what is not

**Taken** (all of it is already visible on your own account screens)

- Per Nikke: level · limit break / core enhancement · the three skill levels · all four gear
  slots with their overload options · harmony cube (kind and level) · collection item /
  favourite item · bond
- Account: synchro level · outpost Recycling Room research levels · account creation time ·
  campaign progress (last cleared Normal / Hard stage) · outpost level

The account values are used by the **Outpost tab** too — campaign progress fills in the
outpost level and resource income, and the creation time is what the Tribe Tower card uses to
work out how many floors you could have climbed.

Only values that appear on a calculator screen or feed the combat power formula are kept.
Everything else is discarded during collection, so it never reaches the file at all.

**Not taken**

- Login cookies, sessions, auth tokens — never read.
- **openid (your account identifier)** — used only as an API argument, never put in the output.
  A `scrub()` function in the script aborts the export outright if anything identifier-shaped
  is still present in the result.
- **Nickname and server** — the calculator does not use them, so they are not included.
- Anyone else's account — it reads only yours, and does not follow another user ID from the URL.

---

## Why it is built this way

The point is to shrink the risk of running someone else's code on top of your logged-in session.

| Property |
|---|
| Fetches and runs no external code. The bookmarklet variant is pinned by hash |
| No external libraries. JSON instead of a spreadsheet |
| Names the receiving origin explicitly; the receiver checks the sending origin in turn |
| Checks for identifiers immediately before export, so no account info can leak into the result |

There is no `eval`, `new Function`, `<script src>` or `import()` anywhere in
`mechashifty.user.js`. That removes any room for code you once read to quietly start doing
something else later. (Only the bookmarklet variant uses `eval`, and only on code whose hash
already matched.)

---

## When it does not work

| Symptom | What to check |
|---|---|
| No entry at all in the Tampermonkey menu | **The "Allow user scripts" toggle from 1-2.** By far the most common cause |
| It says "developer mode is required" | It may really be the "Allow user scripts" toggle. See 1-2 |
| Icon shows but the menu is empty | Whether the current page is `www.blablalink.com`, and whether the script is *Enabled* |
| "You are not logged in…" | Whether you are logged in to blablalink, and ran it from that tab |
| "Could not find your game server" | Account linking and public-profile settings. A private account gets no API response |
| "The popup was blocked" | Allow popups, or save a JSON file and import that instead |
| "No reply" | The tab that opened has to be on the **CP calculator**. Otherwise use the file route |
| Bookmarklet says it "differs from the release" | The script was updated — copy the line above again |
| The window is in the wrong language | Pick one with the language buttons at the top. It is remembered |
| A Nikke is missing from the list | Freshly released Nikkes are not in the site data yet; only those are skipped |
| Gear tier is wrong | Gear with no overload options at all reads as T9 corporation gear. Fix it in the form |

---

## Maintainer notes

Whenever `mechashifty.user.js` changes, always also:

```sh
shasum -a 256 userscript/mechashifty.user.js
```

Put the resulting hash into `EXPECT` in `bookmarklet.js` **and into the bookmarklet line in
all three language guides**, then bump `@version`. Skip this and existing bookmarklet users
get a refusal (which is the intended behaviour).

If the payload format (`mechashifty.roster/2`) changes, `parseRoster` in `assets/roster.js`
has to change with it. Nikkes are matched by `name_code` from `data/nikkes.json`, which
`tools/update_data.py --nikkes` fills from the live CDN.

When you add a user-facing string, fill in all three columns (ko/en/ja) in the `STR` table
in `mechashifty.user.js`.
