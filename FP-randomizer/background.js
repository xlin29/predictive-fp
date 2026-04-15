// background.js — FP Randomizer core (Manifest V3)
"use strict";

const DEFAULTS = {
  enabled: true,
  whitelist: [],
  maxAgeDays: 7,
  uaSpoofEnabled: true // NEW: controls UA spoof for headers (and can be used in hardening.js)
};

// ---- global cached spoofed UA ----
// We generate this once and reuse it so the header UA and navigator UA
// stay in sync instead of being "one behind".
let currentSpoofedUA = null;

// ---- randomness helpers ----
function newUaSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(""); // e.g., "3f9a7c21"
}

// ---- UA noise helpers ----
function fnv1a32(str) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Variable-length letters-only token, length 3–10
function makeNoiseToken(h) {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const minLen = 3;
  const maxLen = 10;
  const len = minLen + (h % (maxLen - minLen + 1)); // 3..10

  let x = h >>> 0;
  let out = "";
  for (let i = 0; i < len; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const idx = x % 26;
    const ch = letters[idx];
    if (i === 0) {
      out += String.fromCharCode(65 + idx); // A–Z
    } else {
      out += ch; // a–z
    }
  }
  return out;
}

// Insert a natural-looking noise token at a hashed position
// inside the first (...) block of the UA.
function buildNoisyUA(baseUA, saltStr) {
  if (!saltStr) return baseUA;

  const m = baseUA.match(/\(([^)]*)\)/);
  if (!m) return baseUA; // no parentheses to touch

  const inner = m[1];
  const parts = inner.split(/;\s*/);

  const h = fnv1a32(baseUA + "|" + saltStr);
  const injectIdx = h % (parts.length + 1);
  const noise = makeNoiseToken(h);

  parts.splice(injectIdx, 0, noise);
  const newInner = parts.join("; ");
  return baseUA.replace(/\([^)]*\)/, "(" + newInner + ")");
}

// Normalize whitelist for DNR: ".example.com" -> "example.com"
function normalizeWhitelistForDnr(whitelist) {
  if (!Array.isArray(whitelist)) return [];
  const out = [];
  for (const raw of whitelist) {
    if (typeof raw !== "string") continue;
    let w = raw.trim();
    if (!w) continue;
    if (w.startsWith(".")) {
      w = w.slice(1);
    }
    // DNR domains apply to that domain and all its subdomains
    out.push(w);
  }
  return out;
}

// ---------------- DNR rule management ----------------

function clearUaRule() {
  chrome.declarativeNetRequest.updateDynamicRules(
    { removeRuleIds: [100], addRules: [] },
    () => {
      if (chrome.runtime.lastError) {
        console.warn(
          "[FP Randomizer] UA rule remove error:",
          chrome.runtime.lastError.message
        );
      } else {
        console.log("[FP Randomizer] UA rule removed");
      }
    }
  );
}

// Install or remove the UA header rule using currentSpoofedUA
function installUaRule(cfg) {
  const shouldSpoof =
    cfg &&
    cfg.enabled &&
    cfg.uaSpoofEnabled !== false && // NEW: only spoof header UA when this is not false
    typeof currentSpoofedUA === "string" &&
    currentSpoofedUA.length > 0;

  if (!shouldSpoof) {
    clearUaRule();
    return;
  }

  const excludedDomains = normalizeWhitelistForDnr(cfg.whitelist || []);

  const condition = {
    resourceTypes: [
      "main_frame",
      "sub_frame",
      "xmlhttprequest"
      // "fetch" is NOT valid for DNR resourceTypes
    ]
  };

  if (excludedDomains.length > 0) {
    // Do not touch UA headers for whitelisted domains (and their subdomains)
    condition.excludedDomains = excludedDomains;
    condition.excludedInitiatorDomains = excludedDomains;
  }

  const rule = {
    id: 100,
    priority: 10000, // high so we override other rules
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "User-Agent",
          operation: "set",
          value: currentSpoofedUA
        }
      ]
    },
    condition
  };

  chrome.declarativeNetRequest.updateDynamicRules(
    {
      removeRuleIds: [100],
      addRules: [rule]
    },
    () => {
      if (chrome.runtime.lastError) {
        console.warn(
          "[FP Randomizer] UA rule update error:",
          chrome.runtime.lastError.message
        );
      } else {
        console.log(
          "[FP Randomizer] UA rule installed with UA:",
          currentSpoofedUA,
          "excludedDomains:",
          excludedDomains
        );
      }
    }
  );
}

// When options change (enabled / whitelist / maxAgeDays / uaSpoofEnabled)
// update the DNR rule too
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;
  if (
    !changes.enabled &&
    !changes.whitelist &&
    !changes.maxAgeDays &&
    !changes.uaSpoofEnabled // NEW
  ) {
    return;
  }

  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    installUaRule(cfg);
  });
});

