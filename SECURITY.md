# Security and deployment boundaries

Do not commit n8n databases, encryption keys, API tokens, generated agent configuration, viewer passwords, or personal deployment files. Examples in this repository use placeholder hostnames and identifiers. Keep real runtime configuration outside a synced checkout, restricted to the service account and administrator who operate the monitor.

The collector intentionally has access to the n8n database and its encrypted Telegram credential. It decrypts that credential in memory using the existing n8n key only to call `getWebhookInfo`. It does not send that credential, user messages, or transaction payloads to the dashboard. The uploaded allowlist includes workflow names, node names, execution IDs, status codes, timestamps, and health details; protect the dashboard because these are operational metadata.

The localhost server is loopback-only and unauthenticated. Do not expose it as a public origin. The public Worker authenticates viewers using revocable, hashed D1 sessions and authenticates the collector with a separate bearer token. Cookies use Secure, HttpOnly, a __Host- prefix, and SameSite=Lax. Login/logout enforce Origin or browser same-origin Fetch Metadata; there is no cross-origin API access. Brute-force login attempts are rate-limited. Changing VIEW_TOKEN invalidates existing viewer sessions.

The collector does not restart n8n or send test messages. Successful history does not prove a fresh end-to-end bot interaction. Schema and n8n internal encryption module compatibility must be reviewed when upgrading n8n. Only SQLite-based n8n installations are supported by this collector.

Report vulnerabilities privately through GitHub's security advisory mechanism when available; do not include active credentials or personal data in public issues.
