import { z } from "zod";

const gatewayAuthSchema = z.object({
  mode: z.enum(["none", "token"]),
  token: z.string().optional(),
});

const gatewayReloadSchema = z.object({
  mode: z.enum(["off", "hot", "hybrid"]),
});

const gatewayConfigSchema = z.object({
  port: z.number().default(18789),
  mode: z.literal("local").default("local"),
  bind: z.enum(["loopback", "lan", "auto"]).default("lan"),
  auth: gatewayAuthSchema,
  reload: gatewayReloadSchema.default({ mode: "hybrid" }),
});

const agentModelSchema = z.union([
  z.string(),
  z.object({
    primary: z.string(),
    fallbacks: z.array(z.string()).optional(),
  }),
]);

const agentSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  default: z.boolean().optional(),
  workspace: z.string().optional(),
  model: agentModelSchema.optional(),
});

const agentsConfigSchema = z.object({
  defaults: z
    .object({
      model: z
        .union([z.string(), z.object({ primary: z.string() })])
        .optional(),
    })
    .optional(),
  list: z.array(agentSchema),
});

const slackAccountSchema = z.object({
  enabled: z.boolean().default(true),
  botToken: z.string(),
  signingSecret: z.string().optional(),
  appToken: z.string().optional(),
  mode: z.enum(["socket", "http"]).default("http"),
  webhookPath: z.string().optional(),
  dmPolicy: z.enum(["pairing", "allowlist", "open"]).optional(),
  groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional(),
});

const slackChannelSchema = z.object({
  mode: z.enum(["socket", "http"]).optional(),
  signingSecret: z.string().optional(),
  enabled: z.boolean().optional(),
  accounts: z.record(z.string(), slackAccountSchema),
});

const channelsConfigSchema = z.object({
  slack: slackChannelSchema.optional(),
});

const bindingMatchSchema = z.object({
  channel: z.string(),
  accountId: z.string().optional(),
});

const bindingSchema = z.object({
  agentId: z.string(),
  match: bindingMatchSchema,
});

export const openclawConfigSchema = z.object({
  gateway: gatewayConfigSchema,
  agents: agentsConfigSchema,
  channels: channelsConfigSchema,
  bindings: z.array(bindingSchema),
});

export type OpenClawConfig = z.infer<typeof openclawConfigSchema>;
export type AgentConfig = z.infer<typeof agentSchema>;
export type SlackAccountConfig = z.infer<typeof slackAccountSchema>;
export type BindingConfig = z.infer<typeof bindingSchema>;
