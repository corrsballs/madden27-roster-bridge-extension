const reported = new Set;

const cdnSeen = [];

try {
    performance.setResourceTimingBufferSize(1e3);
    performance.addEventListener?.("resourcetimingbufferfull", () => {
        scanBuffer();
        try {
            performance.clearResourceTimings();
        } catch {}
    });
} catch {}

function teamIdFromUrl(href = location.href) {
    try {
        const match = new URL(href).pathname.match(TEAM_PAGE);
        return match ? match[1] : "";
    } catch {
        return "";
    }
}

function send(type, payload) {
    try {
        chrome.runtime.sendMessage({
            type: type,
            payload: payload
        }, () => void chrome.runtime.lastError);
    } catch {}
}

function noteCdn(url) {
    if (!(EA_CDN.test(url) || EA_STATIC.test(url)) || cdnSeen.includes(url)) return;
    cdnSeen.push(url);
    if (cdnSeen.length > 60) cdnSeen.shift();
}

function reportUrl(url) {
    if (!url) return;
    noteCdn(url);
    if (reported.has(url) || !ROSTER_JSON.test(url)) return;
    reported.add(url);
    send("TB_URL_FOUND", {
        url: url,
        pageUrl: location.href,
        teamId: teamIdFromUrl(),
        title: document.title,
        seenAt: Date.now()
    });
}

function reportPage() {
    send("TB_PAGE_SEEN", {
        pageUrl: location.href,
        teamId: teamIdFromUrl(),
        title: document.title,
        active: document.visibilityState === "visible",
        seenAt: Date.now()
    });
}

function scanBuffer() {
    try {
        for (const entry of performance.getEntriesByType("resource")) reportUrl(entry.name);
    } catch {}
}

try {
    new PerformanceObserver(list => {
        for (const entry of list.getEntries()) reportUrl(entry.name);
    }).observe({
        type: "resource",
        buffered: true
    });
} catch {
    try {
        new PerformanceObserver(list => {
            for (const entry of list.getEntries()) reportUrl(entry.name);
        }).observe({
            entryTypes: [ "resource" ]
        });
    } catch {}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "TB_RESCAN") {
        reported.clear();
        scanBuffer();
        reportPage();
        sendResponse({
            ok: true,
            teamId: teamIdFromUrl(),
            pageUrl: location.href
        });
        return false;
    }
    if (message?.type === "TB_PING") {
        let resourceCount = 0;
        try {
            resourceCount = performance.getEntriesByType("resource").length;
        } catch {}
        sendResponse({
            ok: true,
            pageUrl: location.href,
            teamId: teamIdFromUrl(),
            resourceCount: resourceCount,
            rosterUrls: [ ...reported ],
            cdnSample: cdnSeen.slice(-25)
        });
        return false;
    }
    if (message?.type === "TB_TICKETS") {
        sendResponse({
            ok: true,
            roster: /\/team-create\/roster\//i.test(location.pathname),
            tickets: document.querySelectorAll("app-players-tickets button.player-ticket").length
        });
        return false;
    }
    return false;
});

scanBuffer();

reportPage();

const scanTimer = setInterval(() => {
    scanBuffer();
    if (reported.size) stopPolling();
}, 2e3);

const pageTimer = setInterval(reportPage, 4e3);

function stopPolling() {
    clearInterval(scanTimer);
    clearInterval(pageTimer);
}

if (reported.size) stopPolling();

for (const event of [ "focus", "pageshow", "visibilitychange" ]) {
    (event === "visibilitychange" ? document : window).addEventListener(event, reportPage);
}
