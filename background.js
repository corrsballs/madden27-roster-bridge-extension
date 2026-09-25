importScripts("tb-urls.js");

self.window = self;

importScripts("shared/bridge-protocol.js", "shared/template-mode.js", "shared/uniform-bank.js", "shared/build-file.js", "courier.js");

const KEY_URLS = "mrb.urls";

const KEY_PAGES = "mrb.pages";

const KEY_PUSH = "mrb.push";

const KEY_STATUS = "mrb.status";

const MAX_URLS = 40;

const MAX_PAGES = 40;

const DEBUGGER_VERSION = "1.3";

const DETACH_AFTER_SERVE_MS = 2e4;

const DETACH_IF_UNUSED_MS = 45e3;

const DETACH_RETRY_MS = 1e3;

const DETACH_MAX_RETRIES = 30;

const attached = new Set;

const unusedTimers = new Map;

const pausedRequests = new Map;

const pausedCountFor = tabId => {
    let n = 0;
    for (const owner of pausedRequests.values()) if (owner === tabId) n += 1;
    return n;
};

const stagedByTab = new Map;

function stagedMap(value) {
    if (!value || typeof value !== "object" || typeof value.url === "string") return {};
    return value;
}

async function readStaged(tabId) {
    if (stagedByTab.has(tabId)) return stagedByTab.get(tabId);
    const record = stagedMap(await read(KEY_PUSH, {}))[String(tabId)] || null;
    if (record) stagedByTab.set(tabId, record);
    return record;
}

async function persistStaged(tabId, record) {
    const all = stagedMap(await read(KEY_PUSH, {}));
    if (record) all[String(tabId)] = record; else delete all[String(tabId)];
    await write(KEY_PUSH, all);
}

async function clearStaged(tabId) {
    stagedByTab.delete(tabId);
    await persistStaged(tabId, null);
}

async function read(key, fallback) {
    const data = await chrome.storage.local.get(key);
    return data[key] === undefined ? fallback : data[key];
}

const write = (key, value) => chrome.storage.local.set({
    [key]: value
});

async function setStatus(patch) {
    const current = await read(KEY_STATUS, {});
    await write(KEY_STATUS, {
        ...current,
        ...patch,
        updatedAt: Date.now()
    });
}

