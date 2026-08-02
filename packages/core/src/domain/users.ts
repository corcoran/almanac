export type UnitSystem = "metric" | "imperial";
export type Sex = "male" | "female";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";

export type User = {
  id: number;
  name: string;
  dob: string | null;
  height_cm: number | null;
  sex: Sex | null;
  email: string | null;
  preferred_unit_system: UnitSystem;
  timezone: string;
  activity_level: ActivityLevel | null;
  llm_logging_enabled: number;
  is_admin: number;
  llm_daily_token_limit: number | null;
  about_me: string | null;
  created_at: string;
};
