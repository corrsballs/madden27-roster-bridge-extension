function initCFB27BuildFile({constants: constants, presets: presets, catalog: catalog}) {
    const D = constants || (typeof window !== "undefined" ? window.D : null) || {};
    const FORMAT_VERSION = 1;
    const POSITION_CODES = D.positionCodes || {};
    const POSITION_ORDER = Object.keys(POSITION_CODES).sort((a, b) => a - b).map(k => POSITION_CODES[k]);
    const CODES = D.positionCodes || {};
    const posOfRow = p => CODES[String(parseInt(p.PLYR_POSITION, 10))] || "?";
    const BASE_PLAYER_FIELDS = [ "PLYR_FIRSTNAME", "PLYR_LASTNAME", "PLYR_HEIGHT", "PLYR_WEIGHT", "PLYR_JERSEYNUM", "PLYR_HOME_TOWN", "PLYR_HOME_STATE", "PLYR_SKINTONE", "PLYR_PORTRAIT", "PLYR_AGE", "PLYR_YEARSPRO", "PLYR_DRAFTROUND", "PLYR_DRAFTPICK", "PLYR_DRAFTTEAM", "PLYR_OVERALLRATING", "PLYR_PLAYERTYPE", "PLYR_TRAITDEVELOPMENT", "PLYR_LONGSNAPRATING" ];
    const EXCLUDED_PLAYER_FIELDS = [ "PLYR_POSITION" ];
    const PLAYER_FIELDS = [ ...new Set([ ...BASE_PLAYER_FIELDS, ...Object.values(D.attrToJson || {}) ]) ];
    const VISUAL_FIELDS = [ "firstName", "lastName", "jerseyName", "heightInches", "weightPounds", "jerseyNumber", "skinTone", "genericHeadName", "genericHead" ];
    const GEAR_SLOTS = new Set((catalog?.slots || []).map(s => s.slot));
    const gearElemsOf = (v, create = false) => {
        const lo = (v?.loadouts || []).find(l => l.loadoutType === 1 && l.loadoutCategory === 0);
        if (!lo) return null;
        if (!lo.loadoutElements && create) lo.loadoutElements = [];
        return lo.loadoutElements || null;
    };
    const PRESET_LIST = presets && Array.isArray(presets.presets) ? presets.presets : [];
    const detectShape = counts => PRESET_LIST.find(p => POSITION_ORDER.every(pos => (p.counts[pos] ?? 0) === (counts[pos] ?? 0))) || null;
    const countsOf = payload => {
        const c = {};
        for (const pos of POSITION_ORDER) c[pos] = 0;
        for (const p of Object.values(payload?.teamData?.roster?.playerData || {})) {
            const pos = posOfRow(p);
            if (pos in c) c[pos]++;
        }
        return c;
    };
    function slotsByPosition(payload) {
        const byPos = new Map(POSITION_ORDER.map(pos => [ pos, [] ]));
        for (const [pid, p] of Object.entries(payload?.teamData?.roster?.playerData || {})) {
            const pos = posOfRow(p);
            if (byPos.has(pos)) byPos.get(pos).push(pid);
        }
        for (const list of byPos.values()) list.sort((a, b) => Number(a) - Number(b));
        return byPos;
    }
    const ubOf = () => typeof window !== "undefined" && window.CFB27UniformBank || typeof self !== "undefined" && self.CFB27UniformBank || typeof globalThis !== "undefined" && globalThis.CFB27UniformBank || null;
    const uniformsOf = build => Array.isArray(build?.uniforms) ? build.uniforms : [];
    const TB_BODY = Object.freeze({
        heightMin: 65,
        heightMax: 84,
        weightMin: 160,
        weightMax: 400
    });
    const clampField = (holder, key, lo, hi, asString) => {
        if (!holder || !(key in holder)) return false;
        const n = parseInt(holder[key], 10);
        if (!Number.isFinite(n) || n >= lo && n <= hi) return false;
        const c = Math.max(lo, Math.min(hi, n));
        holder[key] = asString ? String(c) : c;
        return true;
    };
    function clampBody(fields, visuals) {
        let n = 0;
        const vis = visuals && typeof visuals === "object" ? visuals : null;
        const h0 = parseInt(fields?.PLYR_HEIGHT, 10), w0 = parseInt(fields?.PLYR_WEIGHT, 10);
        const hTwin = vis && "heightInches" in vis && (!fields || !("PLYR_HEIGHT" in fields) || parseInt(vis.heightInches, 10) === h0);
        const wTwin = vis && "weightPounds" in vis && (!fields || !("PLYR_WEIGHT" in fields) || parseInt(vis.weightPounds, 10) === w0 + 160);
        if (clampField(fields, "PLYR_HEIGHT", TB_BODY.heightMin, TB_BODY.heightMax, true)) n++;
        if (clampField(fields, "PLYR_WEIGHT", TB_BODY.weightMin - 160, TB_BODY.weightMax - 160, true)) n++;
        if (hTwin && clampField(vis, "heightInches", TB_BODY.heightMin, TB_BODY.heightMax, false)) n++;
        if (wTwin && clampField(vis, "weightPounds", TB_BODY.weightMin, TB_BODY.weightMax, false)) n++;
        return n;
    }
    function tbSafePayload(work) {
        if (!work?.teamData?.roster?.playerData) return work;
        const out = JSON.parse(JSON.stringify(work));
        const visuals = out.teamData.frostbiteData?.characterVisuals || {};
        for (const [pid, p] of Object.entries(out.teamData.roster.playerData)) clampBody(p, visuals[pid]);
        return out;
    }
    function exportBuild(work, opts = {}) {
        if (!work?.teamData?.roster?.playerData) return {
            error: "no roster loaded"
        };
        const patch = Array.isArray(opts.uniforms) ? opts.uniforms : [];
        if (opts.uniformsOnly) {
            if (!patch.length) return {
                error: "there are no changed uniforms to send"
            };
            return {
                formatVersion: FORMAT_VERSION,
                buildId: opts.buildId ?? (typeof RB_VERSION !== "undefined" ? RB_VERSION : "unstamped"),
                createdAt: opts.createdAt ?? (new Date).toISOString(),
                shape: null,
                presetCounts: null,
                mySchoolTemplateId: work.teamData.teamInfos?.MY_SCHOOL_TEMPLATE_ID ?? null,
                slots: [],
                uniforms: patch,
                notes: opts.notes ?? ""
            };
        }
        const roster = work.teamData.roster.playerData;
        const visuals = work.teamData.frostbiteData?.characterVisuals || {};
        const abilities = work.teamData.frostbiteData?.characterAbilities || {};
        const byPos = slotsByPosition(work);
        const slots = [];
        for (const pos of POSITION_ORDER) {
            byPos.get(pos).forEach((pid, slotIndex) => {
                const p = roster[pid];
                const fields = {};
                for (const k of PLAYER_FIELDS) if (k in p) fields[k] = p[k];
                const slot = {
                    position: pos,
                    slotIndex: slotIndex,
                    fields: fields
                };
                const v = visuals[pid];
                if (v && typeof v === "object") {
                    const vis = {};
                    for (const k of VISUAL_FIELDS) if (k in v) vis[k] = v[k];
                    slot.visuals = vis;
                    const elems = gearElemsOf(v);
                    if (elems) {
                        slot.gear = elems.filter(e => GEAR_SLOTS.has(e.slotType) && e.itemAssetName).map(e => ({
                            slotType: e.slotType,
                            itemAssetName: e.itemAssetName
                        })).sort((a, b) => a.slotType - b.slotType);
                    }
                }
                if (opts.clampToTB) clampBody(slot.fields, slot.visuals);
                if (abilities[pid]) slot.abilities = JSON.parse(JSON.stringify(abilities[pid]));
                slots.push(slot);
            });
        }
        const counts = countsOf(work);
        return {
            formatVersion: FORMAT_VERSION,
            buildId: opts.buildId ?? (typeof RB_VERSION !== "undefined" ? RB_VERSION : "unstamped"),
            createdAt: opts.createdAt ?? (new Date).toISOString(),
            shape: detectShape(counts)?.eaName ?? null,
            presetCounts: counts,
            mySchoolTemplateId: work.teamData.teamInfos?.MY_SCHOOL_TEMPLATE_ID ?? null,
            slots: slots,
            ...patch.length ? {
                uniforms: patch
            } : {},
            notes: opts.notes ?? ""
        };
    }
    function validate(build) {
        if (!build || typeof build !== "object") return "not a build-file";
        if (build.formatVersion !== FORMAT_VERSION) {
            return `format version ${build.formatVersion ?? "missing"}; this kit speaks v${FORMAT_VERSION}`;
        }
        if (build.uniforms != null && !Array.isArray(build.uniforms)) {
            return "the uniforms in the build-file are not a list";
        }
        const patch = uniformsOf(build);
        if (patch.length) {
            const UB = ubOf();
            if (!UB) return "this kit did not load its uniform code, so a uniform patch cannot be read";
            for (let i = 0; i < patch.length; i++) {
                const b = patch[i];
                const at = `uniform ${i + 1}`;
                if (!b || typeof b !== "object" || Array.isArray(b)) return `malformed ${at}; every uniform is an object`;
                if (typeof b.fromSlot !== "number" || !Number.isInteger(b.fromSlot)) {
                    return `malformed ${at}; its fromSlot is not a whole number`;
                }
                const badKit = UB.validate(b);
                if (badKit) return `${at} rejected: ${badKit}`;
            }
        }
        if (!Array.isArray(build.slots) || !build.slots.length && !patch.length) {
            return "no slots in the build-file";
        }
        const plain = v => !!v && typeof v === "object" && !Array.isArray(v);
        const known = new Set(POSITION_ORDER);
        for (let i = 0; i < build.slots.length; i++) {
            const s = build.slots[i];
            const at = `slot ${i + 1}`;
            if (!plain(s)) return `malformed ${at}; every slot is an object`;
            if (typeof s.position !== "string" || !known.has(s.position)) {
                return `malformed ${at}; "${String(s.position)}" is not a position this kit knows`;
            }
            if (!plain(s.fields)) return `malformed ${at} (${s.position}); its fields are not an object`;
            if (s.visuals != null && !plain(s.visuals)) {
                return `malformed ${at} (${s.position}); its visuals are not an object`;
            }
            if (s.gear != null && !Array.isArray(s.gear)) {
                return `malformed ${at} (${s.position}); its gear is not a list`;
            }
            if (s.slotIndex != null && typeof s.slotIndex !== "number") {
                return `malformed ${at} (${s.position}); its slotIndex is not a number`;
            }
        }
        return "";
    }
    function buildCounts(build) {
        const c = {};
        for (const pos of POSITION_ORDER) c[pos] = 0;
        for (const s of build.slots) if (s.position in c) c[s.position]++;
        return c;
    }
    function presetDisagreement(build, counts) {
        if (!build.presetCounts || typeof build.presetCounts !== "object") return null;
        for (const pos of POSITION_ORDER) {
            const said = build.presetCounts[pos] ?? 0;
            if (said !== counts[pos]) {
                return `the build's presetCounts list ${said} ${pos} but its slots hold ${counts[pos]} players there`;
            }
        }
        return null;
    }
    function importBuild(work, build, opts = {}) {
        if (!work?.teamData?.roster?.playerData) return {
            error: "no roster loaded"
        };
        const bad = validate(build);
        if (bad) return {
            error: `build-file rejected: ${bad}`
        };
        const workTarget = work;
        const rawTarget = opts.raw || null;
        work = JSON.parse(JSON.stringify(work));
        let rawStage = rawTarget ? JSON.parse(JSON.stringify(rawTarget)) : null;
        const patch = uniformsOf(build);
        const rosterHalf = build.slots.length > 0;
        const adoptWanted = opts.adoptShape !== false;
        const wantCounts = buildCounts(build);
        const haveCounts = countsOf(work);
        const wantTotal = POSITION_ORDER.reduce((a, p) => a + wantCounts[p], 0);
        const haveTotal = Object.keys(work.teamData.roster.playerData).length;
        const shapeDiffers = POSITION_ORDER.some(p => wantCounts[p] !== haveCounts[p]);
        const T = typeof window !== "undefined" ? window.CFB27Template : null;
        let adopted = false, reslotMoves = 0, adoptSkipped = null;
        const disagree = presetDisagreement(build, wantCounts);
        if (rosterHalf && adoptWanted && shapeDiffers) {
            if (!T?.reslot) adoptSkipped = "the shape module is not loaded"; else if (disagree) adoptSkipped = disagree; else if (wantTotal !== haveTotal) {
                adoptSkipped = `the build holds ${wantTotal} players and this team ${haveTotal}`;
            } else {
                reslotMoves = T.reslot(work, wantCounts).length;
                if (rawStage) T.reslot(rawStage, wantCounts);
                adopted = true;
            }
        }
        const roster = work.teamData.roster.playerData;
        const visuals = work.teamData.frostbiteData?.characterVisuals || {};
        const byPos = slotsByPosition(work);
        const builtByPos = new Map(POSITION_ORDER.map(pos => [ pos, [] ]));
        for (const slot of build.slots) {
            if (builtByPos.has(slot.position)) builtByPos.get(slot.position).push(slot);
        }
        for (const list of builtByPos.values()) {
            list.sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0));
        }
        let matched = 0;
        let noVisuals = 0;
        const perPosition = [];
        for (const pos of rosterHalf ? POSITION_ORDER : []) {
            const built = builtByPos.get(pos);
            const pids = byPos.get(pos);
            const n = Math.min(built.length, pids.length);
            for (let i = 0; i < n; i++) {
                const slot = built[i];
                const pid = pids[i];
                const p = roster[pid];
                for (const k of PLAYER_FIELDS) if (k in slot.fields) p[k] = slot.fields[k];
                const v = visuals[pid];
                if (slot.visuals && !(v && typeof v === "object")) noVisuals++;
                if (v && typeof v === "object" && slot.visuals) {
                    for (const k of VISUAL_FIELDS) if (k in slot.visuals) v[k] = slot.visuals[k];
                    if (Array.isArray(slot.gear)) {
                        const elems = gearElemsOf(v, true);
                        if (elems) {
                            for (const g of slot.gear) {
                                if (!GEAR_SLOTS.has(g.slotType) || !g.itemAssetName) continue;
                                const e = elems.find(x => x.slotType === g.slotType);
                                if (e) e.itemAssetName = g.itemAssetName; else elems.push({
                                    slotType: g.slotType,
                                    itemAssetName: g.itemAssetName,
                                    itemDisplayName: ""
                                });
                            }
                        }
                    }
                }
                if (slot.abilities && work.teamData.frostbiteData) {
                    const fb = work.teamData.frostbiteData;
                    if (!fb.characterAbilities) fb.characterAbilities = {};
                    fb.characterAbilities[pid] = JSON.parse(JSON.stringify(slot.abilities));
                }
                matched++;
            }
            if (built.length || pids.length) {
                perPosition.push({
                    pos: pos,
                    built: built.length,
                    pulled: pids.length,
                    copied: n
                });
            }
        }
        const uniforms = [];
        if (patch.length) {
            const UB = ubOf();
            if (!UB) return {
                error: "build-file rejected: this kit did not load its uniform code"
            };
            for (const bundle of patch) {
                const seats = UB.uniformsOf(work) || [];
                const seat = seats[bundle.fromSlot];
                const seatName = typeof seat?.displayName === "string" && seat.displayName.trim() ? seat.displayName.trim() : `Slot ${bundle.fromSlot + 1}`;
                const r = UB.restore(work, bundle);
                if (r.error) return {
                    error: r.error
                };
                work = r.work;
                if (rawStage) {
                    const rr = UB.restore(rawStage, bundle);
                    if (!rr.error) rawStage = rr.work;
                }
                uniforms.push({
                    slot: bundle.fromSlot,
                    name: typeof bundle.name === "string" ? bundle.name : "",
                    seatName: seatName,
                    outgoing: r.outgoing,
                    added: r.added.length,
                    alreadyPresent: r.alreadyPresent.length,
                    orphaned: r.orphaned.length
                });
            }
        }
        const pulledCounts = countsOf(work);
        const mismatch = perPosition.some(e => e.built !== e.pulled);
        const result = {
            matched: matched,
            noVisuals: noVisuals,
            built: build.slots.length,
            pulled: Object.keys(work.teamData.roster.playerData).length,
            perPosition: perPosition,
            mismatch: mismatch,
            buildShape: build.shape ?? null,
            pulledShape: detectShape(pulledCounts)?.eaName ?? null,
            adopted: adopted,
            reslotMoves: reslotMoves,
            adoptSkipped: adoptSkipped,
            shapeWas: detectShape(haveCounts)?.eaName ?? null,
            ...uniforms.length ? {
                uniforms: uniforms
            } : {}
        };
        workTarget.teamData = work.teamData;
        if (rawTarget) rawTarget.teamData = rawStage.teamData;
        return result;
    }
    const el = id => typeof document !== "undefined" ? document.getElementById(id) : null;
    const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[c]));
    function report(html, tone) {
        const box = el("buildStatus");
        if (!box) return;
        box.style.display = "block";
        box.className = "tbstatus" + (tone ? " " + tone : "");
        box.innerHTML = html;
    }
    const trackBuild = (name, outcome) => typeof window !== "undefined" && window.CFB27Track?.(name, {
        outcome: outcome
    });
    function doExport() {
        if (typeof WORK === "undefined" || !WORK) return;
        const build = exportBuild(WORK);
        if (build.error) {
            trackBuild("build_export", "error");
            return report(esc(build.error), "bad");
        }
        trackBuild("build_export", "ok");
        const name = `madden27-build-${(build.shape || "custom").toLowerCase().replace(/\s+/g, "-")}-${build.createdAt.slice(0, 10)}.json`;
        const blob = new Blob([ JSON.stringify(build) ], {
            type: "application/json"
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5e3);
        report(`Exported <b>${build.slots.length} players</b> as <code>${esc(name)}</code> ;\n      the ${esc(build.shape || "custom")} shape. To land it on a real team: pull the team,\n      then <b>Load build</b>.`, "ok");
    }
    function shapeHtml(r) {
        if (r.adoptSkipped) {
            return `<br><span class="muted">The shape was left as pulled; ${esc(r.adoptSkipped)}.</span>`;
        }
        if (!r.adopted) return "";
        const name = r.buildShape ? esc(r.buildShape) : "a custom shape";
        const from = r.shapeWas ? esc(r.shapeWas) : "a custom shape";
        return `<br>Roster shape changed from <b>${from}</b> to <b>${name}</b> ;\n      ${r.reslotMoves} of this team's players moved position.\n      <span class="muted">Team Builder's preset id is left as pulled: the positions\n      themselves carry the shape.</span>`;
    }
    function reconcileHtml(r) {
        if (!r.mismatch) return "";
        const rows = r.perPosition.filter(e => e.built !== e.pulled).map(e => `${esc(e.pos)}: built ${e.built}, team has ${e.pulled}; ${e.copied} copied,\n        ${e.built > e.pulled ? `<b>${e.built - e.pulled} built player(s) left out</b>` : `<b>${e.pulled - e.built} team slot(s) kept as pulled</b>`}`);
        return `<br><b>Shape mismatch</b>; the build is ${esc(r.buildShape || "a custom shape")},\n      this team is ${esc(r.pulledShape || "a custom shape")}. Every position filled to the\n      smaller count:<br>${rows.join("<br>")}`;
    }
    function doImport(event) {
        const f = event.target.files[0];
        event.target.value = "";
        if (!f) return;
        if (typeof WORK === "undefined" || !WORK) {
            trackBuild("build_import", "error");
            return report("Pull your team in first.", "bad");
        }
        if (window.CFB27Transport?.scratchMode?.()) {
            trackBuild("build_import", "error");
            return report("This roster was built from scratch; a build loads onto a real team. " + "Press <b>Pull from Team Builder</b> first, then <b>Load build</b>.", "bad");
        }
        f.text().then(text => {
            let build;
            try {
                build = JSON.parse(text);
            } catch (error) {
                trackBuild("build_import", "error");
                return report(`That file is not valid JSON: ${esc(error.message)}`, "bad");
            }
            const r = importBuild(WORK, build, {
                raw: typeof RAW !== "undefined" ? RAW : null
            });
            if (r.error) {
                trackBuild("build_import", "error");
                return report(esc(r.error), "bad");
            }
            trackBuild("build_import", "ok");
            DIRTY = true;
            window.CFB27Table?.render?.();
            window.CFB27Template?.onRosterLoaded?.();
            window.CFB27Predict?.update?.();
            if (typeof changeBlip === "function") changeBlip();
            console.info(`[CFB27] transplant: ${r.matched}/${r.built} build slots copied onto ` + `${r.pulled} pulled players (${f.name})` + (r.adopted ? `; shape → ${r.buildShape || "custom"}, ${r.reslotMoves} moved, preset id left as pulled` : ""));
            report(`Transplanted <b>${r.matched} of ${r.built}</b> built players onto this team.\n        The team keeps its own name, colors and stadium.${shapeHtml(r)}${reconcileHtml(r)}\n        <br>Now <b>Push to Team Builder</b>, then press <b>Save</b> in Team Builder.`, r.mismatch ? "warn" : "ok");
        }).catch(error => {
            console.error("[CFB27] build import failed", error);
            trackBuild("build_import", "error");
            report(`That build could not be loaded, so your roster was left exactly as it was:\n        ${esc(error?.message || String(error))}. Check the file is a build exported by this\n        kit, then try again.`, "bad");
        });
    }
    function onRosterLoaded() {
        const scratch = !!window.CFB27Transport?.scratchMode?.();
        const ex = el("buildExport");
        if (ex) ex.style.display = "";
        const im = el("buildImportWrap");
        if (im) im.style.display = scratch ? "none" : "";
    }
    if (typeof window !== "undefined") {
        window.CFB27BuildFile = {
            FORMAT_VERSION: FORMAT_VERSION,
            BASE_PLAYER_FIELDS: BASE_PLAYER_FIELDS,
            PLAYER_FIELDS: PLAYER_FIELDS,
            VISUAL_FIELDS: VISUAL_FIELDS,
            EXCLUDED_PLAYER_FIELDS: EXCLUDED_PLAYER_FIELDS,
            GEAR_SLOTS: GEAR_SLOTS,
            exportBuild: exportBuild,
            importBuild: importBuild,
            validate: validate,
            countsOf: countsOf,
            buildCounts: buildCounts,
            detectShape: detectShape,
            onRosterLoaded: onRosterLoaded,
            TB_BODY: TB_BODY,
            clampBody: clampBody,
            tbSafePayload: tbSafePayload
        };
    }
    const ex = el("buildExport");
    if (ex) ex.onclick = doExport;
    const im = el("buildImport");
    if (im && im.addEventListener) im.addEventListener("change", doImport);
    return typeof window !== "undefined" ? window.CFB27BuildFile : null;
}

if (typeof window !== "undefined") window.initCFB27BuildFile = initCFB27BuildFile;
