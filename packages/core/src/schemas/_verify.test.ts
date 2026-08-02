import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type {
  AlcoholSession,
  BodyWeight,
  CardioSession,
  SleepLog,
  StepLog,
} from "../domain/body.js";
import type { Meal, NutritionPhase } from "../domain/nutrition.js";
import type {
  Exercise,
  ExerciseGroup,
  WorkoutTemplate,
  WorkoutTemplateItem,
} from "../domain/training.js";
import type { UntrackedPeriod } from "../domain/untracked-periods.js";
import type { User } from "../domain/users.js";
import type { Workout } from "../domain/workouts.js";
import type { TodayContext } from "../signals/today.js";
import type {
  AlcoholSessionResponseSchema,
  BodyWeightResponseSchema,
  CardioSessionResponseSchema,
  ExerciseGroupResponseSchema,
  ExerciseResponseSchema,
  MealResponseSchema,
  NutritionPhaseResponseSchema,
  SleepLogResponseSchema,
  StepLogResponseSchema,
  TodayContextResponseSchema,
  UntrackedPeriodResponseSchema,
  UserResponseSchema,
  WorkoutResponseSchema,
  WorkoutTemplateItemResponseSchema,
  WorkoutTemplateResponseSchema,
} from "./index.js";

// Equality check — fails if the structural shapes differ.
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// Drift assertions. Each line is a compile-time check; failure = typecheck error.
// `is_admin` and `llm_daily_token_limit` are server-internal: they live on the
// `User` domain type and repo, but are deliberately NOT exposed on the
// self-serve `UserResponseSchema` (GET/PATCH /v1/users/me) — surfacing admin
// status or a user's token limit there would be an information leak, and they're
// only settable via the future admin route. So the drift guard compares the
// response schema against `User` minus those two fields.
const _u: Equals<
  z.infer<typeof UserResponseSchema>,
  Omit<User, "is_admin" | "llm_daily_token_limit">
> = true;
const _g: Equals<z.infer<typeof ExerciseGroupResponseSchema>, ExerciseGroup> = true;
const _e: Equals<z.infer<typeof ExerciseResponseSchema>, Exercise> = true;
const _t: Equals<z.infer<typeof WorkoutTemplateResponseSchema>, WorkoutTemplate> = true;
const _ti: Equals<z.infer<typeof WorkoutTemplateItemResponseSchema>, WorkoutTemplateItem> = true;
const _m: Equals<z.infer<typeof MealResponseSchema>, Meal> = true;
const _np: Equals<z.infer<typeof NutritionPhaseResponseSchema>, NutritionPhase> = true;
const _bw: Equals<z.infer<typeof BodyWeightResponseSchema>, BodyWeight> = true;
const _al: Equals<z.infer<typeof AlcoholSessionResponseSchema>, AlcoholSession> = true;
const _cd: Equals<z.infer<typeof CardioSessionResponseSchema>, CardioSession> = true;
const _sl: Equals<z.infer<typeof SleepLogResponseSchema>, SleepLog> = true;
const _st: Equals<z.infer<typeof StepLogResponseSchema>, StepLog> = true;
const _w: Equals<z.infer<typeof WorkoutResponseSchema>, Workout> = true;
const _tc: Equals<z.infer<typeof TodayContextResponseSchema>, TodayContext> = true;
const _up: Equals<z.infer<typeof UntrackedPeriodResponseSchema>, UntrackedPeriod> = true;

// Discard markers so unused-locals doesn't flag them.
void _u;
void _g;
void _e;
void _t;
void _ti;
void _m;
void _np;
void _bw;
void _al;
void _cd;
void _sl;
void _st;
void _w;
void _tc;
void _up;

describe("schemas typecheck drift", () => {
  it("compiles (all Equals<...> assertions hold)", () => {
    expect(true).toBe(true);
  });
});
