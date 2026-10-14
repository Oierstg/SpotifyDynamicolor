// @ts-check
// NAME: SpotifyColored
// AUTHOR: Oier
// DESCRIPTION: Spotify con un tono colorido

(function startAppleGlass() {
    if (!window.Spicetify?.Player || !window.Spicetify?.Platform || !document.body) {
        setTimeout(startAppleGlass, 100);
        return;
    }

    document.getElementById("spicetify-water-backdrop")?.remove();

    let activeMeshIndex = 1, activeCoverUrl = "", activeUpdateId = 0, _applyRafId = null;
    let backdropElement = null, listenersAttached = false, historyAttached = false;

    const PALETTE_CACHE_MAX = 50, paletteCache = new Map();
    const SAMPLE_SIZE = 32;
    const _sampleCanvas = document.createElement("canvas");
    _sampleCanvas.width = _sampleCanvas.height = SAMPLE_SIZE;
    const _sampleCtx = _sampleCanvas.getContext("2d", { willReadFrequently: true });

    const FALLBACK_COLOR = Object.freeze({
        hex: "#3a4a58", rawHex: "#3a4a58", r: 58, g: 74, b: 88, h: 208, s: 0.21, l: 0.29,
        isAchromatic: false, isDark: true, isLight: false, percentage: 100
    });
    const FALLBACK_PALETTE = Object.freeze([FALLBACK_COLOR]);

    // =========================================================
    // UTILIDADES DE COLOR Y MATEMÁTICAS
    // =========================================================
    const clamp255 = c => c < 0 ? 0 : c > 255 ? 255 : (c + 0.5) | 0;
    const toHex = c => clamp255(c).toString(16).padStart(2, "0");
    const rgbToHex = (r, g, b) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;

    function hexToRgb(hex) {
        if (!hex) return [255, 255, 255];
        let c = hex.replace("#", "");
        if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
        const n = parseInt(c, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        let h = 0, s = 0, l = (max + min) / 2;
        if (d !== 0) {
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return [h * 360, s, l];
    }

    function hslToRgb(h, s, l) {
        h = ((h % 360) + 360) % 360;
        const a = s * Math.min(l, 1 - l);
        const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(((n + h / 30) % 12) - 3, 9 - ((n + h / 30) % 12), 1))));
        return [f(0), f(8), f(4)];
    }

    const shiftHsl = (h, s, l, dh, sm = 1, lm = 1) => s < 0.08
        ? rgbToHex(...hslToRgb(0, 0, Math.max(0.1, Math.min(0.92, l * lm))))
        : rgbToHex(...hslToRgb(h + dh, Math.max(0, Math.min(1, s * sm)), Math.max(0.18, Math.min(0.72, l * lm))));

    function colorDistSq(r1, g1, b1, r2, g2, b2) {
        const rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
        return (((512 + rm) * dr * dr) >> 8) + 4 * dg * dg + (((767 - rm) * db * db) >> 8);
    }

    const CLUSTER_MERGE_SQ = 65 * 65, DISTINCT_COLOR_SQ = 55 * 55;

    function tuneColor(r, g, b, h, s, l) {
        if (h === undefined) [h, s, l] = rgbToHsl(r, g, b);
        if (s < 0.14) {
            if (l < 0.22) return "#0e1117";
            if (l > 0.78) return "#f2f4f8";
            const gv = Math.round(l * 255);
            return rgbToHex(gv, gv, gv);
        }
        return rgbToHex(...hslToRgb(h, Math.min(1, Math.max(0.60, s * 1.25)), Math.max(0.24, Math.min(0.58, l))));
    }

    const lumPart = v => (v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    const getLuminance = (r, g, b) => 0.2126 * lumPart(r) + 0.7152 * lumPart(g) + 0.0722 * lumPart(b);
    const getContrast = (r1, g1, b1, r2, g2, b2) => (Math.max(getLuminance(r1, g1, b1), getLuminance(r2, g2, b2)) + 0.05) / (Math.min(getLuminance(r1, g1, b1), getLuminance(r2, g2, b2)) + 0.05);

    // =========================================================
    // CÁLCULO DE COLORES PARA BOTÓN PLAY Y TEXTO
    // =========================================================
    function computeButtonColors(colors) {
        if (!colors?.length) return { bg: "#1ed760", bgHover: "#3be477", bgActive: "#1abc54", fg: "#000", glow: "rgba(30,215,96,0.4)" };
        const chosen = colors.find(c => !c.isAchromatic && c.s >= 0.14) || colors[0];
        const { h = 0, s = 0, l = 0.5, isAchromatic, isLight } = chosen;
        const isNeutral = isAchromatic || s < 0.12;
        const btnS = isNeutral ? s : Math.max(0.65, s);
        const [bgR, bgG, bgB] = isNeutral ? ((isLight || l > 0.6) ? [20, 24, 30] : [255, 255, 255]) : hslToRgb(h, btnS, Math.max(0.40, Math.min(0.65, l)));
        const fg = getContrast(bgR, bgG, bgB, 0, 0, 0) > getContrast(bgR, bgG, bgB, 255, 255, 255) ? "#000000" : "#ffffff";
        return {
            bg: rgbToHex(bgR, bgG, bgB),
            bgHover: rgbToHex(...hslToRgb(h, btnS, Math.min(0.85, l + 0.08))),
            bgActive: rgbToHex(...hslToRgb(h, btnS, Math.max(0.20, l - 0.08))),
            fg, glow: `rgba(${bgR}, ${bgG}, ${bgB}, 0.45)`
        };
    }

    function computeDynamicTextColor(colors, isLightMode = false) {
        if (!colors?.length || isLightMode) {
            const base = isLightMode ? "20, 23, 28" : "255, 255, 255";
            return { primary: isLightMode ? "#14171c" : "#ffffff", subdued: `rgba(${base}, 0.72)`, rgb: base, subduedRgb: base };
        }
        const chosen = colors.slice(0, 3).filter(c => (c.percentage || 0) >= 4 && !c.isDark).sort((a, b) => a.percentage - b.percentage)[0] || colors.find(c => !c.isDark) || colors[0];
        const { h = 0, s = 0, l = 0.5, isAchromatic } = chosen;
        if (isAchromatic || s < 0.12) {
            return { primary: "#ffffff", subdued: "rgba(255, 255, 255, 0.72)", rgb: "255, 255, 255", subduedRgb: "255, 255, 255" };
        }
        const textS = Math.min(0.90, Math.max(0.45, s)), textL = Math.max(0.80, Math.min(0.92, l > 0.5 ? l + 0.15 : l + 0.40));
        const pRgb = hslToRgb(h, textS, textL), sRgb = hslToRgb(h, Math.max(0.20, textS * 0.75), Math.max(0.60, textL - 0.18));
        return { primary: rgbToHex(...pRgb), subdued: rgbToHex(...sRgb), rgb: pRgb.join(", "), subduedRgb: sRgb.join(", ") };
    }

    // =========================================================
    // CUANTIZACIÓN RÁPIDA DE IMAGEN (< 2ms)
    // =========================================================
    function analyzeCover(img) {
        const S = SAMPLE_SIZE;
        if (!_sampleCtx) return [FALLBACK_COLOR];
        _sampleCtx.clearRect(0, 0, S, S);
        _sampleCtx.drawImage(img, 0, 0, S, S);
        const data = _sampleCtx.getImageData(0, 0, S, S).data;

        const binMap = new Map();
        let totalWeight = 0;
        for (let p = 0, x = 0, y = 0; p < S * S; p++) {
            const i = p << 2;
            if (data[i + 3] >= 128) {
                const r = data[i], g = data[i + 1], b = data[i + 2];
                const w = (x <= 1 || x >= S - 2 || y <= 1 || y >= S - 2) ? 2 : 1;
                const k = (((r / 20 + 0.5) | 0) << 16) | (((g / 20 + 0.5) | 0) << 8) | ((b / 20 + 0.5) | 0);
                const bin = binMap.get(k);
                if (bin) { bin.rSum += r * w; bin.gSum += g * w; bin.bSum += b * w; bin.count += w; }
                else binMap.set(k, { rSum: r * w, gSum: g * w, bSum: b * w, count: w });
                totalWeight += w;
            }
            if (++x === S) { x = 0; y++; }
        }
        if (!totalWeight) return [FALLBACK_COLOR];

        const bins = Array.from(binMap.values(), b => {
            b.r = b.rSum / b.count; b.g = b.gSum / b.count; b.b = b.bSum / b.count;
            return b;
        }).sort((a, b) => b.count - a.count).slice(0, 24);

        const clusters = [];
        for (const b of bins) {
            const c = clusters.find(cl => colorDistSq(b.r, b.g, b.b, cl.r, cl.g, cl.b) < CLUSTER_MERGE_SQ);
            if (c) {
                c.rSum += b.rSum; c.gSum += b.gSum; c.bSum += b.bSum; c.count += b.count;
                c.r = c.rSum / c.count; c.g = c.gSum / c.count; c.b = c.bSum / c.count;
            } else clusters.push(b);
        }
        clusters.sort((a, b) => b.count - a.count);

        const distinct = [];
        const invW = 1 / totalWeight;
        for (const c of clusters) {
            const pct = (c.count * invW * 100 + 0.5) | 0;
            if (pct >= 1 && !distinct.some(s => colorDistSq(c.r, c.g, c.b, s.r, s.g, s.b) < DISTINCT_COLOR_SQ)) {
                const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
                distinct.push({
                    hex: tuneColor(c.r, c.g, c.b, h, s, l), rawHex: rgbToHex(c.r, c.g, c.b),
                    r: (c.r + 0.5) | 0, g: (c.g + 0.5) | 0, b: (c.b + 0.5) | 0,
                    h: (h + 0.5) | 0, s, l,
                    isAchromatic: s < 0.14, isDark: l < 0.22, isLight: l > 0.78, percentage: pct
                });
                if (distinct.length === 5) break;
            }
        }
        return distinct.length ? distinct : [FALLBACK_COLOR];
    }

    // =========================================================
    // PALETA ARMÓNICA DE ORBES Y FONDOS
    // =========================================================
    function computeBlobPalette(colors) {
        const p = colors?.[0] || FALLBACK_COLOR;
        const { h = 0, s = 0, l = 0.5, isAchromatic, isLight, isDark } = p;
        const accents = (colors || []).filter(c => !c.isAchromatic && c.s >= 0.14), main = accents[0];

        if ((isAchromatic && (isLight || l > 0.70)) || l > 0.82) {
            if (!main) return { c1: "#d0d8e4", c2: "#e0e6f0", c3: "#c5cfdc", c4: "#ebf0f7", base1: "#f5f7fa", base2: "#e6ebf2", isLight: true };
            const bS = Math.min(0.95, Math.max(0.65, main.s * 1.15)), bL = Math.max(0.50, Math.min(0.68, main.l > 0.5 ? main.l : main.l + 0.20));
            return {
                c1: rgbToHex(...hslToRgb(main.h, bS, bL)),
                c2: accents[1] ? rgbToHex(...hslToRgb(accents[1].h, Math.min(0.9, Math.max(0.6, accents[1].s)), Math.max(0.52, Math.min(0.7, accents[1].l)))) : shiftHsl(main.h, bS, bL, 30, 0.9, 1.05),
                c3: shiftHsl(main.h, bS, bL, -25, 0.85, 0.95), c4: shiftHsl(main.h, bS, bL, 15, 0.95, 1.08),
                base1: rgbToHex(...hslToRgb(main.h, Math.min(0.08, main.s * 0.15), 0.94)),
                base2: rgbToHex(...hslToRgb(main.h + 15, Math.min(0.12, main.s * 0.2), 0.88)), isLight: true
            };
        }
        if ((isAchromatic && (isDark || l < 0.26)) || l < 0.16) {
            if (!main) return { c1: "#252c36", c2: "#181d24", c3: "#323b47", c4: "#1f242c", base1: "#090a0d", base2: "#050608", isLight: false };
            return {
                c1: main.hex, c2: accents[1]?.hex || shiftHsl(main.h, main.s, main.l, 28, 0.95, 0.85),
                c3: shiftHsl(main.h, main.s, main.l, -22, 0.9, 0.9), c4: shiftHsl(main.h, main.s, main.l, 12, 1.05, 0.75),
                base1: rgbToHex(...hslToRgb(main.h, Math.min(0.25, main.s * 0.35), 0.05)),
                base2: rgbToHex(...hslToRgb(main.h + 20, Math.min(0.2, main.s * 0.3), 0.03)), isLight: false
            };
        }
        const c2 = colors[1]?.hex || shiftHsl(h, s, l, 35, 0.95, 0.9);
        const [h2, s2, l2] = rgbToHsl(...hexToRgb(c2));
        return {
            c1: p.hex, c2, c3: colors[2]?.hex || shiftHsl(h, s, l, -30, 0.9, 0.95),
            c4: colors[2] ? rgbToHex(...hslToRgb((h + colors[1].h) / 2, Math.min(1, (s + colors[1].s) / 2), Math.min(0.6, (l + colors[1].l) / 2))) : shiftHsl(colors[1]?.h ?? h, colors[1]?.s ?? s, colors[1]?.l ?? l, colors[1] ? -25 : 15, colors[1] ? 0.95 : 1.05, colors[1] ? 1.05 : 1.1),
            base1: rgbToHex(...hslToRgb(h, Math.min(0.7, s * 1.1), Math.max(0.18, Math.min(0.35, l * 0.7)))),
            base2: rgbToHex(...hslToRgb(h2, Math.min(0.65, s2), Math.max(0.14, Math.min(0.3, l2 * 0.6)))), isLight: false
        };
    }

    const setCssVars = (el, vars) => { for (const k in vars) el.style.setProperty(k, vars[k]); };
    const applyColorsToLayer = (layer, p) => layer && setCssVars(layer, {
        "--ag-blob-1": p.c1, "--ag-blob-2": p.c2, "--ag-blob-3": p.c3, "--ag-blob-4": p.c4,
        "--ag-base-1": p.base1, "--ag-base-2": p.base2
    });

    // =========================================================
    // RESOLUCIÓN Y DESCARGA DE IMÁGENES
    // =========================================================
    function normalizeImageUrl(url) {
        if (!url || typeof url !== "string") return "";
        const u = url.trim();
        if (u.startsWith("spotify:image:")) return `https://i.scdn.co/image/${u.slice(14)}`;
        if (/^[0-9a-fA-F]{40}$/.test(u)) return `https://i.scdn.co/image/${u}`;
        if (u.startsWith("http://")) return `https://${u.slice(7)}`;
        return u;
    }

    function extractColorsFromImage(url) {
        if (!url) return Promise.resolve(FALLBACK_PALETTE);
        if (paletteCache.has(url)) return Promise.resolve(paletteCache.get(url));

        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            let retried = false;
            const timer = setTimeout(() => done(FALLBACK_PALETTE), 2500);
            const done = (colors) => {
                clearTimeout(timer);
                img.onload = img.onerror = null;
                if (paletteCache.size >= PALETTE_CACHE_MAX) paletteCache.delete(paletteCache.keys().next().value);
                paletteCache.set(url, colors);
                resolve(colors);
            };
            img.onload = () => {
                try {
                    const c = analyzeCover(img);
                    done(c?.length ? c : FALLBACK_PALETTE);
                } catch { done(FALLBACK_PALETTE); }
            };
            img.onerror = () => {
                if (!retried && url.startsWith("http")) {
                    retried = true;
                    img.src = `${url}${url.includes("?") ? "&" : "?"}ag_bust=${Date.now()}`;
                } else done(FALLBACK_PALETTE);
            };
            img.src = url;
        });
    }

    // =========================================================
    // CSS ESTÁTICO COMPACTO
    // =========================================================
    const GLASS_CSS = `
        :root {
            --ag-color-primary: #fff; --ag-color-secondary: #888; --ag-color-tertiary: #555;
            --ag-color-accent: #fff; --ag-color-dark: #06070a; --ag-color-light: #fff;
            --dynamic-play-btn-bg: #1ed760; --dynamic-play-btn-bg-hover: #3be477; --dynamic-play-btn-bg-active: #1abc54;
            --dynamic-play-btn-fg: #000; --dynamic-play-btn-glow: rgba(30,215,96,0.4);
            --section-background-base: rgba(255,255,255,0.08); --background-elevated-base: rgba(255,255,255,0.08);
        }
        html.ag-light-theme {
            --ag-glass-card-bg: rgba(255,255,255,0.65); --ag-glass-card-border: rgba(0,0,0,0.08);
            --ag-glass-card-shadow: 0 8px 30px rgba(0,0,0,0.06); --ag-btn-bg: rgba(0,0,0,0.05);
            --ag-btn-border: rgba(0,0,0,0.1); --ag-btn-fg: #14171c; --ag-btn-hover: rgba(0,0,0,0.09);
            --ag-text-shadow: none; --section-background-base: rgba(255,255,255,0.65); --background-elevated-base: rgba(255,255,255,0.65);
        }
        html:not(.ag-light-theme) {
            --ag-glass-card-bg: rgba(255,255,255,0.08); --ag-glass-card-border: rgba(255,255,255,0.14);
            --ag-glass-card-shadow: none; --ag-btn-bg: rgba(255,255,255,0.08); --ag-btn-border: rgba(255,255,255,0.12);
            --ag-btn-fg: #fff; --ag-btn-hover: rgba(255,255,255,0.16); --ag-text-shadow: 0 1px 3px rgba(0,0,0,0.6);
        }
        #apple-glass-backdrop {
            position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
            z-index: -1 !important; pointer-events: none !important; overflow: hidden !important;
            background-color: var(--ag-base-1, #1e2532) !important;
            transition: background-color 2.0s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .apple-glass-mesh {
            position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important;
            opacity: 0; pointer-events: none !important; overflow: hidden !important;
            transition: opacity 2.0s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .apple-glass-mesh.active { opacity: 1 !important; }
        .apple-glass-base {
            position: absolute !important; inset: -15% !important; width: 130% !important; height: 130% !important;
            background: linear-gradient(135deg, var(--ag-base-1, #1e2532) 0%, var(--ag-base-2, #161c26) 100%) !important;
            animation: ag-base-drift 45s ease-in-out infinite alternate !important;
            will-change: transform !important;
        }
        .apple-glass-blob {
            position: absolute !important; border-radius: 43% 57% 68% 32% / 44% 48% 52% 56% !important; will-change: transform !important;
            pointer-events: none !important; filter: blur(50px) !important;
            -webkit-filter: blur(50px) !important; opacity: 0.92 !important;
        }
        .blob-1 { width: 85vw !important; height: 85vw !important; min-width: 700px !important; min-height: 700px !important; top: -15% !important; left: -10% !important; background: radial-gradient(ellipse 65% 55% at 38% 38%, var(--ag-blob-1, #3a4a58) 0%, transparent 72%) !important; animation: ag-fluid-drift-1 32s linear infinite !important; }
        .blob-2 { width: 90vw !important; height: 90vw !important; min-width: 750px !important; min-height: 750px !important; bottom: -20% !important; right: -12% !important; background: radial-gradient(ellipse 55% 65% at 62% 62%, var(--ag-blob-2, #24303c) 0%, transparent 72%) !important; animation: ag-fluid-drift-2 40s linear infinite !important; }
        .blob-3 { width: 80vw !important; height: 80vw !important; min-width: 650px !important; min-height: 650px !important; top: 10% !important; right: -8% !important; background: radial-gradient(ellipse 60% 50% at 58% 38%, var(--ag-blob-3, #1e2530) 0%, transparent 70%) !important; animation: ag-fluid-drift-3 28s linear infinite !important; }
        .blob-4 { width: 80vw !important; height: 80vw !important; min-width: 650px !important; min-height: 650px !important; bottom: 5% !important; left: 10% !important; background: radial-gradient(ellipse 50% 60% at 42% 62%, var(--ag-blob-4, #2d3b4a) 0%, transparent 70%) !important; animation: ag-fluid-drift-4 36s linear infinite !important; }

        @keyframes ag-base-drift { 0% { transform: scale(1) rotate(0deg); } 50% { transform: scale(1.08) rotate(5deg); } 100% { transform: scale(1) rotate(0deg); } }
        @keyframes ag-fluid-drift-1 { 0% { transform: translate3d(0,0,0) scale(1) rotate(0deg); } 33% { transform: translate3d(20vw,14vh,0) scale(1.18) rotate(120deg); } 66% { transform: translate3d(-14vw,18vh,0) scale(0.90) rotate(240deg); } 100% { transform: translate3d(0,0,0) scale(1) rotate(360deg); } }
        @keyframes ag-fluid-drift-2 { 0% { transform: translate3d(0,0,0) scale(1) rotate(0deg); } 33% { transform: translate3d(-22vw,-16vh,0) scale(1.20) rotate(-120deg); } 66% { transform: translate3d(16vw,-18vh,0) scale(0.92) rotate(-240deg); } 100% { transform: translate3d(0,0,0) scale(1) rotate(-360deg); } }
        @keyframes ag-fluid-drift-3 { 0% { transform: translate3d(0,0,0) scale(1) rotate(0deg); } 33% { transform: translate3d(-18vw,18vh,0) scale(1.22) rotate(120deg); } 66% { transform: translate3d(18vw,-12vh,0) scale(0.88) rotate(240deg); } 100% { transform: translate3d(0,0,0) scale(1) rotate(360deg); } }
        @keyframes ag-fluid-drift-4 { 0% { transform: translate3d(0,0,0) scale(1) rotate(0deg); } 33% { transform: translate3d(22vw,-16vh,0) scale(1.16) rotate(-120deg); } 66% { transform: translate3d(-16vw,14vh,0) scale(0.92) rotate(-240deg); } 100% { transform: translate3d(0,0,0) scale(1) rotate(-360deg); } }

        /* Neutralización de superficies y cabeceras */
        .NG0KBybUCTo8_SxXHF3N, .dlCd0Cz0sESYGOnuo02M, .aFTT7HhSi7nKw___DYTw,
        .main-topBar-background, .main-topBar-overlay, [data-testid="topbar-content"],
        [class*="_ddPhxHd"], [class*="homeHeader"], [class*="filterChipsSection"], [class*="filterChipsContainer"],
        [data-testid="home-page"] header, [data-testid="home-page"] section, [data-testid="home-page"] > div:first-child,
        .main-home-content > div:first-child, [class*="Xx4EJR6"],
        [data-testid="entity-header"], [class*="kIjnr4D"], [class*="bPcrYUu"], [class*="JMFvw2x"], [class*="PscUzLM"],
        [class*="f17nuQT"], [class*="S8yZmsp"], [class*="AJoN_5g"], [class*="ob4NiMt"],
        [data-testid="action-bar"], [class*="BXKA2bj"], [class*="OM0l0iF"],
        [data-testid="playlist-page"] header, [data-testid="playlist-page"] section,
        [class*="dpvvf5a"], [class*="dDboNBn"] [class*="DsFeJup"], [class*="dDboNBn"] [class*="ovkJ5tt"],
        [class*="dDboNBn"] [class*="OxcpGT"], [class*="DsFeJup"], [class*="ovkJ5tt"],
        [class*="f8pB2G"]:before, [class*="Vsq7_1E"]:before, [class*="Vsq7_1E"]:after, [class*="fytmd2Z"] {
            background: transparent !important; background-color: transparent !important;
            background-image: none !important; box-shadow: none !important; border: none !important;
        }

        /* Eliminación de degradados superpuestos */
        [class*="V7ICuEr"], [class*="QqprhKqw"], [class*="huL1DwM"], [class*="Zsz_4Iz"],
        [class*="wT74N9"], [class*="xWAGb7r"], [class*="OAo3bua"], .AJjP1RzhySWiLWVcLlNA,
        [class*="sxMpFt1"], [class*="oCSWtOA"], [class*="SAZo2_Z"], [data-testid="action-bar-background"],
        [class*="a7UoWEK"]:after, .main-nowPlayingView-lyricsGradient, [class*="lyricsGradient"] {
            display: none !important; background: transparent !important; background-image: none !important;
        }

        /* Tarjetas de cristal y atajos */
        [class*="homeShortcutsGrid-shortcut"], [data-testid="shortcut-item"],
        [class*="dDboNBn"], [class*="lENE6dl"], [class*="J3VbJY8"], [class*="XqTI1G"],
        [class*="lyricsPreview"], .main-nowPlayingView-lyricsContent, .main-nowPlayingView-lyricsContainer,
        .main-nowPlayingView-section, .main-nowPlayingView-artistCard {
            --lyrics-color-background: transparent !important;
            --section-background-base: var(--ag-glass-card-bg, rgba(255,255,255,0.08)) !important;
            background: var(--ag-glass-card-bg, rgba(255,255,255,0.08)) !important;
            border: 1px solid var(--ag-glass-card-border, rgba(255,255,255,0.14)) !important;
            border-radius: 12px !important; box-shadow: var(--ag-glass-card-shadow, none) !important;
            backdrop-filter: blur(14px) !important; -webkit-backdrop-filter: blur(14px) !important;
            transition: background-color 2.0s cubic-bezier(0.4, 0, 0.2, 1), border-color 2.0s ease, transform 0.15s ease !important;
        }
        [class*="homeShortcutsGrid-shortcut"]:hover, [data-testid="shortcut-item"]:hover {
            background: var(--ag-btn-hover, rgba(255,255,255,0.16)) !important; transform: scale(1.02) !important;
        }

        /* Barra inferior: visibilidad de título y artista */
        [data-testid="now-playing-widget"], [class*="XQslIrb"], [class*="nuY09Vy"], [class*="bYH9fSP"],
        .main-nowPlayingWidget-trackInfo, .main-trackInfo-container {
            display: flex !important; visibility: visible !important; opacity: 1 !important; min-width: 120px !important;
        }
        [class*="P8ca1Sh"], [class*="Cno7x2m"], [class*="RhtvF97"], [class*="marquee"],
        [data-encore-id="text"] span, [data-testid="now-playing-widget"] * {
            mask: none !important; -webkit-mask: none !important; mask-image: none !important; -webkit-mask-image: none !important;
        }
        [data-testid="now-playing-widget"] [data-testid="context-item-info-title"],
        [data-testid="now-playing-widget"] [data-testid="context-item-info-title"] *,
        [data-testid="now-playing-widget"] [data-testid="context-item-link"],
        [class*="UxJZcpi"] *, .main-trackInfo-name *, [data-testid="nowplaying-track-link"],
        .main-nowPlayingWidget-nowPlaying [data-encore-id="text"] {
            color: var(--dynamic-text-color, #fff) !important; font-size: 14px !important; font-weight: 700 !important;
            line-height: 1.3 !important; text-shadow: var(--ag-text-shadow, 0 1px 3px rgba(0,0,0,0.6)) !important;
            transition: color 2.0s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        [data-testid="now-playing-widget"] [data-testid="context-item-info-artist"],
        [data-testid="now-playing-widget"] [data-testid="context-item-info-artist"] *,
        [class*="yPuQIWy"] *, .main-trackInfo-artists *, .main-nowPlayingWidget-nowPlaying .encore-internal-color-text-subdued a {
            color: var(--dynamic-text-color-subdued, rgba(255,255,255,0.75)) !important; font-size: 12px !important;
            font-weight: 500 !important; text-shadow: var(--ag-text-shadow, 0 1px 2px rgba(0,0,0,0.5)) !important;
            transition: color 2.0s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }

        /* Letras: tipografía dinámica y scroll ultra fluido */
        @keyframes agLyricsFadeOut { 0% { opacity: 1; filter: blur(0px); transform: translateY(0) scale(1); } 100% { opacity: 0; filter: blur(8px); transform: translateY(6px) scale(0.98); } }
        @keyframes agLyricsFadeIn { 0% { opacity: 0; filter: blur(8px); transform: translateY(6px) scale(0.98); } 100% { opacity: 1; filter: blur(0px); transform: translateY(0) scale(1); } }
        .ag-lyrics-fade-out { animation: agLyricsFadeOut 0.35s cubic-bezier(0.4, 0, 0.2, 1) forwards !important; pointer-events: none !important; }
        .ag-lyrics-fade-in { animation: agLyricsFadeIn 0.75s cubic-bezier(0.16, 1, 0.3, 1) forwards !important; }

        .main-nowPlayingView-lyricsContent *, [class*="lyricsContent"] *, [class*="lyricsPreview"] *,
        .lyrics-lyricsContainer-LyricsLine, [data-testid="lyrics-container"] * { mask: none !important; -webkit-mask: none !important; }

        .lyrics-lyricsContent-active, [class*="lyricsContent-active"], [class*="LyricsLine--active"], [data-testid="lyrics-active-line"] {
            color: var(--dynamic-text-color, #fff) !important; opacity: 1 !important; transform: scale(1.025) !important; transform-origin: left center !important;
            text-shadow: 0 0 16px rgba(var(--dynamic-text-color-rgb, 255, 255, 255), 0.50), var(--ag-text-shadow, 0 1px 4px rgba(0,0,0,0.7)) !important;
            transition: opacity 0.6s cubic-bezier(0.25, 1, 0.5, 1), transform 0.6s ease, color 0.6s ease !important; cursor: pointer !important;
        }
        .lyrics-lyricsContent-lyric:not(.lyrics-lyricsContent-active), [class*="LyricsLine--inactive"], [class*="LyricsLine--passed"],
        .lyrics-lyricsContainer-LyricsLine:not(.lyrics-lyricsContent-active) {
            color: var(--dynamic-text-color-subdued, rgba(255,255,255,0.75)) !important; opacity: 0.45 !important;
            transform: scale(1.0) !important; transform-origin: left center !important;
            text-shadow: var(--ag-text-shadow, 0 1px 3px rgba(0,0,0,0.5)) !important;
            transition: opacity 0.6s cubic-bezier(0.25, 1, 0.5, 1), transform 0.6s ease, color 0.6s ease !important; cursor: pointer !important;
        }
        .lyrics-lyricsContent-lyric:not(.lyrics-lyricsContent-active):hover, [class*="LyricsLine--inactive"]:hover {
            opacity: 0.85 !important; transform: scale(1.01) !important; transition: opacity 0.25s ease !important;
        }

        /* Botón de play y acentos interactivos */
        html body button[data-encore-id="buttonPrimary"], html body .main-playButton-primary,
        html body [data-testid="play-button"], html body button[data-testid="control-button-playpause"] {
            background-color: var(--dynamic-play-btn-bg) !important; border-color: var(--dynamic-play-btn-bg) !important;
            box-shadow: 0 4px 18px var(--dynamic-play-btn-glow) !important;
            transition: background-color 2.0s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 2.0s ease, transform 0.15s ease !important;
        }
        html body button[data-encore-id="buttonPrimary"] *, html body .main-playButton-primary *,
        html body [data-testid="play-button"] *, html body button[data-testid="control-button-playpause"] * {
            color: var(--dynamic-play-btn-fg, #000) !important; fill: var(--dynamic-play-btn-fg, #000) !important;
            transition: color 2.0s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }

        /* Tipografía dinámica general */
        :root, .encore-dark-theme, .encore-dark-theme .encore-base-set {
            --text-base: var(--dynamic-text-color, #fff) !important;
            --text-subdued: var(--dynamic-text-color-subdued, rgba(255,255,255,0.75)) !important;
            --spice-text: var(--dynamic-text-color, #fff) !important;
            --spice-subtext: var(--dynamic-text-color-subdued, rgba(255,255,255,0.75)) !important;
            --lyrics-color-active: var(--dynamic-text-color, #fff) !important;
            --lyrics-color-inactive: rgba(var(--dynamic-text-color-rgb, 255, 255, 255), 0.50) !important;
            --lyrics-color-passed: rgba(var(--dynamic-text-color-rgb, 255, 255, 255), 0.75) !important;
        }
        .main-trackList-rowTitle, [data-testid="internal-track-link"], h1, h2, h3, [data-testid="entity-title"] {
            color: var(--dynamic-text-color, #fff) !important; text-shadow: var(--ag-text-shadow, 0 1px 3px rgba(0,0,0,0.6)) !important;
            transition: color 2.0s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .main-trackList-rowSubTitle, .main-trackList-rowSubTitle a, [data-testid="playback-position"], [data-testid="playback-duration"] {
            color: var(--dynamic-text-color-subdued, rgba(255,255,255,0.75)) !important;
            transition: color 2.0s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        html.ag-light-theme [data-encore-id="icon"], html.ag-light-theme .player-controls button:not([data-encore-id="buttonPrimary"]) {
            color: var(--dynamic-text-color-subdued, rgba(20, 23, 28, 0.70)) !important;
            fill: var(--dynamic-text-color-subdued, rgba(20, 23, 28, 0.70)) !important;
        }
    `;

    // =========================================================
    // INYECCIÓN DOM
    // =========================================================
    function createMeshHtml(id, isActive) {
        return `<div id="${id}" class="apple-glass-mesh ${isActive ? "active" : ""}">
            <div class="apple-glass-base"></div>
            <div class="apple-glass-blob blob-1"></div><div class="apple-glass-blob blob-2"></div>
            <div class="apple-glass-blob blob-3"></div><div class="apple-glass-blob blob-4"></div>
        </div>`;
    }

    function initDOM() {
        let style = document.getElementById("apple-glass-styles");
        if (!style) {
            style = document.createElement("style");
            style.id = "apple-glass-styles";
            document.head.appendChild(style);
        }
        style.textContent = GLASS_CSS;

        let backdrop = document.getElementById("apple-glass-backdrop");
        if (!backdrop) {
            backdrop = document.createElement("div");
            backdrop.id = "apple-glass-backdrop";
            backdrop.innerHTML = createMeshHtml("apple-glass-mesh-1", true) + createMeshHtml("apple-glass-mesh-2", false);
            document.body.prepend(backdrop);
        } else if (!backdrop.querySelector(".apple-glass-blob")) {
            backdrop.innerHTML = createMeshHtml("apple-glass-mesh-1", true) + createMeshHtml("apple-glass-mesh-2", false);
        }
        backdropElement = backdrop;
        applyColorsToRoot(FALLBACK_PALETTE);
    }

    // =========================================================
    // DETECCIÓN DE CARÁTULA ACTIVA
    // =========================================================
    function extractImgSrc(img) {
        if (!img) return "";
        const src = /** @type {HTMLImageElement} */ (img).currentSrc || /** @type {HTMLImageElement} */ (img).src;
        if (!src || src.startsWith("data:") || src.includes("equaliser")) return "";
        const norm = normalizeImageUrl(src);
        return ((norm.includes("scdn.co") || norm.includes("spotifycdn.com") || norm.startsWith("http") || norm.startsWith("blob:")) &&
            !norm.includes("avatar") && !norm.includes("user")) ? norm : "";
    }

    function getBestCoverUrl() {
        const item = Spicetify.Player?.data?.item;
        if (item) {
            const m = item.metadata || {};
            const url = m.image_xlarge_url || m.image_large_url || m.image_url || m.cover_art_url || m.album_art_url || m.image_small_url || item.images?.[0]?.url || item.album?.images?.[0]?.url;
            const norm = normalizeImageUrl(url);
            if (norm) return norm;
        }

        const sel = '.main-nowPlayingWidget-coverArt img, .main-nowPlayingView-coverArt img, [data-testid="now-playing-widget"] img, .main-nowPlayingBar-left img, [data-testid="CoverSlotExpanded__container"] img, .main-coverSlotCollapsed-container img, [data-testid="playlist-page"] [data-testid="entity-image"] img, [data-testid="entity-header"] img, .main-entityHeader-image img, .main-entityHeader-container img, [data-testid="cover-art-image"]';
        for (const img of document.querySelectorAll(sel)) {
            const src = extractImgSrc(img);
            if (src) return src;
        }
        return "";
    }

    // =========================================================
    // APLICACIÓN DE COLORES
    // =========================================================
    function applyColorsToRoot(colors) {
        if (!colors?.length) return;
        const primary = colors[0], palette = computeBlobPalette(colors);
        const btn = computeButtonColors(colors), txt = computeDynamicTextColor(colors, !!palette.isLight);
        const rgbBtn = hexToRgb(btn.bg).join(", ");

        if (_applyRafId) cancelAnimationFrame(_applyRafId);

        _applyRafId = requestAnimationFrame(() => {
            _applyRafId = null;
            document.documentElement.classList.toggle("ag-light-theme", !!palette.isLight);

            setCssVars(document.documentElement, {
                "--dynamic-play-btn-bg": btn.bg, "--dynamic-play-btn-bg-hover": btn.bgHover, "--dynamic-play-btn-bg-active": btn.bgActive,
                "--dynamic-play-btn-fg": btn.fg, "--dynamic-play-btn-glow": btn.glow,
                "--ag-color-primary": primary.hex, "--dynamic-album-vibrant": btn.bg,
                "--dynamic-album-vibrant-rgb": `${primary.r}, ${primary.g}, ${primary.b}`, "--dynamic-album-vibrant-glow": btn.glow,
                "--spice-button": btn.bg, "--spice-button-active": btn.bgActive, "--spice-tab-active": btn.bg,
                "--spice-rgb-button": rgbBtn,
                "--dynamic-text-color": txt.primary, "--dynamic-text-color-subdued": txt.subdued,
                "--dynamic-text-color-rgb": txt.rgb, "--dynamic-text-color-subdued-rgb": txt.subduedRgb,
                "--text-base": txt.primary, "--text-subdued": txt.subdued,
                "--spice-text": txt.primary, "--spice-subtext": txt.subdued,
                "--spice-rgb-text": txt.rgb, "--spice-rgb-subtext": txt.subduedRgb,
                "--lyrics-color-active": txt.primary, "--lyrics-color-inactive": `rgba(${txt.rgb}, 0.5)`, "--lyrics-color-passed": `rgba(${txt.rgb}, 0.75)`,
                "--dynamic-album-light": palette.c4, "--ag-base-1": palette.base1, "--ag-base-2": palette.base2
            });

            if (backdropElement) setCssVars(backdropElement, { "--ag-base-1": palette.base1, "--ag-base-2": palette.base2 });

            const curr = document.getElementById(`apple-glass-mesh-${activeMeshIndex}`);
            const nextIdx = activeMeshIndex === 1 ? 2 : 1;
            const next = document.getElementById(`apple-glass-mesh-${nextIdx}`);
            if (curr && next) {
                applyColorsToLayer(next, palette);
                next.classList.add("active");
                curr.classList.remove("active");
                activeMeshIndex = nextIdx;
            } else if (curr) {
                applyColorsToLayer(curr, palette);
                curr.classList.add("active");
            }
        });
    }

    // =========================================================
    // ACTUALIZACIÓN SECUENCIAL SIN CONDICIONES DE CARRERA
    // =========================================================
    async function updateCoverAndColors(force = false) {
        const coverUrl = getBestCoverUrl();

        if (!coverUrl) {
            if (activeCoverUrl !== "") {
                activeCoverUrl = "";
                activeUpdateId++;
                applyColorsToRoot(FALLBACK_PALETTE);
            }
            return;
        }

        if (coverUrl === activeCoverUrl && !force) return;

        const updateId = ++activeUpdateId;
        activeCoverUrl = coverUrl;

        try {
            const colors = await extractColorsFromImage(coverUrl);
            if (updateId !== activeUpdateId) return;
            applyColorsToRoot(colors);
        } catch (err) {
            if (updateId === activeUpdateId) applyColorsToRoot(FALLBACK_PALETTE);
        }
    }

    // =========================================================
    // CROSSFADE DE LETRAS
    // =========================================================
    const LYRICS_SEL = '[data-testid="lyrics-container"], .main-nowPlayingView-lyricsContent, [class*="lyricsContent"], [class*="lyricsPreview"]';
    let lyricsCrossTimer = null, lyricsCleanTimer = null;

    function triggerLyricsCrossfade() {
        if (lyricsCrossTimer) clearTimeout(lyricsCrossTimer);
        if (lyricsCleanTimer) clearTimeout(lyricsCleanTimer);
        const els = document.querySelectorAll(LYRICS_SEL);
        if (!els.length) return;

        els.forEach(el => { el.classList.remove("ag-lyrics-fade-in"); el.classList.add("ag-lyrics-fade-out"); });
        lyricsCrossTimer = setTimeout(() => {
            document.querySelectorAll(LYRICS_SEL).forEach(el => { el.classList.remove("ag-lyrics-fade-out"); el.classList.add("ag-lyrics-fade-in"); });
            lyricsCrossTimer = null;
            lyricsCleanTimer = setTimeout(() => {
                document.querySelectorAll(LYRICS_SEL).forEach(el => el.classList.remove("ag-lyrics-fade-in"));
                lyricsCleanTimer = null;
            }, 800);
        }, 380);
    }

    // =========================================================
    // INICIALIZACIÓN Y EVENTOS
    // =========================================================
    initDOM();
    updateCoverAndColors();

    if (Spicetify.Player && !listenersAttached) {
        listenersAttached = true;
        let songTimer = null;
        Spicetify.Player.addEventListener("songchange", () => {
            triggerLyricsCrossfade();
            updateCoverAndColors();
            clearTimeout(songTimer);
            songTimer = setTimeout(() => updateCoverAndColors(), 250);
        });
        Spicetify.Player.addEventListener("onplaypause", () => setTimeout(() => updateCoverAndColors(), 80));
    }

    if (Spicetify.Platform?.History && !historyAttached) {
        historyAttached = true;
        let histTimer = null;
        Spicetify.Platform.History.listen(() => {
            clearTimeout(histTimer);
            histTimer = setTimeout(() => updateCoverAndColors(), 200);
        });
    }

    setInterval(() => { if (!document.hidden) updateCoverAndColors(); }, 3000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) updateCoverAndColors(); }, { passive: true });

    console.log("[AppleGlass] Fondo ambiental líquido Apple Glass activo.");
})();
