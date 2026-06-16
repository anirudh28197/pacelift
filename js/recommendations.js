import { supabase } from "./supabaseClient.js";
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS } from "./exercises.js";
import { formatDate, startOfWeek, todayStr, daysBetween, addDays, escapeHtml } from "./utils.js";

export async function initRecommendationsTab() {
  await render();
}

export async function refreshRecommendationsTab() {
  await render();
}

async function render() {
  const container = document.getElementById("recommendationsTab");
  container.innerHTML = `
    <div class="card">
      <h3>Recommendations</h3>
      <div id="recoList"><p class="muted">Analyzing your data...</p></div>
    </div>
  `;

  const listEl = document.getElementById("recoList");

  try {
    const recos = await generateRecommendations();
    if (!recos.length) {
      listEl.innerHTML = `<p class="muted">Log a few workouts and runs to get personalized recommendations.</p>`;
      return;
    }
    listEl.innerHTML = recos
      .map(
        (r) => `
        <div class="reco-card reco-${r.level}">
          <div class="reco-icon">${r.icon}</div>
          <div class="reco-text">${r.text}</div>
        </div>`
      )
      .join("");
  } catch (err) {
    listEl.innerHTML = `<p class="status error">${escapeHtml(err.message)}</p>`;
  }
}

async function generateRecommendations() {
  const today = todayStr();
  const recos = [];

  const [liftsRes, runsRes] = await Promise.all([
    supabase.from("lift_sets").select("date, muscle_group, exercise_name, weight_kg"),
    supabase.from("runs").select("date, run_type"),
  ]);

  if (liftsRes.error) throw liftsRes.error;
  if (runsRes.error) throw runsRes.error;

  const lifts = liftsRes.data;
  const runs = runsRes.data;

  // 1. Muscle groups that haven't been trained recently.
  for (const mg of MUSCLE_GROUPS) {
    const dates = lifts.filter((r) => r.muscle_group === mg).map((r) => r.date);
    if (!dates.length) {
      recos.push({
        icon: "💪",
        level: "info",
        text: `You haven't logged any ${MUSCLE_GROUP_LABELS[mg]} workouts yet — add one to start tracking progress.`,
      });
      continue;
    }
    const lastDate = dates.sort().slice(-1)[0];
    const daysSince = daysBetween(today, lastDate);
    if (daysSince > 7) {
      recos.push({
        icon: "💪",
        level: "warn",
        text: `You haven't trained ${MUSCLE_GROUP_LABELS[mg]} in ${daysSince} days — consider adding it to your next session.`,
      });
    }
  }

  // 2. Strength plateaus — top weight unchanged for the last 3 sessions.
  const exerciseProgress = new Map();
  for (const row of lifts) {
    const key = `${row.muscle_group}|${row.exercise_name}`;
    if (!exerciseProgress.has(key)) exerciseProgress.set(key, new Map());
    const byDate = exerciseProgress.get(key);
    byDate.set(row.date, Math.max(byDate.get(row.date) || 0, row.weight_kg));
  }

  for (const [key, byDate] of exerciseProgress) {
    const exerciseName = key.split("|")[1];
    const sorted = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (sorted.length >= 3) {
      const last3 = sorted.slice(-3).map(([, w]) => w);
      if (last3[0] === last3[1] && last3[1] === last3[2]) {
        recos.push({
          icon: "📈",
          level: "info",
          text: `Your ${exerciseName} weight has been steady at ${last3[2]}kg for your last 3 sessions — try bumping it up to ${last3[2] + 2.5}kg next time.`,
        });
      }
    }
  }

  // 3. No runs logged this week.
  const weekStart = formatDate(startOfWeek(new Date()));
  const runsThisWeek = runs.filter((r) => r.date >= weekStart);
  if (!runsThisWeek.length) {
    recos.push({
      icon: "🏃",
      level: "warn",
      text: "You haven't logged a run this week — even a short recovery run helps maintain consistency.",
    });
  }

  // 4. Same muscle group trained on back-to-back days — suggest rest.
  for (const mg of MUSCLE_GROUPS) {
    const dates = [...new Set(lifts.filter((r) => r.muscle_group === mg).map((r) => r.date))].sort();
    if (dates.length >= 2) {
      const last = dates[dates.length - 1];
      const secondLast = dates[dates.length - 2];
      if (daysBetween(last, secondLast) === 1 && daysBetween(today, last) <= 1) {
        recos.push({
          icon: "🛌",
          level: "info",
          text: `You trained ${MUSCLE_GROUP_LABELS[mg]} on back-to-back days — consider giving it a rest day to recover.`,
        });
      }
    }
  }

  // 5. No long run in the last 2 weeks, despite recent running activity.
  const twoWeeksAgo = formatDate(addDays(new Date(), -14));
  const recentRuns = runs.filter((r) => r.date >= twoWeeksAgo);
  if (recentRuns.length && !recentRuns.some((r) => r.run_type === "long")) {
    recos.push({
      icon: "🏔️",
      level: "info",
      text: "You haven't done a long run in the last 2 weeks — adding one can help build your endurance base.",
    });
  }

  // 6. No runs at all yet.
  if (!runs.length) {
    recos.push({
      icon: "🏃",
      level: "info",
      text: "You haven't logged any runs yet — start with a recovery run to get a baseline.",
    });
  }

  // If everything looks on track, add a positive note.
  if (!recos.some((r) => r.level === "warn")) {
    recos.unshift({
      icon: "✅",
      level: "good",
      text: "Your training looks consistent and balanced across muscle groups and runs — keep it up!",
    });
  }

  return recos;
}
