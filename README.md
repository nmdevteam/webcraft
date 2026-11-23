# WebCraft

WebCraft is a local-first visual website-builder foundation built around Payload CMS, PostgreSQL, React, Vite, and TypeScript. Run it on your own machine to manage website projects, edit and preview pages at desktop/tablet/mobile widths, recover drafts, export a standalone site as a ZIP or (where supported) directly into a local folder, and push generated source to GitHub.

This repository is a working MVP, not a claim that every item in the original product brief is complete. The implemented scope and remaining limits are listed below.

## What works today

- A local dashboard for creating, searching, renaming, duplicating, exporting, and deleting website projects, with ten template categories and starter layouts.
- A single-owner local account, owner-scoped project/page/image access, separate pages per project, homepage selection, slugs, and page SEO title/description.
- A live component renderer, text editing, common style properties, an advanced style panel for layout, typography, borders, shadows, sizing, spacing, and opacity, plus tablet/mobile per-component overrides.
- Multi-select components with Shift/Cmd-click on the canvas or layers. Copy, cut, paste, duplicate, and delete selections as one undoable operation; the inspector continues editing the primary selection. Keyboard shortcuts include Ctrl/Cmd+C/X/V/D, Delete/Backspace, Escape, and Ctrl/Cmd+Z/Y.
- Per-project title, description, language, brand color and font, logo and favicon selection, safe name/property metadata tags, custom CSS, configurable mobile/tablet breakpoints, public HTTP(S) site origin, social-sharing image, and validated schema.org JSON-LD. These settings are applied in the editor preview and standalone export.
- A project-scoped design system with editable color palettes, shared color tokens, H1–H6/body typography presets, spacing and sizing tokens, and global button, link, card, input, and navigation styles. Element controls store CSS-variable references, so token edits synchronize across every page; the same validated variables/rules are included in preview and standalone CSS, with custom CSS applied last.
- A local raster-image library for PNG, JPEG, WebP, and GIF, with folders, search, reusable images, display-name editing, physical filename renaming, move and delete controls. Renames re-upload the existing image through Payload and update saved page, undo/redo, local recovery-draft, and website-setting references. Uploads are capped at 5 MB; SVG and other active/vector formats are rejected.
- Autosave after a short idle period, manual save and Ctrl/Cmd+S, retry on network errors, required revision tokens for every page update, and best-effort IndexedDB recovery drafts.
- Validated path-copy editor updates that preserve unchanged tree branches, suppress no-op history entries, retain immutable undo/redo snapshots without cloning the full tree per edit, and memoize unchanged canvas nodes. Concurrent authenticated-media requests are deduplicated; a bounded session-scoped LRU retains idle object URLs without evicting active media.
- An editor **Analyze** action that reads persisted project settings/pages/assets and generated-site source to report actionable SEO, performance, and accessibility findings. It checks generated metadata and routes, page titles/descriptions/headings/links, source and image byte counts, production build output and gzip sizes, known generated CSS usage, image alt text, heading order, link names, and resolvable color contrast.
- A form builder for contact, newsletter, and custom forms. Frontend-only forms validate in the browser and explicitly do not send responses; external submission is enabled only with a validated HTTPS or same-origin endpoint and sends without browser credentials. The endpoint must support browser CORS where cross-origin.
- Page-scoped entrance, scroll, hover, and link-exit CSS animations with reduced-motion support. Editor previews suppress motion so editing remains predictable.
- Project-level PWA configuration and export: conditional manifest, theme color, icon paths checked against the selected project's assets and exact 192×192/512×512 dimensions, service-worker registration, bounded same-origin static-response caching, and an optional offline page. Installation still requires HTTPS or localhost.
- Authenticated Ctrl/Cmd+K workspace search for owned projects, pages, components, assets, settings, and eligible marketplace entries, with keyboard navigation and deep links. Results are owner-scoped and bounded to a recent sample, node-visit limit, and 60 displayed matches.
- A standalone React + Vite + TypeScript generator. ZIP downloads, local-folder exports, and GitHub pushes are validated and production-built in an isolated temporary directory. The generated site does not require the builder or CMS at runtime.
- Browser folder export through the File System Access API where available. It asks for a parent folder, validates output paths, and creates a new non-overwriting project directory; use ZIP export in browsers that do not support the picker.
- Local GitHub connection, repository listing/creation, and source push. GitHub tokens are encrypted on the local server and are not returned to the browser. New repositories default to private in the app; the owner can choose public visibility.

## Current limits

