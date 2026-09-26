const COURIER_VERIFY_MS = 6e3;

const COURIER_VERIFY_TRIES = 3;

const KEY_COURIER_LAST = "mrb.courier.lastPull";

const COURIER_CONFIRM_TIMEOUT_MS = 5 * 60 * 1e3;

const COURIER_KEEPALIVE_MS = 2e4;

const courierPing = () => {
    try {
        chrome.runtime.getPlatformInfo(() => {});
    } catch {}
};

const courierSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const deliveryLocks = new Set;

let courierGate = Promise.resolve();

function courierSerial(fn) {
    const next = courierGate.then(fn, fn);
    courierGate = next.then(() => {}, () => {});
    return next;
}

let courierOpSeq = 0;

const nextOpId = () => `op-${Date.now()}-${++courierOpSeq}-${Math.random().toString(36).slice(2, 8)}`;

const askSelf = message => new Promise(resolve => {
    const routed = handle(message, resolve);
    if (routed === null) resolve({
        ok: false,
        error: `no handler for ${message && message.type}`
    });
});

let courierKit = null;

function ensureCourierKit() {
    if (!courierKit) {
        courierKit = (async () => {
            const load = async f => {
                const res = await fetch(chrome.runtime.getURL("data/" + f));
                if (!res.ok) throw new Error(`could not load ${f} from the extension package`);
                return res.json();
            };
            const [constants, presets, catalog] = await Promise.all([ load("generator_constants.json"), load("roster_presets.json"), load("equipment_catalog.json") ]);
            initCFB27Template({
                template: null,
                presets: presets,
                constants: constants
            });
            initCFB27BuildFile({
                constants: constants,
                presets: presets,
                catalog: catalog
            });
        })();
    }
    return courierKit;
}

function reconcileReport(r, teamName) {
    return {
        teamName: teamName,
        buildShape: r.buildShape,
        pulledShape: r.pulledShape,
        adoptSkipped: r.adoptSkipped,
        built: r.built,
        pulled: r.pulled,
        matched: r.matched,
        rows: (r.perPosition || []).filter(e => e.built !== e.pulled)
    };
}

function courierNotServed(status) {
    const detail = status.pageError && status.pageError.text && `Team Builder threw: ${status.pageError.text}` || status.pageLog && status.pageLog.text && `Team Builder logged: ${status.pageLog.text}` || status.lastError && `The extension reported: ${status.lastError}` || "nothing was recorded, which usually means the roster request never reached that tab.";
    return `Your roster was not served. Team Builder reloaded with EA's own copy, so nothing ` + `was delivered. ${detail} Check that the yellow "debugging this browser" banner appeared on ` + `the Team Builder tab, then send again.`;
}

async function courierPull(send) {
    send("BRIDGE_PROGRESS", {
        phase: "find"
    });
    const live = await liveTeamBuilderTabs();
    const liveTeams = [ ...new Set(live.map(t => t.teamId).filter(Boolean)) ];
    if (liveTeams.length > 1) {
        send("BRIDGE_FAIL", {
            error: `${live.length} Team Builder tabs showing ${liveTeams.length} different teams are ` + "open, so there is no way to know which team you mean. Close the other Team Builder " + "tabs, keep only the team you want open in Team Builder (any tab of its editor), and " + "try again."
        });
        return null;
    }
    const found = await askSelf({
        type: "TB_STATUS"
    });
    if (!found.ok) {
        send("BRIDGE_FAIL", {
            error: found.error
        });
        return null;
    }
    if (!found.tab) {
        send("BRIDGE_FAIL", {
            error: "No Madden Team Builder tab found. Open your team at ea.com in Team Builder (the " + "Roster tab), then try again. If it is open, reload that tab once: a tab opened before " + "the extension loaded is invisible to it."
        });
        return null;
    }
    let teamId = found.tab.teamId || liveTeams[0] || "";
    let entry = teamId ? (found.urls || []).find(u => u.teamId === teamId) : null;
    if (!teamId || !entry) {
        const remembered = await read(KEY_COURIER_LAST, null);
        if (remembered && (liveTeams.length === 0 || liveTeams[0] === remembered.teamId)) {
            teamId = teamId || remembered.teamId;
            entry = entry || (found.urls || []).find(u => u.assetKey && u.assetKey === remembered.assetKey) || (found.urls || []).find(u => u.teamId === remembered.teamId);
        }
    }
    if (!teamId) {
        send("BRIDGE_FAIL", {
            error: "Team Builder is open, but the tab isn't showing a team id and no team has been " + "pulled yet this session. Open your team in Team Builder (the address bar shows " + "…/team-builder/team-create/<tab>/<team id>), then try again."
        });
        return null;
    }
    if (!entry) {
        send("BRIDGE_FAIL", {
            error: "This team's roster file has not been seen yet. Open the Roster tab on the Team " + "Builder page once so it downloads, then try again."
        });
        return null;
    }
    send("BRIDGE_PROGRESS", {
        phase: "pull"
    });
    const pulled = await askSelf({
        type: "TB_FETCH",
        url: entry.url
    });
    if (!pulled.ok) {
        send("BRIDGE_FAIL", {
            error: `Download failed: ${pulled.error}`
        });
        return null;
    }
    const shapeBad = rosterShapeError(pulled.text);
    if (shapeBad) {
        send("BRIDGE_FAIL", {
            error: `Pulled roster rejected: ${shapeBad}`
        });
        return null;
    }
    const work = JSON.parse(pulled.text);
    const ti = work.teamData.teamInfos;
    const teamName = `${ti.TEAM_NAME || ""} ${ti.TEAM_NICKNAME || ""}`.trim();
    await write(KEY_COURIER_LAST, {
        teamId: teamId,
        assetKey: entry.assetKey || "",
        teamName: teamName,
        seenAt: Date.now()
    });
    return {
        entry: entry,
        work: work,
        teamName: teamName,
        teamId: teamId,
        tabId: found.tab.tabId
    };
}

