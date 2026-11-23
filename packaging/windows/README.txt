WebCraft for Windows

WebCraft is a local website-building application. This installer includes the WebCraft application, Node.js v24.22.3, and PostgreSQL v17.12 for local use. No external database server is required.

Starting WebCraft

After installation, open WebCraft from the Start menu. On first launch, the application initializes its private PostgreSQL database, applies WebCraft's database migrations, starts the local CMS and builder, and opens the builder in your default browser. Leave the launcher window running while you use WebCraft; closing it stops the local services.

Local-only network access

The application binds its web server and bundled database to the loopback interface. The builder proxies its API and media requests only to the local CMS. It is not a hosted service and does not configure remote access.

Your data

Database files, generated media, and the GitHub token (if configured) are stored in your Windows user profile under %LOCALAPPDATA%\WebCraft. These are not written into Program Files and are not removed by uninstalling WebCraft. Back up this folder before moving to another computer. Do not share it: it can contain project data and credentials.

Uninstalling

Use Windows Settings > Apps > Installed apps to remove WebCraft. Uninstalling removes the program but intentionally leaves %LOCALAPPDATA%\WebCraft in place so your work is not erased. Remove that folder manually only if you have a separate backup and want to permanently delete the local database, projects, media, and credentials.

Bundled third-party notices are in the installation folder's THIRD-PARTY-NOTICES.txt and licenses subfolder.
