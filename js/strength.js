import { supabase, getUserId } from "./supabaseClient.js";
import {
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS,
  getExerciseList,
  addCustomExercise,
  getCustomExercisesWithIds,
  renameCustomExercise,
} from "./exercises.js";
import { todayStr, escapeHtml } from "./utils.js";

const ADD_CUSTOM_VALUE = "__add_custom__";

let activeMuscleGroup = "chest";
let currentSets = [{ reps: "", weight: "" }];

export async function initStrengthTab() {
  await render();
}

export async function refreshStrengthTab() {
  await render();
}

async function render() {
  const container = document.getElementById("strengthTab");

  container.innerHTML = `
    <div class="subtabs">
      ${MUSCLE_GROUPS.map(
        (mg) =>
          `<button class="subtab-btn ${mg === activeMuscleGroup ? "active" : ""}" data-mg="${mg}">${MUSCLE_GROUP_LABELS[mg]}</button>`
      ).join("")}
    </div>

    <div class="card">
      <div class="field">
        <label for="liftDate">Date</label>
        <input type="date" id="liftDate" value="${todayStr()}" />
      </div>

      <div class="field">
        <label for="exerciseSelect">Exercise</label>
        <select id="exerciseSelect"></select>
      </div>

      <div id="customExerciseField" class="field hidden">
        <label for="customExerciseInput">New exercise name</label>
        <div class="inline-group">
          <input type="text" id="customExerciseInput" placeholder="e.g. Cable Crossover" />
          <button id="addCustomExerciseBtn" class="secondary-btn" type="button">Add</button>
        </div>
      </div>

      <div id="setsContainer"></div>
      <button id="addSetBtn" class="secondary-btn" type="button">+ Add set</button>
      <button id="saveWorkoutBtn" class="primary-btn" type="button">Save</button>
      <div class="status" id="strengthStatus"></div>
    </div>

    <div class="card">
      <h3>History</h3>
      <div id="liftHistory"><p class="muted">Loading...</p></div>
    </div>

    <div class="card">
      <h3>Custom exercises</h3>
      <div id="customExercisesManager"><p class="muted">Loading...</p></div>
      <div class="status" id="renameStatus"></div>
    </div>
  `;

  container.querySelectorAll(".subtab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeMuscleGroup = btn.dataset.mg;
      currentSets = [{ reps: "", weight: "" }];
      render();
    });
  });

  document.getElementById("addSetBtn").addEventListener("click", () => {
    const last = currentSets[currentSets.length - 1];
    currentSets.push({ reps: last.reps, weight: last.weight });
    renderSets();
  });

  document.getElementById("saveWorkoutBtn").addEventListener("click", saveWorkout);

  document.getElementById("customExerciseInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddCustomExercise();
    }
  });
  document.getElementById("addCustomExerciseBtn").addEventListener("click", handleAddCustomExercise);

  await populateExerciseSelect();
  renderSets();
  await loadHistory();
  await renderCustomExercisesManager();
}

async function populateExerciseSelect(selectName) {
  const select = document.getElementById("exerciseSelect");
  const exercises = await getExerciseList(activeMuscleGroup);

  select.innerHTML =
    exercises.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("") +
    `<option value="${ADD_CUSTOM_VALUE}">+ Add custom exercise...</option>`;

  if (selectName && exercises.includes(selectName)) {
    select.value = selectName;
  }

  select.onchange = async () => {
    const customField = document.getElementById("customExerciseField");
    if (select.value === ADD_CUSTOM_VALUE) {
      customField.classList.remove("hidden");
      document.getElementById("customExerciseInput").focus();
    } else {
      customField.classList.add("hidden");
      currentSets = [{ reps: "", weight: "" }];
      renderSets();
      await loadHistory();
    }
  };
}

async function handleAddCustomExercise() {
  const input = document.getElementById("customExerciseInput");
  const name = input.value.trim();
  if (!name) return;

  const status = document.getElementById("strengthStatus");
  try {
    await addCustomExercise(activeMuscleGroup, name);
    document.getElementById("customExerciseField").classList.add("hidden");
    input.value = "";
    await populateExerciseSelect(name);
    currentSets = [{ reps: "", weight: "" }];
    renderSets();
    await loadHistory();
  } catch (err) {
    status.textContent = err.message;
    status.className = "status error";
  }
}

function renderSets() {
  const container = document.getElementById("setsContainer");
  container.innerHTML = currentSets
    .map(
      (set, i) => `
      <div class="set-row">
        <span class="set-label">Set ${i + 1}</span>
        <input type="number" inputmode="numeric" min="0" placeholder="Reps" class="set-reps" data-idx="${i}" value="${set.reps}" />
        <input type="number" inputmode="decimal" min="0" step="0.5" placeholder="Weight (kg)" class="set-weight" data-idx="${i}" value="${set.weight}" />
        <button type="button" class="remove-set-btn" data-idx="${i}" ${currentSets.length === 1 ? "disabled" : ""}>✕</button>
      </div>
    `
    )
    .join("");

  container.querySelectorAll(".set-reps").forEach((input) => {
    input.addEventListener("input", (e) => {
      currentSets[+e.target.dataset.idx].reps = e.target.value;
    });
  });
  container.querySelectorAll(".set-weight").forEach((input) => {
    input.addEventListener("input", (e) => {
      currentSets[+e.target.dataset.idx].weight = e.target.value;
    });
  });
  container.querySelectorAll(".remove-set-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = +e.target.dataset.idx;
      currentSets.splice(idx, 1);
      renderSets();
    });
  });
}

