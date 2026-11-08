# Mecha Shifty

A static site that brings together character and banner data and progression calculators for *Goddess of Victory: NIKKE*.

**Live site: <https://radm90.github.io/MechaShifty/>**

- Available in Korean, English, and Japanese, with light and dark themes.
- Filters are stored in the URL, so a shared link opens the same view.
- Only the CP calculator and the Manufacturer Tower estimates require account data. Everything else works right away.

## Features

### CP calculator

Shows the combat power (CP) of every Nikke you own on one screen, using account data collected from Blablalink.

| Feature | Description |
|---|---|
| Nikke list | One row per Nikke with limit break, collection item, bond, skills, gear, cube, and level, plus current, Lv. 40, and Lv. 400 CP side by side. |
| Sorting and filters | Sort by any column, or narrow the list by class, element, burst, manufacturer, cube, and name. Nikkes you don't own always stay at the bottom. |
| OL ATK | A single column that adds up the Elemental Damage and ATK overload option totals. |
| Nikke details | Overload option totals and per-slot details, calculated using the in-game display rules. |
| CP gain per step | The CP added by one more step of limit break, core enhancement, console level, or overload option, at Lv. 40 and Lv. 400. |
| Change cube | Try any cube currently equipped on one of your Nikkes. |
| Commander info | Synchro level and console levels. |
| Overload rolls link | Send the selected Nikke's overload gear to the Overload rolls tab. |

### Overload rolls

Calculates the cheapest route to your target options and recommends the next action after every result.

| Feature | Description |
|---|---|
| Targets | Set by total line count across all four gear slots: option type only, one minimum tier for every line, or an exact tier for each line. |
| Recommended lines | Use each Nikke's Budget or Endgame options as the target. |
| Resource priority | Plan routes with Save modules, Balanced, or No lock keys. |
| Modes | Simulate rolls at random, or log real results from the game to get the next action. |
| Keep or apply | Compares keeping the old result with applying the new one by average remaining cost. |
| Progress tracking | Shows resources spent, the roll log, and overload option totals before and after changes. |

### Outpost

Calculates your outpost level and resource income from campaign progress. Importing account data fills in the progress automatically.

| Feature | Description |
|---|---|
| Level | Outpost level from your last cleared Normal and Hard stages, plus the stages left until the next level. |
| Resource income | Core dust, credits, battle data, and commander EXP per minute, per hour, and per 24 hours, assuming a maxed Tactics Academy. |
| Next core dust step | The level and extra stages needed to reach the next whole number of core dust per hour, and where you would land pushing only Normal or only Hard. |
| Manufacturer Towers | The highest floor reachable since your account was created, molds earned so far, and the floors, runs, and weeks needed for one recruit (50 molds). |

### Nikkes

A searchable, filterable list of every Nikke.

| Feature | Description |
|---|---|
| Filters | Manufacturer, element, class, weapon, burst, rarity, squad, and release date. |
| Skill keywords | Show only Nikkes whose skills include a specific keyword. |
| Search | Partial matching on Korean, English, and Japanese names, squads, and nicknames. Also handles Korean initial consonants (`ㄹㅍ`, `라ㅍ`) and names typed without spaces or separators (`라피레드후드`). |
| Detail panel | Each Nikke's nicknames and banner history. |
| Synchro level cap by date | Counts Nikkes released by a chosen date, by rarity, to work out the synchro level cap on that date. |

### Banners

Shows banner periods and history.

| Feature | Description |
|---|---|
| Views | Table or timeline. |
| Filters | Ongoing, upcoming, or ended; limited or standard; banner type (Summer, Collab, Anniversary, and more); and rerun status. |

### Stats

Summarizes Nikke and banner data using the current filters.

| Feature | Description |
|---|---|
| Distributions | Breakdown by each axis, plus the top 12 squads. |
| Cross tables | Heatmaps of Nikke counts for all 10 pairs of manufacturer, element, class, weapon, and burst. |
| Releases over time | Switch between monthly, quarterly, half-yearly, and yearly views. |
| Banner stats | Limited vs. standard ratio, distribution by banner type, and time until rerun. |

### Intercept drops

Compares daily drop probability distributions for Anomaly Interception from before and after the 3.5th anniversary buff.

| Feature | Description |
|---|---|
| Conditions | Boss (Kraken for modules, others for manufacturer gear), Full Burst event day, Synchro Boost, and step. |
| Views | Switch between exactly k and k or more, with the difference and ratio between the two periods. |
| Module pieces | Optionally include guaranteed module pieces in the distribution. |

## Usage

### Using the site

Open the link above. There is nothing to install.

### Importing your account

Used by the CP calculator, the gear link in Overload rolls, and automatic Outpost progress.

1. Set up the collector script with Tampermonkey (recommended) or a bookmarklet.
2. Log in to Blablalink and run the script.
3. Send the collected data to the CP calculator tab, or open or paste the JSON there.

Imported data stays in your browser and is never sent to a server.
See the [user guide](userscript/USER_GUIDE.en.md) for the full steps.

### Running locally

There is no build step and there are no external dependencies. The site doesn't work over `file://`, so serve it over HTTP:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

## Documentation

**User guides**

- [Importing your Nikke data](userscript/USER_GUIDE.en.md) ([한국어](userscript/USER_GUIDE.md) · [日本語](userscript/USER_GUIDE.ja.md))
- [Overload option and value rolling guide](OVERLOAD_GUIDE.md) (Korean)
- [2026-09 reroll duplicate removal rule](NIPAGO_REROLL.md) (Korean)

**Overload references** (Korean)

- [Minimum-cost operating rules](RefDoc/니케_오버로드_최소비용_운영규칙_2026-11-04.md)
- [Endgame and recommended options by Nikke](RefDoc/니케별_오버로드_종결옵션_권장옵션_2026-11-07.md)
- [AI user training documents](RefDoc/니케_오버로드_AI_사용자_학습문서/)

**Developer references** (Korean)

- [Combat power formula](COMBAT_POWER.md)
- [Unresolved deviations and data gaps](DEVIATIONS.md)
- [Skill keywords](NIKKE_KEYWORDS.md) · [Keyword ID table](NIKKE_WORD_GROUPS.md)
