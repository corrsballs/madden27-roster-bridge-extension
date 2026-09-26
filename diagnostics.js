(function() {
    const el = id => document.getElementById(id);
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[c]));
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const VERIFY_AFTER_MS = 6e3;
    let candidates = [];
    let sourceUrl = "";
    let pulledText = "";
    let work = null;
    function setDisabled(id, value) {
        el(id).disabled = value;
        el(id).dataset.set = "1";
    }
    function say(html, kind) {
        const s = el("status");
        s.className = kind || "";
        s.innerHTML = html;
    }
    function ask(message) {
        return new Promise(resolve => {
            chrome.runtime.sendMessage(message, response => {
                if (chrome.runtime.lastError) return resolve({
                    ok: false,
                    error: chrome.runtime.lastError.message
                });
                resolve(response || {
                    ok: false,
                    error: "No response from the extension."
                });
            });
        });
    }
    function fingerprint(text) {
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return h.toString(16).padStart(8, "0");
    }
    function shapeError(parsed) {
        const pd = parsed?.teamData?.roster?.playerData;
        if (!pd || typeof pd !== "object") return "no teamData.roster.playerData";
        if (!Object.keys(pd).length) return "no players";
        if (!parsed?.teamData?.teamInfos) return "no teamData.teamInfos";
        return "";
    }
    function describe(entry) {
        const team = entry.teamId ? `Team ${entry.teamId.slice(0, 10)}` : "unknown team";
        return `${team} · seen ${new Date(entry.seenAt || Date.now()).toLocaleTimeString()}`;
    }
    function paintCandidates(urls, tab) {
        candidates = urls || [];
        const select = el("url");
        select.innerHTML = candidates.length ? candidates.map((e, i) => `<option value="${i}">${esc(describe(e))}</option>`).join("") : "";
        el("urlWrap").style.display = candidates.length > 1 ? "" : "none";
        setDisabled("pull", !candidates.length);
        setDisabled("passthrough", !candidates.length);
        if (!candidates.length) {
            say(tab ? "Team Builder is open, but its roster file has not been requested yet. Click into the <b>Roster</b> tab on that page, then press Find my team again." : "No Madden Team Builder tab found. Open your team at ea.com Team Builder, then press Find my team. If it is open, run <b>Diagnostics</b>: incognito windows, another Chrome profile, or a tab opened before the extension loaded are the usual causes.", "warn");
            return;
        }
        say(candidates.length > 1 ? `Found <b>${candidates.length}</b> roster payloads. Pick one and pull it.` : "Found your team. Press <b>Pull team</b>.", "ok");
    }
    async function refresh(quiet) {
        if (!quiet) say("Looking for an open Team Builder tab&hellip;");
        const r = await ask({
            type: "TB_STATUS"
        });
        if (!r.ok) return say(`Could not talk to the extension: ${esc(r.error)}`, "bad");
        el("version").textContent = r.version ? `v${r.version}` : "";
        paintCandidates(r.urls, r.tab);
        const served = r.status?.lastServed;
        if (served) {
            el("pushed").style.display = "block";
            el("pushed").innerHTML = `Team Builder last loaded a served roster (${esc(served.mode)}) at <b>${new Date(served.at).toLocaleTimeString()}</b>, ${served.bytes} bytes.`;
        }
        return r;
    }
    function positionCounts(pd) {
        const c = {};
        for (const p of Object.values(pd)) c[p.PLYR_POSITION] = (c[p.PLYR_POSITION] || 0) + 1;
        return Object.entries(c).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => `${k}:${v}`).join(" ");
    }
    function renderSummary() {
        if (!work) return;
        const ti = work.teamData.teamInfos;
        const pd = work.teamData.roster.playerData;
        const first = Object.values(pd)[0] || {};
        el("summary").innerHTML = `<table>\n      <tr><th>Team</th><td>${esc(ti.TEAM_NAME)} ${esc(ti.TEAM_NICKNAME)} (${esc(ti.TEAM_SHORTNAME)})</td></tr>\n      <tr><th>Header</th><td>OVR ${esc(ti.TEAM_RATINGOVR)} · OFF ${esc(ti.TEAM_RATINGOFF)} · DEF ${esc(ti.TEAM_RATINGDEF)}</td></tr>\n      <tr><th>Players</th><td>${Object.keys(pd).length} · template ${esc(work.teamData.roster.templateId)} · file v${esc(work.version)}</td></tr>\n      <tr><th>Positions</th><td class="small">${esc(positionCounts(pd))}</td></tr>\n      <tr><th>First player</th><td>${esc(first.PLYR_FIRSTNAME)} ${esc(first.PLYR_LASTNAME)} #${esc(first.PLYR_JERSEYNUM)} pos ${esc(first.PLYR_POSITION)} OVR ${esc(first.PLYR_OVERALLRATING)}</td></tr>\n      <tr><th>Bytes</th><td>${pulledText.length} · fingerprint <code>${fingerprint(pulledText)}</code></td></tr>\n    </table>`;
    }
    async function pull() {
        const entry = candidates[Number(el("url").value || 0)];
        if (!entry) return;
        say("Downloading your roster from EA&hellip;");
        const r = await ask({
            type: "TB_FETCH",
            url: entry.url
        });
        if (!r.ok) return say(`Download failed: ${esc(r.error)}`, "bad");
        let parsed;
        try {
            parsed = JSON.parse(r.text);
        } catch (e) {
            return say(`EA's payload is not valid JSON: ${esc(e.message)}`, "bad");
        }
        const shape = shapeError(parsed);
        if (shape) return say(`Pulled file rejected: ${esc(shape)}.`, "bad");
        sourceUrl = entry.url;
        pulledText = r.text;
        work = parsed;
        setDisabled("download", false);
        renderSummary();
        say(`Pulled <b>${Object.keys(work.teamData.roster.playerData).length} players</b> (${(pulledText.length / 1048576).toFixed(2)} MB). Fingerprint <code>${fingerprint(pulledText)}</code>. Download keeps a copy; nothing here pushes.`, "ok");
    }
    function download() {
        if (!pulledText) return;
        const ti = work.teamData.teamInfos;
        const name = `${ti.TEAM_NAME || "team"}_${(new Date).toISOString().slice(0, 10)}.json`.replace(/[^\w.-]+/g, "_");
        const blob = new Blob([ pulledText ], {
            type: "application/json"
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5e3);
    }
    function failureDetail(status, fallback) {
        return status.pageError?.text && `Team Builder threw: <code>${esc(status.pageError.text)}</code>` || status.pageLog?.text && `Team Builder logged: <code>${esc(status.pageLog.text)}</code>` || status.lastError && `The extension reported: <code>${esc(status.lastError)}</code>` || fallback;
    }
    async function passthrough() {
        const entry = candidates[Number(el("url").value || 0)];
        const url = sourceUrl || entry?.url;
        if (!url) return say("Press <b>Find my team</b> first.", "bad");
        say("Serving EA&rsquo;s untouched roster through the interception path&hellip;");
        const at = Date.now();
        const r = await ask({
            type: "TB_PASSTHROUGH",
            url: url
        });
        if (!r.ok) return say(`Could not start the test: ${esc(r.error)}`, "bad");
        await sleep(VERIFY_AFTER_MS);
        const status = (await ask({
            type: "TB_STATUS"
        }))?.status || {};
        const served = status.lastServed;
        const ea = status.eaResponse;
        const eaLine = ea ? `<br><span class="muted small">EA answered HTTP ${esc(ea.status)} with: ${esc((ea.headers || []).join(" · "))}</span>` : "";
        if (served && (served.at || 0) >= at && served.mode === "passthrough") {
            return say(`<b>Transport is sound.</b> EA's own roster (${served.bytes} bytes) was intercepted and substituted. If a real push fails, the cause is in the edited payload. Press <b>Clear staged</b> before the next real push.${eaLine}`, "ok");
        }
        say(`<b>Transport is broken and the payload is innocent.</b> Even EA's own roster could not be served.<br>${failureDetail(status, "Nothing was recorded.")}${eaLine}`, "bad");
    }
    async function diag() {
        const r = await ask({
            type: "TB_DIAG"
        });
        el("diagOut").style.display = "block";
        el("diagOut").textContent = JSON.stringify(r, null, 2);
    }
    async function clearStaged() {
        const r = await ask({
            type: "TB_CLEAR"
        });
        say(r.ok ? "Cleared the staged roster and detached the debugger." : `Clear failed: ${esc(r.error)}`, r.ok ? "ok" : "bad");
        el("pushed").style.display = "none";
    }
    const BUTTONS = [ "find", "pull", "download", "passthrough", "clear", "diag" ];
    let busy = false;
    const guarded = fn => async () => {
        if (busy) return;
        busy = true;
        const before = new Map(BUTTONS.map(id => [ id, el(id).disabled ]));
        for (const id of BUTTONS) {
            delete el(id).dataset.set;
            el(id).disabled = true;
        }
        document.body.setAttribute("aria-busy", "true");
        try {
            await fn();
        } finally {
            for (const id of BUTTONS) {
                if (el(id).dataset.set === "1") {
                    delete el(id).dataset.set;
                    continue;
                }
                el(id).disabled = before.get(id);
            }
            document.body.removeAttribute("aria-busy");
            busy = false;
        }
    };
    el("find").addEventListener("click", guarded(() => refresh(false)));
    el("pull").addEventListener("click", guarded(pull));
    el("download").addEventListener("click", download);
    el("passthrough").addEventListener("click", guarded(passthrough));
    el("clear").addEventListener("click", guarded(clearStaged));
    el("diag").addEventListener("click", guarded(diag));
    refresh(true);
})();
