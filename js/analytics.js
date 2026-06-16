import { supabase, getUserId } from "./supabaseClient.js";
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS, getExerciseList } from "./exercises.js";
import { RUN_TYPES, RUN_TYPE_LABELS } from "./runs.js";
import { formatDate, startOfWeek, startOfMonth, todayStr, formatDuration, escapeHtml } from "./utils.js";

let progressChart = null;
let runDistanceChart = null;
let runPaceChart = null;
let weightChart = null;

export async function initAnalyticsTab() {
  await render();
}

export async function refreshAnalyticsTab() {
  await render();
}

async function render() {
  const container = document.getElementById("analyticsTab");

  container.innerHTML = `
    <div class="card">
      <h3>This week</h3>
      <div id="weeklySummary"><p class="muted">Loading...</p></div>
    </div>

    <div class="card">
      <h3>This month</h3>
      <div id="monthlySummary"><p class="muted">Loading...</p></div>
    </div>

    <div class="card">
      <h3>Exercise progress</h3>
      <div class="field">
        <label for="progressMuscleGroup">Muscle group</label>
        <select id="progressMuscleGroup">
          ${MUSCLE_GROUPS.map((mg) => `<option value="${mg}">${MUSCLE_GROUP_LABELS[mg]}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="progressExercise">Exercise</label>
        <select id="progressExercise"></select>
      </div>
      <div class="chart-container"><canvas id="progressChart"></canvas></div>
    </div>

    <div class="card">
      <h3>Run distance over time</h3>
      <div class="chart-container"><canvas id="runDistanceChart"></canvas></div>
    </div>

    <div class="card">
      <h3>Run pace over time</h3>
      <div class="chart-container"><canvas id="runPaceChart"></canvas></div>
    </div>

    <div class="card">
      <h3>Body weight &amp; BMI</h3>
      <div class="field">
        <label for="profileHeight">Height (cm)</label>
        <div class="inline-group">
          <input type="number" inputmode="decimal" min="0" step="0.1" id="profileHeight" placeholder="e.g. 178" />
          <button id="saveHeightBtn" class="secondary-btn" type="button">Save</button>
        </div>
      </div>
      <div class="field">
        <label for="weightInput">Log today's weight (kg)</label>
        <div class="inline-group">
          <input type="number" inputmode="decimal" min="0" step="0.1" id="weightInput" placeholder="e.g. 75.4" />
          <button id="saveWeightBtn" class="secondary-btn" type="button">Save</button>
        </div>
      </div>
      <div id="currentBmi"></div>
      <div class="chart-container"><canvas id="weightChart"></canvas></div>
      <div class="status" id="weightStatus"></div>
    </div>
  `;

  await Promise.all([
    renderSummary("weeklySummary", formatDate(startOfWeek(new Date())), todayStr()),
    renderSummary("monthlySummary", formatDate(startOfMonth(new Date())), todayStr()),
    setupProgressChart(),
    renderRunTrends(),
    setupWeightSection(),
  ]);
}

async function renderSummary(elId, start, end) {
  const el = document.getElementById(elId);

  const [liftsRes, runsRes] = await Promise.all([
    supabase.from("lift_sets").select("date, muscle_group, reps, weight_kg").gte("date", start).lte("date", end),
    supabase.from("runs").select("date, run_type, distance_km, duration_seconds").gte("date", start).lte("date", end),
  ]);

  if (liftsRes.error || runsRes.error) {
    const err = liftsRes.error || runsRes.error;
    el.innerHTML = `<p class="status error">${escapeHtml(err.message)}</p>`;
    return;
  }

  const lifts = liftsRes.data;
  const runs = runsRes.data;

  const strengthRows = MUSCLE_GROUPS.map((mg) => {
    const rows = lifts.filter((r) => r.muscle_group === mg);
    const sessions = new Set(rows.map((r) => r.date)).size;
    const sets = rows.length;
    const volume = rows.reduce((sum, r) => sum + r.reps * r.weight_kg, 0);
    return { mg, sessions, sets, volume };
  });

  const runRows = RUN_TYPES.map((type) => {
    const rows = runs.filter((r) => r.run_type === type);
    const count = rows.length;
    const distance = rows.reduce((sum, r) => sum + r.distance_km, 0);
    const duration = rows.reduce((sum, r) => sum + r.duration_seconds, 0);
    return { type, count, distance, duration };
  });

  el.innerHTML = `
    <div class="summary-section">
      <h4>Strength</h4>
      ${strengthRows
        .map(
          (r) => `
        <div class="summary-row">
          <span>${MUSCLE_GROUP_LABELS[r.mg]}</span>
          <span>${r.sessions} session${r.sessions === 1 ? "" : "s"} · ${r.sets} sets · ${Math.round(r.volume)} kg volume</span>
        </div>`
        )
        .join("")}
    </div>
    <div class="summary-section">
      <h4>Runs</h4>
      ${runRows
        .map(
          (r) => `
        <div class="summary-row">
          <span>${RUN_TYPE_LABELS[r.type]}</span>
          <span>${r.count} run${r.count === 1 ? "" : "s"} · ${r.distance.toFixed(1)} km · ${formatDuration(r.duration)}</span>
        </div>`
        )
        .join("")}
    </div>
  `;
}

async function setupProgressChart() {
  const mgSelect = document.getElementById("progressMuscleGroup");
  const exSelect = document.getElementById("progressExercise");

  async function populateExercises() {
    const exercises = await getExerciseList(mgSelect.value);
    exSelect.innerHTML = exercises
      .map((e) => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`)
      .join("");
  }

  await populateExercises();
  await drawProgressChart();

  mgSelect.addEventListener("change", async () => {
    await populateExercises();
    await drawProgressChart();
  });
  exSelect.addEventListener("change", drawProgressChart);
}

