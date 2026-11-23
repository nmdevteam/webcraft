# Architecture decisions

## Local builder and CMS

The builder is a Vite/React application served on `127.0.0.1:5173`; the Payload/Next service owns authentication, persistence, and server-only GitHub operations on `127.0.0.1:3000`. The browser calls Payload's REST API with a session token held for the current tab. PostgreSQL is the canonical store for owner-scoped projects, pages, settings, and asset metadata. Uploaded raster files are stored separately in `apps/cms/.webcraft/media`, so database backups alone are not complete backups.

Payload's PostgreSQL adapter was selected because the brief requires a durable local relational database; see the official [PostgreSQL adapter guide](https://payloadcms.com/docs/database/postgres). Payload's installation requirements and configuration model are documented in the [installation guide](https://payloadcms.com/docs/getting-started/installation). The Vite builder uses the [Payload REST API](https://payloadcms.com/docs/rest-api/overview) rather than a public deployment or hosted data service.

## Owner and project boundaries

The local instance is deliberately single-owner. The first account is the only account that can be created; collection access rules scope reads, updates, and deletes to that owner. Hooks verify that a page or image belongs to an owned project, keep page and asset project relationships immutable after creation, and validate incoming page data using the same schema as the source generator.

## Data integrity and concurrency

Projects own their pages, image records, and asset folders. Page hooks check project ownership, validate the complete page tree and persisted undo history, reject duplicate slugs, allow one homepage, and require every update to carry a revision token that matches the revision read by Payload. The token is incremented after a matching update. Folder hooks check for duplicate names within a project. These checks are application-level reads performed before the write; they are not atomic database compare-and-swap operations or composite unique indexes. Two tabs writing at the same time can therefore race on a slug, homepage, folder name, or revision even though ordinary sequential edits are guarded.

The repository has no tracked Payload migration baseline. Payload initialized its schema in a disposable local PostgreSQL 16 cluster for REST runtime checks; no existing/user database was used, and this test database is not a migration baseline. Keep the documented single-owner/local deployment model; before supporting concurrent or multi-user writes, establish and test a migration baseline, add database-enforced uniqueness where appropriate, and make revision checks transactional or conditional.

The editor store uses validated immutable path-copy updates: unchanged branches retain their identity, and prior trees become frozen history entries rather than full-tree clones on every edit. Persisted undo/redo data is revalidated when loaded. Memoized renderer nodes compare node identity and per-node selection, while stable page-slug/callback props avoid rerendering the full canvas for unrelated editor state changes. Authenticated media reads deduplicate in-flight requests and retain a bounded LRU of idle object URLs per session; active media are not evicted. Session changes invalidate pending results and clear the cache.

Asset removal clears references from current page trees, saved per-page undo/redo snapshots, all project settings (including custom CSS, social image, and PWA icons), and local recovery drafts before the media record/file is deleted. If any saved-reference update fails, deletion stops and the file is kept. Renames update current page trees, per-page undo/redo snapshots, settings, and local recovery drafts after the physical file is renamed. Project-version snapshots contain page/settings JSON but not binary media or rename history; restoring an older snapshot made before an image was deleted or renamed can restore a path to a missing image. Back up the media directory alongside PostgreSQL.

## Generated websites

The canonical component tree is JSON validated with Zod. The editor preview uses the shared React renderer; exported sites are generated independently as React + Vite + TypeScript and contain only page data, renderer code, CSS, and referenced local assets. User-authored text is stored as JSON and rendered as React text, not inserted as raw HTML. The validator writes generated files into a private temporary directory, bounds paths and size, installs dependencies with lifecycle scripts disabled, runs a production build, and removes the temporary directory whether the build passes or fails. Project, page, asset metadata, and media bytes are read in separate operations rather than one repeatable-read snapshot; concurrent edits or uploads can make a validation/export reflect more than one point in time.
Generated text files, including the optional service worker and offline page, carry versioned WebCraft provenance comments. The generated package manifest and `src/site.json` include the same non-sensitive generator metadata; the optional PWA manifest includes it too. JSON files do not receive comments because comments would make them invalid JSON. The optional favicon is a raster image (PNG, JPEG, WebP, or GIF); SVG icons are not supported.

## SEO, performance, and accessibility analysis

The editor's analysis endpoint uses the authenticated same-origin request flow and reads the selected project, its pages, and its assets with Payload access controls enabled for the signed-in owner. It passes those saved records through the same standalone source generator used for exports, then returns only a bounded report; generated source and asset contents are not returned by the endpoint. Site origin, page metadata, social image selection, and schema.org JSON-LD are validated project settings. Generated exports include a canonical homepage, per-route metadata updates after React hydration, robots.txt, a sitemap only when a public origin is known, and safely serialized JSON-LD.

Performance findings measure actual generated text-source bytes and decoded image bytes, with limited source-level observations for generated CSS and image loading. They are not browser performance results: the analyzer does not run Lighthouse, measure Core Web Vitals, compressed transfer sizes, production bundle output, crawler rendering, or search-engine status. Accessibility findings inspect saved component structure and only resolvable color pairs; custom CSS disables modeled contrast findings because it can override those colors. Runtime keyboard, screen-reader, and assistive-technology behavior remains a manual/browser check.

## Forms, motion, PWA output, and workspace search

Form definitions are schema-validated component data that travel with the standalone export. Frontend-only mode performs browser validation but sends no response. External mode requires an HTTPS URL or a same-origin path, submits a browser `FormData` POST with credentials omitted and redirects rejected, and relies on the selected endpoint's CORS policy and server-side validation. WebCraft does not provide a form inbox or delivery service. Animations are exported as scoped CSS and small runtime hooks; editor mode suppresses them, and both preview/export honor `prefers-reduced-motion`.

PWA files are emitted only for enabled projects. The service worker caches only same-origin public static GET responses, enforces an entry cap and an 8 MiB streaming response limit, skips private/no-store and wildcard-`Vary` responses, and supports an optional offline document. The manifest's icon paths are copied into the export's asset directory; dimensions are not inspected, and installability still depends on a secure deployment origin.

Global search authenticates through the same-origin project-history request guard. Payload reads run with access control enabled and owner filters; pages, assets, and installed packages are only surfaced when linked to a project in the owner's fetched project set. Public marketplace packages are searchable alongside the owner's own packages. Reads are limited to the 100 most recent records per collection; nested component traversal shares a 2,000-node budget, and output is capped at 60 matches. The API reports when these bounds may have truncated the result set, returns no-store responses, and exposes labels/navigation targets rather than stored asset contents.

## Uploads and local media

Only PNG, JPEG, WebP, and GIF are accepted. The browser and Payload both enforce a 5 MB per-file limit; Payload also caps the whole multipart request and file count. SVG is intentionally disabled until the project has a reviewed sanitizer and serving policy. Originals and generated thumbnails are stored outside Next's public directory in `.webcraft/media`; the builder fetches them through Payload's authenticated file endpoint, and server-side exports read the same private files. The CMS startup, build, and start commands safely migrate older files from `public/media` into private storage. Back up the database and this media directory together. See Payload's official [upload overview](https://payloadcms.com/docs/upload/overview) for upload configuration and multipart limits.

## GitHub credentials and pushes

GitHub credentials stay on the local server. A fine-grained token is checked against GitHub, encrypted at rest using AES-256-GCM with a key derived from the local `WEBCRAFT_SECRET`, and written outside tracked source files. A push validates the generated website before creating Git blobs, a tree, and a commit through GitHub's API. The local WebCraft builder's repository is separate from any website a user exports.

## Deliberate scope limits

This MVP favors validated page trees and a safe, reproducible export over arbitrary HTML. Nested drag-and-drop, grouping, and group/ungroup are not implemented; SVG upload remains disabled. Direct local-folder export requires the browser File System Access API. See the README's current-limits section before relying on a missing feature.