const LOGO_CDN = /^https:\/\/cdn\.mcr\.ea\.com\//i;

const LOGO_MAX_BYTES = 2 * 1024 * 1024;

async function pullLogo(work) {
    try {
        const meta = JSON.parse(work?.teamData?.teamInfos?.TEAM_PRIMARY_LOGO || "null");
        const url = meta && typeof meta.pngUrl === "string" ? meta.pngUrl : null;
        if (!url || !LOGO_CDN.test(url)) return null;
        const response = await fetch(url, {
            cache: "no-store"
        });
        if (!response.ok) return null;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length || bytes.length > LOGO_MAX_BYTES) return null;
        let bin = "";
        for (let i = 0; i < bytes.length; i += 32768) {
            bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
        }
        const type = /^image\//.test(response.headers.get("content-type") || "") ? response.headers.get("content-type") : "image/png";
        return {
            url: url,
            dataUri: `data:${type};base64,${btoa(bin)}`
        };
    } catch {
        return null;
    }
}

async function runPull(send) {
    const got = await courierPull(send);
    if (!got) return;
    const logo = await pullLogo(got.work);
    send("BRIDGE_ROSTER", {
        roster: got.work,
        teamName: got.teamName,
        teamId: got.teamId,
        ...logo ? {
            logoUrl: logo.url,
            logoDataUri: logo.dataUri
        } : {}
    });
}

async function runCourier(build, send, state) {
    await ensureCourierKit();
    const BF = self.CFB27BuildFile;
    const bad = BF.validate(build);
    if (bad) return send("BRIDGE_FAIL", {
        error: `Build file rejected: ${bad}`
    });
    const got = await courierSerial(async () => {
        const g = await courierPull(send);
        if (!g) return null;
        if (g.tabId != null && deliveryLocks.has(g.tabId)) {
            send("BRIDGE_FAIL", {
                error: "A delivery is already running. Wait for it to finish."
            });
            return null;
        }
        if (g.tabId != null) {
            deliveryLocks.add(g.tabId);
            state.lockedTab = g.tabId;
        }
        return g;
    });
    if (!got) return;
    const {entry: entry, work: work, teamName: teamName} = got;
    const patch = Array.isArray(build.uniforms) ? build.uniforms : [];
    if (patch.length) {
        const UB = self.CFB27UniformBank;
        if (!UB) {
            return send("BRIDGE_FAIL", {
                error: "This extension did not load its uniform code; update it and try again."
            });
        }
        const assetName = UB.assetNameOf(work);
        const prefix = UB.prefixOf(work);
        for (const bundle of patch) {
            if (bundle && bundle.assetName === assetName && bundle.prefix === prefix) continue;
            const from = bundle && (bundle.teamLabel || bundle.assetName) || "another team";
            return send("BRIDGE_FAIL", {
                error: `This design was banked from ${from}, so it cannot go on ${teamName}. Same team only. ` + "Nothing in Team Builder was changed."
            });
        }
        send("BRIDGE_PROGRESS", {
            phase: "uniforms",
            detail: `${patch.length} uniform${patch.length === 1 ? "" : "s"}`
        });
    }
    if (!Array.isArray(build.slots) || build.slots.length) {
        send("BRIDGE_PROGRESS", {
            phase: "transplant",
            detail: teamName
        });
    }
    const r = BF.importBuild(work, build);
    if (r.error) return send("BRIDGE_FAIL", {
        error: r.error
    });
    if (r.mismatch) {
        const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const keepAlive = setInterval(courierPing, COURIER_KEEPALIVE_MS);
        let answer;
        try {
            answer = await new Promise(resolve => {
                state.confirm = {
                    token: token,
                    resolve: resolve
                };
                send("BRIDGE_PROGRESS", {
                    phase: "confirm",
                    token: token,
                    report: reconcileReport(r, teamName)
                });
                setTimeout(() => {
                    if (state.confirm && state.confirm.token === token) {
                        state.confirm = null;
                        resolve({
                            proceed: false,
                            timeout: true
                        });
                    }
                }, COURIER_CONFIRM_TIMEOUT_MS);
            });
        } finally {
            clearInterval(keepAlive);
        }
        if (!answer.proceed) {
            return send("BRIDGE_FAIL", {
                cancelled: true,
                error: answer.timeout ? "No answer to the shape-mismatch report, so nothing was pushed." : "Cancelled. Nothing was pushed; your Team Builder team is untouched."
            });
        }
    }
    send("BRIDGE_PROGRESS", {
        phase: "push",
        detail: teamName
    });
    const opId = nextOpId();
    const players = Object.keys(work.teamData.roster.playerData).length;
    const pushed = await askSelf({
        type: "TB_PUSH",
        url: entry.url,
        text: JSON.stringify(work),
        teamName: teamName,
        players: players,
        opId: opId,
        ...typeof got.tabId === "number" ? {
            tabId: got.tabId
        } : {}
    });
    if (!pushed.ok) return send("BRIDGE_FAIL", {
        error: `Push failed: ${pushed.error}`
    });
    let served = null;
    for (let i = 0; i < COURIER_VERIFY_TRIES && !served; i++) {
        await courierSleep(COURIER_VERIFY_MS);
        const check = await askSelf({
            type: "TB_STATUS"
        });
        const status = check.ok && check.status || {};
        if (status.lastServed && status.lastServed.opId === opId) {
            served = status.lastServed;
        } else if (i === COURIER_VERIFY_TRIES - 1) {
            return send("BRIDGE_FAIL", {
                error: courierNotServed(status)
            });
        }
    }
    send("BRIDGE_DONE", {
        report: {
            teamName: teamName,
            players: players,
            matched: r.matched,
            built: r.built,
            adopted: r.adopted,
            reslotMoves: r.reslotMoves,
            shape: r.stamped ? r.stamped.eaName : r.buildShape || null,
            mismatch: r.mismatch,
            uniforms: Array.isArray(r.uniforms) ? r.uniforms : null
        }
    });
}