async function drawProgressChart() {
  const mg = document.getElementById("progressMuscleGroup").value;
  const exercise = document.getElementById("progressExercise").value;
  const ctx = document.getElementById("progressChart");

  if (progressChart) {
    progressChart.destroy();
    progressChart = null;
  }
  if (!exercise) return;

  const { data, error } = await supabase
    .from("lift_sets")
    .select("date, weight_kg")
    .eq("muscle_group", mg)
    .eq("exercise_name", exercise)
    .order("date", { ascending: true });

  if (error || !data.length) return;

  const byDate = new Map();
  for (const row of data) {
    byDate.set(row.date, Math.max(byDate.get(row.date) || 0, row.weight_kg));
  }

  progressChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [...byDate.keys()],
      datasets: [
        {
          label: `${exercise} - top weight (kg)`,
          data: [...byDate.values()],
          borderColor: "#f7d774",
          backgroundColor: "rgba(247,215,116,0.2)",
          tension: 0.2,
        },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
  });
}

async function renderRunTrends() {
  const distCtx = document.getElementById("runDistanceChart");
  const paceCtx = document.getElementById("runPaceChart");

  if (runDistanceChart) {
    runDistanceChart.destroy();
    runDistanceChart = null;
  }
  if (runPaceChart) {
    runPaceChart.destroy();
    runPaceChart = null;
  }

  const { data, error } = await supabase
    .from("runs")
    .select("date, run_type, distance_km, duration_seconds")
    .order("date", { ascending: true });

  if (error || !data.length) return;

  const dates = [...new Set(data.map((r) => r.date))].sort();
  const colors = { speed: "#ff8a8a", recovery: "#7cfc9a", long: "#f7d774" };

  function datasetsFor(valueFn) {
    return RUN_TYPES.map((type) => ({
      label: RUN_TYPE_LABELS[type],
      data: dates.map((date) => {
        const run = data.find((r) => r.date === date && r.run_type === type);
        return run ? valueFn(run) : null;
      }),
      borderColor: colors[type],
      backgroundColor: colors[type],
      spanGaps: true,
      tension: 0.2,
    }));
  }

  runDistanceChart = new Chart(distCtx, {
    type: "line",
    data: { labels: dates, datasets: datasetsFor((r) => r.distance_km) },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, title: { display: true, text: "km" } } },
    },
  });

  runPaceChart = new Chart(paceCtx, {
    type: "line",
    data: { labels: dates, datasets: datasetsFor((r) => r.duration_seconds / 60 / r.distance_km) },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, title: { display: true, text: "min/km" } } },
    },
  });
}

