import express from "express";

export interface AppDeps {
  checkDatabase: () => Promise<boolean>;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.use(express.json());

  app.get("/health", async (_req, res) => {
    const database = await deps.checkDatabase().catch(() => false);
    res.status(database ? 200 : 503).json({ service: "api", ok: database, database });
  });

  return app;
}