function bridgePort(port) {
    const state = {
        running: false,
        confirm: null,
        lockedTab: null
    };
    const releaseLock = () => {
        if (state.lockedTab != null) {
            deliveryLocks.delete(state.lockedTab);
            state.lockedTab = null;
        }
    };
    const send = (type, payload) => {
        try {
            port.postMessage({
                type: type,
                payload: payload
            });
        } catch {}
    };
    port.onDisconnect.addListener(() => {
        if (state.confirm) {
            const c = state.confirm;
            state.confirm = null;
            c.resolve({
                proceed: false
            });
        }
    });
    port.onMessage.addListener(msg => {
        const {type: type, payload: payload} = msg || {};
        if (type === "BRIDGE_HELLO") {
            (async () => {
                let tab = null;
                try {
                    tab = await pickTeamBuilderTab();
                } catch {
                    tab = null;
                }
                send("BRIDGE_STATUS", {
                    installed: true,
                    version: chrome.runtime.getManifest().version,
                    tbTabSeen: !!tab
                });
            })();
            return;
        }
        if (type === "BRIDGE_CONFIRM") {
            if (state.confirm && payload && payload.token === state.confirm.token) {
                const c = state.confirm;
                state.confirm = null;
                c.resolve({
                    proceed: payload.proceed === true
                });
            }
            return;
        }
        if (type === "BRIDGE_TEXTURES") {
            const reqId = payload && payload.reqId;
            Promise.resolve().then(() => fetchTextures(payload && payload.urls, {
                wantBytes: !!(payload && payload.wantBytes === true)
            })).then(rows => send("BRIDGE_TEXTURES_RESULT", {
                reqId: reqId,
                rows: rows
            })).catch(error => send("BRIDGE_TEXTURES_RESULT", {
                reqId: reqId,
                rows: [],
                error: String(error && error.message || error)
            }));
            return;
        }
        if (type === "BRIDGE_PULL") {
            if (state.running) {
                return send("BRIDGE_FAIL", {
                    error: "A delivery is already running. Wait for it to finish."
                });
            }
            state.running = true;
            runPull(send).catch(error => send("BRIDGE_FAIL", {
                error: String(error && error.message || error)
            })).finally(() => {
                state.running = false;
                releaseLock();
            });
            return;
        }
        if (type === "BRIDGE_SEND") {
            if (state.running) {
                return send("BRIDGE_FAIL", {
                    error: "A delivery is already running. Wait for it to finish."
                });
            }
            state.running = true;
            runCourier(payload && payload.buildFile, send, state).catch(error => send("BRIDGE_FAIL", {
                error: String(error && error.message || error)
            })).finally(() => {
                state.running = false;
                state.confirm = null;
                releaseLock();
            });
        }
    });
}
