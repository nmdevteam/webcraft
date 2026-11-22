# WebCraft

WebCraft is a local-first visual website-builder foundation built around Payload CMS, PostgreSQL, React, Vite, and TypeScript. Run it on your own machine to manage website projects, edit and preview pages at desktop/tablet/mobile widths, recover drafts, export a standalone site as a ZIP or (where supported) directly into a local folder, and push generated source to GitHub.

This repository is a working MVP, not a claim that every item in the original product brief is complete. The implemented scope and remaining limits are listed below.

## What works today

- A local dashboard for creating, searching, renaming, duplicating, exporting, and deleting website projects, with ten template categories and starter layouts.
- A single-owner local account, owner-scoped project/page/image access, separate pages per project, homepage selection, slugs, and page SEO title/description.
- A live component renderer, text editing, common style properties, an advanced style panel for layout, typography, borders, shadows, sizing, spacing, and opacity, plus tablet/mobile per-component overrides.
- Multi-select components with Shift/Cmd-click on the canvas or layers. Copy, cut, paste, duplicate, and delete selections as one undoable operation; the inspector continues editing the primary selection. Keyboard shortcuts include Ctrl/Cmd+C/X/V/D, Delete/Backspace, Escape, and Ctrl/Cmd+Z/Y.
- Per-project title, description, language, brand color and font, logo and favicon selection, safe name/property metadata tags, custom CSS, and configurable mobile/tablet breakpoints. These settings are applied in the editor preview and standalone export.
- A local raster-image library for PNG, JPEG, WebP, and GIF, with folders, search, reusable images, display-name editing, physical filename renaming, move and delete controls. Renames re-upload the existing image through Payload and update saved page and website-setting references. Uploads are capped at 5 MB; SVG and other active/vector formats are rejected.
- Autosave after a short idle period, manual save and Ctrl/Cmd+S, retry on network errors, revision checks, and best-effort IndexedDB recovery drafts.
- A standalone React + Vite + TypeScript generator. ZIP downloads, local-folder exports, and GitHub pushes are validated and production-built in an isolated temporary directory. The generated site does not require the builder or CMS at runtime.
- Browser folder export through the File System Access API where available. It asks for a parent folder, validates output paths, and creates a new non-overwriting project directory; use ZIP export in browsers that do not support the picker.
- Local GitHub connection, repository listing/creation, and source push. GitHub tokens are encrypted on the local server and are not returned to the browser. New repositories default to private in the app; the owner can choose public visibility.

## Current limits

- Component drag-and-drop and reordering operate at the page's top level; nested grouping and group/ungroup are not implemented.
- Asset renames replace the upload through Payload and update saved references across project pages and settings; SVG uploads remain disabled for safety.
- Custom CSS is checked for known executable and import patterns, but custom CSS is still author-supplied styling, not a sandbox; review it before publishing. Custom metadata accepts safe `name` and `property` tags rather than arbitrary HTML or scripts.
- Direct local-folder export depends on browser File System Access API support and user permission; the validated ZIP export is the portable fallback.
- The local database and uploaded media are stored separately. Back up both the database data and `apps/cms/.webcraft/media`. On startup/build, existing files in the former public media folder are moved into private storage.
- WebCraft is designed for a single-owner local installation, not an internet-facing multi-tenant service. Keep the CMS and PostgreSQL on loopback unless you add and review an appropriate deployment security model.

## Requirements

- Node.js `24.22.3` or newer, matching the installed Payload 3 line's supported Node requirement.
- pnpm `10.12.1` (the repository pins it in `package.json`).
- Docker Compose v2 for the included local PostgreSQL service.

## Run locally

```sh
pnpm install
pnpm run setup             # creates a private .env with random local secrets
docker compose up -d db
pnpm dev
```

Open the builder at <http://127.0.0.1:5173>. On first launch, create the single local owner account. The Payload API is on <http://127.0.0.1:3000> and is bound to loopback by the dev script.

`pnpm run setup` does not overwrite an existing `.env`. Keep `.env` private and out of Git. The generated file uses mode `0600`. The compose service binds PostgreSQL to `127.0.0.1:5432` and persists data in the `webcraft-postgres` Docker volume. To stop the database without deleting data, run `docker compose stop db`; deleting the volume removes the database and is destructive.

## Development and checks

```sh
pnpm typecheck
pnpm test                         # core schema and source-generator tests
pnpm test:integration             # install and production-build a generated sample site
pnpm build                        # core, CMS, and builder production builds
pnpm security:audit               # production dependency advisory scan
```

The generated-project validator uses `npm install --ignore-scripts --include=dev` in a fresh temporary directory, then runs the generated `npm run build`, and removes the directory afterward. It accepts at most 300 source files and 8 MB of combined source. An export supports at most 100 pages and 100 project assets; uploaded image data is additionally limited to 5 MB combined per export. The dashboard, editor, and preview paginate their project, page, asset, and folder lists rather than silently hiding records after the first 100.

## GitHub connection

In **Settings → GitHub integration**, connect a fine-grained personal access token. For listing and pushing to an existing repository, grant Metadata read and Contents read/write for the repositories the token can access. Repository creation additionally needs Administration read/write. WebCraft sends the token to the local CMS once, checks it with GitHub, encrypts it using AES-256-GCM with a key derived from `WEBCRAFT_SECRET`, and stores it in `.webcraft/github-token.enc` with restrictive local permissions. Disconnect deletes that encrypted file.

The app requires an explicit repository selection for each push, validates the generated website before making a commit, and protects `nmdevteam/nmdevteam` from its export endpoint. The project repository for this WebCraft source code is separate from that protected profile repository.

## Local data and security notes

The CMS enforces owner-scoped access, prevents pages and assets from being reassigned between projects, and serves uploaded media through Payload's authenticated file endpoint rather than an unauthenticated public directory. It validates component trees, project settings and page fields, restricts uploaded image MIME types and size, rejects unsafe URL schemes and known unsafe CSS constructs, and escapes generated HTML metadata. The generated renderer uses React text rendering rather than raw HTML insertion. Generated file paths are checked before a local folder export is written. GitHub tokens, `.env`, private media, and the database volume are excluded from source control.

For more detail, see [Security Policy](SECURITY.md), [Architecture decisions](docs/architecture.md), and the [dependency security audit](docs/security-audit.md).

## License

WebCraft is released under the [MIT License](LICENSE). Copyright © 2026 nmdevteam.
