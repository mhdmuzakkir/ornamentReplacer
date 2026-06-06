# Ornament Replacer - Agent Guide

> **Purpose**: Essential context for AI coding agents working on this project.

---

## Project Overview

**Ornament Replacer** is an Adobe CEP panel extension for Adobe Illustrator.

| Attribute | Value |
|-----------|-------|
| Host Application | Adobe Illustrator (ILST) |
| CEP Version | 11.0 (CSXS.11) |
| Extension Type | Panel |
| Current Version | 3.5.0 |

---

## Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| UI | HTML5, CSS3, Vanilla JS | No frameworks. Single-page panel UI. |
| Illustrator Integration | ExtendScript (JSX) | jsx/host.jsx (~1999 lines) + per-ornament scripts. |
| CEP Bridge | lib/CSInterface.js | CEP bridge library. |
| File I/O | Node.js APIs | --enable-nodejs + --mixed-context. |
| Data Storage | JSON files on disk | Template prefs, settings. |
| Styling | CSS custom properties | Dark theme matching Illustrator. |

**Critical constraint**: ES6 modules are **not used**. Scripts load via traditional script tags.

---

## Project Structure

    ornamentReplacer/
    |-- CSXS/
    |   |-- manifest.xml
    |-- assets/
    |   |-- icon.svg
    |   |-- icons/
    |       |-- drive.svg
    |-- css/
    |   |-- style.css
    |   |-- surah_names.ttf
    |-- jsx/
    |   |-- host.jsx
    |   |-- ayah.jsx
    |   |-- ayahalign.jsx
    |   |-- border.jsx
    |   |-- hizb.jsx
    |   |-- hizbx.jsx
    |   |-- layercopy.jsx
    |   |-- ruba.jsx
    |   |-- sajdah.jsx
    |   |-- surah.jsx
    |-- lib/
    |   |-- CSInterface.js
    |   |-- main.js
    |   |-- drive-scanner.js
    |   |-- updater.js
    |   |-- mushaf_info.json
    |   |-- styles.css
    |-- index.html
    |-- version.json
    |-- check-update.bat
    |-- update.bat
    |-- install.bat
    |-- install.sh
    |-- README.md
    |-- .debug

---

## Build and Test Commands

### No Build System

This project has **no build process**, **no package manager**, and **no bundler**.

- Edit files directly.
- Changes take effect after restarting Illustrator or reloading the extension.

### Testing

There is **no automated test suite**. Testing is entirely manual. Verify:

1. **Panel loads** without console errors.
2. **Template browse** opens file dialog and loads template.
3. **Designs panel** shows available ornament types.
4. **Single file mode** processes the active document.
5. **Batch mode** processes all .ai files in a folder.
6. **Updater** checks for updates correctly.

---

## Code Organization

### Key Concepts

- **Template-Based Replacement** — A template .ai file contains named page items (ayah, sajdah, ruba, hizb, hizbx, surah, border). The extension copies these from the template and replaces matching objects in target documents.
- **Per-Ornament Scripts** — Each ornament type has its own .jsx file for specialized sizing and placement logic.
- **Google Drive Auto-Detect** — Uses drive-scanner.js (shared with other Mushaf tools) to find the project folder.
- **Self-Updater** — check-update.bat / update.bat / install.bat pattern (same as mushaftask and symbolPalette).

### Ornament Types

| Type | Arabic Name | Size (mm) | Script |
|------|-------------|-----------|--------|
| Ayah | ayah | 4-5 x 5-7 | ayah.jsx |
| Sajdah | sajdah | 12-15 x 21-22 | sajdah.jsx |
| Ruba | ruba | 12-15 x 25-26 | ruba.jsx |
| Hizb | hizb | 12-15 x 38-40 | hizb.jsx |
| HizbX | hizbx | 12-15 x 41-45 | hizbx.jsx |
| Surah | surah | 87-88 x 9-10 | surah.jsx |
| Border | border | 102-104 x 157-159 | border.jsx |

---

## Code Style Guidelines

### JavaScript

- **No ES6 modules** — Use traditional script loading and global namespace.
- **Var / let / const mixed** — Follow the surrounding style.
- **Functions are hoisted** — Declared with `function name() {}`.
- **Console logging is heavy** — Do not remove existing logs.
- **Path separators** — Windows paths are primary target.

### CSS

- CSS custom properties in `:root` for theming.
- Dark theme matching Adobe Illustrator native panels.

---

## Common Pitfalls for Agents

1. **Do not add ES6 module imports** — CEP does not support import/export.
2. **Do not delete console.log statements**.
3. **Path separators** — Windows paths are primary.
4. **ExtendScript returns strings** — Check for "null", "undefined", "Error".
5. **Node.js availability** — Check `typeof require !== 'undefined'`.
6. **Template page items must be named exactly** — lowercase: ayah, sajdah, ruba, hizb, hizbx, surah, border.
7. **Batch processing** — Template file is automatically excluded from batch mode.
8. **Self-update safety** — Only runs from user-writable paths (AppData).

---

## Related Systems

- **Mushaf Task Manager** (`mushaftask.extension`)
- **Symbol Palette** (`symbolPalette`)
- **WebP Exporter** (`mushaf-webp-exporter.extension`)

---

*Last updated: June 6, 2026*
