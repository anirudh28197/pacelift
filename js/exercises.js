import { supabase, getUserId } from "./supabaseClient.js";

export const MUSCLE_GROUPS = ["chest", "back", "biceps", "triceps", "shoulders"];

export const MUSCLE_GROUP_LABELS = {
  chest: "Chest",
  back: "Back",
  biceps: "Biceps",
  triceps: "Triceps",
  shoulders: "Shoulders",
};

export const DEFAULT_EXERCISES = {
  chest: ["Bench Press", "Incline Bench Press", "Dumbbell Press", "Push-ups", "Cable Fly", "Dips"],
  back: ["Deadlift", "Pull-ups", "Lat Pulldown", "Barbell Row", "Seated Cable Row", "T-Bar Row"],
  biceps: ["Barbell Curl", "Dumbbell Curl", "Hammer Curl", "Preacher Curl", "Cable Curl"],
  triceps: ["Tricep Pushdown", "Skull Crushers", "Overhead Tricep Extension", "Close-Grip Bench Press"],
  shoulders: ["Overhead Press", "Lateral Raise", "Front Raise", "Arnold Press", "Face Pull", "Rear Delt Fly"],
};

export async function getCustomExercises(muscleGroup) {
  const { data, error } = await supabase
    .from("custom_exercises")
    .select("name")
    .eq("muscle_group", muscleGroup)
    .order("name");
  if (error) throw error;
  return data.map((row) => row.name);
}

export async function addCustomExercise(muscleGroup, name) {
  const userId = await getUserId();
  const { error } = await supabase
    .from("custom_exercises")
    .insert({ muscle_group: muscleGroup, name, user_id: userId });
  if (error) throw error;
}

export async function getExerciseList(muscleGroup) {
  const custom = await getCustomExercises(muscleGroup);
  return [...DEFAULT_EXERCISES[muscleGroup], ...custom];
}
