import { getSession, login, logout, onAuthStateChange } from "./auth.js";
import { initStrengthTab, refreshStrengthTab } from "./strength.js";
import { initRunsTab, refreshRunsTab } from "./runs.js";
import { initAnalyticsTab, refreshAnalyticsTab } from "./analytics.js";
import { initRecommendationsTab, refreshRecommendationsTab } from "./recommendations.js";

const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");
const loginForm = document.getElementById("loginForm");
const loginStatus = document.getElementById("loginStatus");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");

const TAB_REFRESHERS = {
  strengthTab: refreshStrengthTab,
  runsTab: refreshRunsTab,
  analyticsTab: refreshAnalyticsTab,
  recommendationsTab: refreshRecommendationsTab,
};

let appInitialized = false;

async function showApp() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");

  if (!appInitialized) {
    appInitialized = true;
    await initStrengthTab();
    await initRunsTab();
    await initAnalyticsTab();
    await initRecommendationsTab();
    setupTabs();
  }
}

function showLogin() {
  appView.classList.add("hidden");
  loginView.classList.remove("hidden");
  appInitialized = false;
}

function setupTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"));

      const tabId = btn.dataset.tab;
      document.getElementById(tabId).classList.remove("hidden");

      const refresh = TAB_REFRESHERS[tabId];
      if (refresh) await refresh();
    });
  });
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginBtn.disabled = true;
  loginStatus.textContent = "Logging in...";
  loginStatus.className = "status";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const { error } = await login(email, password);

  if (error) {
    loginStatus.textContent = error.message;
    loginStatus.className = "status error";
    loginBtn.disabled = false;
    return;
  }

  loginStatus.textContent = "";
  loginBtn.disabled = false;
});

logoutBtn.addEventListener("click", async () => {
  await logout();
});

onAuthStateChange((session) => {
  if (session) {
    showApp();
  } else {
    showLogin();
  }
});

(async () => {
  const session = await getSession();
  if (session) {
    await showApp();
  } else {
    showLogin();
  }
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
