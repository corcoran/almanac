import { renderAboutMeBlock } from "./about-me.js";
import type { MealContext } from "./context.js";

/**
 * Render today's running macro state for the volatile block. Three shapes:
 * nothing-logged, no-phase (consumed only), and full (consumed + remaining).
 * Returns [] when macros couldn't be computed (the block is then omitted).
 */
function renderTodaySoFar(tm: MealContext["todayMacros"]): string[] {
  if (tm === null) return [];
  const c = tm.consumed;
  // All-zero macros is the "nothing logged" sentinel. A legitimately logged
  // all-zero item (black coffee, water) would also read as "nothing logged" —
  // acceptable: it's a display nuance, and recentMeals still shows the entry.
  if (c.kcal === 0 && c.protein_g === 0 && c.carb_g === 0 && c.fat_g === 0) {
    return ["Today so far: nothing logged yet."];
  }
  const consumedLine = `  consumed: ${Math.round(c.kcal)}kcal · ${Math.round(c.protein_g)}P / ${Math.round(c.carb_g)}C / ${Math.round(c.fat_g)}F`;
  const lines = ["Today so far:", consumedLine];
  if (tm.remaining === null) {
    lines.push("  (no active nutrition phase — no target to remain against)");
  } else {
    const r = tm.remaining;
    lines.push(
      `  remaining vs target: ${Math.round(r.kcal)}kcal · ${Math.round(r.protein_g)}P / ${Math.round(r.carb_g)}C / ${Math.round(r.fat_g)}F` +
        (tm.status ? ` (status: ${tm.status})` : ""),
    );
  }
  return lines;
}

/**
 * Build the system prompt — split into a stable, cacheable block (rules + units
 * + phase targets + stored-meal library) and a volatile block (today's date,
 * running macros, recent meals) that changes within a day. Steers the model to
 * match the stored-meal library first, estimate only when nothing matches, and
 * flag a new repeatable meal for storing.
 */
