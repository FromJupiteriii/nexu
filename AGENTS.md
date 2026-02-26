# AGENTS.md

This file is for agentic coding tools working in this repo.

## Repo overview

Nexu 是 OpenClaw 多租户平台。用户在 Dashboard 创建 Bot，连接 Slack 机器人，系统自动生成 OpenClaw 配置并热加载到共享 Gateway 进程中。

- Monorepo using pnpm workspaces.
- Apps:
  - `apps/api` — Hono + Drizzle + Zod OpenAPI (Node ESM)
  - `apps/web` — React + Ant Design + Vite
- Shared packages:
  - `packages/shared` — 共享类型/Zod schema
- Deployment:
  - `deploy/k8s` — Kubernetes manifests
- TypeScript strict configs in `tsconfig.base.json`.
- Biome for linting/formatting (`biome.json`).

### Tech stack (aligned with CloudSpec)

| Layer | Technology | Purpose |
|-------|-----------|---------|
| API framework | **Hono** + `@hono/zod-openapi` | Type-safe routes with auto OpenAPI spec |
| Database | **Drizzle ORM** + PostgreSQL (dev: SQLite) | Type-safe queries, no FK references |
| Validation | **Zod** | Single source of truth for types |
| Auth | **better-auth** | Email/password + session management |
| Frontend SDK | **@hey-api/openapi-ts** | Auto-generated from OpenAPI spec |
| Frontend | **React** + **Ant Design** + **Vite** | Dashboard UI |
| State | **React Query** (@tanstack/react-query) | Server state management |
| Lint/Format | **Biome** | Replaces ESLint + Prettier |
| Package manager | **pnpm** workspaces | Monorepo |

### Type safety principle

Zod schema 是单一数据源，类型从它派生到所有层：

```
Zod Schema (定义一次)
  → API 路由验证 (@hono/zod-openapi)
  → OpenAPI Spec (自动生成)
  → 前端 SDK 类型 (@hey-api/openapi-ts 自动生成)
  → DB 查询类型 (Drizzle 推导)
  → Auth session 类型 (better-auth 推导)
```

**禁止手写类型同步。类型只能从 schema 推导，不能复制粘贴。**

## Required reading before coding

按此顺序阅读，确保理解系统设计后再动手：

1. **`docs/designs/openclaw-multi-tenant.md`** — 完整架构设计、数据模型、API、分阶段计划
2. **`docs/references/openclaw-config-schema.md`** — Config 生成器必须输出的 JSON 格式及坑点
3. **`docs/references/api-patterns.md`** — Hono + Drizzle + Zod 编码模式（从 CloudSpec 提取）
4. **`docs/references/infrastructure.md`** — 可用基础设施（数据库、缓存、存储等）

## Hard rules (must follow)

- Never commit any code changes until explicitly told to do so.
- **Never use `any`.** Use explicit types, `unknown` with narrowing, or Zod inference (`z.infer<typeof schema>`). No exceptions.
- Always run typecheck commands after you write TypeScript code.
- Always run lint commands after you modify any code.
- Do not introduce new dependencies without explicit approval.
- Do not modify OpenClaw source code unless the design doc explicitly calls for it.
- Do not use foreign key relations and references in the database schema.
- Channel credentials (bot tokens, signing secrets) must never appear in logs or error messages.
- All API responses must use Zod response schemas registered in the OpenAPI route.
- Config generator output must match `docs/references/openclaw-config-schema.md` exactly — read the "常见坑点" section.
- Do not use `fetch` directly in the frontend; always use the generated SDK from `apps/web/lib/api`.

## Commands

All commands are pnpm-based. Use `pnpm --filter` to target a single app.

### Install
- `pnpm install`

### Dev
- `pnpm dev` (runs all apps in parallel)
- `pnpm --filter @nexu/api dev`
- `pnpm --filter @nexu/web dev`

### Build
- `pnpm build` (all apps)
- `pnpm --filter @nexu/api build`
- `pnpm --filter @nexu/web build`

### Typecheck
- `pnpm typecheck` (all apps)
- `pnpm --filter @nexu/api typecheck`
- `pnpm --filter @nexu/web typecheck`

### Lint / format (Biome)
- `pnpm lint`
- `pnpm format`

### Tests
- `pnpm test`
- `pnpm --filter @nexu/api test`

### Database (Drizzle)
- `pnpm --filter @nexu/api db:push` (push schema to database)

### API and Type Generation
- `pnpm generate-types`: Exports OpenAPI schema from `apps/api` and regenerates TypeScript clients/types in `apps/web/lib/api`.

### Experiments (OpenClaw validation)
- `OPENCLAW_DIR=/path/to/openclaw ./experiments/run-all.sh`

## Code style guidelines

### Formatting (Biome)
- Indentation: 2 spaces.
- Quotes: double quotes (`"`).
- Imports are auto-organized by Biome; do not hand-sort.
- Do not introduce unused imports; Biome will flag them.

### TypeScript
- Strict mode enabled in `tsconfig.base.json`.
- `apps/api` uses `type: "module"` (ESM).
- Prefer `z.infer<typeof schema>` over manual type definitions.
- Prefer explicit types at module boundaries and exported functions.
- **`any` is banned.** Use `unknown` with narrowing if type is uncertain.

