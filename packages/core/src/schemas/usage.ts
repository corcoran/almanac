import { z } from "zod";

export const DailyBalanceSchema = z.object({
  tokensUsed: z.number().int().nonnegative(),
  callsToday: z.number().int().nonnegative(),
  softLimit: z.number().int().positive().nullable(),
  avgTokensPerLog: z.number().positive(),
  logsLeftEstimate: z.number().int().nonnegative().nullable(),
  pctRemaining: z.number().min(0).max(100).nullable(),
  overSoftLimit: z.boolean(),
  overHardCap: z.boolean(),
  resetsAt: z.string(),
});
export type DailyBalanceResponse = z.infer<typeof DailyBalanceSchema>;
