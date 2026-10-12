import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

export type AppEnv = "development" | "staging" | "production";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type BridgeConfig = {
  appEnv: AppEnv;
  port: number;
  logLevel: LogLevel;
  bridgeApiKey: string;
  tmsHost: string;
  tmsPort: number;
  tmsToken: string;
  fmcsaApiKey: string;
};


const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: resolve(repoRoot, ".env") });

const envSchema = z.object({
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  BRIDGE_API_KEY: z.string().min(16),
  TMS_HOST: z.string().min(1),
  TMS_PORT: z.coerce.number().int().min(1).max(65535),
  TMS_TOKEN: z.string().min(1),
  FMCSA_API_KEY: z.string().min(1),
});

export function loadConfig(): BridgeConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid configuration: ${fields}. See repo .env.example`);
  }

  if (parsed.data.APP_ENV === "production") {
    throw new Error(
      "APP_ENV=production is not supported; use development or staging.",
    );
  }

  return {
    appEnv: parsed.data.APP_ENV,
    port: parsed.data.PORT,
    logLevel: parsed.data.LOG_LEVEL,
    bridgeApiKey: parsed.data.BRIDGE_API_KEY,
    tmsHost: parsed.data.TMS_HOST,
    tmsPort: parsed.data.TMS_PORT,
    tmsToken: parsed.data.TMS_TOKEN,
    fmcsaApiKey: parsed.data.FMCSA_API_KEY,
  };
}