async function setupWeightSection() {
  const userId = await getUserId();
  const { data: profile } = await supabase
    .from("profile")
    .select("height_cm")
    .eq("user_id", userId)
    .maybeSingle();

  const heightInput = document.getElementById("profileHeight");
  if (profile && profile.height_cm) heightInput.value = profile.height_cm;

  document.getElementById("saveHeightBtn").addEventListener("click", async () => {
    const status = document.getElementById("weightStatus");
    const height = Number(heightInput.value);
    if (!height || height <= 0) {
      status.textContent = "Please enter a valid height.";
      status.className = "status error";
      return;
    }
    const { error } = await supabase
      .from("profile")
      .upsert({ user_id: userId, height_cm: height, updated_at: new Date().toISOString() });
    if (error) {
      status.textContent = error.message;
      status.className = "status error";
      return;
    }
    status.textContent = "Height saved.";
    status.className = "status success";
    await drawWeightChart();
  });

  document.getElementById("saveWeightBtn").addEventListener("click", async () => {
    const status = document.getElementById("weightStatus");
    const weightInput = document.getElementById("weightInput");
    const weight = Number(weightInput.value);
    if (!weight || weight <= 0) {
      status.textContent = "Please enter a valid weight.";
      status.className = "status error";
      return;
    }
    const { error } = await supabase
      .from("body_weight_logs")
      .upsert({ user_id: userId, date: todayStr(), weight_kg: weight }, { onConflict: "user_id,date" });
    if (error) {
      status.textContent = error.message;
      status.className = "status error";
      return;
    }
    status.textContent = "Weight logged.";
    status.className = "status success";
    weightInput.value = "";
    await drawWeightChart();
  });

  await drawWeightChart();
}

async function drawWeightChart() {
  const userId = await getUserId();
  const ctx = document.getElementById("weightChart");
  const bmiEl = document.getElementById("currentBmi");

  if (weightChart) {
    weightChart.destroy();
    weightChart = null;
  }

  const [{ data: profile }, { data: weights, error }] = await Promise.all([
    supabase.from("profile").select("height_cm").eq("user_id", userId).maybeSingle(),
    supabase.from("body_weight_logs").select("date, weight_kg").order("date", { ascending: true }),
  ]);

  if (error || !weights.length) {
    bmiEl.innerHTML = `<p class="muted">Log your weight to see your BMI and trend.</p>`;
    return;
  }

  const heightM = profile && profile.height_cm ? profile.height_cm / 100 : null;
  const latest = weights[weights.length - 1];

  if (heightM) {
    const bmi = latest.weight_kg / (heightM * heightM);
    bmiEl.innerHTML = `<p>Current BMI: <strong>${bmi.toFixed(1)}</strong> (${bmiCategory(bmi)}) — based on ${latest.weight_kg}kg on ${latest.date}</p>`;
  } else {
    bmiEl.innerHTML = `<p class="muted">Set your height above to see your BMI.</p>`;
  }

  const datasets = [
    {
      label: "Weight (kg)",
      data: weights.map((w) => w.weight_kg),
      borderColor: "#7cfc9a",
      backgroundColor: "rgba(124,252,154,0.2)",
      yAxisID: "y",
      tension: 0.2,
    },
  ];

  const scales = {
    y: { type: "linear", position: "left", title: { display: true, text: "kg" } },
  };

  if (heightM) {
    datasets.push({
      label: "BMI",
      data: weights.map((w) => w.weight_kg / (heightM * heightM)),
      borderColor: "#f7d774",
      backgroundColor: "rgba(247,215,116,0.2)",
      yAxisID: "y1",
      tension: 0.2,
    });
    scales.y1 = {
      type: "linear",
      position: "right",
      title: { display: true, text: "BMI" },
      grid: { drawOnChartArea: false },
    };
  }

  weightChart = new Chart(ctx, {
    type: "line",
    data: { labels: weights.map((w) => w.date), datasets },
    options: { responsive: true, maintainAspectRatio: false, scales },
  });
}

function bmiCategory(bmi) {
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "overweight";
  return "obese";
}
