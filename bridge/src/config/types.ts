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
