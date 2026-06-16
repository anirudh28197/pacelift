import { supabase, getUserId } from "./supabaseClient.js";
import { todayStr, formatDuration, formatPace, escapeHtml } from "./utils.js";

export const RUN_TYPES = ["speed", "recovery", "long"];
export const RUN_TYPE_LABELS = { speed: "Speed", recovery: "Recovery", long: "Long" };

// GPS tracking state
let tracking = false;
let watchId = null;
let timerInterval = null;
let startTime = null;
let elapsedSeconds = 0;
let totalDistanceKm = 0;
let routePoints = [];
let lastPosition = null;

// Manual form edit state
let editingRunId = null;

export async function initRunsTab() {
  await render();
}

export async function refreshRunsTab() {
  await render();
}

async function render() {
  const container = document.getElementById("runsTab");

  container.innerHTML = `
    <div class="card">
      <h3>Track a run</h3>
      <div class="field">
        <label for="trackerRunType">Run type</label>
        <select id="trackerRunType">
          ${RUN_TYPES.map((t) => `<option value="${t}">${RUN_TYPE_LABELS[t]}</option>`).join("")}
        </select>
      </div>
      <div class="tracker-stats">
        <div class="tracker-stat"><span class="tracker-value" id="trackerTime">0:00</span><span class="tracker-label">Time</span></div>
        <div class="tracker-stat"><span class="tracker-value" id="trackerDistance">0.00 km</span><span class="tracker-label">Distance</span></div>
        <div class="tracker-stat"><span class="tracker-value" id="trackerPace">—</span><span class="tracker-label">Pace</span></div>
      </div>
      <button id="trackerBtn" class="primary-btn" type="button">Start GPS Tracking</button>
      <div class="status" id="trackerStatus"></div>
      <p class="hint">Keep this tab open and your screen on while tracking — GPS tracking pauses if your phone locks or you switch apps.</p>
    </div>

    <div class="card">
      <h3 id="manualFormTitle">Add a run manually</h3>
      <div class="field">
        <label for="manualDate">Date</label>
        <input type="date" id="manualDate" value="${todayStr()}" />
      </div>
      <div class="field">
        <label for="manualRunType">Run type</label>
        <select id="manualRunType">
          ${RUN_TYPES.map((t) => `<option value="${t}">${RUN_TYPE_LABELS[t]}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="manualDistance">Distance (km)</label>
        <input type="number" inputmode="decimal" min="0" step="0.01" id="manualDistance" placeholder="e.g. 5.2" />
      </div>
      <div class="field">
        <label>Duration</label>
        <div class="inline-group">
          <input type="number" inputmode="numeric" min="0" id="manualMinutes" placeholder="Minutes" />
          <input type="number" inputmode="numeric" min="0" max="59" id="manualSeconds" placeholder="Seconds" />
        </div>
      </div>
      <div class="field">
        <label for="manualNotes">Notes (optional)</label>
        <input type="text" id="manualNotes" placeholder="e.g. Felt strong, hilly route" />
      </div>
      <button id="manualSaveBtn" class="primary-btn" type="button">Save run</button>
      <button id="manualCancelBtn" class="secondary-btn hidden" type="button">Cancel edit</button>
      <div class="status" id="manualStatus"></div>
    </div>

    <div class="card">
      <h3>History</h3>
      <div id="runHistory"><p class="muted">Loading...</p></div>
    </div>
  `;

  document.getElementById("trackerBtn").addEventListener("click", toggleTracking);
  document.getElementById("manualSaveBtn").addEventListener("click", saveManualRun);
  document.getElementById("manualCancelBtn").addEventListener("click", cancelEdit);

  updateTrackerUI();
  await loadHistory();
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toggleTracking() {
  if (tracking) {
    stopTracking();
  } else {
    startTracking();
  }
}

function startTracking() {
  const status = document.getElementById("trackerStatus");

  if (!("geolocation" in navigator)) {
    status.textContent = "Geolocation is not supported on this device/browser.";
    status.className = "status error";
    return;
  }

  totalDistanceKm = 0;
  elapsedSeconds = 0;
  routePoints = [];
  lastPosition = null;
  startTime = Date.now();
  tracking = true;
  status.textContent = "Acquiring GPS signal...";
  status.className = "status";

  document.getElementById("trackerRunType").disabled = true;
  document.getElementById("trackerBtn").textContent = "Stop & Save";

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      routePoints.push({ lat: latitude, lng: longitude, t: Date.now() });

      if (lastPosition) {
        totalDistanceKm += haversineKm(lastPosition.lat, lastPosition.lng, latitude, longitude);
      }
      lastPosition = { lat: latitude, lng: longitude };
      status.textContent = "Tracking...";
      status.className = "status success";
    },
    (err) => {
      status.textContent = `Location error: ${err.message}`;
      status.className = "status error";
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
  );

  timerInterval = setInterval(() => {
    elapsedSeconds = (Date.now() - startTime) / 1000;
    updateTrackerUI();
  }, 1000);

  updateTrackerUI();
}

async function stopTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  tracking = false;

  const status = document.getElementById("trackerStatus");
  document.getElementById("trackerRunType").disabled = false;
  document.getElementById("trackerBtn").textContent = "Start GPS Tracking";

  if (totalDistanceKm <= 0 || elapsedSeconds < 5) {
    status.textContent = "Run too short to save — not enough GPS data was recorded.";
    status.className = "status error";
    updateTrackerUI();
    return;
  }

  const runType = document.getElementById("trackerRunType").value;
  status.textContent = "Saving run...";
  status.className = "status";

  try {
    const userId = await getUserId();
    const { error } = await supabase.from("runs").insert({
      user_id: userId,
      date: todayStr(),
      run_type: runType,
      distance_km: Math.round(totalDistanceKm * 1000) / 1000,
      duration_seconds: Math.round(elapsedSeconds),
      route: routePoints,
      source: "gps",
    });
    if (error) throw error;

    status.textContent = `Saved! ${totalDistanceKm.toFixed(2)} km in ${formatDuration(elapsedSeconds)}.`;
    status.className = "status success";
    await loadHistory();
  } catch (err) {
    status.textContent = err.message;
    status.className = "status error";
  }

  totalDistanceKm = 0;
  elapsedSeconds = 0;
  routePoints = [];
  updateTrackerUI();
}

function updateTrackerUI() {
  const timeEl = document.getElementById("trackerTime");
  const distEl = document.getElementById("trackerDistance");
  const paceEl = document.getElementById("trackerPace");
  if (!timeEl) return;

  const mins = Math.floor(elapsedSeconds / 60);
  const secs = Math.floor(elapsedSeconds % 60);
  timeEl.textContent = `${mins}:${String(secs).padStart(2, "0")}`;
  distEl.textContent = `${totalDistanceKm.toFixed(2)} km`;
  paceEl.textContent = totalDistanceKm > 0 ? formatPace(elapsedSeconds / totalDistanceKm) : "—";
}

async function saveManualRun() {
  const status = document.getElementById("manualStatus");
  const date = document.getElementById("manualDate").value;
  const runType = document.getElementById("manualRunType").value;
  const distance = Number(document.getElementById("manualDistance").value);
  const minutes = Number(document.getElementById("manualMinutes").value) || 0;
  const seconds = Number(document.getElementById("manualSeconds").value) || 0;
  const notes = document.getElementById("manualNotes").value.trim();
  const durationSeconds = minutes * 60 + seconds;

  if (!date) {
    status.textContent = "Please choose a date.";
    status.className = "status error";
    return;
  }
  if (!distance || distance <= 0) {
    status.textContent = "Please enter a valid distance.";
    status.className = "status error";
    return;
  }
  if (!durationSeconds || durationSeconds <= 0) {
    status.textContent = "Please enter a valid duration.";
    status.className = "status error";
    return;
  }

  const saveBtn = document.getElementById("manualSaveBtn");
  saveBtn.disabled = true;
  status.textContent = "Saving...";
  status.className = "status";

  try {
    const userId = await getUserId();
    const record = {
      date,
      run_type: runType,
      distance_km: distance,
      duration_seconds: durationSeconds,
      notes: notes || null,
    };

    if (editingRunId) {
      const { error } = await supabase.from("runs").update(record).eq("id", editingRunId);
      if (error) throw error;
      status.textContent = "Run updated!";
    } else {
      const { error } = await supabase
        .from("runs")
        .insert({ ...record, user_id: userId, source: "manual" });
      if (error) throw error;
      status.textContent = "Run saved!";
    }

    status.className = "status success";
    cancelEdit();
    await loadHistory();
  } catch (err) {
    status.textContent = err.message;
    status.className = "status error";
  } finally {
    saveBtn.disabled = false;
  }
}

function cancelEdit() {
  editingRunId = null;
  document.getElementById("manualFormTitle").textContent = "Add a run manually";
  document.getElementById("manualSaveBtn").textContent = "Save run";
  document.getElementById("manualCancelBtn").classList.add("hidden");
  document.getElementById("manualDate").value = todayStr();
  document.getElementById("manualRunType").value = "speed";
  document.getElementById("manualDistance").value = "";
  document.getElementById("manualMinutes").value = "";
  document.getElementById("manualSeconds").value = "";
  document.getElementById("manualNotes").value = "";
}

function startEdit(run) {
  editingRunId = run.id;
  document.getElementById("manualFormTitle").textContent = "Edit run";
  document.getElementById("manualSaveBtn").textContent = "Update run";
  document.getElementById("manualCancelBtn").classList.remove("hidden");
  document.getElementById("manualDate").value = run.date;
  document.getElementById("manualRunType").value = run.run_type;
  document.getElementById("manualDistance").value = run.distance_km;
  document.getElementById("manualMinutes").value = Math.floor(run.duration_seconds / 60);
  document.getElementById("manualSeconds").value = run.duration_seconds % 60;
  document.getElementById("manualNotes").value = run.notes || "";
  document.getElementById("manualFormTitle").scrollIntoView({ behavior: "smooth" });
}

async function deleteRun(id) {
  if (!confirm("Delete this run?")) return;
  const { error } = await supabase.from("runs").delete().eq("id", id);
  if (!error) await loadHistory();
}

async function loadHistory() {
  const historyEl = document.getElementById("runHistory");

  const { data, error } = await supabase
    .from("runs")
    .select("id, date, run_type, distance_km, duration_seconds, source, notes")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    historyEl.innerHTML = `<p class="status error">${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!data.length) {
    historyEl.innerHTML = `<p class="muted">No runs logged yet.</p>`;
    return;
  }

  window.__runsById = Object.fromEntries(data.map((r) => [r.id, r]));

  historyEl.innerHTML = data
    .map((run) => {
      const pace = run.distance_km > 0 ? formatPace(run.duration_seconds / run.distance_km) : "—";
      return `
        <div class="history-row">
          <div class="history-date">${run.date} <span class="badge">${RUN_TYPE_LABELS[run.run_type]}</span> ${run.source === "gps" ? "📍" : ""}</div>
          <div class="history-detail">${run.distance_km.toFixed(2)} km · ${formatDuration(run.duration_seconds)} · ${pace}</div>
          ${run.notes ? `<div class="history-detail muted">${escapeHtml(run.notes)}</div>` : ""}
          <div class="history-actions">
            <button class="link-btn edit-run-btn" data-id="${run.id}" type="button">Edit</button>
            <button class="link-btn delete-run-btn" data-id="${run.id}" type="button">Delete</button>
          </div>
        </div>
      `;
    })
    .join("");

  historyEl.querySelectorAll(".edit-run-btn").forEach((btn) => {
    btn.addEventListener("click", () => startEdit(window.__runsById[btn.dataset.id]));
  });
  historyEl.querySelectorAll(".delete-run-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteRun(btn.dataset.id));
  });
}
