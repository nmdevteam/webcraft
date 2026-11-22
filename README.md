# WebCraft

WebCraft is a local-first visual website-builder foundation built around Payload CMS, PostgreSQL, React, Vite, and TypeScript. Run it on your own machine to manage website projects, edit pages visually, preview them at desktop/tablet/mobile widths, recover drafts, export a standalone site ZIP, and push generated source to GitHub.

This repository is an early, working MVP—not a claim that every item in the original product brief is complete. The implemented scope and the remaining gaps are listed below so contributors can see what is real today.

## What works today

- A local dashboard for creating, searching, renaming, duplicating, exporting, and deleting website projects, with ten template categories and starter layouts.
- A single-owner local account, owner-scoped project/page/image access, separate pages per project, homepage selection, slugs, and page SEO title/description.
- A live component renderer, text editing, basic style properties, top-level drag/reorder, duplicate/delete, selected-component copy/paste, undo/redo, and desktop/tablet/mobile canvas and clean preview modes.
- Autosave after a short idle period, manual save and Ctrl/Cmd+S, retry on network errors, revision checks, and best-effort IndexedDB recovery drafts.
- A local raster-image library for PNG, JPEG, WebP, and GIF. Each upload is capped at 5 MB; SVG and other active/vector formats are deliberately rejected.
- A standalone React + Vite + TypeScript generator. Downloaded ZIPs and GitHub pushes are first installed and production-built in an isolated temporary directory. The generated site does not require the builder or CMS at runtime.
- Local GitHub connection, repository listing/creation, and source push. GitHub tokens are encrypted on the local server and are not returned to the browser. New repositories default to private in the app; the owner can choose public visibility.

## Current limits

- Component drag-and-drop and reordering currently operate at the page's top level; nested grouping and group/ungroup are not implemented yet.
- The asset library supports upload, search, reuse, and delete, but not folders or filename renaming. SVG upload is disabled for safety.
- Project settings cover website name, description, language, primary color, and font. Favicon/logo management, custom CSS/HTML metadata, and configurable responsive breakpoints are not implemented yet. The current inspector exposes basic colors, typography, spacing, width, and alignment, not every advanced style property in the full brief.
- Export is provided as a validated ZIP; direct export to a local folder is not supported by a browser-based app.
- The local database and uploaded media are stored separately. Back up both the Docker volume and `apps/cms/public/media`.
- Runtime CMS/database behavior needs a working local PostgreSQL service. CI and this sandbox can typecheck/build source without PostgreSQL, but those checks do not replace a real end-to-end run against a database.

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
pnpm build                         # core, CMS, and builder production builds
pnpm audit                        # dependency advisory scan
```

The generated-project validator uses `npm install --ignore-scripts --include=dev` in a fresh temporary directory, then runs the generated `npm run build`, and removes the directory afterward. It accepts at most 300 source files and 8 MB of combined source. Uploaded image data is additionally limited to 5 MB combined per export.

## GitHub connection

In **Settings → GitHub integration**, connect a fine-grained personal access token. For listing and pushing to an existing repository, grant Metadata read and Contents read/write for the repositories the token can access. Repository creation additionally needs Administration read/write. WebCraft sends the token to the local CMS once, checks it with GitHub, encrypts it using AES-256-GCM with a key derived from `WEBCRAFT_SECRET`, and stores it in `.webcraft/github-token.enc` with restrictive local permissions. Disconnect deletes that encrypted file.

The app requires an explicit repository selection for each push, validates the generated website before making a commit, and protects `nmdevteam/nmdevteam` from its export endpoint. The project repository for this WebCraft source code is separate from that protected profile repository.

## Local data and security notes

WebCraft is intended for a single-owner local installation, not an internet-facing multi-tenant service. Keep its API and database on loopback, use unique secrets from `pnpm run setup`, and do not expose PostgreSQL publicly. The CMS enforces owner-scoped access, validates component trees and page fields, restricts uploaded image MIME types/size, rejects unsafe URL schemes and CSS constructs, and escapes generated HTML metadata. The generated renderer uses React text rendering rather than raw HTML insertion. GitHub tokens, `.env`, local media, and the database volume are excluded from source control.

For more detail, see [Security Policy](SECURITY.md), [Architecture decisions](docs/architecture.md), and the [dependency security audit](docs/security-audit.md).

## License

WebCraft is released under the [MIT License](LICENSE). Copyright © 2026 nmdevteam.
