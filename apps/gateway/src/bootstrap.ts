import { registerPool } from "./api.js";
import { fetchInitialConfig } from "./config.js";
import { env, envWarnings } from "./env.js";
import { waitGatewayReady } from "./gateway-health.js";
import { log } from "./log.js";
import { startManagedOpenclawGateway } from "./openclaw-process.js";
import { runWithRetry } from "./utils.js";

async function registerPoolWithRetry(): Promise<void> {
  return runWithRetry(
    registerPool,
    ({ attempt, retryDelayMs, error }) => {
      log("pool registration failed; retrying", {
        attempt,
        poolId: env.RUNTIME_POOL_ID,
        retryDelayMs,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    },
    env.RUNTIME_MAX_BACKOFF_MS,
  );
}

async function fetchInitialConfigWithRetry(): Promise<void> {
  return runWithRetry(
    fetchInitialConfig,
    ({ attempt, retryDelayMs, error }) => {
      log("initial config sync failed; retrying", {
        attempt,
        poolId: env.RUNTIME_POOL_ID,
        retryDelayMs,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    },
    env.RUNTIME_MAX_BACKOFF_MS,
  );
}

export async function bootstrapGateway(): Promise<void> {
  if (envWarnings.usedHostnameAsRuntimePoolId) {
    log("warning: RUNTIME_POOL_ID is unset; using hostname fallback", {
      nodeEnv: env.NODE_ENV,
      poolId: env.RUNTIME_POOL_ID,
    });
  }

  if (envWarnings.deprecatedGatewayHttpEnvKeys.length > 0) {
    log("deprecated gateway HTTP env vars detected and ignored", {
      keys: envWarnings.deprecatedGatewayHttpEnvKeys,
    });
  }

  if (envWarnings.openclawConfigPathSource === "state_dir_env") {
    log("OPENCLAW_CONFIG_PATH is unset; derived from OPENCLAW_STATE_DIR", {
      stateDir: envWarnings.openclawStateDir,
      configPath: envWarnings.openclawConfigPath,
    });
  }

  if (envWarnings.openclawConfigPathSource === "profile_default") {
    log("OPENCLAW_CONFIG_PATH is unset; derived from profile default", {
      profile: env.OPENCLAW_PROFILE,
      stateDir: envWarnings.openclawStateDir,
      configPath: envWarnings.openclawConfigPath,
    });
  }

  if (envWarnings.openclawConfigPathSource === "default") {
    log("OPENCLAW_CONFIG_PATH is unset; using ~/.openclaw/openclaw.json", {
      stateDir: envWarnings.openclawStateDir,
      configPath: envWarnings.openclawConfigPath,
    });
  }

  log("starting gateway", {
    poolId: env.RUNTIME_POOL_ID,
    configPath: env.OPENCLAW_CONFIG_PATH,
    manageOpenclawProcess: env.RUNTIME_MANAGE_OPENCLAW_PROCESS,
  });
  await registerPoolWithRetry();
  log("pool registered", { poolId: env.RUNTIME_POOL_ID });

  await fetchInitialConfigWithRetry();

  if (env.RUNTIME_MANAGE_OPENCLAW_PROCESS) {
    startManagedOpenclawGateway();
  }

  await waitGatewayReady();
}
