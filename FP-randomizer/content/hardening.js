/* content/hardening.js — UA + appVersion + screen + WebGL + font noise + canvas defense; */
(() => {
  // Request { cfg, spoofedUA } from the extension (through bootstrap.js)
  function requestConfigAndUA() {
    return new Promise((resolve) => {
      const onMsg = (ev) => {
        if (ev?.data?.__fpRs === 1) {
          window.removeEventListener("message", onMsg);
          resolve(ev.data.payload);
        }
      };
      window.addEventListener("message", onMsg);
      window.postMessage({ __fpRq: 1 }, "*");
    });
  }

  function isWhitelisted(host, list) {
    if (!Array.isArray(list)) return false;
    return list.some(
      (w) =>
        host === w ||
        (typeof w === "string" && w.startsWith(".") && host.endsWith(w))
    );
  }

  // --- small hash to derive stable per-UA noise for screen/WebGL ---
  function fnv1a32(str) {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // --- deterministic session-wide noise RNG (stable for a given UA + origin) ---
  function makeSessionNoiseRng(seedStr) {
    let h = fnv1a32(seedStr || "fp-session-noise");
    return {
      nextUint32() {
        h = Math.imul(h, 1664525) + 1013904223;
        return h >>> 0;
      },
      nextInt(max) {
        const u = this.nextUint32();
        return max > 0 ? (u % max) : 0;
      }
    };
  }

  let sessionNoise = null;
  let sessionNoiseSeed = null;

  function getSessionNoise() {
    let ua = "";
    let origin = "";
    try {
      ua = navigator.userAgent || "";
    } catch (_) {}
    try {
      origin = location.origin || location.hostname || "";
    } catch (_) {}

    const seed = ua + "|" + origin;

    if (!sessionNoise || sessionNoiseSeed !== seed) {
      sessionNoiseSeed = seed;
      sessionNoise = makeSessionNoiseRng(seed);
    }
    return sessionNoise;
  }

  // Variable-length letters-only token, length 3–10
  // Same style as the UA token strategy
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

  // Derive appVersion from spoofedUA in a "normal" browser way.
  function makeAppVersionFromUA(spoofedUA, realAppVersion) {
    if (typeof spoofedUA !== "string" || !spoofedUA) {
      return realAppVersion || "";
    }

    const m = spoofedUA.match(/^Mozilla\/([^\s]+)\s+(.*)$/);
    if (m) {
      const versionPart = m[1]; // e.g., "5.0"
      const rest = m[2];        // e.g., "(Macintosh; ...) AppleWebKit/..."
      return versionPart + " " + rest;
    }

    // Fallback: just return spoofedUA if format is non-standard.
    return spoofedUA;
  }

  // --- compute small, stable deltas for screen resolution ---
  function computeScreenOffsets(spoofedUA, realScreen) {
    const baseW = realScreen.width;
    const baseH = realScreen.height;

    // Hash based on spoofedUA so it's stable for this UA
    const h = fnv1a32(String(spoofedUA) + "|screen");

    // Small deltas in [-5, +5]
    const deltaW = (h % 11) - 5;
    const deltaH = ((h >>> 4) % 11) - 5;

    const clamp = (v, min, max) =>
      v < min ? min : v > max ? max : v;

    const fakeWidth       = clamp(baseW + deltaW, 320, 100000);
    const fakeHeight      = clamp(baseH + deltaH, 320, 100000);
    const fakeAvailWidth  = clamp(realScreen.availWidth + deltaW, 320, 100000);
    const fakeAvailHeight = clamp(realScreen.availHeight + deltaH, 320, 100000);

    return {
      width:        fakeWidth,
      height:       fakeHeight,
      availWidth:   fakeAvailWidth,
      availHeight:  fakeAvailHeight
    };
  }

  // --- WebGL renderer perturbation, same strategy style as UA but GPU-like ---
  function makeGpuLikeToken(h) {
    // Letters biased toward GPU-ish ones
    const prefixLetters = "GMTARXNVPUABCDEFGHIJ";
    const suffixLetters = "ProMaxUltraSEFT";

    // Choose a short prefix like "GX", "GM", "A15", etc.
    const p1 = prefixLetters[h % prefixLetters.length];
    const p2 = prefixLetters[(h >>> 3) % prefixLetters.length];

    // 2–3 digits
    const d1 = (h >>> 6)  % 10;
    const d2 = (h >>> 10) % 10;
    const useThirdDigit = ((h >>> 14) & 1) === 1;
    const d3 = (h >>> 16) % 10;

    let digits = "" + d1 + d2;
    if (useThirdDigit) digits += d3;

    // Optional short suffix like "Pro", "Max", etc.
    const useSuffix = ((h >>> 20) & 1) === 1;
    let suffix = "";
    if (useSuffix) {
      const sLen = 3; // keep it short, like "Pro"
      let x = (h >>> 24) >>> 0;
      for (let i = 0; i < sLen; i++) {
        const idx = x % suffixLetters.length;
        suffix += suffixLetters[idx];
        x = (x * 1664525 + 1013904223) >>> 0;
      }
      // Capitalize first letter
      suffix = suffix[0].toUpperCase() + suffix.slice(1).toLowerCase();
    }

    // Patterns like "GX104", "AM25 Pro"
    if (suffix) {
      return p1 + p2 + digits + " " + suffix;
    }
    return p1 + p2 + digits;
  }

  function buildNoisyRenderer(baseRenderer, spoofedUA) {
    if (!baseRenderer || !spoofedUA) return baseRenderer;

    const h = fnv1a32(baseRenderer + "|" + spoofedUA);
    const gpuToken = makeGpuLikeToken(h);

    // If we have parentheses, standard ANGLE-style string:
    //   "ANGLE (AMD, Radeon RX 580 Series, D3D11)"
    const m = baseRenderer.match(/\(([^)]*)\)/);
    if (m) {
      const inner = m[1];
      const parts = inner.split(/,\s*/); // ANGLE often uses comma-separated entries

      if (parts.length > 0) {
        // Choose a middle-ish part (usually GPU model), but avoid index 0 vendor
        const idxBase = (h >>> 8) % parts.length;
        const idx = Math.min(Math.max(1, idxBase), parts.length - 1);
        parts[idx] = parts[idx] + " " + gpuToken;

        const newInner = parts.join(", ");
        return baseRenderer.replace(/\([^)]*\)/, "(" + newInner + ")");
      }
    }

    // If no parentheses, just append a space + token
    // e.g., "Apple M2" -> "Apple M2 GX104"
    return baseRenderer + " " + gpuToken;
  }

  // ===== UA spoofing toggle =====
  let uaSpoofEnabled = true;

  function setUaSpoofEnabled(enabled) {
    uaSpoofEnabled = !!enabled;
  }

  // Expose a small hook so you can call from console or future UI:
  try {
    window.__fpRandSetUaSpoofEnabled = setUaSpoofEnabled;
  } catch (_) {}

  // ============ UA + appVersion patch ============
  function patchUA(spoofedUA) {
    if (!spoofedUA) return;

    const realNav = navigator;

    // If we already wrapped with this exact UA, skip
    if (realNav.__fpRandWrappedUA === spoofedUA) {
      return;
    }

    const handler = {
      get(target, prop, receiver) {
        if (prop === "userAgent") {
          return spoofedUA;
        }

        if (prop === "appVersion") {
          const realAppVersion = Reflect.get(target, "appVersion", target);
          return makeAppVersionFromUA(spoofedUA, realAppVersion);
        }

        let desc = Reflect.getOwnPropertyDescriptor(target, prop);
        if (!desc) {
          const proto = Object.getPrototypeOf(target);
          if (proto) {
            desc = Object.getOwnPropertyDescriptor(proto, prop);
          }
        }

        if (desc && typeof desc.get === "function" && !("value" in desc)) {
          try {
            return desc.get.call(target);
          } catch (e) {
          }
        }

        // If the property is a function value, bind it to the real navigator
        if (desc && typeof desc.value === "function") {
          try {
            return desc.value.bind(target);
          } catch (e) {
            // fall through
          }
        }

        try {
          return Reflect.get(target, prop, target);
        } catch (e) {
          return undefined;
        }
      },

      getPrototypeOf(target) {
        return Object.getPrototypeOf(target);
      }
    };

    const navProxy = new Proxy(realNav, handler);

    try {
      Object.defineProperty(navProxy, "__fpRandWrappedUA", {
        value: spoofedUA,
        enumerable: false,
        configurable: false
      });
    } catch (_) {}

    try {
      const desc = Object.getOwnPropertyDescriptor(window, "navigator");
      const configurable = !desc || desc.configurable === true;

      Object.defineProperty(window, "navigator", {
        configurable,
        enumerable: true,
        get() { return navProxy; }
      });
    } catch (_) {
      // Fallback: direct assignment if allowed
      try {
        window.navigator = navProxy;
      } catch (_) {}
    }
  }

  // ============ Screen patch ============
  function patchScreen(spoofedUA) {
    if (!spoofedUA) return;

    const realScreen = window.screen;
    if (!realScreen) return;

    const offsets = computeScreenOffsets(spoofedUA, realScreen);

    const handler = {
      get(target, prop, receiver) {
        if (prop === "width")        return offsets.width;
        if (prop === "height")       return offsets.height;
        if (prop === "availWidth")   return offsets.availWidth;
        if (prop === "availHeight")  return offsets.availHeight;

        // Other properties pass through
        try {
          return Reflect.get(target, prop, target);
        } catch (e) {
          return undefined;
        }
      },

      getPrototypeOf(target) {
        return Object.getPrototypeOf(target);
      }
    };

    const screenProxy = new Proxy(realScreen, handler);

    try {
      const desc = Object.getOwnPropertyDescriptor(window, "screen");
      const configurable = !desc || desc.configurable === true;

      Object.defineProperty(window, "screen", {
        configurable,
        enumerable: true,
        get() { return screenProxy; }
      });
    } catch (_) {
      // Fallback: direct assignment if allowed
      try {
        window.screen = screenProxy;
      } catch (_) {}
    }
  }


  // ============ WebGL renderer patch ============

  function patchWebGL(spoofedUA) {
    if (!spoofedUA) return;
    if (typeof WebGLRenderingContext === "undefined") return;

    // Enum constants (numeric) for vendor/renderer
    const GL_VENDOR = 0x1F00;
    const GL_RENDERER = 0x1F01;
    const UNMASKED_VENDOR_WEBGL = 0x9245;
    const UNMASKED_RENDERER_WEBGL = 0x9246;

    function wrapGetParameter(proto) {
      if (!proto || !proto.getParameter) return;

      const orig = proto.getParameter;
      if (orig.__fpRandWrapped) {
        return;
      }

      function wrappedGetParameter(pname) {
        // If the page queries the debug renderer info without the extension,
        // short-circuit to null to avoid INVALID_ENUM.
        if (
          pname === UNMASKED_VENDOR_WEBGL ||
          pname === UNMASKED_RENDERER_WEBGL
        ) {
          try {
            const hasExt =
              this &&
              typeof this.getExtension === "function" &&
              this.getExtension("WEBGL_debug_renderer_info");
            if (!hasExt) {
              // Spec allows returning null when extension is not available.
              return null;
            }
          } catch (_) {
            return null;
          }
        }

        let value;
        try {
          value = orig.call(this, pname);
        } catch (e) {
          // If the underlying call throws for any reason, just propagate
          // whatever it produced (likely undefined) without extra logic.
          return value;
        }

        if (typeof value === "string") {
          if (
            pname === GL_VENDOR ||
            pname === GL_RENDERER ||
            pname === UNMASKED_VENDOR_WEBGL ||
            pname === UNMASKED_RENDERER_WEBGL
          ) {
            // Apply UA-style noise to the renderer/vendor string
            return buildNoisyRenderer(value, spoofedUA);
          }
        }

        return value;
      }

      try {
        Object.defineProperty(wrappedGetParameter, "__fpRandWrapped", {
          value: true,
          enumerable: false,
          configurable: false
        });
      } catch (_) {}

      try {
        Object.defineProperty(proto, "getParameter", {
          value: wrappedGetParameter,
          writable: true,
          configurable: true
        });
      } catch (_) {
        // fallback
        proto.getParameter = wrappedGetParameter;
      }
    }

    try {
      wrapGetParameter(WebGLRenderingContext.prototype);
    } catch (_) {}

    try {
      if (typeof WebGL2RenderingContext !== "undefined") {
        wrapGetParameter(WebGL2RenderingContext.prototype);
      }
    } catch (_) {}
  }


  // ============ Font noise patch  ============

  function patchFontNoise() {
    const proto = HTMLElement.prototype;
    if (!proto) return;
    if (proto.__fpFontNoisePatched) return;

    const origHDesc = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
    const origWDesc = Object.getOwnPropertyDescriptor(proto, "offsetWidth");

    if (!origHDesc || typeof origHDesc.get !== "function") return;
    if (!origWDesc || typeof origWDesc.get !== "function") return;

    const origHGet = origHDesc.get;
    const origWGet = origWDesc.get;

    const rand = {
      // small integer noise in {-1, 0, +1}, deterministic for a given UA+origin
      noise() {
        const rng = getSessionNoise();
        const idxSign = rng.nextInt(10); // 0..9
        const sign = (idxSign === 6) ? +1 : -1;   
        const mag = rng.nextInt(2);               // 0 or 1
        return sign * mag;
      },
      // biased sign used only to decide whether to apply noise at all
      // we want valid ~40% => Δ!=0 ~20% 
      sign() {
        const rng = getSessionNoise();
        const idx = rng.nextInt(10);             // 0..9
        // 0,1,2,3 => 4/10 = 40% chance to be +1
        return (idx < 4) ? +1 : -1;
      }
    };

    // Patch offsetHeight
    try {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        enumerable: origHDesc.enumerable,
        get: new Proxy(origHGet, {
          apply(target, self, args) {
            try {
              const rect = self.getBoundingClientRect();
              const height = Math.floor(rect && rect.height);
              // ~40% of the time (for non-zero height) we attempt to add noise
              const valid = height && rand.sign() === 1;
              const result = valid ? height + rand.noise() : height;

              if (valid && result !== height) {
                try {
                  window.top.postMessage("font-defender-alert", "*");
                } catch (_) {}
              }

              return result;
            } catch (e) {
              return Reflect.apply(target, self, args);
            }
          }
        })
      });
    } catch (_) {}

    // Patch offsetWidth
    try {
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
        configurable: true,
        enumerable: origWDesc.enumerable,
        get: new Proxy(origWGet, {
          apply(target, self, args) {
            try {
              const rect = self.getBoundingClientRect();
              const width = Math.floor(rect && rect.width);
              const valid = width && rand.sign() === 1;
              const result = valid ? width + rand.noise() : width;

              if (valid && result !== width) {
                try {
                  window.top.postMessage("font-defender-alert", "*");
                } catch (_) {}
              }

              return result;
            } catch (e) {
              return Reflect.apply(target, self, args);
            }
          }
        })
      });
    } catch (_) {}

    // Sandboxed frame recovery
    try {
      const mkey = "font-defender-sandboxed-frame";
      document.documentElement.setAttribute(mkey, "");

      window.addEventListener(
        "message",
        function (e) {
          if (e.data && e.data === mkey) {
            try {
              e.preventDefault();
              e.stopPropagation();
            } catch (_) {}

            if (e.source && e.source.HTMLElement) {
              try {
                Object.defineProperty(e.source.HTMLElement.prototype, "offsetWidth", {
                  configurable: true,
                  enumerable: true,
                  get: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth").get
                });
              } catch (_) {}

              try {
                Object.defineProperty(e.source.HTMLElement.prototype, "offsetHeight", {
                  configurable: true,
                  enumerable: true,
                  get: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight").get
                });
              } catch (_) {}
            }
          }
        },
        false
      );
    } catch (_) {}

    try {
      Object.defineProperty(proto, "__fpFontNoisePatched", {
        value: true,
        enumerable: false,
        configurable: false
      });
    } catch (_) {}
  }


  // ============ Canvas fingerprinting defense ============

  function patchCanvasDefense() {
    if (HTMLCanvasElement.prototype.__fpCanvasPatched) return;

    try {
      const port = document.createElement("div");
      port.id = "cc-blck-fp";
      document.documentElement.appendChild(port);

      // Enable by default; 
      port.dataset.enabled = "true";
      // "random" -> random per call; 
      port.dataset.mode = port.dataset.mode || "random";

      let gshift; 
      const getImageDataOrig = CanvasRenderingContext2D.prototype.getImageData;

      const manipulate = (canvas) => {
        try {
          if (!canvas || !canvas.getContext) return;
          if (port.dataset.enabled !== "true") return;

          const { width, height } = canvas;
          if (!width || !height) return;

          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return;

          port.dispatchEvent(new Event("manipulate"));

          const matt = getImageDataOrig.call(ctx, 0, 0, width, height);
          const mode = port.dataset.mode;

          function randomDelta() {
            // deterministic delta in [-3, +3] based on UA+origin
            const rng = getSessionNoise();
            const v = rng.nextInt(7); // 0..6
            return v - 3;
          }

          const shift = (mode === "session" && gshift)
            ? gshift
            : {
                r: mode === "random"
                  ? randomDelta()
                  : Number(port.dataset.red || 0),
                g: mode === "random"
                  ? randomDelta()
                  : Number(port.dataset.green || 0),
                b: mode === "random"
                  ? randomDelta()
                  : Number(port.dataset.blue || 0)
              };

          if (mode === "session" && !gshift) {
            gshift = shift;
          }

          const stepY = Math.max(1, (height / 10) | 0 || 1);
          const stepX = Math.max(1, (width / 10) | 0 || 1);

          for (let y = 0; y < height; y += stepY) {
            for (let x = 0; x < width; x += stepX) {
              const n = ((y * (width * 4)) + (x * 4));
              matt.data[n + 0] = matt.data[n + 0] + shift.r;
              matt.data[n + 1] = matt.data[n + 1] + shift.g;
              matt.data[n + 2] = matt.data[n + 2] + shift.b;
            }
          }
          ctx.putImageData(matt, 0, 0);
        } catch (_) {
          // ignore
        }
      };

      // --- Create proxies once ---
      const origToBlob    = HTMLCanvasElement.prototype.toBlob;
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      const origGetCtx    = HTMLCanvasElement.prototype.getContext;

      const toBlobProxy = origToBlob && new Proxy(origToBlob, {
        apply(target, self, args) {
          try { manipulate(self); } catch (_) {}
          return Reflect.apply(target, self, args);
        }
      });

      const toDataURLProxy = origToDataURL && new Proxy(origToDataURL, {
        apply(target, self, args) {
          try { manipulate(self); } catch (_) {}
          return Reflect.apply(target, self, args);
        }
      });

      const getImageDataProxy = new Proxy(
        CanvasRenderingContext2D.prototype.getImageData,
        {
          apply(target, self, args) {
            try { manipulate(self.canvas); } catch (_) {}
            return Reflect.apply(target, self, args);
          }
        }
      );

      const getContextProxy = new Proxy(origGetCtx, {
        apply(target, self, args) {
          if (port.dataset.enabled === "true" && args[0] === "2d") {
            args[1] = args[1] || {};
            args[1].willReadFrequently = true;
          }
          return Reflect.apply(target, self, args);
        }
      });

      function applyCanvasProxies(win) {
        try {
          if (!win || !win.HTMLCanvasElement || !win.CanvasRenderingContext2D) return;

          if (toBlobProxy && win.HTMLCanvasElement.prototype.toBlob) {
            win.HTMLCanvasElement.prototype.toBlob = toBlobProxy;
          }
          if (toDataURLProxy && win.HTMLCanvasElement.prototype.toDataURL) {
            win.HTMLCanvasElement.prototype.toDataURL = toDataURLProxy;
          }

          win.CanvasRenderingContext2D.prototype.getImageData = getImageDataProxy;
          win.HTMLCanvasElement.prototype.getContext = getContextProxy;
        } catch (_) {
        }
      }

      // Apply to current window
      applyCanvasProxies(window);

      // Apply to any frames that already exist at this moment
      for (let i = 0; i < window.frames.length; i++) {
        applyCanvasProxies(window.frames[i]);
      }

      // Watch for new iframes added later (e.g., #canvas-iframe on browserleaks)
      const mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node && node.nodeType === 1) {
              if (node.tagName === "IFRAME") {
                try {
                  const win = node.contentWindow;
                  if (win) applyCanvasProxies(win);
                } catch (_) {}
              }
              // also check any nested iframes inside added subtree
              const iframes = node.querySelectorAll
                ? node.querySelectorAll("iframe")
                : [];
              for (const frame of iframes) {
                try {
                  const win = frame.contentWindow;
                  if (win) applyCanvasProxies(win);
                } catch (_) {}
              }
            }
          }
        }
      });

      mo.observe(document.documentElement, {
        childList: true,
        subtree: true
      });

      // For other injected worlds via postMessage
      const observe = (e) => {
        if (e.source && e.data === "inject-script-into-source") {
          try {
            applyCanvasProxies(e.source);
            e.source.addEventListener("message", observe);
          } catch (err) {
            console.warn("Cannot spoof Canvas", e.source, err);
          }
        }
      };
      window.addEventListener("message", observe);

      Object.defineProperty(HTMLCanvasElement.prototype, "__fpCanvasPatched", {
        value: true,
        enumerable: false,
        configurable: false
      });
    } catch (_) {
    }
  }


  // ============ main orchestration ============
  (async function main() {
    const resp = await requestConfigAndUA();
    const cfg = resp?.cfg;
    const spoofedUA = resp?.spoofedUA;

    // If disabled globally, do nothing anywhere
    if (!cfg || !cfg.enabled) return;

    const host = location.hostname;
    // Allowlisted sites: keep everything original (no canvas, no UA/screen/WebGL/font)
    if (isWhitelisted(host, cfg.whitelist)) return;

    // Canvas defense for non-allowlisted sites
    try {
      patchCanvasDefense();
    } catch (_) {}

    // If no spoofedUA, stop after canvas patch (rare)
    if (!spoofedUA) return;

    try {
      // UA + appVersion spoof (can be disabled via __fpRandSetUaSpoofEnabled(false))
      if (uaSpoofEnabled) {
        patchUA(spoofedUA);
      }
    } catch (_) {}

    try {
      // Screen resolution spoof (small deltas, consistent)
      patchScreen(spoofedUA);
    } catch (_) {}

    try {
      // WebGL renderer spoof — same strategy style as UA
      patchWebGL(spoofedUA);
    } catch (_) {}

    try {
      // Font metrics noise (random jitter via offsetWidth/offsetHeight)
      patchFontNoise();
    } catch (_) {}
  })();
})();
