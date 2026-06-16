import { supabase, getUserId } from "./supabaseClient.js";
import { todayStr, formatDuration, formatPace, escapeHtml } from "./utils.js";

export const RUN_TYPES = ["speed", "recovery", "long"];
export const RUN_TYPE_LABELS = { speed: "Speed", recovery: "Recovery", long: "Long" };

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
      <h3 id="manualFormTitle">Add a run</h3>
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

  document.getElementById("manualSaveBtn").addEventListener("click", saveManualRun);
  document.getElementById("manualCancelBtn").addEventListener("click", cancelEdit);

  await loadHistory();
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
  document.getElementById("manualFormTitle").textContent = "Add a run";
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
    .select("id, date, run_type, distance_km, duration_seconds, notes")
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
          <div class="history-date">${run.date} <span class="badge">${RUN_TYPE_LABELS[run.run_type]}</span></div>
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