function assetKey(url) {
    try {
        const match = new URL(url).pathname.match(/^\/(\d+)\/bundles-users\/([^/]+)\/([^/]+)\//i);
        return match ? `${match[1]}/${match[2]}/${match[3]}` : "";
    } catch {
        return "";
    }
}

function teamIdFromUrl(url) {
    try {
        const match = new URL(url).pathname.match(TEAM_PAGE);
        return match ? match[1] : "";
    } catch {
        return "";
    }
}

async function rememberUrl(payload) {
    if (!ROSTER_JSON.test(payload?.url || "")) return;
    const urls = await read(KEY_URLS, []);
    const entry = {
        url: payload.url,
        assetKey: assetKey(payload.url),
        teamId: payload.teamId || "",
        pageUrl: payload.pageUrl || "",
        title: payload.title || "",
        seenAt: payload.seenAt || Date.now()
    };
    const prior = urls.find(item => item.url === entry.url);
    if (prior && prior.teamId) entry.teamId = prior.teamId;
    const deduped = urls.filter(item => item.url !== entry.url);
    await write(KEY_URLS, [ entry, ...deduped ].slice(0, MAX_URLS));
}

async function rememberPage(payload, sender) {
    const tabId = sender?.tab?.id;
    if (typeof tabId !== "number" || !payload?.teamId) return;
    const pages = await read(KEY_PAGES, {});
    pages[String(tabId)] = {
        tabId: tabId,
        ...payload,
        seenAt: payload.seenAt || Date.now()
    };
    const keys = Object.keys(pages);
    if (keys.length > MAX_PAGES) {
        keys.sort((a, b) => (pages[b].seenAt || 0) - (pages[a].seenAt || 0));
        for (const stale of keys.slice(MAX_PAGES)) delete pages[stale];
    }
    await write(KEY_PAGES, pages);
}

const looksLikeTeamBuilder = url => TEAM_BUILDER_PAGE.test(url || "");

async function liveTeamBuilderTabs() {
    let tabs = [];
    try {
        tabs = await chrome.tabs.query({
            url: TEAM_BUILDER_MATCH
        });
    } catch {}
    if (!tabs.length) {
        try {
            const all = await chrome.tabs.query({});
            tabs = all.filter(tab => looksLikeTeamBuilder(tab.url));
        } catch {}
    }
    return tabs.filter(tab => typeof tab.id === "number").map(tab => ({
        tabId: tab.id,
        teamId: teamIdFromUrl(tab.url || ""),
        pageUrl: tab.url || "",
        title: tab.title || "",
        active: Boolean(tab.active),
        lastAccessed: Number(tab.lastAccessed) || 0
    }));
}

async function pickTeamBuilderTab(preferTeamId = "") {
    const tabs = await liveTeamBuilderTabs();
    if (!tabs.length) return null;
    if (preferTeamId) {
        const mine = tabs.filter(tab => tab.teamId === preferTeamId);
        if (mine.length) return mine.find(tab => tab.active) || mine[0];
        if (tabs.length > 1) {
            const shown = tabs.map(tab => tab.teamId || "(no team in URL)").join(", ");
            throw new Error(`That roster belongs to team ${preferTeamId}, but no open Team Builder tab is ` + `showing it (open tabs: ${shown}). Open that team and try again.`);
        }
    }
    const withTeam = tabs.filter(tab => tab.teamId);
    const pool = withTeam.length ? withTeam : tabs;
    return pool.find(tab => tab.active) || pool.sort((a, b) => b.lastAccessed - a.lastAccessed)[0];
}

async function teamIdForUrl(url) {
    const key = assetKey(url);
    const urls = await read(KEY_URLS, []);
    const hit = urls.find(entry => entry.url === url) || key && urls.find(entry => entry.assetKey === key);
    return hit?.teamId || "";
}

async function rescanActiveTab() {
    const tab = await pickTeamBuilderTab();
    if (!tab) return null;
    try {
        await chrome.tabs.sendMessage(tab.tabId, {
            type: "TB_RESCAN"
        });
        await new Promise(resolve => setTimeout(resolve, 200));
    } catch {}
    return tab;
}

async function candidateUrls() {
    const [urls, tab] = await Promise.all([ read(KEY_URLS, []), pickTeamBuilderTab() ]);
    const sorted = [ ...urls ].sort((a, b) => {
        const aMine = Boolean(tab?.teamId) && a.teamId === tab.teamId;
        const bMine = Boolean(tab?.teamId) && b.teamId === tab.teamId;
        if (aMine !== bMine) return aMine ? -1 : 1;
        return (b.seenAt || 0) - (a.seenAt || 0);
    });
    return {
        urls: sorted,
        tab: tab
    };
}

function toBase64(text) {
    const bytes = (new TextEncoder).encode(text);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

const DROP_HEADERS = new Set([ "content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive", "etag", "last-modified", "age", "date" ]);

let observedHeaders = null;

function corsHeaders(request) {
    const h = request && request.headers || {};
    const get = name => {
        const key = Object.keys(h).find(k => k.toLowerCase() === name);
        return key ? h[key] : "";
    };
    const origin = get("origin");
    const reqHeaders = get("access-control-request-headers");
    const out = [ {
        name: "access-control-allow-origin",
        value: origin || "*"
    }, {
        name: "access-control-allow-methods",
        value: "GET, OPTIONS"
    }, {
        name: "access-control-allow-headers",
        value: reqHeaders || "x-requested-with, content-type"
    }, {
        name: "access-control-expose-headers",
        value: "*"
    }, {
        name: "access-control-max-age",
        value: "600"
    } ];
    if (origin) out.push({
        name: "access-control-allow-credentials",
        value: "true"
    });
    return out;
}

function responseHeaders(request) {
    const base = (observedHeaders || []).filter(h => !DROP_HEADERS.has(h.name.toLowerCase()));
    const have = new Set(base.map(h => h.name.toLowerCase()));
    const add = (name, value) => {
        if (!have.has(name)) base.push({
            name: name,
            value: value
        });
    };
    add("content-type", "application/json; charset=utf-8");
    const out = base.filter(h => h.name.toLowerCase() !== "cache-control");
    out.push({
        name: "cache-control",
        value: "no-store"
    });
    out.push({
        name: "x-madden-roster-bridge",
        value: "1"
    });
    const CORS = new Set([ "access-control-allow-origin", "access-control-allow-credentials", "access-control-allow-headers", "access-control-allow-methods", "access-control-max-age", "access-control-expose-headers" ]);
    return out.filter(h => !CORS.has(h.name.toLowerCase())).concat(corsHeaders(request));
}

async function fetchEa(url) {
    const response = await fetch(url, {
        cache: "no-store"
    });
    const text = await response.text();
    observedHeaders = [ ...response.headers ].map(([name, value]) => ({
        name: name,
        value: value
    }));
    await setStatus({
        eaResponse: {
            url: url,
            status: response.status,
            at: Date.now(),
            headers: observedHeaders.map(h => `${h.name}: ${h.value}`)
        }
    });
    if (!response.ok) throw new Error(`EA returned HTTP ${response.status}`);
    return text;
}

function cancelDetachTimer(tabId) {
    const timer = unusedTimers.get(tabId);
    if (timer !== undefined) clearTimeout(timer);
    unusedTimers.delete(tabId);
}

async function detachTab(tabId, attempt = 0) {
    cancelDetachTimer(tabId);
    const pending = pausedCountFor(tabId);
    if (pending) {
        if (attempt < DETACH_MAX_RETRIES) {
            unusedTimers.set(tabId, setTimeout(() => {
                detachTab(tabId, attempt + 1).catch(() => {});
            }, DETACH_RETRY_MS));
            return;
        }
        for (const [requestId, owner] of [ ...pausedRequests ]) {
            if (owner === tabId) pausedRequests.delete(requestId);
        }
        await setStatus({
            lastError: `Detached tab ${tabId} with ${pending} request(s) still paused after ` + `${DETACH_MAX_RETRIES * DETACH_RETRY_MS / 1e3}s; Chrome never answered them.`,
            lastErrorAt: Date.now()
        });
    }
    if (attached.has(tabId)) {
        try {
            await chrome.debugger.sendCommand({
                tabId: tabId
            }, "Fetch.disable");
        } catch {}
        try {
            await chrome.debugger.sendCommand({
                tabId: tabId
            }, "Network.setCacheDisabled", {
                cacheDisabled: false
            });
        } catch {}
        try {
            await chrome.debugger.detach({
                tabId: tabId
            });
        } catch {}
        attached.delete(tabId);
    }
    if (!attached.size) await setStatus({
        intercepting: false
    });
}

async function detachAll() {
    for (const tabId of [ ...attached ]) await detachTab(tabId);
    for (const tabId of [ ...unusedTimers.keys() ]) cancelDetachTimer(tabId);
    await setStatus({
        intercepting: false
    });
}

async function startIntercepting(tabId) {
    if (!attached.has(tabId)) {
        try {
            await chrome.debugger.attach({
                tabId: tabId
            }, DEBUGGER_VERSION);
        } catch (error) {
            if (!/already attached/i.test(error?.message || "")) throw error;
        }
        attached.add(tabId);
    }
    await chrome.debugger.sendCommand({
        tabId: tabId
    }, "Fetch.enable", {
        patterns: [ {
            urlPattern: DEBUGGER_PATTERN,
            requestStage: "Request"
        } ]
    });
    try {
        await chrome.debugger.sendCommand({
            tabId: tabId
        }, "Network.enable");
        await chrome.debugger.sendCommand({
            tabId: tabId
        }, "Network.setCacheDisabled", {
            cacheDisabled: true
        });
    } catch {}
    try {
        await chrome.debugger.sendCommand({
            tabId: tabId
        }, "Runtime.enable");
        await chrome.debugger.sendCommand({
            tabId: tabId
        }, "Log.enable");
    } catch {}
    await setStatus({
        intercepting: true,
        interceptTabId: tabId,
        interceptAt: Date.now(),
        pageError: null,
        pageLog: null,
        lastError: null
    });
    cancelDetachTimer(tabId);
    unusedTimers.set(tabId, setTimeout(() => {
        detachTab(tabId).catch(() => {});
    }, DETACH_IF_UNUSED_MS));
}

chrome.debugger.onEvent.addListener((source, method, params) => {
    if (method === "Runtime.exceptionThrown") {
        const detail = params?.exceptionDetails || {};
        setStatus({
            pageError: {
                text: detail.exception?.description || detail.text || "unknown exception",
                url: detail.url || "",
                line: detail.lineNumber,
                at: Date.now()
            }
        }).catch(() => {});
        return;
    }
    if (method === "Log.entryAdded" && params?.entry?.level === "error") {
        setStatus({
            pageLog: {
                text: params.entry.text || "",
                url: params.entry.url || "",
                at: Date.now()
            }
        }).catch(() => {});
        return;
    }
    if (method !== "Fetch.requestPaused") return;
    const tabId = source?.tabId;
    pausedRequests.set(params.requestId, tabId);
    (async () => {
        const url = params?.request?.url || "";
        const push = await readStaged(tabId);
        const matches = push && (push.url === url || push.assetKey && push.assetKey === assetKey(url));
        if (!matches) {
            await chrome.debugger.sendCommand(source, "Fetch.continueRequest", {
                requestId: params.requestId
            });
            return;
        }
        if ((params.request?.method || "").toUpperCase() === "OPTIONS") {
            await chrome.debugger.sendCommand(source, "Fetch.fulfillRequest", {
                requestId: params.requestId,
                responseCode: 204,
                responsePhrase: "No Content",
                responseHeaders: corsHeaders(params.request)
            });
            return;
        }
        const body = push.mode === "passthrough" ? await fetchEa(url) : push.text;
        await chrome.debugger.sendCommand(source, "Fetch.fulfillRequest", {
            requestId: params.requestId,
            responseCode: 200,
            responsePhrase: "OK",
            responseHeaders: responseHeaders(params.request),
            body: toBase64(body)
        });
        try {
            await chrome.debugger.sendCommand(source, "Network.setCacheDisabled", {
                cacheDisabled: false
            });
        } catch {}
        await setStatus({
            lastServed: {
                url: url,
                mode: push.mode || "edited",
                teamName: push.teamName || "",
                players: push.players || 0,
                opId: push.opId || "",
                bytes: body.length,
                at: Date.now()
            },
            intercepting: false
        });
        cancelDetachTimer(tabId);
        unusedTimers.set(tabId, setTimeout(() => {
            detachTab(tabId).catch(() => {});
        }, DETACH_AFTER_SERVE_MS));
    })().catch(async error => {
        try {
            await chrome.debugger.sendCommand(source, "Fetch.continueRequest", {
                requestId: params.requestId
            });
        } catch {}
        await setStatus({
            lastError: String(error?.message || error),
            lastErrorAt: Date.now()
        });
    }).finally(() => {
        pausedRequests.delete(params.requestId);
    });
});

chrome.debugger.onDetach.addListener(source => {
    if (typeof source?.tabId === "number") {
        attached.delete(source.tabId);
        cancelDetachTimer(source.tabId);
    }
    if (!attached.size) setStatus({
        intercepting: false
    }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(tabId => {
    attached.delete(tabId);
    cancelDetachTimer(tabId);
    clearStaged(tabId).catch(() => {});
    read(KEY_PAGES, {}).then(pages => {
        if (!pages[String(tabId)]) return;
        delete pages[String(tabId)];
        return write(KEY_PAGES, pages);
    }).catch(() => {});
});

function rosterShapeError(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        return `Edited roster is not valid JSON: ${error.message}`;
    }
    const playerData = parsed?.teamData?.roster?.playerData;
    if (!playerData || typeof playerData !== "object") {
        return "Edited roster has no teamData.roster.playerData; that is not a Team Builder " + "payload. Refusing to serve it.";
    }
    const count = Object.keys(playerData).length;
    if (!count) return "Edited roster contains no players. Refusing to serve an empty roster.";
    if (!parsed?.teamData?.teamInfos) {
        return "Edited roster has no teamData.teamInfos; the team header is missing.";
    }
    return "";
}

function handle(message, sendResponse) {
    const {type: type} = message || {};
    if (type === "TB_STATUS") {
        (async () => {
            await rescanActiveTab();
            const [{urls: urls, tab: tab}, staged, status] = await Promise.all([ candidateUrls(), read(KEY_PUSH, {}), read(KEY_STATUS, {}) ]);
            const push = tab ? stagedMap(staged)[String(tab.tabId)] || null : null;
            sendResponse({
                ok: true,
                version: chrome.runtime.getManifest().version,
                urls: urls,
                tab: tab,
                pushed: push ? {
                    url: push.url,
                    teamName: push.teamName,
                    players: push.players,
                    at: push.at
                } : null,
                status: status
            });
        })().catch(error => sendResponse({
            ok: false,
            error: String(error?.message || error)
        }));
        return true;
    }
    if (type === "TB_FETCH") {
        if (!ROSTER_JSON.test(message.url || "")) {
            sendResponse({
                ok: false,
                error: "That is not a Team Builder roster payload URL."
            });
            return false;
        }
        fetchEa(message.url).then(text => sendResponse({
            ok: true,
            text: text
        })).catch(error => sendResponse({
            ok: false,
            error: String(error?.message || error)
        }));
        return true;
    }
    if (type === "TB_PASSTHROUGH") {
        const {url: url} = message;
        if (!ROSTER_JSON.test(url || "")) {
            sendResponse({
                ok: false,
                error: "That is not a Team Builder roster payload URL."
            });
            return false;
        }
        (async () => {
            const tab = await pickTeamBuilderTab(await teamIdForUrl(url));
            if (!tab) throw new Error("No Team Builder tab is open. Open your team, then try again.");
            const record = {
                url: url,
                assetKey: assetKey(url),
                mode: "passthrough",
                text: "",
                teamName: "",
                players: 0,
                at: Date.now()
            };
            stagedByTab.set(tab.tabId, record);
            await startIntercepting(tab.tabId);
            await persistStaged(tab.tabId, record);
            sendResponse({
                ok: true,
                tabId: tab.tabId
            });
            chrome.tabs.reload(tab.tabId).catch(() => {});
        })().catch(error => sendResponse({
            ok: false,
            error: String(error?.message || error)
        }));
        return true;
    }
    if (type === "TB_PUSH") {
        const {url: url, text: text, teamName: teamName, players: players, reload: reload} = message;
        if (!ROSTER_JSON.test(url || "")) {
            sendResponse({
                ok: false,
                error: "That is not a Team Builder roster payload URL."
            });
            return false;
        }
        const shape = rosterShapeError(text);
        if (shape) {
            sendResponse({
                ok: false,
                error: shape
            });
            return false;
        }
        (async () => {
            const tab = await pickTeamBuilderTab(await teamIdForUrl(url));
            if (!tab) throw new Error("No Team Builder tab is open. Open your team, then push again.");
            const record = {
                url: url,
                assetKey: assetKey(url),
                text: text,
                teamName: teamName || "",
                players: players || 0,
                opId: message.opId || "",
                at: Date.now()
            };
            stagedByTab.set(tab.tabId, record);
            await startIntercepting(tab.tabId);
            await persistStaged(tab.tabId, record);
            sendResponse({
                ok: true,
                tabId: tab.tabId,
                reloaded: reload !== false
            });
            if (reload !== false) chrome.tabs.reload(tab.tabId).catch(() => {});
        })().catch(error => sendResponse({
            ok: false,
            error: String(error?.message || error)
        }));
        return true;
    }
    if (type === "TB_DIAG") {
        (async () => {
            const report = {
                at: (new Date).toISOString(),
                version: chrome.runtime.getManifest().version
            };
            try {
                const all = await chrome.tabs.query({});
                report.tabsTotal = all.length;
                report.tabsWithUrl = all.filter(tab => tab.url).length;
                report.eaTabs = all.filter(tab => /ea\.com/i.test(tab.url || "")).map(tab => ({
                    id: tab.id,
                    url: tab.url,
                    active: tab.active,
                    incognito: tab.incognito
                }));
            } catch (error) {
                report.tabsError = String(error?.message || error);
            }
            try {
                const filtered = await chrome.tabs.query({
                    url: TEAM_BUILDER_MATCH
                });
                report.filteredQueryCount = filtered.length;
            } catch (error) {
                report.filteredQueryError = String(error?.message || error);
            }
            try {
                report.hostPermission = await chrome.permissions.contains({
                    origins: [ "https://www.ea.com/*", "https://cdn.mcr.ea.com/*" ]
                });
            } catch (error) {
                report.hostPermissionError = String(error?.message || error);
            }
            const tab = await pickTeamBuilderTab().catch(() => null);
            report.chosenTab = tab || null;
            report.stagedTabs = Object.keys(stagedMap(await read(KEY_PUSH, {})));
            report.attachedTabs = [ ...attached ];
            if (tab) {
                try {
                    report.contentScript = await chrome.tabs.sendMessage(tab.tabId, {
                        type: "TB_PING"
                    });
                } catch (error) {
                    report.contentScript = null;
                    report.contentScriptError = String(error?.message || error);
                }
                try {
                    report.tickets = await chrome.tabs.sendMessage(tab.tabId, {
                        type: "TB_TICKETS"
                    });
                } catch {}
            }
            report.storedUrls = (await read(KEY_URLS, [])).map(entry => entry.url);
            report.status = await read(KEY_STATUS, {});
            sendResponse({
                ok: true,
                report: report
            });
        })().catch(error => sendResponse({
            ok: false,
            error: String(error?.message || error)
        }));
        return true;
    }
    if (type === "TB_CLEAR") {
        (async () => {
            stagedByTab.clear();
            await chrome.storage.local.remove(KEY_PUSH);
            await detachAll();
            sendResponse({
                ok: true
            });
        })().catch(error => sendResponse({
            ok: false,
            error: String(error?.message || error)
        }));
        return true;
    }
    return null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "TB_URL_FOUND") {
        rememberUrl(message.payload).catch(() => {});
        return false;
    }
    if (message?.type === "TB_PAGE_SEEN") {
        rememberPage(message.payload, sender).catch(() => {});
        return false;
    }
    const handled = handle(message, sendResponse);
    return handled === null ? false : handled;
});

chrome.runtime.onConnect.addListener(port => {
    if (port.name === "mrb-bridge") bridgePort(port);
});

const SITE_URL = "";

const DIAGNOSTICS_URL = chrome.runtime.getURL("diagnostics.html");

chrome.action.onClicked.addListener(() => {
    (async () => {
        const target = SITE_URL || DIAGNOSTICS_URL;
        const open = await chrome.tabs.query({
            url: `${target}*`
        });
        if (!open.length) {
            await chrome.tabs.create({
                url: target
            });
            return;
        }
        const tab = open.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
        await chrome.tabs.update(tab.id, {
            active: true
        });
        await chrome.windows.update(tab.windowId, {
            focused: true
        });
    })().catch(() => {});
});

const TEXTURE_BYTES_MAX = 8 * 1024 * 1024;

async function textureFetch(url, method) {
    const P = self.CFB27BridgeProtocol;
    const ctl = new AbortController;
    const timer = setTimeout(() => ctl.abort(), P && P.TEXTURE_TIMEOUT_MS || 5e3);
    try {
        const res = await fetch(url, {
            method: method,
            cache: "no-store",
            credentials: "omit",
            signal: ctl.signal
        });
        if (res.url && P.textureVerdict(res.url) !== "fetch") return null;
        const buf = method === "GET" && res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
        return {
            res: res,
            buf: buf
        };
    } finally {
        clearTimeout(timer);
    }
}

async function fetchTextures(urls, opts) {
    const P = self.CFB27BridgeProtocol;
    const max = P && P.TEXTURE_MAX_URLS || 40;
    const wantBytes = !!(opts && opts.wantBytes === true);
    const list = Array.isArray(urls) ? urls : [];
    const rows = [];
    const seen = new Set;
    for (const url of list) {
        if (seen.has(url)) continue;
        seen.add(url);
        if (seen.size > max || !P || P.textureVerdict(url) !== "fetch") {
            rows.push({
                url: typeof url === "string" ? url.slice(0, 300) : null,
                status: "refused",
                bytes: null
            });
            continue;
        }
        try {
            const got = await textureFetch(url, wantBytes ? "GET" : "HEAD");
            if (!got) {
                rows.push({
                    url: url,
                    status: "refused",
                    bytes: null
                });
                continue;
            }
            const {res: res, buf: buf} = got;
            if (!wantBytes || !res.ok) {
                const len = parseInt(res.headers.get("content-length") || "", 10);
                rows.push({
                    url: url,
                    status: res.status,
                    bytes: res.ok && Number.isFinite(len) && len >= 0 ? len : null
                });
                continue;
            }
            const row = {
                url: url,
                status: res.status,
                bytes: buf.length
            };
            if (buf.length && buf.length <= TEXTURE_BYTES_MAX) {
                let bin = "";
                for (let k = 0; k < buf.length; k += 32768) bin += String.fromCharCode(...buf.subarray(k, k + 32768));
                const type = res.headers.get("content-type") || "";
                row.type = /^image\//.test(type) ? type : "image/png";
                row.data = btoa(bin);
            }
            rows.push(row);
        } catch (error) {
            rows.push({
                url: url,
                status: error && error.name === "AbortError" ? "timeout" : "error",
                bytes: null
            });
        }
    }
    return rows;
}
