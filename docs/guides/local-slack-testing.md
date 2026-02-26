# Local Slack Testing Guide

How to receive Slack event callbacks on your local machine and optionally run a Gateway for end-to-end AI responses.

## Architecture

```
Slack Events API ─→ cloudflared tunnel ─→ Nexu API (:3000)
                                            │
                                            ├─ url_verification → immediate reply
                                            ├─ verify signature (HMAC-SHA256)
                                            └─ forward to Gateway (:18789)
                                                  │
                                                  ├─ AI (via LiteLLM / Anthropic)
                                                  └─ reply via Slack API
```

## Prerequisites

- Docker (for PostgreSQL)
- pnpm 9+
- Node 20+ (Node 22+ required for Gateway)
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (`brew install cloudflared`)
- A Slack workspace where you have admin access
- (Optional) [OpenClaw](https://github.com/openclaw/openclaw) repo cloned locally — for running Gateway

## Part 1: API + Slack Events

### 1. Start Database

```bash
docker compose up -d
```

This starts PostgreSQL on port 5433. Tables are auto-migrated on API startup.

### 2. Create a Slack App

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**
2. Name it anything (e.g. "Nexu Dev"), pick your workspace
3. Note down from **Basic Information**:
   - **Signing Secret**
4. Note down from **Settings → Install App** (or after OAuth):
   - The Client ID and Client Secret are in **Basic Information** → **App Credentials**

#### Bot Token Scopes

Go to **OAuth & Permissions** → **Scopes** → **Bot Token Scopes**, add:

- `channels:history`
- `channels:read`
- `chat:write`
- `groups:history`
- `groups:read`
- `im:history`
- `im:read`
- `im:write`
- `mpim:history`
- `mpim:read`
- `users:read`

### 3. Start HTTPS Tunnel

Slack requires HTTPS for both OAuth redirect and Event Subscriptions.

```bash
cloudflared tunnel --url http://localhost:3000
```

It will output a URL like:
```
https://some-random-words.trycloudflare.com
```

> **Note:** This URL changes every time you restart cloudflared. You'll need to update Slack App settings accordingly.

### 4. Configure Environment

Copy `.env.example` and fill in:

```bash
cp apps/api/.env.example apps/api/.env
```

```env
DATABASE_URL=postgresql://nexu:nexu@localhost:5433/nexu_dev
BETTER_AUTH_SECRET=nexu-dev-secret-change-in-production
BETTER_AUTH_URL=https://<your-tunnel>.trycloudflare.com
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
SLACK_CLIENT_ID=<from Slack App>
SLACK_CLIENT_SECRET=<from Slack App>
SLACK_SIGNING_SECRET=<from Slack App>
GATEWAY_TOKEN=gw-secret-token
PORT=3000
WEB_URL=http://localhost:5173
```

**Important:** `BETTER_AUTH_URL` must be the cloudflared tunnel URL (HTTPS).

### 5. Configure Slack App URLs

#### OAuth Redirect URL

**OAuth & Permissions** → **Redirect URLs** → Add:
```
https://<your-tunnel>.trycloudflare.com/api/oauth/slack/callback
```
Click **Add** then **Save URLs**.

#### Event Subscriptions

**Event Subscriptions** → Enable Events → **Request URL**:
```
https://<your-tunnel>.trycloudflare.com/api/slack/events
```

Slack will send a `url_verification` challenge. If the API is running, it should show **Verified** automatically.

**Subscribe to bot events** → Add:
- `app_mention` — triggers when someone @mentions your bot
- `message.im` — triggers on direct messages to your bot

Click **Save Changes**.

### 6. Start Dev Server

```bash
pnpm dev
```

This starts:
- API on `http://localhost:3000`
- Web on `http://localhost:5173`

### 7. Create a Test Account

1. Open `http://localhost:5173` in your browser
2. Use invite code `NEXU2026` to register
3. A default bot needs to exist — create one via DB if needed:

```sql
-- Connect to: postgresql://nexu:nexu@localhost:5433/nexu_dev
INSERT INTO bots (id, user_id, name, slug, system_prompt, created_at, updated_at)
VALUES (
  'bot_dev_01',
  '<your-user-id-from-user-table>',
  'Dev Bot',
  'dev-bot',
  'You are a helpful assistant.',
  NOW()::text,
  NOW()::text
);
```

### 8. Connect Slack via OAuth

1. Go to **Channels** page in the web UI
2. Click **Add to Slack**
3. Authorize in Slack
4. You should see "Connected" status

### 9. Test Events (API Only)

In your Slack workspace:
- **@mention the bot** in a channel (after inviting it with `/invite @BotName`)
- **DM the bot** directly (find it under Apps in the sidebar)

You should see in the API logs:
```
[slack-events] team=T12345 event=app_mention (no gateway pod — logged only)
[slack-events] payload: { ... }
```

At this point, the API receives and logs events but the bot can't respond without a Gateway.

---

## Part 2: Gateway (End-to-End AI Responses)

To make the bot actually respond, you need to run an OpenClaw Gateway locally.

### Prerequisites

- Node 22+ (`nvm install 22 && nvm use 22`)
- OpenClaw repo cloned: `git clone https://github.com/openclaw/openclaw.git`
- An AI provider (LiteLLM proxy, Anthropic API key, etc.)

### 1. Set Up a Gateway Pool

Create a gateway pool record and link your bot to it:

```sql
-- Connect to: postgresql://nexu:nexu@localhost:5433/nexu_dev

-- Create gateway pool (pointing to localhost)
INSERT INTO gateway_pools (id, name, pod_ip, status, created_at)
VALUES ('pool_local_01', 'local-dev', '127.0.0.1', 'active', NOW()::text);

-- Assign bot to pool
UPDATE bots SET pool_id = 'pool_local_01' WHERE id = '<your-bot-id>';

-- Verify webhook_routes has pool assignment
UPDATE webhook_routes SET pool_id = 'pool_local_01' WHERE channel_type = 'slack';
```

### 2. Generate Gateway Config

The API generates the config dynamically from the database:

```bash
curl -s http://localhost:3000/api/internal/pools/pool_local_01/config | python3 -m json.tool > gateway-config.json
```

This endpoint is unauthenticated (internal use). It reads bots, channels, and credentials from the database and produces a full OpenClaw config.

Verify the config looks correct:
```bash
cat gateway-config.json
```

You should see:
- `agents.list` — your bot
- `channels.slack.accounts` — your Slack workspace with decrypted botToken and signingSecret
- `bindings` — mapping agent to Slack account
- `gateway.auth.token` — gateway authentication token

#### Model Configuration

The config generator uses the bot's `model_id` from the database. If your bot doesn't have one, add the model to `agents.defaults` in the generated config:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-3.7-sonnet"
      }
    },
    "list": [...]
  }
}
```

The model name must match what your AI provider supports. Check with:
```bash
curl -s <your-provider-url>/v1/models -H "Authorization: Bearer <key>" | python3 -m json.tool
```

### 3. Start Gateway

```bash
# Set AI provider credentials
export ANTHROPIC_API_KEY=<your-api-key>
export ANTHROPIC_BASE_URL=<your-provider-base-url>  # e.g. https://litellm.example.com

