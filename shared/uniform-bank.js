(function() {
    "use strict";
    const BUNDLE_VERSION = 2;
    const OLDEST_VERSION = 1;
    const MAX_SLOTS = 5;
    const PART_KINDS = [ "helmets", "jerseys", "pants", "socks" ];
    const SLOT_KIND = {
        93: "helmets",
        98: "jerseys",
        97: "pants",
        94: "socks"
    };
    const KIND_LABEL = {
        93: "Helmet",
        98: "Jersey",
        97: "Pants",
        94: "Socks",
        95: "Shoes",
        96: "Shoes"
    };
    const SIG_MATERIALS = {
        helmets: 5,
        jerseys: 6,
        pants: 6,
        socks: 6
    };
    const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
    const seatNo = i => i + 1;
    const fbOf = work => work?.teamData?.frostbiteData || work?.frostbiteData || null;
    const tvOf = work => fbOf(work)?.teamVisuals || work?.teamData?.teamVisuals || null;
    const tiOf = work => work?.teamData?.teamInfos || work?.teamInfos || null;
    const uniformsOf = work => {
        const u = tvOf(work)?.uniforms;
        return Array.isArray(u) ? u : null;
    };
    function prefixOf(work) {
        const p = tvOf(work)?.prefixName;
        return typeof p === "string" && p ? p : null;
    }
    function assetNameOf(work) {
        const a = tvOf(work)?.assetName;
        if (typeof a === "string" && a) return a;
        const t = tiOf(work)?.TEAM_ASSETNAME;
        return typeof t === "string" && t ? t : null;
    }
    function teamLabelOf(work) {
        const ti = tiOf(work) || {};
        const parts = [ ti.TEAM_NAME, ti.TEAM_NICKNAME ].filter(s => typeof s === "string" && s.trim());
        if (parts.length) return parts.join(" ").trim();
        const md = work?.metadata || {};
        const alt = [ md.teamDisplayName, md.teamNickname ].filter(s => typeof s === "string" && s.trim());
        return alt.length ? alt.join(" ").trim() : "";
    }
    function brandIdOf(work) {
        const b = tiOf(work)?.BRAND_ID;
        return typeof b === "string" && b ? b : null;
    }
    const elementsOf = slot => {
        const e = slot?.uniform?.loadoutElements;
        return Array.isArray(e) ? e : [];
    };
    function isCatalogue(name) {
        if (typeof name !== "string" || !name) return false;
        const low = name.toLowerCase();
        return low.startsWith("contentshared/") || low.startsWith("content/") || low.startsWith("u_generic_shoesx_") || low.includes("/u_generic_shoesx_");
    }
    function ownedBy(name, assetName, prefix) {
        if (typeof name !== "string" || !name) return false;
        if (isCatalogue(name)) return false;
        if (assetName && name.includes(assetName)) return true;
        return !!prefix && name.startsWith(prefix + "_");
    }
    function refsOf(recipe) {
        const out = [];
        const seen = new Set;
        const walk = node => {
            if (!node || typeof node !== "object") return;
            if (seen.has(node)) return;
            seen.add(node);
            if (Array.isArray(node)) {
                for (const v of node) walk(v);
                return;
            }
            for (const [k, v] of Object.entries(node)) {
                if (k === "textureId" && typeof v === "string") {
                    if (!out.includes(v)) out.push(v);
                } else if (v && typeof v === "object") walk(v);
            }
        };
        walk(recipe);
        return out;
    }
    function kindOfPart(fb, partItem, slotType) {
        const byType = SLOT_KIND[Number(slotType)];
        if (byType && fb?.uniformParts?.[byType] && partItem in fb.uniformParts[byType]) return byType;
        for (const kind of PART_KINDS) {
            if (fb?.uniformParts?.[kind] && partItem in fb.uniformParts[kind]) return kind;
        }
        return byType || null;
    }
    function seatNames(entry, assetName, prefix) {
        const out = [];
        for (const el of elementsOf(entry)) {
            const n = el?.itemAssetName;
            if (ownedBy(n, assetName, prefix) && !out.includes(n)) out.push(n);
        }
        return out;
    }
    const nameKey = names => [ ...names ].sort().join("\0");
    const seatRoleOf = i => i === 0 ? "home" : i === 1 ? "away" : "alternate";
    function itemDisplayNameFor(seatIndex, seatLabel, slotType) {
        const kind = KIND_LABEL[Number(slotType)];
        if (!kind) return null;
        const base = typeof seatLabel === "string" && seatLabel.trim() ? seatLabel.trim() : `Slot ${seatNo(seatIndex)}`;
        const line = `${base} ${kind}`;
        return seatIndex === 0 || seatIndex === 1 ? line.toUpperCase() : line;
    }
    function hexOf(colour) {
        if (!isObj(colour)) return null;
        if (![ "r", "g", "b" ].every(k => typeof colour[k] === "number" && Number.isFinite(colour[k]))) {
            return null;
        }
        const ch = v => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, "0").toUpperCase();
        return `#${ch(colour.r)}${ch(colour.g)}${ch(colour.b)}`;
    }
    function pieceColours(recipe, kind) {
        const out = [];
        const mats = recipe?.layerCompTexture?.materials;
        const list = Array.isArray(mats) ? mats : [];
        const upto = SIG_MATERIALS[kind] || 6;
        for (let m = 0; m < upto; m++) out.push(hexOf(list[m]?.tint?.colorR));
        if (kind === "helmets") {
            out.push(hexOf(recipe?.facemaskMaterialSettings?.faceMaskColor));
            out.push(hexOf(recipe?.number?.overlays?.[0]?.tint?.colorR));
        } else if (kind === "jerseys") {
            const num = recipe?.numberComp?.overlays?.[0]?.tint;
            out.push(hexOf(num?.colorR));
            out.push(hexOf(num?.colorG));
            out.push(hexOf(num?.colorB));
            out.push(hexOf(recipe?.fontComp?.overlays?.[0]?.tint?.colorR));
        } else if (kind === "socks") {
            out.push(hexOf(recipe?.underSockColor));
        }
        return out;
    }
    function signature(bundle, opts) {
        const pieces = Array.isArray(opts?.pieces) && opts.pieces.length ? opts.pieces : PART_KINDS;
        const chunks = [];
        for (const kind of pieces) {
            const recipes = isObj(bundle?.parts?.[kind]) ? Object.values(bundle.parts[kind]) : [];
            chunks.push(`${kind}=${recipes.map(r => pieceColours(r, kind).join(",")).join(";")}`);
        }
        return chunks.join("|");
    }
    function imagesOf(bundle) {
        const tex = isObj(bundle?.textures) ? bundle.textures : {};
        return Object.keys(tex).map(id => ({
            id: id,
            url: typeof tex[id]?.url === "string" ? tex[id].url : null
        })).filter(row => !!row.url);
    }
    function extract(work, slotIndex, opts = {}) {
        const fb = fbOf(work);
        const uniforms = uniformsOf(work);
        const prefix = prefixOf(work);
        const assetName = assetNameOf(work);
        if (!fb || !uniforms) {
            return {
                error: "This roster carries no Team Builder uniforms. Pull the team from Team Builder first."
            };
        }
        if (!prefix || !assetName) {
            return {
                error: "This team's payload does not name a uniform prefix, so its designs cannot be banked."
            };
        }
        if (typeof slotIndex !== "number" || !Number.isInteger(slotIndex)) {
            return {
                error: "No uniform slot was named, so there is nothing to bank."
            };
        }
        const i = slotIndex;
        if (i < 0 || i >= Math.min(uniforms.length, MAX_SLOTS)) {
            return {
                error: `There is no uniform slot ${seatNo(i)} on this team. It has ${uniforms.length}.`
            };
        }
        const entry = uniforms[i];
        if (!isObj(entry)) {
            return {
                error: `Uniform slot ${seatNo(i)} is empty, so there is nothing to bank.`
            };
        }
        const seatName = typeof entry.displayName === "string" ? entry.displayName : "";
        const bundle = {
            bundleVersion: BUNDLE_VERSION,
            assetName: assetName,
            prefix: prefix,
            teamLabel: teamLabelOf(work),
            brandId: brandIdOf(work),
            fromSlot: i,
            seatName: seatName,
            seatRole: seatRoleOf(i),
            seatCount: uniforms.length,
            seatMap: uniforms.map(u => seatNames(u, assetName, prefix)),
            name: String(opts.name || seatName || `Slot ${seatNo(i)}`),
            bankedAt: opts.bankedAt || (new Date).toISOString(),
            setId: opts.setId || null,
            sig: "",
            origin: opts.origin || "pull",
            confirmedAt: opts.confirmedAt || null,
            slot: clone(entry),
            items: {},
            parts: Object.fromEntries(PART_KINDS.map(k => [ k, {} ])),
            textures: {},
            images: {}
        };
        const texIds = [];
        const noteTextures = recipe => {
            for (const id of refsOf(recipe)) {
                if (fb.textures && id in fb.textures && !texIds.includes(id)) texIds.push(id);
            }
        };
        noteTextures(entry);
        for (const el of elementsOf(entry)) {
            const name = el?.itemAssetName;
            if (!ownedBy(name, assetName, prefix)) continue;
            const item = fb.characterUniformItems?.[name];
            if (!isObj(item)) continue;
            bundle.items[name] = clone(item);
            noteTextures(item);
            const partItem = item.partItem;
            if (typeof partItem !== "string" || !partItem) continue;
            const kind = kindOfPart(fb, partItem, el?.slotType);
            const recipe = kind ? fb.uniformParts?.[kind]?.[partItem] : null;
            if (!kind || !isObj(recipe)) {
                return {
                    error: `Slot ${seatNo(i)} names a piece (${partItem}) this pulled team does not carry. ` + "Pull the team again; if it keeps happening, that slot is broken in Team Builder."
                };
            }
            bundle.parts[kind][partItem] = clone(recipe);
            noteTextures(recipe);
        }
        for (const id of texIds) bundle.textures[id] = clone(fb.textures[id]);
        bundle.sig = signature(bundle);
        return bundle;
    }
    const MIGRATIONS = {
        1: b => b
    };
    function migrate(bundle) {
        if (!isObj(bundle) || !Number.isInteger(bundle.bundleVersion)) return bundle;
        if (bundle.bundleVersion < OLDEST_VERSION || bundle.bundleVersion >= BUNDLE_VERSION) return bundle;
        let out = clone(bundle);
        for (let v = out.bundleVersion; v < BUNDLE_VERSION; v++) {
            out = MIGRATIONS[v](out);
            out.bundleVersion = v + 1;
        }
        return out;
    }
    function validate(bundle) {
        if (!isObj(bundle) || bundle.error) return "not a uniform bundle";
        if (!Number.isInteger(bundle.bundleVersion) || bundle.bundleVersion < OLDEST_VERSION) {
            return `this design carries no version this page knows (version ${bundle.bundleVersion ?? "(none)"})`;
        }
        if (bundle.bundleVersion > BUNDLE_VERSION) {
            return `this design was banked by a newer version of this page (version ${bundle.bundleVersion})`;
        }
        if (bundle.bundleVersion < BUNDLE_VERSION) bundle = migrate(bundle);
        if (typeof bundle.assetName !== "string" || !bundle.assetName) return "the bundle names no team";
        if (typeof bundle.prefix !== "string" || !bundle.prefix) return "the bundle names no team prefix";
        if (!Number.isInteger(bundle.fromSlot) || bundle.fromSlot < 0) return "the bundle names no uniform slot";
        if (!Number.isInteger(bundle.seatCount) || bundle.seatCount < 1) return "the bundle records no slot count";
        if (!Array.isArray(bundle.seatMap) || !bundle.seatMap.every(Array.isArray)) {
            return "the bundle records no slot map";
        }
        if (!isObj(bundle.slot)) return "the bundle carries no uniform slot";
        if (!Array.isArray(bundle.slot?.uniform?.loadoutElements)) {
            return "the bundle's uniform slot carries no loadout elements";
        }
        for (const key of [ "items", "textures", "images" ]) {
            if (!isObj(bundle[key])) return `the bundle carries no ${key}`;
        }
        if (!isObj(bundle.parts)) return "the bundle carries no parts";
        for (const kind of PART_KINDS) {
            if (!isObj(bundle.parts[kind])) return `the bundle is missing its ${kind} parts`;
        }
        for (const el of elementsOf(bundle.slot)) {
            const name = el?.itemAssetName;
            if (!ownedBy(name, bundle.assetName, bundle.prefix)) continue;
            const item = bundle.items[name];
            if (!isObj(item)) return `the bundle is missing the piece ${name}`;
            const partItem = item.partItem;
            if (typeof partItem !== "string" || !partItem) continue;
            const kind = SLOT_KIND[Number(el?.slotType)] || PART_KINDS.find(k => partItem in bundle.parts[k]);
            if (!kind || !isObj(bundle.parts[kind]?.[partItem])) {
                return `the bundle is missing the recipe ${partItem}`;
            }
        }
        for (const kind of PART_KINDS) {
            for (const recipe of Object.values(bundle.parts[kind])) {
                for (const id of refsOf(recipe)) {
                    if (!ownedBy(id, bundle.assetName, bundle.prefix)) continue;
                    if (!(id in bundle.textures)) return `the bundle is missing the image record ${id}`;
                }
            }
        }
        return null;
    }
    function seatStillMine(work, bundle) {
        const uniforms = uniformsOf(work);
        if (!uniforms || !isObj(bundle)) return false;
        const i = bundle.fromSlot;
        if (!Number.isInteger(i) || i < 0 || i >= uniforms.length) return false;
        const assetName = assetNameOf(work);
        const prefix = prefixOf(work);
        const live = uniforms.map(u => seatNames(u, assetName, prefix));
        const mine = seatNames(bundle.slot, bundle.assetName, bundle.prefix);
        if (!mine.length) return false;
        const mineKey = nameKey(mine);
        const at = live.findIndex(names => names.length && nameKey(names) === mineKey);
        if (at >= 0) return at === i;
        const hereKey = live[i].length ? nameKey(live[i]) : null;
        if (hereKey && Array.isArray(bundle.seatMap)) {
            const wasAt = bundle.seatMap.findIndex(names => Array.isArray(names) && names.length && nameKey(names) === hereKey);
            if (wasAt >= 0 && wasAt !== i) return false;
        }
        if (uniforms.length !== bundle.seatCount) return false;
        return true;
    }
    function collisionsOf(work, bundle) {
        const shared = [];
        const uniforms = uniformsOf(work);
        const fb = fbOf(work);
        if (!uniforms || !fb || !isObj(bundle)) return {
            outcome: "clean",
            shared: shared
        };
        const assetName = assetNameOf(work);
        const prefix = prefixOf(work);
        const wanted = new Map;
        for (const [name, item] of Object.entries(isObj(bundle.items) ? bundle.items : {})) {
            wanted.set(name, item);
        }
        for (const kind of PART_KINDS) {
            for (const [key, recipe] of Object.entries(isObj(bundle.parts?.[kind]) ? bundle.parts[kind] : {})) {
                wanted.set(key, recipe);
            }
        }
        for (let s = 0; s < uniforms.length; s++) {
            if (s === bundle.fromSlot) continue;
            for (const name of seatNames(uniforms[s], assetName, prefix)) {
                const row = fb.characterUniformItems?.[name];
                if (wanted.has(name)) shared.push({
                    name: name,
                    seat: s,
                    same: same(wanted.get(name), row)
                });
                const partItem = row?.partItem;
                if (typeof partItem !== "string" || !partItem || !wanted.has(partItem)) continue;
                const kind = kindOfPart(fb, partItem);
                const recipe = kind ? fb.uniformParts?.[kind]?.[partItem] : null;
                shared.push({
                    name: partItem,
                    seat: s,
                    same: same(wanted.get(partItem), recipe)
                });
            }
        }
        const outcome = !shared.length ? "clean" : shared.every(row => row.same) ? "alias" : "blocked";
        return {
            outcome: outcome,
            shared: shared
        };
    }
    function unreferenced(work) {
        const fb = fbOf(work);
        const uniforms = uniformsOf(work) || [];
        const assetName = assetNameOf(work);
        const prefix = prefixOf(work);
        const liveItems = new Set;
        const liveParts = new Set;
        for (const entry of uniforms) {
            for (const name of seatNames(entry, assetName, prefix)) {
                liveItems.add(name);
                const partItem = fb?.characterUniformItems?.[name]?.partItem;
                if (typeof partItem === "string" && partItem) liveParts.add(partItem);
            }
        }
        const out = new Set;
        for (const name of Object.keys(fb?.characterUniformItems || {})) {
            if (ownedBy(name, assetName, prefix) && !liveItems.has(name)) out.add(name);
        }
        for (const kind of PART_KINDS) {
            for (const key of Object.keys(fb?.uniformParts?.[kind] || {})) {
                if (ownedBy(key, assetName, prefix) && !liveParts.has(key)) out.add(key);
            }
        }
        return out;
    }
    function restore(work, bundle) {
        const bad = validate(bundle);
        if (bad) return {
            error: bad
        };
        bundle = migrate(bundle);
        const uniforms = uniformsOf(work);
        if (!fbOf(work) || !uniforms) {
            return {
                error: "This roster carries no Team Builder uniforms. Pull the team from Team Builder first."
            };
        }
        const prefix = prefixOf(work);
        const assetName = assetNameOf(work);
        if (assetName !== bundle.assetName || prefix !== bundle.prefix) {
            let from = bundle.teamLabel || bundle.assetName;
            let onto = teamLabelOf(work) || assetName || "this team";
            if (from === onto) {
                from = String(bundle.assetName);
                onto = String(assetName);
            }
            return {
                error: `This design was banked from ${from}, so it cannot go on ${onto}. Same team only.`
            };
        }
        const i = bundle.fromSlot;
        if (typeof i !== "number" || !Number.isInteger(i)) {
            return {
                error: "This design does not name a uniform slot to go back into, so nothing was changed."
            };
        }
        if (i < 0 || i >= Math.min(uniforms.length, MAX_SLOTS)) {
            return {
                error: `There is no uniform slot ${seatNo(i)} on this team. It has ${uniforms.length}.`
            };
        }
        if (!seatStillMine(work, bundle)) {
            return {
                error: `Slot ${seatNo(i)} is not the slot this design came from any more. ` + "Team Builder's slots have moved, most likely because one was deleted, and putting it " + `back now would put it in the wrong slot. Bank what is in slot ${seatNo(i)} today, ` + "then restore this once cross-slot placement is on."
            };
        }
        const outgoing = extract(work, i, {
            name: uniforms[i]?.displayName,
            origin: "replaced"
        });
        if (outgoing.error) return {
            error: outgoing.error
        };
        const wasOrphan = unreferenced(work);
        const next = clone(work);
        const fb = fbOf(next);
        const slots = uniformsOf(next);
        if (!fb.characterUniformItems) fb.characterUniformItems = {};
        if (!fb.uniformParts) fb.uniformParts = {};
        if (!fb.textures) fb.textures = {};
        const added = [];
        const alreadyPresent = [];
        const overwritten = [];
        const merge = (target, key, value) => {
            if (key in target) {
                if (same(target[key], value)) {
                    alreadyPresent.push(key);
                    return;
                }
                overwritten.push(key);
            } else {
                added.push(key);
            }
            target[key] = clone(value);
        };
        for (const [name, item] of Object.entries(bundle.items)) merge(fb.characterUniformItems, name, item);
        for (const kind of PART_KINDS) {
            if (!isObj(fb.uniformParts[kind])) fb.uniformParts[kind] = {};
            for (const [key, recipe] of Object.entries(bundle.parts[kind])) merge(fb.uniformParts[kind], key, recipe);
        }
        for (const [id, tex] of Object.entries(bundle.textures)) {
            if (id in fb.textures) {
                alreadyPresent.push(id);
                continue;
            }
            fb.textures[id] = clone(tex);
            added.push(id);
        }
        const seat = slots[i];
        const seatLabel = typeof seat.displayName === "string" ? seat.displayName : "";
        const elements = clone(bundle.slot?.uniform?.loadoutElements) || [];
        for (const el of elements) {
            if (!isObj(el)) continue;
            const line = itemDisplayNameFor(i, seatLabel, el.slotType);
            if (line !== null) el.itemDisplayName = line;
        }
        if (!isObj(seat.uniform)) seat.uniform = {};
        seat.uniform.loadoutElements = elements;
        const nowOrphan = unreferenced(next);
        const orphaned = [ ...nowOrphan ].filter(name => !wasOrphan.has(name));
        return {
            work: next,
            outgoing: outgoing,
            added: added,
            alreadyPresent: alreadyPresent,
            overwritten: overwritten,
            orphaned: orphaned
        };
    }
    const TOKEN_RE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
    const RESERVED_TOKENS = [ "home", "away" ];
    const ITEM_WORD = {
        helmets: "HELMET",
        jerseys: "JERSEY",
        pants: "PANTS",
        socks: "SOCKS"
    };
    const PART_WORD = {
        helmets: "helmet",
        jerseys: "jersey",
        pants: "pants",
        socks: "socks"
    };
    const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    function parseItemName(name, assetName) {
        if (typeof name !== "string" || !assetName) return null;
        const m = new RegExp(`^U_${reEsc(assetName)}_(HELMET|JERSEY|PANTS|SOCKS)_([A-Za-z0-9]+)$`).exec(name);
        if (!m) return null;
        return {
            kind: PART_KINDS.find(k => ITEM_WORD[k] === m[1]),
            token: m[2]
        };
    }
    function parsePartKey(key, assetName) {
        if (typeof key !== "string" || !assetName) return null;
        const m = new RegExp(`^${reEsc(assetName)}-([A-Za-z0-9]+)-(helmet|jersey|pants|socks)$`).exec(key);
        if (!m) return null;
        return {
            kind: PART_KINDS.find(k => PART_WORD[k] === m[2]),
            token: m[1]
        };
    }
    const itemNameFor = (assetName, kind, token) => `U_${assetName}_${ITEM_WORD[kind]}_${token}`;
    const partKeyFor = (assetName, kind, token) => `${assetName}-${token}-${PART_WORD[kind]}`;
    function tokenProblem(token) {
        if (typeof token !== "string" || !TOKEN_RE.test(token)) {
            return `the token ${JSON.stringify(token)} is not in Team Builder's grammar (a letter, then letters and digits, 32 at most)`;
        }
        if (RESERVED_TOKENS.includes(token.toLowerCase())) {
            return `the token ${token} is Team Builder's own Home/Away word`;
        }
        return null;
    }
    function tokenCollisions(work, token) {
        const hits = [];
        const bad = tokenProblem(token);
        if (bad) return {
            ok: false,
            error: bad,
            hits: hits
        };
        const fb = fbOf(work);
        const uniforms = uniformsOf(work);
        const assetName = assetNameOf(work);
        if (!fb || !uniforms || !assetName) {
            return {
                ok: false,
                error: "This roster carries no Team Builder uniforms. Pull the team from Team Builder first.",
                hits: hits
            };
        }
        const low = token.toLowerCase();
        const minted = new Set;
        for (const kind of PART_KINDS) {
            minted.add(itemNameFor(assetName, kind, token).toLowerCase());
            minted.add(partKeyFor(assetName, kind, token).toLowerCase());
        }
        const note = (where, name, extra) => {
            if (hits.some(h => h.where === where && h.name === name)) return;
            hits.push({
                where: where,
                name: name,
                ...extra || {}
            });
        };
        const judge = (where, name, extra) => {
            if (typeof name !== "string") return;
            if (minted.has(name.toLowerCase())) {
                note(where, name, extra);
                return;
            }
            const t = parseItemName(name, assetName)?.token ?? parsePartKey(name, assetName)?.token;
            if (t && t.toLowerCase() === low) note("token", name, extra);
        };
        for (const name of Object.keys(fb.characterUniformItems || {})) judge("item", name);
        for (const kind of PART_KINDS) {
            for (const key of Object.keys(fb.uniformParts?.[kind] || {})) judge("part", key, {
                kind: kind
            });
        }
        uniforms.forEach((entry, s) => {
            for (const el of elementsOf(entry)) judge("element", el?.itemAssetName, {
                seat: s
            });
        });
        return {
            ok: hits.length === 0,
            hits: hits
        };
    }
    function mintToken(work, stem) {
        const base = typeof stem === "string" && TOKEN_RE.test(stem) ? stem : "Locker";
        for (let n = 1; n < 1e3; n++) {
            const t = `${base}${n}`;
            if (tokenProblem(t)) break;
            if (tokenCollisions(work, t).ok) return t;
        }
        return null;
    }
    function tokenOfBundle(bundle) {
        const seen = new Set;
        for (const name of Object.keys(isObj(bundle?.items) ? bundle.items : {})) {
            const p = parseItemName(name, bundle.assetName);
            if (p) seen.add(p.token);
        }
        return seen.size === 1 ? [ ...seen ][0] : null;
    }
    function rekey(bundle, token, dest) {
        const bad = validate(bundle);
        if (bad) return {
            error: bad
        };
        bundle = migrate(bundle);
        const shape = tokenProblem(token);
        if (shape) return {
            error: shape
        };
        const work = dest?.work;
        const toSlot = dest?.toSlot;
        const uniforms = uniformsOf(work);
        if (!fbOf(work) || !uniforms) {
            return {
                error: "This roster carries no Team Builder uniforms. Pull the team from Team Builder first."
            };
        }
        const assetName = assetNameOf(work);
        const prefix = prefixOf(work);
        if (assetName !== bundle.assetName || prefix !== bundle.prefix) {
            return {
                error: `This design was banked from ${bundle.teamLabel || bundle.assetName}, so it cannot go on ${teamLabelOf(work) || assetName || "this team"}. Same team only.`
            };
        }
        if (typeof toSlot !== "number" || !Number.isInteger(toSlot)) {
            return {
                error: "No destination slot was named, so nothing was changed."
            };
        }
        if (toSlot < 0 || toSlot >= Math.min(uniforms.length, MAX_SLOTS)) {
            return {
                error: `There is no uniform slot ${seatNo(toSlot)} on this team. It has ${uniforms.length}.`
            };
        }
        if (toSlot === 0 || toSlot === 1) {
            return {
                error: `Slot ${seatNo(toSlot)} is ${toSlot === 0 ? "Home" : "Away"}, whose pieces use Team Builder's fixed names, so a design can only be re-keyed into slot 3 or above.`
            };
        }
        const destSeat = uniforms[toSlot];
        if (!isObj(destSeat)) return {
            error: `Uniform slot ${seatNo(toSlot)} is empty in this payload, so it has no fields to keep.`
        };
        const clash = tokenCollisions(work, token);
        if (!clash.ok) {
            const first = clash.hits[0];
            return {
                error: clash.error || `The token ${token} is already used on this team (${first.where} ${first.name}${Number.isInteger(first.seat) ? `, slot ${seatNo(first.seat)}` : ""}), so nothing was changed.`,
                hits: clash.hits
            };
        }
        const oldToken = tokenOfBundle(bundle);
        const itemMap = new Map;
        const partMap = new Map;
        for (const name of Object.keys(bundle.items)) {
            const p = parseItemName(name, bundle.assetName);
            if (!p) return {
                error: `the piece ${name} is not in Team Builder's naming grammar, so it cannot be re-keyed`
            };
            itemMap.set(name, itemNameFor(bundle.assetName, p.kind, token));
        }
        for (const kind of PART_KINDS) {
            for (const key of Object.keys(bundle.parts[kind])) {
                const p = parsePartKey(key, bundle.assetName);
                if (!p || p.kind !== kind) return {
                    error: `the recipe ${key} is not in Team Builder's naming grammar, so it cannot be re-keyed`
                };
                partMap.set(key, partKeyFor(bundle.assetName, kind, token));
            }
        }
        const rewrites = {
            itemKeys: 0,
            itemAssetName: 0,
            itemPartItem: 0,
            partKeys: 0,
            elementNames: 0
        };
        const conversions = {
            itemRowShape: 0,
            shoeSpelling: 0
        };
        const out = clone(bundle);
        out.items = {};
        for (const [name, row] of Object.entries(bundle.items)) {
            const next = clone(row);
            const newName = itemMap.get(name);
            rewrites.itemKeys++;
            if (typeof next.assetName === "string") {
                if (next.assetName !== name) return {
                    error: `the piece ${name} names itself ${next.assetName}, so it cannot be re-keyed`
                };
                next.assetName = newName;
                rewrites.itemAssetName++;
            }
            if (typeof next.partItem === "string" && next.partItem) {
                if (!partMap.has(next.partItem)) return {
                    error: `the piece ${name} points at ${next.partItem}, which the bundle does not carry`
                };
                next.partItem = partMap.get(next.partItem);
                rewrites.itemPartItem++;
            }
            if ("displayName" in next || next.secondarySlot !== next.primarySlot) {
                if ("displayName" in next) delete next.displayName;
                if (typeof next.primarySlot === "number") next.secondarySlot = next.primarySlot;
                conversions.itemRowShape++;
            }
            out.items[newName] = next;
        }
        for (const kind of PART_KINDS) {
            out.parts[kind] = {};
            for (const [key, recipe] of Object.entries(bundle.parts[kind])) {
                out.parts[kind][partMap.get(key)] = clone(recipe);
                rewrites.partKeys++;
            }
        }
        const slot = out.slot;
        if (!isObj(slot.uniform)) slot.uniform = {};
        const seatLabel = typeof destSeat.displayName === "string" ? destSeat.displayName : "";
        for (const el of elementsOf(slot)) {
            if (!isObj(el)) continue;
            const name = el.itemAssetName;
            if (itemMap.has(name)) {
                el.itemAssetName = itemMap.get(name);
                rewrites.elementNames++;
            } else if (ownedBy(name, bundle.assetName, bundle.prefix)) {
                return {
                    error: `the slot names ${name}, which the bundle does not carry`
                };
            } else if (typeof name === "string" && name.includes("/") && /U_GENERIC_SHOESX_/i.test(name)) {
                el.itemAssetName = name.slice(name.lastIndexOf("/") + 1);
                conversions.shoeSpelling++;
            }
            const line = itemDisplayNameFor(toSlot, seatLabel, el.slotType);
            if (line !== null) el.itemDisplayName = line;
        }
        for (const f of [ "displayName", "currentOfficial", "isCustom" ]) {
            if (f in destSeat) slot[f] = clone(destSeat[f]); else delete slot[f];
        }
        const du = isObj(destSeat.uniform) ? destSeat.uniform : {};
        for (const f of [ "loadoutType", "loadoutCategory", "displayOrder" ]) {
            if (f in du) slot.uniform[f] = clone(du[f]); else delete slot.uniform[f];
        }
        const newNames = seatNames(slot, bundle.assetName, bundle.prefix);
        out.fromSlot = toSlot;
        out.seatName = seatLabel;
        out.seatRole = seatRoleOf(toSlot);
        out.seatCount = uniforms.length;
        out.seatMap = uniforms.map((u, s) => s === toSlot ? newNames : seatNames(u, assetName, prefix));
        out.origin = "rekeyed";
        out.confirmedAt = null;
        out.token = token;
        out.rekeyedFrom = {
            fromSlot: bundle.fromSlot,
            seatName: bundle.seatName,
            token: oldToken
        };
        delete out.kitId;
        out.sig = signature(out);
        const still = validate(out);
        if (still) return {
            error: `the re-keyed design did not validate: ${still}`
        };
        return {
            bundle: out,
            renamed: {
                items: [ ...itemMap.entries() ],
                parts: [ ...partMap.entries() ]
            },
            rewrites: rewrites,
            conversions: conversions
        };
    }
    function placeInto(work, bundle, toSlot, token) {
        const t = token === undefined || token === null ? mintToken(work) : token;
        if (!t) return {
            error: "No fresh token could be minted for this team."
        };
        const k = rekey(bundle, t, {
            work: work,
            toSlot: toSlot
        });
        if (k.error) return k;
        const col = collisionsOf(work, k.bundle);
        if (col.outcome !== "clean") {
            return {
                error: `The re-keyed design still shares keys with another slot (${col.outcome}), so nothing was changed.`,
                hits: col.shared
            };
        }
        const r = restore(work, k.bundle);
        if (r.error) return {
            error: r.error
        };
        return {
            ...r,
            token: t,
            rekeyed: k.bundle,
            renamed: k.renamed,
            rewrites: k.rewrites,
            conversions: k.conversions
        };
    }
    const API = {
        BUNDLE_VERSION: BUNDLE_VERSION,
        MAX_SLOTS: MAX_SLOTS,
        PART_KINDS: PART_KINDS,
        SLOT_KIND: SLOT_KIND,
        KIND_LABEL: KIND_LABEL,
        OLDEST_VERSION: OLDEST_VERSION,
        rekey: rekey,
        tokenCollisions: tokenCollisions,
        mintToken: mintToken,
        placeInto: placeInto,
        tokenOfBundle: tokenOfBundle,
        parseItemName: parseItemName,
        parsePartKey: parsePartKey,
        extract: extract,
        restore: restore,
        validate: validate,
        migrate: migrate,
        signature: signature,
        collisionsOf: collisionsOf,
        seatStillMine: seatStillMine,
        refsOf: refsOf,
        prefixOf: prefixOf,
        assetNameOf: assetNameOf,
        teamLabelOf: teamLabelOf,
        brandIdOf: brandIdOf,
        imagesOf: imagesOf,
        uniformsOf: uniformsOf,
        seatNames: seatNames,
        hexOf: hexOf,
        pieceColours: pieceColours,
        itemDisplayNameFor: itemDisplayNameFor
    };
    const G = typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : globalThis;
    G.CFB27UniformBank = API;
    if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
