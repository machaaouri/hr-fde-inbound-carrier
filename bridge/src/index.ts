import { loadConfig } from "./config/env.ts";
import { buildApp } from "./server/build-app.ts";

async function main(): Promise<void> {
  process.on("unhandledRejection", (reason: unknown) => {
    console.error(
      "unhandledRejection (process kept alive):",
      reason instanceof Error ? reason.message : String(reason),
    );
  });
  process.on("uncaughtException", (err: Error) => {
    console.error("uncaughtException (process kept alive):", err.message);
  });

  const config = loadConfig();
  const app = await buildApp(config);

  const close = async (): Promise<void> => {
    app.log.info("shutting down");
    await app.close();
  };

  process.on("SIGTERM", () => {
    void close().finally(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    void close().finally(() => process.exit(0));
  });

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(
    {
      port: config.port,
      env: config.appEnv,
      live: [
        "carriers/verify",
        "loads/search",
        "otp/send",
        "otp/verify",
        "offers/decide",
      ],
      stub: ["bookings"],
    },
    "bridge listening",
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
