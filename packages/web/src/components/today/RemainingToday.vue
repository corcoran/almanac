<script setup lang="ts">
import type { TodayContextResponseSchema } from "@almanac/core/schemas";
import type { z } from "zod";
import CalorieRing from "./CalorieRing.vue";
import MacroBar from "./MacroBar.vue";

type TodayBlock = z.infer<typeof TodayContextResponseSchema>["today"];

const props = defineProps<{ today: TodayBlock }>();
</script>

<template>
  <div class="block" data-test="remaining-today">
    <div v-if="!today.target" class="no-phase-message">
      No active phase — remaining target unavailable
    </div>

    <template v-else>
      <div class="ring-wrap">
        <CalorieRing :target="today.target.kcal" :intake="today.intake.kcal" />
        <div class="barset">
          <MacroBar
            name="Protein"
            macro="protein"
            :target="today.target.protein_g"
            :intake="today.intake.protein_g"
          />
          <MacroBar
            name="Carbs"
            macro="carb"
            :target="today.target.carb_g"
            :intake="today.intake.carb_g"
          />
          <MacroBar
            name="Fat"
            macro="fat"
            :target="today.target.fat_g"
            :intake="today.intake.fat_g"
          />
        </div>
      </div>

    </template>
  </div>
</template>

<style scoped>
.block {
  background: var(--panel, #161922);
  border: 1px solid var(--line, #262a36);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.no-phase-message { color: var(--ink-dim, #9aa0ad); font-size: 13px; }

.ring-wrap { display: flex; gap: 16px; align-items: center; }
.barset { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
</style>