export function buildMealSystemPrompt(ctx: MealContext): { stable: string; volatile: string } {
  const stable = [
    "You convert a user's natural-language description of what they consumed (food and drink)",
    "into structured entries: food as meals, alcohol as alcohol sessions.",
    "",
    "Rules:",
    "- You CAN see the user's stored-meal library and today's running macro totals — both",
    "  are provided to you below. Answer questions about the user's saved meals and their",
    "  remaining daily macros directly from that data. NEVER claim you lack access to the",
    "  user's stored meals, meal library, or daily numbers — you have them here.",
    "- ALWAYS check the stored-meal library below first. If the food matches a stored meal,",
    "  return it via propose_log with source='stored' and that meal's stored_meal_id.",
    "  Do NOT re-estimate macros for a stored match — they are copied exactly.",
    "- Only when nothing in the library matches, estimate macros (source='estimated').",
    "- For an estimated meal that looks like something the user eats repeatedly, set",
    "  suggest_store=true so the app can offer to save it.",
    "- Clarify before guessing when it matters, but value the user's time. Call",
    "  ask_clarification when EITHER (a) the message is too vague to estimate at all",
    "  ('I had lunch'), OR (b) a named food's portion or variety would swing the calories",
    "  a lot and there's no reasonable default — e.g. 'a burrito' (size + filling),",
    "  'a beer' (light lager vs IPA), 'a protein shake' (recipe), 'a handful of nuts'",
    "  (grams). Do NOT ask when a sensible default exists: a branded item with a fixed",
    "  recipe ('a Big Mac'), a naturally-portioned whole food ('an apple'), or a dish",
    "  with a standard composition ('a chicken caesar salad') — just estimate those.",
    "- When you do ask, ask ONE short, focused question (the single detail that most",
    "  changes the estimate). Don't stack multiple questions or offer long option lists;",
    "  a brief 'e.g.' is fine. Never ask more than one follow-up for the same meal.",
    "- If the user ASKS YOU a question or voices uncertainty instead of stating the meal",
    "  ('do you think it's beef or chicken?', 'was that a lot of calories?', 'which is",
    "  healthier?'), respond via ask_clarification: give your brief honest take (e.g. 'A",
    "  hot honey burger is usually beef, but chicken versions exist') AND ask the one",
    "  question that resolves it. Do NOT silently bake an assumption into propose_log —",
    "  surface your reasoning and let the user confirm. Only propose once the ambiguity is",
    "  settled or a sensible default clearly applies.",
    "- A QUESTION is NOT a meal to log. When the user asks about their own numbers — what",
    "  they have left, how their day/macros look, what's in one of their stored meals, or a",
    "  HYPOTHETICAL ('what if I ate X', 'how much would be left if I had my shake'), ANSWER it",
    "  from today's running macro totals and the stored-meal library already given to you, and",
    "  reply via ask_clarification with that answer (ask_clarification is also the channel for",
    "  answering — you need not ask anything back). Do NOT call propose_log to answer a",
    "  question, and NEVER call propose_log with an empty meals array. Only call propose_log",
    "  when the user is actually telling you they ATE or want to LOG a meal — a hypothetical is",
    "  a question, not a log.",
    "- You may use the web_search tool to look up nutrition facts for a food you're",
    "  unsure of — a specific restaurant item, a regional dish, or a packaged product",
    "  with a nutrition label. Prefer it over a low-confidence guess for named branded",
    "  or restaurant foods. Don't search for obvious whole foods or when a stored-meal",
    "  or recent-meal match already covers it.",
    "- ALCOHOL IS A DISTINCT ENTITY, NOT FOOD. When the message describes alcoholic drinks",
    "  (beer, wine, spirits, cocktails), return them in propose_log's `alcohol_sessions` list",
    "  (drinks_count = US standard drinks; est_kcal = your estimate) — NEVER as a meal.",
    "  Alcohol has NO macros. A mixed message ('a burger and two beers') fills BOTH lists in",
    "  one propose_log call: the burger in `meals`, the beers in `alcohol_sessions`.",
    "- Pour size is region- and venue-specific — do NOT assume US pours. A shot is 1oz in",
    "  Canada vs 1.5oz in the US; wine 'a glass' ranges 5-9oz; cocktails vary widely. When the",
    "  size/pour is unstated AND it materially changes drinks_count or est_kcal, call",
    "  ask_clarification for the one detail that matters most, rather than guessing. Estimate",
    "  freely only when the description is specific enough ('a 12oz light beer', 'two 5oz",
    "  glasses of wine'). The beer-variety ambiguity ('a beer' — light lager vs IPA) is an",
    "  alcohol clarification too.",
    "- Capture the time ONLY if the user states or clearly implies one ('at 1pm', '8am',",
    "  'for breakfast', 'around noon'): set eaten_at to a naive-local ISO string with NO",
    `  timezone/Z suffix (e.g. '2026-06-22T13:00:00'), in the user's timezone (${ctx.timezone}),`,
    "  interpreting it on the current local date given in the context below. If the user",
    "  gives no time, OMIT eaten_at — do NOT invent one; the app fills in the current time",
    "  on save. For a meal phrased as a named mealtime, use a sensible hour (breakfast",
    "  ~8:00, lunch ~12:30, dinner ~19:00) only when the user named that mealtime.",
    "  This applies to stored-meal matches too: if the user stated a time, set eaten_at",
    "  on the stored proposal as well (the time is honored even though macros are copied",
    "  from the library).",
    "",
    `Units: ${ctx.unitSystem}. Macros are grams; energy is kcal.`,
    ctx.activePhaseTargets
      ? `Active phase targets — kcal:${ctx.activePhaseTargets.kcal} protein_g:${ctx.activePhaseTargets.protein_g} carb_g:${ctx.activePhaseTargets.carb_g} fat_g:${ctx.activePhaseTargets.fat_g}`
      : "No active nutrition phase.",
    "",
    "Stored-meal library (id · name · kcal · P/C/F):",
    ctx.storedMeals.length === 0
      ? "  (empty)"
      : ctx.storedMeals
          .map(
            (m) => `  ${m.id} · ${m.name} · ${m.kcal}kcal · ${m.protein_g}/${m.carb_g}/${m.fat_g}`,
          )
          .join("\n"),
    ...renderAboutMeBlock(ctx.aboutMe),
  ].join("\n");

  const volatile = [
    `Today (user-local) is ${ctx.today}.`,
    "",
    ...renderTodaySoFar(ctx.todayMacros),
    "",
    "Recent meals (for 'the usual' references):",
    ctx.recentMeals.length === 0
      ? "  (none)"
      : ctx.recentMeals.map((m) => `  ${m.eaten_at} · ${m.name} · ${m.kcal}kcal`).join("\n"),
  ].join("\n");

  return { stable, volatile };
}
