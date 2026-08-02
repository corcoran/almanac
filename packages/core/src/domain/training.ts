export type ExerciseGroup = {
  id: number;
  user_id: number;
  name: string;
  display_order: number;
  created_at: string;
};

export type Exercise = {
  id: number;
  user_id: number;
  group_id: number;
  name: string;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
};

export type WorkoutTemplateItem = {
  id: number;
  template_id: number;
  exercise_id: number;
  display_order: number;
  default_sets: number;
  default_reps: number | null;
  default_weight_kg: number | null;
  notes: string | null;
};

export type WorkoutTemplate = {
  id: number;
  user_id: number;
  name: string;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  items?: WorkoutTemplateItem[];
};
