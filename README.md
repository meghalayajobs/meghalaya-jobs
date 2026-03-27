# Meghalaya Jobs Auto Blogger System

This project pulls Meghalaya government job notices from official department sites, groups them into `Recruitment`, `Admit Card`, `Result`, and `Other Notice`, and generates:

- static Blogger HTML
- a live Blogger widget snippet
- GitHub Pages files
- JSON data
- a local admin panel for editing department names and links

## What changed

- Hourly GitHub automation is configured.
- The UI is mobile-friendly.
- `North Garo Hills` now uses `https://northgarohills.gov.in/notice_category/announcements/`.
- Source links are editable from a local admin panel.
- A one-time Blogger live embed snippet is generated, so daily manual paste work is not needed.

## Main files

- `data/site-config.json`: editable source and quick-link config
- `generate-meghalaya-jobs.mjs`: scraper and output generator
- `admin-server.mjs`: local admin panel server
- `admin/panel.html`: admin interface
- `dist/meghalaya-jobs-blogger.html`: static Blogger HTML
- `dist/meghalaya-jobs-blogger-live.html`: one-time live Blogger embed code
- `dist/meghalaya-jobs-widget.js`: live widget script for Blogger
- `docs/`: GitHub Pages output

## Local use

### 1. Open the admin panel

```powershell
npm run admin
```

Open `http://127.0.0.1:8787`

### 2. Edit sources

In the admin panel you can:

- change department name
- change official link
- change per-site limit
- enable or disable a source
- add new department links
- update quick links

### 3. Generate output

Click `Generate Output Now`

This refreshes:

- `dist/`
- `docs/`

## Blogger setup with no daily manual work

This project is designed for a one-time Blogger paste.

### 1. Push this project to GitHub

The default config assumes your Pages URL will be:

`https://meghalayajobs.github.io/meghalaya-jobs`

If your repo name is different, update `Public Base URL` in the admin panel or in `data/site-config.json`.

### 2. Enable GitHub Actions

The repo already includes:

- `.github/workflows/update-meghalaya-jobs.yml`
- `.github/workflows/deploy-pages.yml`

The first workflow refreshes every hour.
The second workflow deploys `docs/` to GitHub Pages.

### 3. Paste the live Blogger code once

After running generation, open:

`dist/meghalaya-jobs-blogger-live.html`

Copy that full code into your Blogger page HTML view.

That snippet loads:

- `meghalaya-jobs-widget.js` from GitHub Pages

When GitHub updates every hour, Blogger loads the latest widget automatically.

## Static Blogger option

If you want a plain copy-paste version instead of the live widget, use:

`dist/meghalaya-jobs-blogger.html`

This is static HTML, so you would need to paste it again after future updates.

## Commands

Generate manually:

```powershell
npm run generate
```

Open admin panel:

```powershell
npm run admin
```

## Important note

GitHub URL `https://github.com/meghalayajobs` looks like an account URL, not a full repository URL.
This setup assumes a repo name like `meghalaya-jobs` under that account.
If the actual repo name is different, update `publicBaseUrl` before using the live Blogger snippet.