- Component drag-and-drop and reordering operate at the page's top level; nested grouping and group/ungroup are not implemented.
- Typography supports the built-in Inter, system-ui, Georgia, and Arial stacks; Google Fonts loading and custom font uploads are not part of this phase. The eight foundational color tokens remain required, and a token used by saved content or global styles cannot be deleted.
- Asset renames replace the upload through Payload and update saved references across project pages, per-page undo/redo history, local recovery drafts, and settings; restoring an older project snapshot may bring back a path to a deleted or renamed image. SVG uploads remain disabled for safety.
- PostgreSQL migration `20261123_070000_integrity_guarantees` adds atomic page revision enforcement and unique indexes for per-project slugs, one homepage per project, and case-insensitive folder names. The adapter declares those same indexes in Payload's generated schema so non-production schema push preserves them. The migration's duplicate preflight stops without changing records if existing data conflicts; resolve those rows and rerun the migration. The export reads project, page, and asset metadata in a read-only repeatable-read snapshot. The separate media directory cannot join a PostgreSQL snapshot, so missing or unsafe files fail the export rather than producing a partial result. Keep this app on its documented single-owner local deployment model.
- Project-version snapshots contain page and settings data, not uploaded binary files or rename history. Asset deletion clears saved page/settings references and per-page undo/redo history before removing the image; asset renames update saved per-page history and drafts. Restoring an older project snapshot may reinstate a reference to an image that has since been deleted or renamed.
- Custom CSS is checked for known executable and import patterns, but custom CSS is still author-supplied styling, not a sandbox; review it before publishing. Custom metadata accepts safe `name` and `property` tags rather than arbitrary HTML or scripts.
- The Analyze report measures generated source and image bytes plus actual local production-build file counts, aggregate and JS/CSS/HTML sizes, per-file gzip sizes, and build duration. It does not run Lighthouse or a browser session, and those build sizes are not guaranteed to equal deployed transfer sizes. It does not report Core Web Vitals: field CWV require real field data from deployed users. Per-page title/description/canonical/social tags update after the generated React app hydrates; use prerendering/server rendering when no-JavaScript crawler previews are required. Contrast checks are limited to saved styles/design tokens and are skipped when project custom CSS could override them.
- Form submissions have no bundled server inbox, spam filtering, or delivery guarantees; choose and operate an endpoint you trust. PWA installation/offline behavior depends on deployment hosting and should be tested on its target HTTPS origin. Workspace search caps each record collection at 100 recent records, component traversal at 2,000 nodes, and output at 60 results, and marks capped responses as bounded rather than promising exhaustive search.
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

`pnpm run setup` does not overwrite an existing `.env`. Keep `.env` private and out of Git. The generated file uses mode `0600`. The compose service binds PostgreSQL to `127.0.0.1:5432` and persists data in the `webcraft-postgres` Docker volume. To stop the database without deleting data, run `docker compose stop db`; deleting the volume removes the database and is destructive. After Payload has initialized its collection tables on a new development database, apply the integrity migration with `pnpm --filter @webcraft/cms payload migrate`. On production deployments, apply tracked Payload migrations as part of the database deployment process before serving writes; do not use Payload schema push as a substitute for this migration.

## Development and checks

```sh
pnpm typecheck
pnpm test                         # core, analyzer, route-security, renderer-cache, builder, and migration-safety unit tests
pnpm test:integration             # install and production-build a generated sample site
pnpm build                        # core, CMS, and builder production builds
pnpm security:audit               # production dependency advisory scan
```

The integrity migration has duplicate-preflight unit coverage. Run the Payload migration against a disposable PostgreSQL database when validating a release; the migration intentionally refuses to proceed until duplicate legacy slugs, homepages, or case-insensitive folder names are resolved.

The initial schema baseline (`20261123_060000_initial_schema`) installs only into an empty application schema, skips an existing database only when its tables, columns, indexes, and constraints match, and refuses partial schemas. The baseline SQL resource excludes Payload's migration ledger; the migration creates Payload's compatible ledger table within the same transaction when needed so Payload can record the migration. It is intentionally irreversible: `migrate:down` stops rather than deleting tables or user data. Back up the database and media before migrations or resets.

The generated-project validator uses `npm install --ignore-scripts --include=dev` in a fresh temporary directory, then runs the generated `npm run build`, and removes the directory afterward. It accepts at most 300 source files and 8 MB of combined source. An export supports at most 100 pages and 100 project assets; uploaded image data is additionally limited to 5 MB combined per export. The dashboard, editor, and preview paginate their project, page, asset, and folder lists rather than silently hiding records after the first 100.

## GitHub connection

In **Settings → GitHub integration**, connect a fine-grained personal access token. For listing and pushing to an existing repository, grant Metadata read and Contents read/write for the repositories the token can access. Repository creation additionally needs Administration read/write. WebCraft sends the token to the local CMS once, checks it with GitHub, then encrypts it at rest with AES-256-GCM using a key derived from `WEBCRAFT_SECRET`, a fresh per-record salt and IV, and authenticated version/login metadata. New records are stored in `.webcraft/github-token.enc` with 0700 directory and 0600 file permissions. Historical v1 records remain readable and are re-encrypted as v2 on a successful read; v1 could not authenticate its login metadata. Keep `WEBCRAFT_SECRET` private and stable: changing it makes the existing token unreadable, so reconnect GitHub. Disconnect deletes the encrypted file.

The app requires an explicit repository selection for each push, validates the generated website before making a commit, and protects `nmdevteam/nmdevteam` from its export endpoint. The project repository for this WebCraft source code is separate from that protected profile repository.

## Local data and security notes

The CMS enforces owner-scoped access, prevents pages and assets from being reassigned between projects, and serves uploaded media through Payload's authenticated file endpoint rather than an unauthenticated public directory. GitHub tokens are encrypted on the local server; the browser session JWT in `sessionStorage` and local recovery drafts in IndexedDB are not encrypted by WebCraft, so do not treat those browser records as encrypted secrets. It validates component trees, project settings and page fields, restricts uploaded image MIME types and size, rejects unsafe URL schemes and known unsafe CSS constructs, and escapes generated HTML metadata. The generated renderer uses React text rendering rather than raw HTML insertion. Generated file paths are checked before a local folder export is written. GitHub tokens, `.env`, private media, and the database volume are excluded from source control.

For more detail, see [Security Policy](SECURITY.md), [Architecture decisions](docs/architecture.md), and the [dependency security audit](docs/security-audit.md).

## License

WebCraft is released under the [MIT License](LICENSE). Copyright © 2026 nmdevteam.
