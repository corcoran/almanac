/**
 * Static starter-program catalog for workout-template authoring. Pure data +
 * a pure expansion function so the web UI can seed templates and a future MCP
 * `apply_template_preset` tool can reuse the same source of truth (mirrors how
 * report.ts keeps assembleReport pure for cross-package reuse).
 *
 * Preset items reference exercises by NAME (resolved to the user's library at
 * apply time, creating any missing exercise/group). Presets never prescribe a
 * weight — weight is personal and left blank for the user to fill in.
 */

export type PresetItem = {
  exerciseName: string;
  groupName: string;
  default_sets: number;
  default_reps: number | null;
};

export type PresetTemplate = {
  name: string;
  items: PresetItem[];
};

export type ProgramPreset = {
  id: "ppl" | "upper_lower";
  label: string;
  templates: PresetTemplate[];
};

export type ExpandedProgram = {
  templates: PresetTemplate[];
};

const compound = (exerciseName: string, groupName: string): PresetItem => ({
  exerciseName,
  groupName,
  default_sets: 3,
  default_reps: 5,
});

const accessory = (exerciseName: string, groupName: string): PresetItem => ({
  exerciseName,
  groupName,
  default_sets: 3,
  default_reps: 10,
});

export const PROGRAM_PRESETS: readonly ProgramPreset[] = [
  {
    id: "ppl",
    label: "Push / Pull / Legs",
    templates: [
      {
        name: "Push",
        items: [
          compound("Barbell bench press", "Chest"),
          compound("Overhead press", "Shoulders"),
          accessory("Incline dumbbell press", "Chest"),
          accessory("Lateral raise", "Shoulders"),
          accessory("Triceps pushdown", "Arms"),
        ],
      },
      {
        name: "Pull",
        items: [
          compound("Barbell row", "Back"),
          accessory("Lat pulldown", "Back"),
          accessory("Face pull", "Back"),
          accessory("Biceps curl", "Arms"),
        ],
      },
      {
        name: "Legs",
        items: [
          compound("Back squat", "Legs"),
          compound("Romanian deadlift", "Legs"),
          accessory("Leg press", "Legs"),
          accessory("Leg curl", "Legs"),
          accessory("Calf raise", "Legs"),
        ],
      },
    ],
  },
  {
    id: "upper_lower",
    label: "Upper / Lower",
    templates: [
      {
        name: "Upper",
        items: [
          compound("Barbell bench press", "Chest"),
          compound("Barbell row", "Back"),
          accessory("Overhead press", "Shoulders"),
          accessory("Lat pulldown", "Back"),
          accessory("Biceps curl", "Arms"),
          accessory("Triceps pushdown", "Arms"),
        ],
      },
      {
        name: "Lower",
        items: [
          compound("Back squat", "Legs"),
          compound("Romanian deadlift", "Legs"),
          accessory("Leg press", "Legs"),
          accessory("Leg curl", "Legs"),
          accessory("Calf raise", "Legs"),
        ],
      },
    ],
  },
];

/**
 * Expand a program preset into the templates to create. Near-identity in this
 * first cut, but the seam for any future per-user logic and the function an
 * MCP tool would call.
 */
export function expandProgramPreset(preset: ProgramPreset): ExpandedProgram {
  return { templates: preset.templates };
}
