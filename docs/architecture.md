# Architecture decisions

## Local builder and CMS

The builder is a Vite/React application served on `127.0.0.1:5173`; the Payload/Next service owns authentication, persistence, and server-only GitHub operations on `127.0.0.1:3000`. The browser calls Payload's REST API with a session token held for the current tab. PostgreSQL is the canonical store for owner-scoped projects, pages, settings, and asset metadata. Uploaded raster files are kept separately in `apps/cms/public/media`, so database backups alone are not complete backups.

Payload's PostgreSQL adapter was selected because the brief requires a durable local relational database; see the official [PostgreSQL adapter guide](https://payloadcms.com/docs/database/postgres). Payload's installation requirements and configuration model are documented in the [installation guide](https://payloadcms.com/docs/getting-started/installation). The Vite builder uses the [Payload REST API](https://payloadcms.com/docs/rest-api/overview) rather than a public deployment or hosted data service.

## Owner and project boundaries

The local instance is deliberately single-owner. The first account is the only account that can be created; collection access rules scope reads, updates, and deletes to that owner. Hooks also verify that a page or image's project belongs to the current user and validate incoming page data using the same schema as the source generator.

## Generated websites

The canonical component tree is JSON validated with Zod. The editor preview uses the shared React renderer; exported sites are generated independently as React + Vite + TypeScript and contain only page data, renderer code, CSS, and referenced local assets. User-authored text is stored as JSON and rendered as React text, not inserted as raw HTML. The validator writes generated files into a private temporary directory, bounds paths and size, installs dependencies with lifecycle scripts disabled, runs a production build, and removes the temporary directory whether the build passes or fails.

## Uploads and local media

Only PNG, JPEG, WebP, and GIF are accepted. The browser and Payload both enforce a 5 MB per-file limit; Payload also caps the whole multipart request and file count. SVG is intentionally disabled until the project has a reviewed sanitizer and serving policy. See Payload's official [upload overview](https://payloadcms.com/docs/upload/overview) for `staticDir`, MIME restrictions, and Payload-wide multipart limits.

## GitHub credentials and pushes

GitHub credentials stay on the local server. A fine-grained token is checked against GitHub, encrypted at rest using AES-256-GCM with a key derived from the local `WEBCRAFT_SECRET`, and written outside tracked source files. A push validates the generated website before creating Git blobs, a tree, and a commit through GitHub's API. The local WebCraft builder's repository is separate from any website a user exports.

## Deliberate scope limits

This MVP favors validated page trees and a safe, reproducible export over arbitrary HTML. Nested drag-and-drop, grouping, copy/paste, advanced settings such as custom CSS/HTML metadata or responsive breakpoints, an SVG sanitizer, direct folder export, and true database-backed runtime integration tests are not yet implemented. See the README's current-limits section before relying on a missing feature.
