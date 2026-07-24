import "dotenv/config";
import { syncNow } from "../src/sync.js";

syncNow()
  .then((r) => {
    console.log(`Done: ${r.count} week(s).`);
    process.exit(0);
  })
  .catch((e) => {
    console.error("Sync failed:", e.message);
    process.exit(1);
  });