### Naming conventions
- Files and folders: `kebab-case` (`bot-routes.ts`, `config-generator.ts`).
- Types/interfaces: `PascalCase` (`CreateBotInput`, `BotChannel`).
- Variables/functions: `camelCase` (`createBot`, `generateConfig`).
- React components: `PascalCase` (`BotListPage`, `ChannelStatusBadge`).
- Zod schemas: `camelCase` + `Schema` suffix (`createBotSchema`, `botResponseSchema`).
- DB tables: `snake_case` in Drizzle schema (`bot_channels`, `gateway_pools`).

### Error handling
- Throw `HTTPException` from Hono with clear status and message.
- Include context in errors: `throw new HTTPException(404, { message: \`Bot ${botId} not found\` })`.
- Never swallow errors silently; log or rethrow with context.

### Logging
- Use structured logging (pino or console with JSON).
- Never log credentials, tokens, or secrets.
- Keep logs minimal in production paths.

## Backend architecture (API)

### Route structure (Hono + Zod OpenAPI)

```typescript
import { createRoute, z } from "@hono/zod-openapi";

// 1. Define Zod schemas (single source of truth)
const CreateBotSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  systemPrompt: z.string().optional(),
  modelId: z.string().default("gpt-4o"),
});

const BotResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(["active", "paused", "deleted"]),
  createdAt: z.string(),
});

// 2. Define route with OpenAPI metadata
const createBotRoute = createRoute({
  method: "post",
  path: "/v1/bots",
  request: {
    body: { content: { "application/json": { schema: CreateBotSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: BotResponseSchema } },
      description: "Bot created",
    },
  },
});

// 3. Implement handler (fully typed, no any)
app.openapi(createBotRoute, async (c) => {
  const input = c.req.valid("json"); // type: z.infer<typeof CreateBotSchema>
  const bot = await createBot(input);
  return c.json(bot, 200);           // type-checked against BotResponseSchema
});
```

**Key:** Request validation, response type checking, and OpenAPI spec all derived from the same Zod schema.

### Workflow for API changes
1. Define/modify Zod schemas and routes in `apps/api/src/routes/`.
2. Run `pnpm generate-types`. This:
   - Exports OpenAPI schema from API.
   - Regenerates TypeScript SDK in `apps/web/lib/api/`.
3. Update frontend to use new generated SDK functions.
4. Run `pnpm typecheck` to verify frontend matches new API contract.

### Database (Drizzle, no FKs)

```typescript
import { pgTable, text, timestamp, bigint, jsonb } from "drizzle-orm/pg-core";

export const bots = pgTable("bots", {
  pk: bigint("pk", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  id: text("id").notNull().unique(),     // public ID (cuid2)
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  systemPrompt: text("system_prompt"),
  modelId: text("model_id").default("gpt-4o"),
  agentConfig: jsonb("agent_config").default({}),
  status: text("status").default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
```

Rules:
- **No foreign keys or references** — use application-level joins.
- Public IDs via cuid2 (`@paralleldrive/cuid2`), never expose `pk`.
- `bigint` auto-incrementing `pk` for internal use.
- All tables in `apps/api/src/db/schema/index.ts`.

### Config generator (核心模块)

- Location: `apps/api/src/lib/config-generator.ts`
- Input: `poolId`
- Output: Valid `OpenClawConfig` JSON（含 models、agents、channels、bindings、commands）
- Schema: `packages/shared/src/schemas/openclaw-config.ts`
- Must read: `docs/references/openclaw-config-schema.md`
- Currently only Slack channel is supported
- **Environment variables:**
  - `LITELLM_BASE_URL` + `LITELLM_API_KEY` — 配置后自动生成 `models.providers.litellm` 段
  - `GATEWAY_TOKEN` — Gateway 认证 token
- **Model ID 处理:** 当 LiteLLM 配置存在时，自动给 model ID 加 `litellm/` 前缀
- Critical constraints:
  - `bindings[].agentId` must match `agents.list[].id`
  - `bindings[].match.accountId` must match `channels.slack.accounts` key (NOT botToken)
  - Slack HTTP mode requires `signingSecret`
  - Only one agent should have `default: true`
  - Slack channel 必须显式设 `groupPolicy: "open"`（运行时默认 `"allowlist"` 会丢弃消息）
  - LiteLLM 模型必须设 `compat.supportsStore: false`（避免 Bedrock 400 错误）

### Auth (better-auth)

- Email/password registration + login.
- Session-based with HTTP-only cookies.
- API key support for programmatic access.
- Configured in `apps/api/src/auth.ts`.

## Frontend architecture (Web)

- **Framework**: React + Ant Design + Vite
- **API calls**: Always use generated SDK from `apps/web/lib/api/sdk.gen.ts`. Never use raw `fetch`.
- **State**: React Query for server state.
- **Routing**: React Router.

## Required checks after code changes

- `pnpm typecheck` — always after TypeScript changes
- `pnpm lint` — always after any code changes
- `pnpm generate-types` — after API route/schema changes
- `pnpm test` — after logic changes