async function saveWorkout() {
  const status = document.getElementById("strengthStatus");
  const date = document.getElementById("liftDate").value;
  const exerciseName = document.getElementById("exerciseSelect").value;

  if (!date) {
    status.textContent = "Please choose a date.";
    status.className = "status error";
    return;
  }
  if (exerciseName === ADD_CUSTOM_VALUE) {
    status.textContent = "Please add or choose an exercise first.";
    status.className = "status error";
    return;
  }

  const rows = [];
  for (let i = 0; i < currentSets.length; i++) {
    const reps = Number(currentSets[i].reps);
    const weight = Number(currentSets[i].weight);
    if (!reps || reps <= 0 || isNaN(weight) || weight < 0) {
      status.textContent = `Please fill in valid reps and weight for set ${i + 1}.`;
      status.className = "status error";
      return;
    }
    rows.push({
      date,
      muscle_group: activeMuscleGroup,
      exercise_name: exerciseName,
      set_number: i + 1,
      reps,
      weight_kg: weight,
    });
  }

  const saveBtn = document.getElementById("saveWorkoutBtn");
  saveBtn.disabled = true;
  status.textContent = "Saving...";
  status.className = "status";

  try {
    const userId = await getUserId();
    const records = rows.map((r) => ({ ...r, user_id: userId }));
    const { error } = await supabase.from("lift_sets").insert(records);
    if (error) throw error;

    status.textContent = "Saved!";
    status.className = "status success";
    currentSets = [{ reps: "", weight: "" }];
    renderSets();
    await loadHistory();
  } catch (err) {
    status.textContent = err.message;
    status.className = "status error";
  } finally {
    saveBtn.disabled = false;
  }
}

async function renderCustomExercisesManager() {
  const el = document.getElementById("customExercisesManager");
  if (!el) return;
  let customs;
  try {
    customs = await getCustomExercisesWithIds(activeMuscleGroup);
  } catch (err) {
    el.innerHTML = `<p class="status error">${escapeHtml(err.message)}</p>`;
    return;
  }

  if (!customs.length) {
    el.innerHTML = `<p class="muted">No custom exercises for ${MUSCLE_GROUP_LABELS[activeMuscleGroup]}.</p>`;
    return;
  }

  el.innerHTML = customs
    .map(
      (c) => `
      <div class="history-row" id="custom-ex-${c.id}">
        <div class="history-detail">${escapeHtml(c.name)}</div>
        <div class="history-actions">
          <button class="link-btn rename-ex-btn" data-id="${c.id}" data-name="${escapeHtml(c.name)}" type="button">Rename</button>
        </div>
      </div>`
    )
    .join("");

  el.querySelectorAll(".rename-ex-btn").forEach((btn) => {
    btn.addEventListener("click", () => startRename(btn.dataset.id, btn.dataset.name));
  });
}

function startRename(id, currentName) {
  const row = document.getElementById(`custom-ex-${id}`);
  if (!row) return;
  row.innerHTML = `
    <div class="inline-group">
      <input type="text" id="renameInput-${id}" value="${escapeHtml(currentName)}" />
      <button class="secondary-btn save-rename-btn" data-id="${id}" type="button">Save</button>
      <button class="link-btn cancel-rename-btn" type="button">Cancel</button>
    </div>`;
  row.querySelector(".save-rename-btn").addEventListener("click", () => handleRename(id, currentName));
  row.querySelector(".cancel-rename-btn").addEventListener("click", () => renderCustomExercisesManager());
  document.getElementById(`renameInput-${id}`).focus();
}

async function handleRename(id, oldName) {
  const status = document.getElementById("renameStatus");
  const input = document.getElementById(`renameInput-${id}`);
  const newName = input ? input.value.trim() : "";

  if (!newName || newName === oldName) {
    await renderCustomExercisesManager();
    return;
  }

  try {
    await renameCustomExercise(id, oldName, newName, activeMuscleGroup);
    status.textContent = "Renamed successfully.";
    status.className = "status success";
    await populateExerciseSelect(newName);
    await renderCustomExercisesManager();
    await loadHistory();
  } catch (err) {
    status.textContent = err.message;
    status.className = "status error";
    await renderCustomExercisesManager();
  }
}

async function loadHistory() {
  const historyEl = document.getElementById("liftHistory");
  const exerciseName = document.getElementById("exerciseSelect").value;

  if (exerciseName === ADD_CUSTOM_VALUE) {
    historyEl.innerHTML = "";
    return;
  }

  const { data, error } = await supabase
    .from("lift_sets")
    .select("date, set_number, reps, weight_kg")
    .eq("muscle_group", activeMuscleGroup)
    .eq("exercise_name", exerciseName)
    .order("date", { ascending: false })
    .order("set_number", { ascending: true })
    .limit(100);

  if (error) {
    historyEl.innerHTML = `<p class="status error">${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!data.length) {
    historyEl.innerHTML = `<p class="muted">No sessions logged yet for ${escapeHtml(exerciseName)}.</p>`;
    return;
  }

  const byDate = new Map();
  for (const row of data) {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date).push(row);
  }

  const dates = [...byDate.keys()].slice(0, 6);

  historyEl.innerHTML = dates
    .map((date) => {
      const sets = byDate.get(date);
      const setsText = sets
        .map((s) => `${s.reps}×${s.weight_kg}kg`)
        .join(", ");
      const top = Math.max(...sets.map((s) => s.weight_kg));
      return `
        <div class="history-row">
          <div class="history-date">${date}</div>
          <div class="history-detail">${setsText}</div>
          <div class="history-top">Top: ${top}kg</div>
        </div>
      `;
    })
    .join("");
}
