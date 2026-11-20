import { z } from "zod";
import { queryEnumDefault } from "./_helpers.js";

// GET /insights — CR-023: the last 7 or 30 days (Manila), 7 by default
export const dashboardInsightsQuerySchema = z.object({
  days: queryEnumDefault(["7", "30"], "7").transform(Number),
});
