// content/bootstrap.js — bridge between page (MAIN) and extension 
(() => {
  window.addEventListener("message", (ev) => {
    const data = ev?.data;
    if (!data || typeof data !== "object") return;

    // Page (hardening.js in MAIN world) requests config + spoofedUA
    if (data.__fpRq === 1) {
      // Real UA from this context, before any spoofing in MAIN
      const baseUA = navigator.userAgent;

      try {
        chrome.runtime.sendMessage(
          { type: "get-config-and-ua", baseUA },
          (resp) => {
            if (chrome.runtime.lastError) {
              console.warn(
                "[FP Randomizer] get-config-and-ua error:",
                chrome.runtime.lastError.message
              );
              return;
            }
            if (!resp) return;

            // Send response back into MAIN world
            window.postMessage(
              { __fpRs: 1, payload: resp },
              "*"
            );
          }
        );
      } catch (e) {
        console.warn("[FP Randomizer] get-config-and-ua send failed:", e);
      }
    }
  });
})();