# Set config paths
export OPENCLAW_CONFIG_PATH=$(pwd)/gateway-config.json
export OPENCLAW_STATE_DIR=/tmp/nexu-gateway-state

# Start gateway (requires Node 22+)
node /path/to/openclaw/openclaw.mjs gateway run --bind loopback --port 18789 --force
```

You should see:
```
[gateway] agent model: anthropic/claude-3.7-sonnet
[gateway] listening on ws://127.0.0.1:18789 (PID xxxxx)
```

> **Note:** If using a LiteLLM proxy, `ANTHROPIC_BASE_URL` should be the base URL without `/v1` (e.g. `https://litellm.example.com`, not `https://litellm.example.com/v1`). The Anthropic SDK adds the API path automatically.

### 4. Test End-to-End

1. In Slack, @mention your bot or DM it
2. Watch the API logs for event forwarding:
   ```
   [slack-events] team=T12345 event=app_mention
   ```
3. Watch the Gateway logs for AI processing:
   ```
   [agent/embedded] embedded run agent start
   [agent/embedded] embedded run agent end
   ```
4. The bot should reply in Slack!

---

## Troubleshooting

### Tunnel URL changed
If you restarted cloudflared, update these three places:
1. `apps/api/.env` → `BETTER_AUTH_URL`
2. Slack App → **OAuth & Permissions** → **Redirect URLs**
3. Slack App → **Event Subscriptions** → **Request URL**

Then restart the dev server (`pnpm dev`).

### "Add to Slack" button is disabled
The `bots` table is empty or the bot belongs to a different user. Check with:
```sql
SELECT b.id, b.user_id, u.email
FROM bots b JOIN "user" u ON b.user_id = u.id;
```

### Slack shows "dispatch_failed" or no events arrive
- Verify Event Subscriptions Request URL shows **Verified**
- Check that `webhook_routes` table has a row for your team ID:
  ```sql
  SELECT * FROM webhook_routes WHERE channel_type = 'slack';
  ```
- If empty, disconnect and re-connect Slack via the UI

### Events arrive but Gateway gets 405 "Method Not Allowed"
The Gateway's Slack webhook handler is not registered. Check these in order:

1. Gateway logs should show `[slack] http mode listening at /slack/events/<accountId>` on startup
2. The generated config must have `channels.slack.accounts.<id>.mode` set to `"http"`
3. The config must include `appToken` in each Slack account (even in HTTP mode — the OpenClaw plugin's `isConfigured` check requires it). The config generator adds a placeholder automatically.
4. The config must have a top-level `channels.slack.signingSecret` and `channels.slack.mode: "http"`
5. The `webhookPath` in the config must match what the API forwards to

### Gateway API key error (401 authentication_error)
- Verify `ANTHROPIC_BASE_URL` points to your proxy (not api.anthropic.com)
- Verify the model name exists on your provider (`curl <url>/v1/models`)
- For LiteLLM: `ANTHROPIC_BASE_URL` should NOT include `/v1`

### Bot receives events but doesn't reply
- Check Gateway logs for agent errors
- Verify AI provider is reachable: `curl -s <ANTHROPIC_BASE_URL>/v1/models`
- Make sure the model in config matches an available model on the provider