// ---------------- Register MAIN-world hardening script ----------------

// Register content/hardening.js to run in MAIN world at document_start, all frames
chrome.runtime.onInstalled.addListener(() => {
  chrome.scripting
    .registerContentScripts([
      {
        id: "fp-hardening-main",
        js: ["content/hardening.js"],
        matches: ["<all_urls>"],
        runAt: "document_start",
        allFrames: true,
        world: "MAIN"
      }
    ])
    .catch((err) => {
      console.error(
        "[FP Randomizer] Failed to register MAIN hardening script:",
        err
      );
    });
});

// On browser startup, reset the cached UA so each browser session starts fresh
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.remove(["spoofedUA", "spoofedUACreatedAt"], () => {
    currentSpoofedUA = null;
    console.log("[FP Randomizer] Reset spoofedUA on browser startup");
  });
});

// ---------------- helper: load / persist spoofed UA ----------------

function loadSpoofedUAFromStorage(maxAgeDays, callback) {
  chrome.storage.local.get(["spoofedUA", "spoofedUACreatedAt"], (data) => {
    const ua =
      data && typeof data.spoofedUA === "string" ? data.spoofedUA : null;
    const createdAt =
      data && typeof data.spoofedUACreatedAt === "number"
        ? data.spoofedUACreatedAt
        : null;

    if (!ua) {
      callback(null);
      return;
    }

    const now = Date.now();
    // allow 0 days to mean "expire immediately"
    let ageLimitDays = DEFAULTS.maxAgeDays;
    if (typeof maxAgeDays === "number" && maxAgeDays >= 0) {
      ageLimitDays = maxAgeDays;
    }
    const maxAgeMs = ageLimitDays * 24 * 60 * 60 * 1000;

    // Expire if older than max age
    if (createdAt && now - createdAt > maxAgeMs) {
      console.log("[FP Randomizer] Stored spoofedUA expired by age; rotating");
      chrome.storage.local.remove(["spoofedUA", "spoofedUACreatedAt"], () => {});
      callback(null);
      return;
    }

    callback(ua);
  });
}

function saveSpoofedUAToStorage(ua) {
  try {
    chrome.storage.local.set({
      spoofedUA: ua,
      spoofedUACreatedAt: Date.now()
    });
  } catch (e) {
    console.warn("[FP Randomizer] Failed to persist spoofedUA:", e);
  }
}

// ---------------- lifecycle + messages ----------------
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  // manual one-time randomization from popup
  if (msg?.type === "reset-spoofed-ua") {
    // Clear stored spoofed UA so a new one will be generated next time
    chrome.storage.local.remove(["spoofedUA", "spoofedUACreatedAt"], () => {
      currentSpoofedUA = null;
      // Do NOT touch the current DNR rule here.
      // It will be updated the next time we handle get-config-and-ua.
      try {
        send({ ok: true });
      } catch (_) {}
    });
    return true; // async reply
  }

  // Content (via bootstrap bridge) asks for config + spoofed UA based on baseUA
  if (msg?.type === "get-config-and-ua") {
    const baseUA = typeof msg.baseUA === "string" ? msg.baseUA : null;

    chrome.storage.sync.get(DEFAULTS, (cfg) => {
      if (!cfg || !cfg.enabled || !baseUA) {
        // Disabled: clear cached UA and header rule
        currentSpoofedUA = null;
        installUaRule(cfg || DEFAULTS);
        send({
          cfg: cfg || DEFAULTS,
          spoofedUA: null
        });
        return;
      }

      // If we already have a spoofed UA in memory, just reuse it
      if (currentSpoofedUA) {
        installUaRule(cfg);
        send({
          cfg,
          spoofedUA: currentSpoofedUA
        });
        return;
      }

      const maxAgeDays =
        typeof cfg.maxAgeDays === "number" && cfg.maxAgeDays > 0
          ? cfg.maxAgeDays
          : DEFAULTS.maxAgeDays;

      // Otherwise, try to load from local storage so it does not change
      // on every service worker restart, unless expired.
      loadSpoofedUAFromStorage(maxAgeDays, (storedUA) => {
        if (storedUA) {
          currentSpoofedUA = storedUA;
          installUaRule(cfg);
          send({
            cfg,
            spoofedUA: currentSpoofedUA
          });
          return;
        }

        // No valid stored UA: derive a new one once from baseUA.
        const salt = newUaSalt();
        currentSpoofedUA = buildNoisyUA(baseUA, salt);
        saveSpoofedUAToStorage(currentSpoofedUA);
        installUaRule(cfg);

        send({
          cfg,
          spoofedUA: currentSpoofedUA
        });
      });
    });

    return true; // async reply
  }

  return false;
});
