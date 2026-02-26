# Local Slack Testing Guide

How to receive Slack event callbacks on your local machine.

## Prerequisites

- Docker (for PostgreSQL)
- pnpm 9+
- Node 20+
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (`brew install cloudflared`)
- A Slack workspace where you have admin access

## 1. Start Database

```bash
docker compose up -d
```

This starts PostgreSQL on port 5433. Tables are auto-migrated on API startup.

## 2. Create a Slack App

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**
2. Name it anything (e.g. "Nexu Dev"), pick your workspace
3. Note down from **Basic Information**:
   - **Signing Secret**
4. Note down from **Settings → Install App** (or after OAuth):
   - The Client ID and Client Secret are in **Basic Information** → **App Credentials**

### Bot Token Scopes

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

## 3. Start HTTPS Tunnel

Slack requires HTTPS for both OAuth redirect and Event Subscriptions.

```bash
cloudflared tunnel --url http://localhost:3000
```

It will output a URL like:
```
https://some-random-words.trycloudflare.com
```

> **Note:** This URL changes every time you restart cloudflared. You'll need to update Slack App settings accordingly.

## 4. Configure Environment

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

## 5. Configure Slack App URLs

### OAuth Redirect URL

**OAuth & Permissions** → **Redirect URLs** → Add:
```
https://<your-tunnel>.trycloudflare.com/api/oauth/slack/callback
```
Click **Add** then **Save URLs**.

### Event Subscriptions

**Event Subscriptions** → Enable Events → **Request URL**:
```
https://<your-tunnel>.trycloudflare.com/api/slack/events
```

Slack will send a `url_verification` challenge. If the API is running, it should show **Verified** automatically.

**Subscribe to bot events** → Add:
- `app_mention` — triggers when someone @mentions your bot
- `message.im` — triggers on direct messages to your bot

Click **Save Changes**.

## 6. Start Dev Server

```bash
pnpm dev
```

This starts:
- API on `http://localhost:3000`
- Web on `http://localhost:5173`

## 7. Create a Test Account

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

## 8. Connect Slack via OAuth

1. Go to **Channels** page in the web UI
2. Click **Add to Slack**
3. Authorize in Slack
4. You should see "Connected" status

## 9. Test Events

In your Slack workspace:
- **@mention the bot** in a channel (after inviting it with `/invite @BotName`)
- **DM the bot** directly (find it under Apps in the sidebar)

You should see in the API logs:
```
[slack-events] team=T12345 event=app_mention (no gateway pod — logged only)
[slack-events] payload: { ... }
```

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

### Bot doesn't reply to messages
Expected in local dev without a Gateway pod. The API receives and logs events but can't process AI responses without a running OpenClaw Gateway.
