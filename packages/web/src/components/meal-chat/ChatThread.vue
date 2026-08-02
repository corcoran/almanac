<script setup lang="ts">
import { computed } from "vue";
import {
  lastEstablishedDate,
  lastEstablishedTime,
  type Turn,
} from "../../stores/meal-chat.store.js";
import WebSourcesFootnote from "../chat/WebSourcesFootnote.vue";
import AlcoholCard from "./AlcoholCard.vue";
import ProposalCard from "./ProposalCard.vue";
import QuestionBubble from "./QuestionBubble.vue";

const props = defineProps<{
  turns: Turn[];
  viewedDate: string;
  realToday: string;
  pending?: boolean;
}>();

// The time + date established earlier in the conversation, passed to every card
// as the default for re-estimates the model returned without their own eaten_at.
// The date travels too so a late-evening re-estimate keeps the original day.
const fallbackTime = computed(() => lastEstablishedTime(props.turns) ?? undefined);
const fallbackDate = computed(() => lastEstablishedDate(props.turns) ?? undefined);

const emit = defineEmits<{
  (
    e: "log-estimated",
    turnIndex: number,
    mealIndex: number,
    body: {
      name: string | null;
      kcal: number;
      protein_g: number;
      carb_g: number;
      fat_g: number;
      eaten_at: string;
    },
    save: boolean,
  ): void;
  (
    e: "log-stored",
    turnIndex: number,
    mealIndex: number,
    storedMealId: number,
    eatenAt: string,
  ): void;
  (
    e: "log-alcohol",
    turnIndex: number,
    alcoholIndex: number,
    body: { drinks_count: number; est_kcal: number; started_at: string; notes: string | null },
  ): void;
  (e: "dismiss-alcohol", turnIndex: number, alcoholIndex: number): void;
  (e: "dismiss", turnIndex: number, mealIndex: number): void;
  (e: "log-all", turnIndex: number): void;
}>();
</script>

<template>
  <div class="chat-thread" data-test="chat-thread">
    <template v-for="(turn, ti) in turns" :key="ti">
      <div v-if="turn.role === 'user'" class="user-turn" data-test="chat-user-turn">
        {{ turn.content }}
      </div>

      <div v-else-if="turn.kind === 'question'" class="assistant-turn">
        <WebSourcesFootnote
          v-if="turn.usage.sources.length > 0"
          :sources="turn.usage.sources"
        />
        <div
          v-else-if="turn.usage.web_search_requests > 0"
          class="searched-note"
          data-test="chat-searched"
        >🔍 searched the web</div>
        <QuestionBubble :question="turn.content" />
        <div v-if="turn.searchNote" class="search-note" data-test="chat-search-note">{{ turn.searchNote }}</div>
      </div>

      <div v-else class="assistant-turn">
        <WebSourcesFootnote
          v-if="turn.usage.sources.length > 0"
          :sources="turn.usage.sources"
        />
        <div
          v-else-if="turn.usage.web_search_requests > 0"
          class="searched-note"
          data-test="chat-searched"
        >🔍 searched the web</div>
        <ProposalCard
          v-for="(meal, mi) in turn.meals"
          :key="meal._key"
          :meal="meal"
          :viewed-date="viewedDate"
          :real-today="realToday"
          :pending="pending"
          :fallback-time="fallbackTime"
          :fallback-date="fallbackDate"
          @log-estimated="(body, save) => emit('log-estimated', ti, mi, body, save)"
          @log-stored="(id, eatenAt) => emit('log-stored', ti, mi, id, eatenAt)"
          @dismiss="emit('dismiss', ti, mi)"
        />
        <AlcoholCard
          v-for="(a, ai) in turn.alcoholSessions"
          :key="a._key"
          :alcohol="a"
          :viewed-date="viewedDate"
          :real-today="realToday"
          :pending="pending"
          :fallback-time="fallbackTime"
          :fallback-date="fallbackDate"
          @log-alcohol="(body) => emit('log-alcohol', ti, ai, body)"
          @dismiss="emit('dismiss-alcohol', ti, ai)"
        />
        <button
          v-if="turn.meals.length + turn.alcoholSessions.length > 1"
          type="button"
          class="log-all-btn"
          :disabled="pending"
          data-test="chat-log-all"
          @click="emit('log-all', ti)"
        >Log all {{ turn.meals.length + turn.alcoholSessions.length }}</button>
        <div
          v-for="(s, li) in turn.loggedSummaries"
          :key="'logged-' + li"
          class="logged-row"
          data-test="chat-logged"
        >{{ s }}</div>
        <div v-if="turn.searchNote" class="search-note" data-test="chat-search-note">{{ turn.searchNote }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.chat-thread { display: flex; flex-direction: column; gap: 10px; }
.user-turn {
  align-self: flex-end; max-width: 85%;
  background: var(--accent, #5b7cfa); color: #fff;
  border-radius: 12px 12px 2px 12px; padding: 8px 12px; font-size: 13px;
}
.assistant-turn { align-self: flex-start; width: 100%; max-width: 92%; }
.log-all-btn {
  margin-top: 4px; font: inherit; font-size: 12px; cursor: pointer;
  background: transparent; border: 1px dashed var(--line-2, #353a4a);
  color: var(--ink-dim, #9aa0ad); border-radius: 6px; padding: 6px 10px;
}
.log-all-btn:disabled { opacity: 0.5; cursor: default; }
.logged-row {
  margin-top: 4px; font-size: 12px;
  color: var(--good, #6cc070);
}
.search-note {
  margin-top: 4px; font-size: 12px;
  color: var(--ink-dim, #9aa0ad); font-style: italic;
}
.searched-note {
  margin-bottom: 4px; font-size: 11px;
  color: var(--ink-faint, #6b7180);
}
</style>
