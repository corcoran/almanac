/** code → emoji for accomplishment ('win') rows. Shared by WinsSummary and AchievementHistory. */
export const ACCOMPLISHMENT_ICON: Record<string, string> = {
  weigh_in_streak: "🔥",
  workout_consistency: "🏋️",
  target_adherence_streak: "✅",
  weight_milestone: "⚖️",
  tdee_measured: "📈",
  strength_pr: "💪",
  phase_complete: "🏁",
  phase_halfway: "⏳",
  workout_total: "🏆",
  volume_total: "🦾",
  meal_total: "🍽️",
  weigh_in_total: "📊",
  sleep_recovery: "😴",
};

/** Fallback used when a code has no mapped icon. */
export const ACCOMPLISHMENT_ICON_FALLBACK = "🎉";
