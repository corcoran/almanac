import { type Ref, ref } from "vue";

const GENERIC_ERROR = "Something went wrong. Please try again.";

export interface InlineEdit {
  isEditing: Ref<boolean>;
  pending: Ref<boolean>;
  error: Ref<string | null>;
  startEdit: () => void;
  cancel: () => void;
  save: (fn: () => Promise<void>) => Promise<void>;
}

/**
 * Field-agnostic edit/save/error state machine for inline block editing.
 * The caller supplies `fn` (the actual write + refresh) to `save`; this
 * composable owns only the editing/pending/error transitions. No knowledge
 * of any specific field, the API, or units.
 */
export function useInlineEdit(): InlineEdit {
  const isEditing = ref(false);
  const pending = ref(false);
  const error = ref<string | null>(null);

  function startEdit(): void {
    error.value = null;
    isEditing.value = true;
  }

  function cancel(): void {
    if (pending.value) return;
    error.value = null;
    isEditing.value = false;
  }

  async function save(fn: () => Promise<void>): Promise<void> {
    if (pending.value) return;
    pending.value = true;
    error.value = null;
    try {
      await fn();
      isEditing.value = false;
    } catch (e) {
      error.value = e instanceof Error && e.message ? e.message : GENERIC_ERROR;
    } finally {
      pending.value = false;
    }
  }

  return { isEditing, pending, error, startEdit, cancel, save };
}
