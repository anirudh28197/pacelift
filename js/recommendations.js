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
      <h3>Tips</h3>
      <div id="recoList"><p class="muted">Analyzing your data...</p></div>
    </div>
  `;

  const listEl = document.getElementById("recoList");

  let lifts, runs, weights;
  try {
    ({ lifts, runs, weights } = await fetchTrainingData());
    const recos = buildRuleBasedRecommendations(lifts, runs, weights);
    if (!recos.length) {
      listEl.innerHTML = `<p class="muted">Log a few workouts and runs to get personalized tips.</p>`;
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
    return;
  }

  // AI coaching is purely additive on top of the rule-based tips above — any
  // failure here (no API key configured yet, network error, etc.) is caught
  // and ignored so it can never break the Tips tab.
  fetchAiCoachTips(lifts, runs, weights)
    .then((tips) => {
      if (!tips.length) return;
      container.insertAdjacentHTML(
        "beforeend",
        `<div class="card">
          <h3>🤖 AI Coach</h3>
          <div>${tips.map((t) => `<p class="ai-tip">${escapeHtml(t)}</p>`).join("")}</div>
        </div>`
      );
    })
    .catch(() => {});
}

async function fetchTrainingData() {
  const [liftsRes, runsRes, weightsRes] = await Promise.all([
    supabase.from("lift_sets").select("date, muscle_group, exercise_name, weight_kg, reps"),
    supabase.from("runs").select("date, run_type, distance_km, duration_seconds"),
    supabase.from("body_weight_logs").select("date, weight_kg").order("date", { ascending: true }),
  ]);

  if (liftsRes.error) throw liftsRes.error;
  if (runsRes.error) throw runsRes.error;
  if (weightsRes.error) throw weightsRes.error;

  return { lifts: liftsRes.data, runs: runsRes.data, weights: weightsRes.data };
}

async function fetchAiCoachTips(lifts, runs, weights) {
  if (!lifts.length && !runs.length) return [];

  const res = await fetch("/.netlify/functions/ai-coach", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lifts, runs, weights }),
  });
  if (!res.ok) return [];

  const data = await res.json();
  return Array.isArray(data.tips) ? data.tips : [];
}

function buildRuleBasedRecommendations(lifts, runs, weights) {
  const today = todayStr();
  const recos = [];

  if (!lifts.length && !runs.length) return [];

  // 1. Overall inactivity — no workout in 3+ days.
  const allDates = [...new Set([...lifts.map((l) => l.date), ...runs.map((r) => r.date)])].sort();
  if (allDates.length) {
    const daysSince = daysBetween(today, allDates[allDates.length - 1]);
    if (daysSince >= 3) {
      recos.push({
        icon: "⚡",
        level: "warn",
        text: `You haven't logged any activity in ${daysSince} days — even a short session today will help you maintain momentum.`,
      });
    }
  }

  // 2. New PR from the most recent session.
  if (lifts.length >= 1) {
    const sortedLiftDates = [...new Set(lifts.map((l) => l.date))].sort();
    const lastDate = sortedLiftDates[sortedLiftDates.length - 1];
    const lastLifts = lifts.filter((l) => l.date === lastDate);
    const priorLifts = lifts.filter((l) => l.date < lastDate);

    const priorBest = new Map();
    for (const row of priorLifts) {
      const key = `${row.muscle_group}|${row.exercise_name}`;
      priorBest.set(key, Math.max(priorBest.get(key) || 0, row.weight_kg));
    }

    const newPRs = [];
    const seenKeys = new Set();
    for (const row of lastLifts) {
      const key = `${row.muscle_group}|${row.exercise_name}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const prev = priorBest.get(key) || 0;
      if (prev > 0 && row.weight_kg > prev) {
        newPRs.push(`${row.exercise_name} (${row.weight_kg}kg)`);
      }
    }

    if (newPRs.length) {
      recos.push({
        icon: "🏆",
        level: "good",
        text: `New personal record${newPRs.length > 1 ? "s" : ""} from your last session: ${newPRs.join(", ")} — great work!`,
      });
    }
  }

  // 3. Strength plateaus — same top weight for last 3 sessions on an exercise.
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
          text: `Your ${exerciseName} weight has been stuck at ${last3[2]}kg for 3 sessions in a row — try adding 2.5kg next time to break through.`,
        });
      }
    }
  }

  // 4. Estimated 1RM improvement — highlight the single biggest gain.
  {
    const oneRMByEx = new Map();
    for (const row of lifts) {
      if (!row.reps || row.reps <= 0 || !row.weight_kg) continue;
      const est = row.weight_kg * (1 + row.reps / 30);
      const key = `${row.muscle_group}|${row.exercise_name}`;
      if (!oneRMByEx.has(key)) oneRMByEx.set(key, []);
      oneRMByEx.get(key).push({ date: row.date, est });
    }

    let bestExercise = null;
    let bestGainPct = 0;

    for (const [key, sessions] of oneRMByEx) {
      const sorted = sessions.sort((a, b) => (a.date < b.date ? -1 : 1));
      if (sorted.length < 4) continue;
      const baseline = sorted.slice(0, 2).reduce((s, x) => s + x.est, 0) / 2;
      const recent = sorted.slice(-2).reduce((s, x) => s + x.est, 0) / 2;
      const pct = ((recent - baseline) / baseline) * 100;
      if (pct >= 10 && pct > bestGainPct) {
        bestGainPct = pct;
        bestExercise = key.split("|")[1];
      }
    }

    if (bestExercise) {
      recos.push({
        icon: "💪",
        level: "good",
        text: `Your estimated strength on ${bestExercise} has grown ~${Math.round(bestGainPct)}% since you started — solid progress!`,
      });
    }
  }

  // 5. Muscle groups not trained in > 7 days (show max 2 most overdue).
  const overdueGroups = [];
  for (const mg of MUSCLE_GROUPS) {
    const dates = lifts.filter((r) => r.muscle_group === mg).map((r) => r.date);
    if (!dates.length) continue;
    const lastDate = dates.sort().slice(-1)[0];
    const daysSince = daysBetween(today, lastDate);
    if (daysSince > 7) overdueGroups.push({ mg, daysSince });
  }
  overdueGroups.sort((a, b) => b.daysSince - a.daysSince);
  for (const { mg, daysSince } of overdueGroups.slice(0, 2)) {
    recos.push({
      icon: "💪",
      level: "warn",
      text: `You haven't trained ${MUSCLE_GROUP_LABELS[mg]} in ${daysSince} days — consider adding it to your next session.`,
    });
  }

  // 6. Push/pull imbalance in the last 30 days.
  {
    const thirtyDaysAgo = formatDate(addDays(new Date(), -30));
    const recent = lifts.filter((l) => l.date >= thirtyDaysAgo);
    const pushSessions = new Set(
      recent.filter((l) => ["chest", "shoulders", "triceps"].includes(l.muscle_group)).map((l) => `${l.muscle_group}|${l.date}`)
    ).size;
    const pullSessions = new Set(
      recent.filter((l) => ["back", "biceps"].includes(l.muscle_group)).map((l) => `${l.muscle_group}|${l.date}`)
    ).size;

    if (pushSessions > 0 && pullSessions > 0) {
      const ratio = pushSessions / pullSessions;
      if (ratio >= 2.5) {
        recos.push({
          icon: "⚖️",
          level: "warn",
          text: `You're training push muscles ${Math.round(ratio)}× more than pull muscles lately — add more back and bicep work to stay balanced and protect your posture.`,
        });
      } else if (ratio <= 0.4) {
        recos.push({
          icon: "⚖️",
          level: "warn",
          text: `You're training pull muscles ${Math.round(1 / ratio)}× more than push muscles lately — balance it out with more chest, shoulder, and tricep work.`,
        });
      }
    }
  }

  // 7. Same muscle group trained on back-to-back days.
  for (const mg of MUSCLE_GROUPS) {
    const dates = [...new Set(lifts.filter((r) => r.muscle_group === mg).map((r) => r.date))].sort();
    if (dates.length >= 2) {
      const last = dates[dates.length - 1];
      const secondLast = dates[dates.length - 2];
      if (daysBetween(last, secondLast) === 1 && daysBetween(today, last) <= 1) {
        recos.push({
          icon: "🛌",
          level: "info",
          text: `You trained ${MUSCLE_GROUP_LABELS[mg]} two days in a row — give it a rest day to recover and grow stronger.`,
        });
      }
    }
  }

  // 8. No runs this week (only if lifting regularly).
  const weekStart = formatDate(startOfWeek(new Date()));
  if (!runs.filter((r) => r.date >= weekStart).length && lifts.length) {
    recos.push({
      icon: "🏃",
      level: "warn",
      text: "You haven't logged a run this week — even a short recovery run improves circulation and helps muscles recover faster.",
    });
  }

  // 9. No long run in 2 weeks (if running regularly).
  const twoWeeksAgo = formatDate(addDays(new Date(), -14));
  const recentRuns = runs.filter((r) => r.date >= twoWeeksAgo);
  if (recentRuns.length >= 2 && !recentRuns.some((r) => r.run_type === "long")) {
    recos.push({
      icon: "🏔️",
      level: "info",
      text: "You've been running regularly but haven't done a long run in 2 weeks — a longer, slower run builds your aerobic base and endurance.",
    });
  }

  // 10. Speed run pace trend.
  const speedRuns = runs
    .filter((r) => r.run_type === "speed" && r.distance_km > 0 && r.duration_seconds > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  if (speedRuns.length >= 4) {
    const pace = (r) => r.duration_seconds / 60 / r.distance_km;
    const recentAvg = (pace(speedRuns[speedRuns.length - 1]) + pace(speedRuns[speedRuns.length - 2])) / 2;
    const prevAvg = (pace(speedRuns[speedRuns.length - 3]) + pace(speedRuns[speedRuns.length - 4])) / 2;
    if (recentAvg > prevAvg * 1.07) {
      recos.push({
        icon: "🐢",
        level: "info",
        text: `Your speed run pace has slowed ~${Math.round(((recentAvg - prevAvg) / prevAvg) * 100)}% recently (${recentAvg.toFixed(1)} vs ${prevAvg.toFixed(1)} min/km) — try a focused interval session to sharpen it.`,
      });
    } else if (recentAvg < prevAvg * 0.95) {
      recos.push({
        icon: "🚀",
        level: "good",
        text: `Your speed run pace has improved ~${Math.round(((prevAvg - recentAvg) / prevAvg) * 100)}% recently (${recentAvg.toFixed(1)} vs ${prevAvg.toFixed(1)} min/km) — great work, keep pushing!`,
      });
    }
  }

  // 11. Body weight trend (if 7+ entries logged).
  if (weights.length >= 7) {
    const recent = weights.slice(-7).map((w) => w.weight_kg);
    const change = recent[recent.length - 1] - recent[0];
    if (change >= 1.5) {
      recos.push({
        icon: "📈",
        level: "info",
        text: `Your weight is up ${change.toFixed(1)}kg over the past week — if unintended, review your nutrition and consider adding more cardio.`,
      });
    } else if (change <= -1.5) {
      recos.push({
        icon: "📉",
        level: "info",
        text: `Your weight dropped ${Math.abs(change).toFixed(1)}kg this week — make sure you're eating enough to fuel your training and recovery.`,
      });
    }
  }

  // If no warnings, add an encouraging note.
  if (!recos.some((r) => r.level === "warn")) {
    recos.unshift({
      icon: "✅",
      level: "good",
      text: "Your training looks consistent and well-balanced — keep it up!",
    });
  }

  return recos;
}
