# First Foods Tracker

A small, free website for logging the foods our baby has tried, how she liked them, and the 9 major allergens. Both parents log from their own iPhones; entries sync through this repo.

**Site:** https://ngreensphan1.github.io/first-foods/

## How it works

- Plain HTML, CSS and JavaScript. No build step, no server, no dependencies.
- `foods.json` is the food catalog (327 foods). Safety notes cite CDC, FDA/EPA, health.gov, NHS and state health sources.
- The shared log is `log.json` on the **`data`** branch. Each phone reads and writes it through GitHub's API using a fine-grained token that only has *Contents: read and write* on this repo.
- Every change is an event with a unique id. If both phones save at once, GitHub rejects the stale save (409), the app re-reads, merges by id and retries, so nothing is lost.
- Works offline; unsent entries sync when the phone is back online.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell |
| `styles.css` | Design tokens and components (from Claude Design) |
| `app.js` | UI, event log, GitHub sync |
| `foods.json` | Food catalog |
| `sw.js` | Offline cache |
| `manifest.webmanifest`, `icons/` | Home Screen install |

## Setting up a phone

1. Open the site in Safari or Chrome (use the same one each time).
2. Enter your name and paste the token (stored only on that phone).
3. Enter the baby's name and birthdate (shared to both phones).
4. Share → **Add to Home Screen**.

Never commit the token to this repo.

*For tracking only; not medical advice.*
