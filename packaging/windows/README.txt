WebCraft for Windows

WebCraft is a local website-building application. This installer includes WebCraft, Node.js v24.22.3, and PostgreSQL v17.12 for local use. No external database server is required.

Starting WebCraft

After installation, open WebCraft from the Start menu. On first launch, WebCraft unpacks its runtime into %LOCALAPPDATA%\WebCraft\rt-0.1.1. This one-time setup can take several minutes. The compressed runtime archive remains in Program Files while the expanded runtime is cached under your user profile, so allow disk space for both. The runtime is checked before it starts. Later launches reuse the extracted files.

The application then initializes its private PostgreSQL database, applies WebCraft's database migrations, starts the local CMS and builder, and opens the builder in your default browser. Leave the launcher window running while you use WebCraft; closing it stops the local services.

Local-only network access

The application binds its web server and bundled database to the loopback interface. The builder proxies its API and media requests only to the local CMS. It is not a hosted service and does not configure remote access.

Your files and data

Database files, generated media, the GitHub token (if configured), and the extracted runtime are stored in your Windows user profile under %LOCALAPPDATA%\WebCraft. The MSI itself installs only the compressed runtime archive, launch scripts, documentation, and licenses in Program Files. These files are not written into Program Files as loose runtime files. Back up the entire WebCraft folder before moving to another computer. Do not share it: it can contain project data and credentials.

If WEBCRAFT_DATA_DIR is set in your environment before starting WebCraft, the runtime cache and application data use that directory instead of the default location.

Uninstalling

Use Windows Settings > Apps > Installed apps to remove WebCraft. Uninstalling removes the MSI-installed files but intentionally leaves %LOCALAPPDATA%\WebCraft in place, including your data and extracted runtime, so your work is not erased. Remove that folder manually only after closing WebCraft and making a separate backup, if you want to permanently delete the local database, projects, media, runtime files, and credentials.

Bundled third-party notices are in the installation folder's THIRD-PARTY-NOTICES.txt and licenses subfolder.
