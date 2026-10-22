# Deploy your own monitor

The demo is entirely local. These steps deploy a separate instance using your account and data; they do not connect to the original author's environment.

## Cloudflare Worker and D1

Requires Node.js 24, a Cloudflare account, and a domain managed in that account.

```sh
npm ci
npx wrangler login
npx wrangler d1 create n8n-healthcheck
```

Copy `cloud/wrangler.example.json` to `cloud/wrangler.json`. Set your custom domain and the returned D1 database ID. With multiple accounts, also set `account_id` explicitly. Keep this real deployment file untracked. Both `workers.dev` and preview URLs are disabled so the custom domain is the only public entry point.

```sh
npx wrangler d1 execute DB --config cloud/wrangler.json --remote --file cloud/schema.sql
```

Generate two independent random secrets, for example with Node's `crypto.randomBytes(32).toString('base64url')`. Use one as `INGEST_TOKEN` for the agent and one as `VIEW_TOKEN` for dashboard login. Enter each through Wrangler's interactive secret prompt, not a command-line argument:

```sh
npx wrangler secret put INGEST_TOKEN --config cloud/wrangler.json
npx wrangler secret put VIEW_TOKEN --config cloud/wrangler.json
npm run deploy
```

The worker fails closed if its secrets are missing. It does not offer unauthenticated access to health data. Use username `health` with `VIEW_TOKEN` in the normal login form. Select remember-me for 30 days; logout revokes the session in D1.

For execution links, replace the `https://n8n.example.com` placeholder in `index.html` with your own public n8n origin before building. This is a viewer navigation link, not an inbound database connection.

## Local collector and sender

Copy `.env.example` to `.env` and configure:

| Variable | Meaning |
| --- | --- |
| `N8N_URL` | Local n8n HTTP origin |
| `N8N_DATA` | Existing n8n directory containing `database.sqlite` and `config` |
| `N8N_INSTALL` | `node_modules` directory within the installed n8n package |
| `N8N_WORKFLOW_ID` | Workflow to monitor |
| `N8N_PUBLIC_URL` | Expected production Telegram webhook origin |
| `SUPABASE_URL` | Optional Supabase project URL; left unset means unknown |
| `HEALTH_AGENT_CONFIG` | Absolute path to a private agent JSON file outside Git |

Copy `agent.example.json` to that private path. Replace the endpoint with your custom domain's `/api/ingest` URL, and use the same `INGEST_TOKEN` configured in Cloudflare. Restrict the file's permissions to the operating user/service account before writing a real token.

```sh
npm start       # local dashboard only, port 8787
npm run agent  # local dashboard plus a 60-second outbound sender
```

The Node process must remain running. These are separate modes; if the local port is already occupied, the agent continues its independent cloud reporting. The agent reads its configuration at startup, so restart only the agent after changing its settings.

## Windows startup

From PowerShell **as Administrator**, after completing `.env` and the private agent configuration:

```powershell
.\scripts\install-agent.ps1 -ConfigPath "C:\Services\n8n-healthcheck\agent.json"
```

The installer restricts a runtime directory to the installing user and SYSTEM, copies only the runtime code and environment settings, and registers a distinct `N8nHealthcheckAgent` scheduled task. The task runs as SYSTEM at startup and retries on failure. Ensure `N8N_DATA` and `N8N_INSTALL` are explicit absolute paths that SYSTEM may read. This installer does not stop n8n or any other monitoring task.

## Verification

- `/` redirects anonymous users to `/login`; `/api/health` returns 401.
- The normal form logs in with the existing viewer credential and sets a Secure, HttpOnly cookie.
- The agent delivers fresh snapshots; actual status remains visible with the browser closed.
- If the agent stops for over three minutes, the cloud page remains reachable and marks current checks unknown.
- Historical red bars indicate an observed error in that hour, not necessarily an ongoing outage.
- Stopping n8n is not required to verify an agent disconnect. Any deliberate production-outage test should have a verified recovery path.

Current `schema.sql` includes latest status, hourly history, sessions, and rate-limit tables. Applying it is idempotent; it does not delete existing history. The collector uses n8n internal APIs and schema, so verify it against each n8n upgrade.
