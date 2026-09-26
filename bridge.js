(function() {
    const P = window.CFB27BridgeProtocol;
    if (!P || !P.originAllowed(location.origin)) return;
    const postToPage = (type, payload) => {
        try {
            window.postMessage(P.message("ext", type, payload), location.origin);
        } catch {}
    };
    let port = null;
    let inFlight = false;
    function ensurePort() {
        if (port) return port;
        port = chrome.runtime.connect({
            name: "mrb-bridge"
        });
        port.onMessage.addListener(msg => {
            if (!msg || typeof msg.type !== "string") return;
            if (msg.type === "BRIDGE_DONE" || msg.type === "BRIDGE_FAIL" || msg.type === "BRIDGE_ROSTER") inFlight = false;
            postToPage(msg.type, msg.payload || {});
        });
        port.onDisconnect.addListener(() => {
            port = null;
            if (inFlight) {
                inFlight = false;
                postToPage("BRIDGE_FAIL", {
                    error: "The extension went away mid-delivery (service worker dropped or extension " + "reloaded). Check Team Builder: if its tab did not reload with your roster, " + "send again."
                });
            }
        });
        return port;
    }
    window.addEventListener("message", event => {
        if (event.source !== window || event.origin !== location.origin) return;
        const r = P.accept(event.data, event.origin, "site");
        if (r.drop) return;
        if (r.error) return postToPage("BRIDGE_FAIL", {
            error: r.error
        });
        if (r.msg.type === "BRIDGE_SEND" || r.msg.type === "BRIDGE_PULL") inFlight = true;
        try {
            ensurePort().postMessage({
                type: r.msg.type,
                payload: r.msg.payload
            });
        } catch {
            port = null;
            inFlight = false;
            postToPage("BRIDGE_FAIL", {
                error: "Could not reach the extension; it may have just updated. Reload this page and try again."
            });
        }
    });
})();
