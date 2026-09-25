(function() {
    const PROTOCOL_VERSION = 2;
    const MARK = "mrb-bridge";
    const SITE_ORIGINS = [];
    const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
    const ALLOW_DEV_ORIGIN = false;
    const originAllowed = origin => ALLOW_DEV_ORIGIN && DEV_ORIGIN.test(String(origin || "")) || SITE_ORIGINS.includes(origin);
    const TYPES = {
        site: [ "BRIDGE_HELLO", "BRIDGE_SEND", "BRIDGE_PULL", "BRIDGE_CONFIRM", "BRIDGE_TEXTURES" ],
        ext: [ "BRIDGE_STATUS", "BRIDGE_PROGRESS", "BRIDGE_ROSTER", "BRIDGE_DONE", "BRIDGE_FAIL", "BRIDGE_TEXTURES_RESULT" ]
    };
    const TEXTURE_CDN = /^https:\/\/cdn\.mcr\.ea\.com\/[^\s]*$/;
    const TEXTURE_MAX_URLS = 40;
    const TEXTURE_TIMEOUT_MS = 5e3;
    function textureVerdict(url) {
        if (typeof url !== "string" || url.length > 2048 || !TEXTURE_CDN.test(url)) return "refused";
        if (typeof URL === "function") {
            try {
                if (new URL(url).origin !== "https://cdn.mcr.ea.com") return "refused";
            } catch (e) {
                return "refused";
            }
        }
        return "fetch";
    }
    const message = (dir, type, payload) => ({
        mark: MARK,
        v: PROTOCOL_VERSION,
        dir: dir,
        type: type,
        payload: payload || {}
    });
    function accept(data, origin, expectDir) {
        if (!originAllowed(origin)) return {
            drop: true
        };
        if (!data || typeof data !== "object" || data.mark !== MARK) return {
            drop: true
        };
        if (data.dir !== expectDir) return {
            drop: true
        };
        if (data.v !== PROTOCOL_VERSION) {
            return {
                error: `bridge protocol version mismatch; the other side speaks v${data.v ?? "?"}, ` + `this side v${PROTOCOL_VERSION}. Update the older one (extension: reload it from GitHub; ` + `site: hard-reload the page) and try again.`
            };
        }
        if (!TYPES[expectDir] || !TYPES[expectDir].includes(data.type)) {
            return {
                error: `unknown bridge message "${String(data.type).slice(0, 40)}"`
            };
        }
        const payload = data.payload && typeof data.payload === "object" ? data.payload : {};
        if (data.type === "BRIDGE_SEND" && (!payload.buildFile || typeof payload.buildFile !== "object")) {
            return {
                error: "BRIDGE_SEND carries no build-file"
            };
        }
        if (data.type === "BRIDGE_TEXTURES") {
            if (!Array.isArray(payload.urls) || !payload.urls.length) {
                return {
                    error: "BRIDGE_TEXTURES carries no image URLs"
                };
            }
            if (payload.urls.length > TEXTURE_MAX_URLS) {
                return {
                    error: `BRIDGE_TEXTURES asks for ${payload.urls.length} images; at most ${TEXTURE_MAX_URLS} go in one request`
                };
            }
        }
        return {
            msg: {
                type: data.type,
                payload: payload
            }
        };
    }
    const API = {
        PROTOCOL_VERSION: PROTOCOL_VERSION,
        MARK: MARK,
        TYPES: TYPES,
        SITE_ORIGINS: SITE_ORIGINS,
        originAllowed: originAllowed,
        message: message,
        accept: accept,
        TEXTURE_MAX_URLS: TEXTURE_MAX_URLS,
        TEXTURE_TIMEOUT_MS: TEXTURE_TIMEOUT_MS,
        textureVerdict: textureVerdict
    };
    const G = typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : globalThis;
    G.CFB27BridgeProtocol = API;
    if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
