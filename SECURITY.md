# Security Policy

WebCraft is an early local-first MVP intended for a single owner on a trusted machine. It is not currently designed or reviewed for public internet exposure, multi-tenant hosting, or production use with multiple users.

## Supported version

Security fixes are made on the current default branch. There are no published release branches yet.

## Reporting a vulnerability

Please do not publish sensitive vulnerability details in a public issue. If GitHub Private Vulnerability Reporting is enabled for this repository, use it. Otherwise, contact the repository maintainers privately and include the affected version/commit, reproduction steps, and impact. Do not include real GitHub tokens, passwords, or private user data in a report.

## Security boundaries and safeguards

- Keep the Vite UI, Payload/Next API, and PostgreSQL service bound to loopback. Do not expose the local services to the public internet.
- Keep `.env`, `.webcraft/`, `apps/cms/public/media/`, and the PostgreSQL data volume private. Use unique generated secrets and back up uploaded media separately from the database.
- The application currently supports one local owner. Do not treat its first-user registration flow as a general public sign-up system.
- GitHub tokens are encrypted on the local server; use a fine-grained token limited to the repositories you need and disconnect it when no longer needed.
- Uploaded SVG and non-raster formats are disabled. Do not broaden MIME types without a reviewed sanitizer and tests.
- Export validation runs fixed generator output in a fresh temporary directory, with dependency lifecycle scripts disabled and bounded source/build time. Do not modify it to execute arbitrary project scripts or install user-provided dependencies without a security review.
