**Schema Validator Extension - Gingco Communication - Version: 0.1 - 11 2026**

---

# Schema Validator (Chrome + Firefox)

Browser extension that validates the schema.org JSON-LD of the current page in a side panel (Chrome) / sidebar (Firefox).
Clicking the toolbar icon opens the panel. Validation runs fully offline against a bundled copy of the schema.org vocabulary.

## Features (v0.1)

- Reads all `<script type="application/ld+json">` blocks of the active tab (rendered DOM).
- Generic checks for **every** schema.org type, derived from the vocabulary:
  - JSON syntax, empty blocks, `@context` is schema.org
  - type and property exist (with "Did you mean …" suggestions)
  - property is expected on the type, including inherited properties (`domainIncludes` + `subClassOf`)
  - value matches expected type (`rangeIncludes`): Text, URL, Date, DateTime, Time, Number, Integer, Boolean, enumeration members, nested entities
  - superseded and pending terms
  - `@id` references resolve across all JSON-LD blocks on the page (undefined references: info)
- "Detected items" view like validator.schema.org: nodes with the same `@id` are merged, referenced nodes are nested instead of listed separately, undefined references show as `@type: Thing`.
- Severity filter (error / warning / info), structure tree with markers, click on issue jumps to the node, source view with copy.
- Re-scans on tab switch, page load and URL change. Manual "Rescan" button.
- Links to Google Rich Results Test and Schema Markup Validator for public pages.
- Toolbar badge after every page load (panel need not be open): number of detected items; red = errors, orange = warnings, green = valid, grey `0` = no JSON-LD. Tooltip shows counts.

Not included yet: Google rich-result rules (required/recommended per type), Microdata/RDFa, German UI.

## Requirements

- Node.js ≥ 18 (no npm dependencies)
- Chrome ≥ 116, Firefox ≥ 115

## Commands

| Command | Purpose |
|---|---|
| `npm run update-vocab` | Download the current schema.org vocabulary into `src/vocab.json` (commit the result) |
| `npm run build` | Build `dist/chrome` and `dist/firefox` (`build:chrome` / `build:firefox` for one target) |
| `npm test` | Run validator tests |
| `npm run build-icons` | Render `assets/icon.svg` to `src/icons/*.png` (needs Google Chrome, headless) |

## Install (internal, unpacked)

**Chrome:** `chrome://extensions` → enable Developer mode → "Load unpacked" → select `dist/chrome`.
Panel side: Chrome settings → Appearance → side panel position.

**Firefox:** `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on…" → select `dist/firefox/manifest.json`.
Temporary add-ons are removed when Firefox restarts. If the panel shows "cannot be read", use the "Grant access to all websites" button
or allow site access in `about:addons` → Schema Validator → Permissions.
Panel side: sidebar menu → "Move sidebar to right/left".

## Structure

```
manifests/        chrome.json, firefox.json (version is taken from package.json at build)
assets/icon.svg   logo source (JSON braces + check mark)
scripts/          build.mjs, update-vocab.mjs, build-icons.sh
src/background.js toolbar click → open panel
src/sidepanel.*   panel UI
src/lib/          extract.js (runs in page), validator.js (pure, tested)
src/vocab.json    compact schema.org vocabulary (generated)
test/             node:test suite
```

---

Autor: S. Sisupalan · Intern
