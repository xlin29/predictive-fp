"""
Generate synthetic test_data
=============================
Generates fully synthetic browser fingerprint data in the same schema as the
real dataset. No real user information is included. The code can be run
end-to-end with this data and it is safe to publish on GitHub.

Each user gets multiple visit records simulating fingerprint changes caused by
browser version upgrades. Platform / browser / GPU combinations are drawn from
a set of coherent device profiles to ensure internal consistency.

Usage:
    python generate_test_data.py                     # 10 users -> test_data_synthetic/
    python generate_test_data.py --users 50          # 50 users
    python generate_test_data.py --out my_test_data  # custom output directory
    python generate_test_data.py --seed 42           # fixed seed for reproducibility
"""

import os
import json
import random
import hashlib
import argparse
import string
from datetime import datetime, timedelta, timezone

# ── Configuration ─────────────────────────────────────────────────────────────
DEFAULT_OUT   = "test_data_synthetic/"
DEFAULT_USERS = 10
START_DATE    = datetime(2023, 9, 1, tzinfo=timezone.utc)
END_DATE      = datetime(2024, 3, 31, tzinfo=timezone.utc)
# ─────────────────────────────────────────────────────────────────────────────

# ── Device profiles: platform / browser / GPU / plugins bound together ────────
# Each profile: (weight, platform_str, nav_vendor_type, system, system_family,
#                browser_name, browser_versions,
#                webgl_vendor, webgl_renderer,
#                device_type, nav_vendor,
#                has_plugins)
DEVICE_PROFILES = [
    # Windows + Chrome
    (25, "Win32",          "Windows", "Windows 10",     "Windows",
         "Chrome", [119, 120, 121, 122, 123],
         "Google Inc. (Intel)",  "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
         "PC", "Google Inc.", True),
    (10, "Win32",          "Windows", "Windows 11",     "Windows",
         "Chrome", [119, 120, 121, 122, 123],
         "Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
         "PC", "Google Inc.", True),
    # Windows + Edge
    (10, "Win32",          "Windows", "Windows 10",     "Windows",
         "Edge",   [119, 120, 121],
         "Google Inc. (Intel)",  "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
         "PC", "Google Inc.", True),
    # Windows + Firefox
    (8,  "Win32",          "Windows", "Windows 10",     "Windows",
         "Firefox",[118, 119, 120, 121],
         "Google Inc. (Intel)",  "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
         "PC", "", False),
    # Mac + Chrome
    (15, "MacIntel",       "MacOS",   "Mac OS X 10.15", "MacOS",
         "Chrome", [119, 120, 121, 122, 123],
         "Apple Inc.",           "Apple M1",
         "PC", "Google Inc.", True),
    (5,  "MacIntel",       "MacOS",   "Mac OS X 14",    "MacOS",
         "Chrome", [120, 121, 122, 123],
         "Apple Inc.",           "Apple M2",
         "PC", "Google Inc.", True),
    # Mac + Safari
    (8,  "MacIntel",       "MacOS",   "Mac OS X 14",    "MacOS",
         "Safari", [16, 17],
         "Apple Inc.",           "Apple M2",
         "PC", "Apple Computer, Inc.", False),
    # Mac + Firefox
    (5,  "MacIntel",       "MacOS",   "Mac OS X 10.15", "MacOS",
         "Firefox",[118, 119, 120, 121],
         "Apple Inc.",           "Apple M1",
         "PC", "", False),
    # iPhone + Safari
    (8,  "iPhone",         "iOS",     "iOS 17.0",       "iOS",
         "Safari", [16, 17],
         "Apple Inc.",           "Apple A15 GPU",
         "Mobile", "Apple Computer, Inc.", False),
    # Android + Chrome
    (6,  "Linux armv81",   "Android", "Android 13",     "Android",
         "Chrome", [119, 120, 121],
         "Qualcomm",             "Adreno (TM) 640",
         "Mobile", "Google Inc.", False),
]

CHROME_PLUGINS = [
    {"a": 975495497,   "b": "PDF Viewer"},
    {"a": 1061675194,  "b": "Chrome PDF V"},
    {"a": 2126051627,  "b": "Chromium PDF"},
    {"a": 1387368353,  "b": "Microsoft Ed"},
    {"a": -1716625998, "b": "WebKit built"},
]

PRODUCT_SUB_MAP = {"Chrome": "20030107", "Edge": "20030107",
                   "Safari": "20030107", "Firefox": "20100101"}
PIXEL_RATIOS = ["1.0", "1.5", "2.0", "3.0"]

