(function () {
    const DEFAULT_AGENT_ID = "agent_9801kk75c5c9e8gtqhcc9zwbtef3";
    const DEFAULT_AGENT_NAME = "Ruben Nijhuis";
    const config = window.SoftoraElevenLabsAgent || {};
    const agentId = String(config.agentId || DEFAULT_AGENT_ID).trim();
    const agentName = String(config.agentName || DEFAULT_AGENT_NAME).trim() || DEFAULT_AGENT_NAME;

    if (!agentId) return;

    function ensureWidgetScript() {
        if (document.querySelector('script[data-softora-elevenlabs-widget="true"]')) return;
        const script = document.createElement("script");
        script.src = "https://elevenlabs.io/convai-widget/index.js";
        script.async = true;
        script.setAttribute("data-softora-elevenlabs-widget", "true");
        document.head.appendChild(script);
    }

    function ensureWidgetStyles() {
        if (document.getElementById("softora-elevenlabs-widget-style")) return;
        const style = document.createElement("style");
        style.id = "softora-elevenlabs-widget-style";
        style.textContent = [
            'elevenlabs-convai[data-softora-elevenlabs-agent="true"] {',
            "    position: relative;",
            "    z-index: 10030;",
            "}",
            'body:has(elevenlabs-convai[data-softora-elevenlabs-agent="true"]:hover) {',
            "    cursor: auto !important;",
            "}",
            'body:has(elevenlabs-convai[data-softora-elevenlabs-agent="true"]:hover) .cursor,',
            'body:has(elevenlabs-convai[data-softora-elevenlabs-agent="true"]:hover) .cursor-dot {',
            "    opacity: 0;",
            "}",
        ].join("\n");
        document.head.appendChild(style);
    }

    function mountWidget() {
        if (document.querySelector('elevenlabs-convai[data-softora-elevenlabs-agent="true"]')) return;

        const widget = document.createElement("elevenlabs-convai");
        widget.setAttribute("agent-id", agentId);
        widget.setAttribute("data-softora-elevenlabs-agent", "true");
        widget.setAttribute("aria-label", "Praat met " + agentName);
        document.body.appendChild(widget);
    }

    function init() {
        if (!document.body) return;
        ensureWidgetStyles();
        ensureWidgetScript();
        mountWidget();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
        return;
    }

    init();
})();
