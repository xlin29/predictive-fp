// popup.js

const DEFAULTS = {
  enabled: true,
  maxAgeDays: 7,
  whitelist: [],
  uaSpoofEnabled: true
};

const $ = (id) => document.getElementById(id);

function applyEnabledState(enabled) {
  const btn = $("toggleButton");
  const statusText = $("statusText");

  if (!btn || !statusText) return;

  if (enabled) {
    btn.classList.remove("off");
    btn.classList.add("on");
    btn.textContent = "Turn off";

    statusText.classList.remove("off");
    statusText.classList.add("on");
    statusText.textContent = "Enabled";
  } else {
    btn.classList.remove("on");
    btn.classList.add("off");
    btn.textContent = "Turn on";

    statusText.classList.remove("on");
    statusText.classList.add("off");
    statusText.textContent = "Disabled";
  }
}

function applyUaSpoofState(enabled) {
  const btn = $("uaToggleButton");
  const statusText = $("uaStatusText");

  if (!btn || !statusText) return;

  if (enabled) {
    btn.classList.remove("off");
    btn.classList.add("on");
    btn.textContent = "Turn off UA";

    statusText.classList.remove("off");
    statusText.classList.add("on");
    statusText.textContent = "On";
  } else {
    btn.classList.remove("on");
    btn.classList.add("off");
    btn.textContent = "Turn on UA";

    statusText.classList.remove("on");
    statusText.classList.add("off");
    statusText.textContent = "Off";
  }
}

function loadState() {
  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    applyEnabledState(!!cfg.enabled);
    applyUaSpoofState(cfg.uaSpoofEnabled !== false);

    const maxAgeInput = $("maxAgeInput");
    if (maxAgeInput) {
      const val =
        typeof cfg.maxAgeDays === "number" && cfg.maxAgeDays > 0
          ? cfg.maxAgeDays
          : DEFAULTS.maxAgeDays;
      maxAgeInput.value = String(val);
    }

    const allowlistInput = $("allowlistInput");
    if (allowlistInput) {
      const list = Array.isArray(cfg.whitelist) ? cfg.whitelist : [];
      allowlistInput.value = list.join("\n");
    }
  });
}

function toggleEnabled() {
  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    const nextEnabled = !cfg.enabled;

    chrome.storage.sync.set(
      {
        enabled: nextEnabled
      },
      () => {
        applyEnabledState(nextEnabled);
      }
    );
  });
}

function toggleUaSpoofEnabled() {
  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    const current = cfg.uaSpoofEnabled !== false; // default true
    const next = !current;

    chrome.storage.sync.set(
      {
        uaSpoofEnabled: next
      },
      () => {
        applyUaSpoofState(next);
      }
    );
  });
}

// save maxAgeDays from the popup input
function saveMaxAge() {
  const input = $("maxAgeInput");
  if (!input) return;

  let val = parseInt(input.value, 10);
  if (!Number.isFinite(val) || val < 0) {
    val = DEFAULTS.maxAgeDays;
  } else if (val > 365) {
    val = 365;
  }

  input.value = String(val);

  chrome.storage.sync.set({ maxAgeDays: val }, () => {
    // no UI change needed; background will pick this up on next UA load
  });
}

// save whitelist from textarea (one domain per line)
function saveWhitelist() {
  const ta = $("allowlistInput");
  if (!ta) return;

  const raw = ta.value || "";
  const lines = raw.split(/\r?\n/);

  const whitelist = lines
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  chrome.storage.sync.set({ whitelist }, () => {
    // nothing else to do; background + content scripts will honor this
  });
}

// force one-time randomization of spoofed UA (and thus noise)
function forceRandomize() {
  chrome.runtime.sendMessage({ type: "reset-spoofed-ua" }, (resp) => {
    const btn = $("randomizeButton");
    if (btn) {
      btn.textContent = "Randomized ✓";
      setTimeout(() => {
        btn.textContent = "Randomize now";
      }, 1500);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadState();

  const btn = $("toggleButton");
  if (btn) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      toggleEnabled();
    });
  }

  const uaBtn = $("uaToggleButton");
  if (uaBtn) {
    uaBtn.addEventListener("click", (e) => {
      e.preventDefault();
      toggleUaSpoofEnabled();
    });
  }

  const randBtn = $("randomizeButton");
  if (randBtn) {
    randBtn.addEventListener("click", (e) => {
      e.preventDefault();
      forceRandomize();
    });
  }

  const maxAgeInput = $("maxAgeInput");
  if (maxAgeInput) {
    maxAgeInput.addEventListener("change", saveMaxAge);
    maxAgeInput.addEventListener("blur", saveMaxAge);
  }

  const allowlistInput = $("allowlistInput");
  if (allowlistInput) {
    allowlistInput.addEventListener("change", saveWhitelist);
    allowlistInput.addEventListener("blur", saveWhitelist);
  }
});