RESOLUTIONS_BY_DEVICE = {
    "PC":     ["1920X1080", "1366X768", "1440X900", "2560X1440", "1280X800", "1600X900"],
    "Mobile": ["375X812",   "390X844",  "414X896",  "360X780"],
}

AVAIL_RES_OFFSET = {
    "1920X1080": "1920X1040", "1366X768": "1366X728",
    "1440X900":  "1440X860",  "2560X1440":"2560X1400",
    "1280X800":  "1280X760",  "1600X900": "1600X860",
    "375X812":   "375X812",   "390X844":  "390X844",
    "414X896":   "414X896",   "360X780":  "360X780",
}

# ─────────────────────────────────────────────────────────────────────────────

def rand_hex(n, rng):
    return ''.join(rng.choices('0123456789abcdef', k=n))

def rand_cookie(rng):
    chars = string.ascii_letters + string.digits + '-_'
    return ''.join(rng.choices(chars, k=43))

def sha256_of(value):
    return hashlib.sha256(value.encode()).hexdigest()

def stable_hex(seed_str, n=8):
    """Deterministic hex hash from a fixed string.
    Used for fields that should remain stable across visits on the same browser version."""
    return hashlib.sha256(seed_str.encode()).hexdigest()[:n]

def make_ua(platform_str, system, browser_name, browser_ver):
    if browser_name == "Chrome":
        if "Win" in platform_str:
            return (f"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    f"(KHTML, like Gecko) Chrome/{browser_ver}.0.0.0 Safari/537.36")
        elif "Mac" in platform_str:
            return (f"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    f"(KHTML, like Gecko) Chrome/{browser_ver}.0.0.0 Safari/537.36")
        else:  # Android
            return (f"Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 "
                    f"(KHTML, like Gecko) Chrome/{browser_ver}.0.0.0 Mobile Safari/537.36")
    elif browser_name == "Edge":
        return (f"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                f"(KHTML, like Gecko) Chrome/{browser_ver}.0.0.0 Safari/537.36 "
                f"Edg/{browser_ver}.0.0.0")
    elif browser_name == "Firefox":
        if "Mac" in platform_str:
            return f"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:{browser_ver}.0) Gecko/20100101 Firefox/{browser_ver}.0"
        elif "Win" in platform_str:
            return f"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:{browser_ver}.0) Gecko/20100101 Firefox/{browser_ver}.0"
        else:
            return f"Mozilla/5.0 (X11; Linux x86_64; rv:{browser_ver}.0) Gecko/20100101 Firefox/{browser_ver}.0"
    elif browser_name == "Safari":
        if "iPhone" in platform_str:
            return (f"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                    f"AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{browser_ver}.0 "
                    f"Mobile/15E148 Safari/604.1")
        else:
            return (f"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
                    f"AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{browser_ver}.0 Safari/605.1.15")
    return ""

def make_fp(profile, browser_ver, res, user_seed, rng):
    """
    user_seed: per-user fixed seed string; ensures stable fields are consistent
               across visits on the same browser version.
    rng:       used for fields that may vary between visits (e.g. canvas).
    """
    (_, platform_str, nav_vendor_type, system, system_family,
     browser_name, _, webgl_vendor, webgl_renderer,
     device_type, nav_vendor, has_plugins) = profile

    avail_res   = AVAIL_RES_OFFSET.get(res, res)
    pixel_ratio = rng.choice(PIXEL_RATIOS)
    user_agent  = make_ua(platform_str, system, browser_name, browser_ver)
    ua_compact  = user_agent.replace(" ", "")
    browser_str = f"{browser_name} {browser_ver}.0.0"
    browser_family = f"{platform_str}~{browser_name}"
    product_sub = PRODUCT_SUB_MAP.get(browser_name, "20030107")

    if has_plugins:
        plugins_num = str(len(CHROME_PLUGINS))
        plugins_str = str([{k: float(v) if k == 'a' else v
                            for k, v in p.items()} for p in CHROME_PLUGINS])
    else:
        plugins_num = "0"
        plugins_str = "[]"

    # Stable fields: same user + same browser version -> same value
    ver_seed = f"{user_seed}|{browser_name}|{browser_ver}|{platform_str}"
    font_val          = stable_hex(ver_seed + "|font")
    plugin_feature    = stable_hex(ver_seed + "|plugin")
    date_feature      = stable_hex(ver_seed + "|date")
    webgl_params      = stable_hex(ver_seed + "|webgl_params")
    original_font_rng = random.Random(ver_seed + "|orig_font")
    original_font     = [str(original_font_rng.randint(0, 1)) for _ in range(46)]

    # Per-visit fields: canvas can vary slightly between renders
    canvas = rand_hex(8, rng)

    fp = {
        "webgl_vendor":       webgl_vendor,
        "webgl_renderer":     webgl_renderer,
        "platform":           platform_str,
        "buildID":            "",
        "productSub":         product_sub,
        "navigator_vendor":   nav_vendor,
        "colorDepth":         "24",
        "pixelDepth":         "24",
        "http_userAgent":     user_agent,
        "http_device":        device_type,
        "http_system_family": system_family,
        "http_system":        system,
        "http_browser_family":browser_name,
        "http_browser":       browser_str,
        "userAgent":          ua_compact,
        "appVersion":         ua_compact.replace("Mozilla/", ""),
        "system":             system,
        "system_family":      system_family,
        "browser":            browser_str,
        "browser_family":     browser_family,
        "device":             device_type,
        "plugins_num":        plugins_num,
        "plugins":            plugins_str,
        "pluginFeature":      plugin_feature,
        "dateFeature":        date_feature,
        "devicePixelRatio":   pixel_ratio,
        "resolution":         res,
        "avail_resolution":   avail_res,
        "font":               font_val,
        "original-font":      original_font,
        "webgl":              ("WebGL 1.0 (OpenGL ES 2.0 Chromium),30,16384,8,16,32,1024,8,0,"
                               "WebKit,16,8,WebKit WebGL,8,4096,16384,24,16,"
                               "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium),16384"),
        "webgl_parameters":   webgl_params,
        "canvas":             canvas,
        "width":              res.split("X")[0],
    }
    return fp

def pick_profile(rng):
    weights = [p[0] for p in DEVICE_PROFILES]
    return rng.choices(DEVICE_PROFILES, weights=weights, k=1)[0]

def gen_timestamps(n_visits, rng):
    total_seconds = int((END_DATE - START_DATE).total_seconds())
    first = START_DATE + timedelta(seconds=rng.randint(0, total_seconds // 2))
    timestamps = [first]
    for _ in range(n_visits - 1):
        gap = timedelta(days=rng.randint(1, 60))
        nxt = timestamps[-1] + gap
        if nxt > END_DATE:
            break
        timestamps.append(nxt)
    return [str(ts) for ts in timestamps]

def gen_user(user_idx, rng):
    profile      = pick_profile(rng)
    browser_vers = profile[6]
    device_type  = profile[9]
    res_pool     = RESOLUTIONS_BY_DEVICE[device_type]
    res          = rng.choice(res_pool)
    cookie       = rand_cookie(rng)
    login_id     = sha256_of(f"synthetic_user_{user_idx}_{rng.random()}")

    n_visits   = rng.choices([2, 3, 4, 5, 6, 8, 10], weights=[20, 20, 20, 15, 10, 8, 7])[0]
    timestamps = gen_timestamps(n_visits, rng)

    records     = []
    current_ver = rng.choice(browser_vers)

    for i, ts in enumerate(timestamps):
        # Simulate browser upgrade (~30% chance per visit, only to newer versions)
        if i > 0 and rng.random() < 0.3:
            newer = [v for v in browser_vers if v > current_ver]
            if newer:
                current_ver = rng.choice(newer)

        fp = make_fp(profile, current_ver, res, login_id, rng)
        records.append({
            "loginidName": login_id,
            "cookie":      cookie,
            "timestamp":   ts,
            "fp":          fp,
        })
    return records

def main():
    parser = argparse.ArgumentParser(description="Generate synthetic test_data")
    parser.add_argument("--users", type=int, default=DEFAULT_USERS,
                        help=f"Number of users to generate (default: {DEFAULT_USERS})")
    parser.add_argument("--out",   type=str, default=DEFAULT_OUT,
                        help=f"Output directory (default: {DEFAULT_OUT})")
    parser.add_argument("--seed",  type=int, default=None,
                        help="Random seed for reproducibility")
    args = parser.parse_args()

    rng = random.Random(args.seed)
    os.makedirs(args.out, exist_ok=True)

    print(f"Generating {args.users} synthetic users -> {args.out}")
    for i in range(args.users):
        user_rng = random.Random(rng.random())
        records  = gen_user(i, user_rng)
        filename = sha256_of(f"file_{i}_{rng.random()}") + ".json"
        with open(os.path.join(args.out, filename), "w") as f:
            for record in records:
                f.write(json.dumps(record) + "\n")

    print(f"Done. Generated {args.users} user files.")

if __name__ == "__main__":
    main()
