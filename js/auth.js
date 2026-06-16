import { supabase } from "./supabaseClient.js";

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function login(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export function logout() {
  return supabase.auth.signOut();
}

export function onAuthStateChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => callback(session));
}
