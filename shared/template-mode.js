function initCFB27Template({template: template, presets: presets, constants: constants}) {
    const el = id => typeof document !== "undefined" ? document.getElementById(id) : null;
    const D = constants || (typeof window !== "undefined" ? window.D : null) || {};
    const POSITION_ORDER = Object.keys(D.positionCodes || {}).sort((a, b) => a - b).map(k => D.positionCodes[k]);
    const codeOfPos = pos => Number(Object.keys(D.positionCodes || {}).find(k => D.positionCodes[k] === pos));
    const sideOf = pos => {
        const c = codeOfPos(pos);
        return c <= 9 ? "off" : c <= 18 ? "def" : "st";
    };
    const groupOf = pos => (D.positionGroup || {})[pos] || pos;
    const CODES = D.positionCodes || {};
    const CODE_OF = {};
    for (const [code, pos] of Object.entries(CODES)) CODE_OF[pos] = code;
    const posOfRow = p => CODES[String(parseInt(p.PLYR_POSITION, 10))] || "?";
    const LIST = presets && Array.isArray(presets.presets) ? presets.presets : [];
    const DEFAULT_SHAPE = "Pistol";
    const totalOf = counts => POSITION_ORDER.reduce((a, pos) => a + ((counts || {})[pos] || 0), 0);
    const byName = name => LIST.find(p => p.eaName === name) || null;
    function countsOf(name) {
        const p = byName(name);
        return p ? p.counts : null;
    }
    function reslot(payload, counts) {
        const roster = payload?.teamData?.roster?.playerData;
        if (!roster || !counts) return [];
        const byPos = new Map(POSITION_ORDER.map(pos => [ pos, [] ]));
        const stray = [];
        for (const [pid, p] of Object.entries(roster)) {
            const pos = posOfRow(p);
            if (byPos.has(pos)) byPos.get(pos).push(pid); else stray.push(pid);
        }
        const donors = [];
        for (const pos of POSITION_ORDER) {
            const want = counts[pos] ?? 0;
            const have = byPos.get(pos);
            for (const pid of have.slice(want)) donors.push({
                pid: pid,
                from: pos
            });
            byPos.set(pos, have.slice(0, want));
        }
        for (const pid of stray) donors.push({
            pid: pid,
            from: posOfRow(roster[pid])
        });
        const moves = [];
        for (const pos of POSITION_ORDER) {
            let need = (counts[pos] ?? 0) - byPos.get(pos).length;
            while (need > 0) {
                let i = donors.findIndex(d => groupOf(d.from) === groupOf(pos));
                if (i === -1) i = donors.findIndex(d => sideOf(d.from) === sideOf(pos));
                if (i === -1) i = 0;
                const donor = donors.splice(i, 1)[0];
                if (!donor) break;
                roster[donor.pid].PLYR_POSITION = String(CODE_OF[pos]);
                byPos.get(pos).push(donor.pid);
                moves.push({
                    pid: donor.pid,
                    from: donor.from,
                    to: pos
                });
                need--;
            }
        }
        return moves;
    }
    function countsOfWork(payload) {
        const roster = payload?.teamData?.roster?.playerData;
        const c = {};
        for (const pos of POSITION_ORDER) c[pos] = 0;
        if (roster) for (const p of Object.values(roster)) {
            const pos = posOfRow(p);
            if (pos in c) c[pos]++;
        }
        return c;
    }
    function detectShape(counts) {
        return LIST.find(p => POSITION_ORDER.every(pos => (p.counts[pos] ?? 0) === (counts[pos] ?? 0))) || null;
    }
    function seatPicks({counts: counts, picks: picks, slotSources: slotSources, adjustable: adjustable}) {
        const work = {};
        for (const pos of POSITION_ORDER) work[pos] = counts[pos] ?? 0;
        const seated = {};
        for (const pos of POSITION_ORDER) seated[pos] = [];
        const free = pos => work[pos] - seated[pos].length;
        const seats = [], overflow = [], delta = {};
        for (const pick of picks || []) {
            const elig = POSITION_ORDER.filter(pos => pick.positions ? pick.positions.includes(pos) : (slotSources[pos] || []).includes(pick.group));
            if (!elig.length) {
                overflow.push({
                    ...pick,
                    reason: `no position takes a ${pick.group}`
                });
                continue;
            }
            const open = elig.filter(pos => free(pos) > 0).sort((a, b) => free(b) - free(a) || POSITION_ORDER.indexOf(a) - POSITION_ORDER.indexOf(b))[0];
            if (open) {
                seated[open].push(pick.key);
                seats.push({
                    key: pick.key,
                    pos: open
                });
                continue;
            }
            if (!adjustable) {
                overflow.push({
                    ...pick,
                    reason: `${elig.join("/")} full`
                });
                continue;
            }
            const grow = elig.slice().sort((a, b) => work[a] - work[b] || POSITION_ORDER.indexOf(a) - POSITION_ORDER.indexOf(b))[0];
            const donor = POSITION_ORDER.filter(pos => pos !== grow && free(pos) > 0).sort((a, b) => free(b) - free(a) || POSITION_ORDER.indexOf(b) - POSITION_ORDER.indexOf(a))[0];
            if (!donor) {
                overflow.push({
                    ...pick,
                    reason: `roster is full; ${totalOf(counts)} picks`
                });
                continue;
            }
            work[grow]++;
            work[donor]--;
            delta[grow] = (delta[grow] || 0) + 1;
            delta[donor] = (delta[donor] || 0) - 1;
            seated[grow].push(pick.key);
            seats.push({
                key: pick.key,
                pos: grow
            });
        }
        const changes = POSITION_ORDER.filter(pos => delta[pos]).map(pos => ({
            pos: pos,
            delta: delta[pos]
        }));
        return {
            counts: work,
            seats: seats,
            byPos: seated,
            overflow: overflow,
            changes: changes
        };
    }
    function stampPreset(payload, preset) {
        if (!payload?.teamData || !preset) return null;
        if (payload.teamData.roster && preset.selectValue != null) {
            payload.teamData.roster.templateId = preset.selectValue;
        }
        const measured = preset.mySchoolTemplateId != null;
        if (measured) {
            payload.teamData.teamInfos.MY_SCHOOL_TEMPLATE_ID = String(preset.mySchoolTemplateId);
            if (payload.metadata) payload.metadata.mySchoolTemplateId = String(preset.mySchoolTemplateId);
        }
        return {
            eaName: preset.eaName,
            templateId: preset.selectValue,
            mySchoolTemplateId: measured ? String(preset.mySchoolTemplateId) : null,
            measured: measured
        };
    }
    function build(name) {
        const preset = byName(name) || byName(DEFAULT_SHAPE);
        const payload = JSON.parse(JSON.stringify(template));
        if (!preset) return {
            payload: payload,
            preset: null,
            moves: []
        };
        if (preset.rows) {
            payload.teamData.roster.playerData = JSON.parse(JSON.stringify(preset.rows.playerData));
            payload.teamData.frostbiteData.characterVisuals = JSON.parse(JSON.stringify(preset.rows.characterVisuals));
        }
        const moves = reslot(payload, preset.counts);
        return {
            payload: payload,
            preset: preset,
            moves: moves
        };
    }
    const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[c]));
    const opt = p => `<option value="${esc(p.eaName)}">${esc(p.eaName)} · ${totalOf(p.counts)} players</option>`;
    function paintPicker() {
        const sel = el("tbShape");
        if (!sel || !LIST.length) return;
        sel.innerHTML = LIST.map(opt).join("");
        sel.value = DEFAULT_SHAPE;
        const wrap = el("tbShapeWrap");
        if (wrap) wrap.style.display = "";
    }
    function ensureCustomOption(sel) {
        let custom = sel.querySelector?.('option[value="__custom"]');
        if (!custom && typeof document !== "undefined" && sel.appendChild) {
            custom = document.createElement("option");
            custom.value = "__custom";
            custom.textContent = "Custom shape";
            sel.appendChild(custom);
        }
        return custom;
    }
    function start(asked) {
        const name = typeof asked === "string" && asked || el("tbShape")?.value || DEFAULT_SHAPE;
        if (typeof DIRTY !== "undefined" && DIRTY && typeof confirm === "function" && !confirm("Start over? The roster you have built will be discarded.")) return false;
        const {payload: payload, preset: preset} = build(name);
        window.CFB27Transport?.loadScratch?.(payload, preset ? preset.eaName : name);
        return true;
    }
    function applyShape(name) {
        if (typeof WORK === "undefined" || !WORK || typeof RAW === "undefined" || !RAW) return null;
        const preset = byName(name);
        if (!preset) return null;
        if (totalOf(preset.counts) !== totalOf(countsOfWork(WORK))) {
            if (window.CFB27Transport?.scratchMode?.()) {
                if (!start(preset.eaName)) onRosterLoaded();
                return {
                    preset: preset,
                    moves: [],
                    rebuilt: 0,
                    rebuiltFresh: true
                };
            }
            console.warn(`[Madden 27 Editor] ${preset.eaName} is ${totalOf(preset.counts)} players and this team holds ` + `${totalOf(countsOfWork(WORK))}; shape not changed`);
            return null;
        }
        return {
            preset: preset,
            ...applyCounts(preset.counts)
        };
    }
    function applyCounts(counts) {
        const moves = reslot(WORK, counts);
        reslot(RAW, counts);
        let rebuilt = 0;
        for (const m of moves) {
            if (window.CFB27Table?.ensureArchetype?.(m.pid, m.from)) rebuilt++;
        }
        if (moves.length) DIRTY = true;
        window.CFB27Table?.render?.();
        window.CFB27PoolBrowser?.render?.();
        window.CFB27Predict?.update?.();
        if (typeof changeBlip === "function") changeBlip();
        return {
            moves: moves,
            rebuilt: rebuilt
        };
    }
    function onRosterLoaded() {
        const sel = el("tbShape");
        if (!sel || typeof WORK === "undefined" || !WORK) return;
        const scratch = !!window.CFB27Transport?.scratchMode?.();
        const found = detectShape(countsOfWork(WORK));
        if (!found) ensureCustomOption(sel);
        sel.value = found ? found.eaName : "__custom";
        sel.disabled = false;
        const ti = WORK.teamData?.teamInfos || {};
        const ids = `templateId ${WORK.teamData?.roster?.templateId ?? "–"}` + `, MY_SCHOOL_TEMPLATE_ID ${ti.MY_SCHOOL_TEMPLATE_ID ?? "–"}` + `, metadata ${WORK.metadata?.mySchoolTemplateId ?? "–"}`;
        const claims = LIST.find(p => p.selectValue === WORK.teamData?.roster?.templateId);
        console.info(`[Madden 27 Editor] shape: the players are ${found ? found.eaName : "a custom shape"}; ` + `the stored ids say ${claims ? claims.eaName : "no preset we know"} (${ids})` + (claims && found && claims.eaName !== found.eaName ? "; THEY DISAGREE, which is normal for an EA payload and harmless; the players are the truth" : ""));
        const wrap = el("tbShapeWrap");
        if (wrap) wrap.title = scratch ? "Team Builder's own roster presets (64 to 74 players). Changing it starts a fresh roster in that preset." : "Team Builder's own roster presets. A preset of the same size re-slots THIS team in place; " + "real players move position and are re-archetyped " + "to stay rateable. Team Builder's preset id is left as pulled: the positions themselves carry the shape.";
    }
    window.CFB27Template = {
        build: build,
        reslot: reslot,
        countsOf: countsOf,
        countsOfWork: countsOfWork,
        detectShape: detectShape,
        seatPicks: seatPicks,
        applyShape: applyShape,
        stampPreset: stampPreset,
        byName: byName,
        onRosterLoaded: onRosterLoaded,
        presets: () => LIST,
        start: start
    };
    paintPicker();
    const btn = el("tbScratch");
    if (btn) {
        btn.disabled = false;
        btn.onclick = () => start();
    }
    const sel = el("tbShape");
    if (sel && sel.addEventListener) {
        sel.addEventListener("change", () => {
            if (typeof WORK === "undefined" || !WORK) return;
            const r = applyShape(sel.value);
            if (!r || r.rebuiltFresh) return;
            console.info(`[Madden 27 Editor] shape → ${r.preset.eaName}: ${r.moves.length} player(s) re-slotted in place` + (r.rebuilt ? `, ${r.rebuilt} re-archetyped to stay rateable` : ""));
        });
    }
}

if (typeof window !== "undefined") window.initCFB27Template = initCFB27Template;
