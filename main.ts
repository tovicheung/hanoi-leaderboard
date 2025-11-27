import { app } from "./src/api.ts";
import { setupKv } from "./src/db.ts";

await setupKv();

Deno.serve(app.fetch);
