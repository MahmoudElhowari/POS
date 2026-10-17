import { createApp } from "./app.js";
import { pool } from "./db/client.js";

const port = Number(process.env.API_PORT ?? 3000);

const app = createApp({
  checkDatabase: async () => {
    await pool.query("select 1");
    return true;
  },
});

app.listen(port, () => {
  console.log(`api listening on :${port}`);
});
