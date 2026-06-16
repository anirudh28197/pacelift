import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error || new Error("Not logged in");
  return data.user.id;
}
