(function () {
    "use strict";

    const triggers = document.querySelectorAll("[data-chatbot-trigger]");

    if (!triggers.length) return;

    if (!document.querySelector("link[data-softora-chatbot-styles]")) {
        const stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = "/assets/premium-website-chatbot.css?v=20260818a";
        stylesheet.setAttribute("data-softora-chatbot-styles", "true");
        document.head.appendChild(stylesheet);
    }

    document.body.insertAdjacentHTML(
        "beforeend",
        `
            <div class="softora-chatbot" id="softora-chatbot" role="dialog" aria-modal="true" aria-labelledby="softora-chatbot-title" aria-describedby="softora-chatbot-description" aria-hidden="true" hidden>
                <button type="button" class="softora-chatbot-backdrop" data-chatbot-close aria-label="Sluit chatbot"></button>
                <section class="softora-chatbot-panel" tabindex="-1">
                    <header class="softora-chatbot-header">
                        <div>
                            <span class="softora-chatbot-eyebrow">Softora chatbot</span>
                            <h2 id="softora-chatbot-title">Waar kan ik je mee helpen?</h2>
                            <p id="softora-chatbot-description">Stel je vraag over websites, software, voice of chatbots.</p>
                        </div>
                        <button type="button" class="softora-chatbot-close" data-chatbot-close aria-label="Sluit chatbot">×</button>
                    </header>
                    <div class="softora-chatbot-messages" id="softora-chatbot-messages" role="log" aria-live="polite" aria-relevant="additions">
                        <div class="softora-chatbot-message softora-chatbot-message--bot">Hoi! Ik denk met je mee. Waar ben je benieuwd naar?</div>
                    </div>
                    <div class="softora-chatbot-suggestions" aria-label="Voorbeeldvragen">
                        <button type="button" data-chatbot-suggestion="Wat kost een website?">Wat kost een website?</button>
                        <button type="button" data-chatbot-suggestion="Wat kunnen jullie bouwen?">Wat kunnen jullie bouwen?</button>
                        <button type="button" data-chatbot-suggestion="Ik wil contact opnemen">Ik wil contact opnemen</button>
                    </div>
                    <form class="softora-chatbot-form" id="softora-chatbot-form" autocomplete="off">
                        <label class="softora-chatbot-sr-only" for="softora-chatbot-input">Typ je vraag</label>
                        <input id="softora-chatbot-input" name="message" type="text" maxlength="500" placeholder="Typ je vraag…" enterkeyhint="send" required>
                        <button type="submit" aria-label="Verstuur bericht">Verstuur</button>
                    </form>
                    <p class="softora-chatbot-note">Je chat blijft op deze pagina en wordt niet opgeslagen.</p>
                </section>
            </div>
        `
    );

    const dialog = document.getElementById("softora-chatbot");
    const form = document.getElementById("softora-chatbot-form");
    const input = document.getElementById("softora-chatbot-input");
    const messages = document.getElementById("softora-chatbot-messages");

    if (!dialog || !form || !input || !messages) return;

    let previouslyFocused = null;
    let isOpen = false;

    const responseRules = [
        {
            pattern: /prijs|kost|kosten|budget|tarief/,
            answer: "De prijs hangt af van wat je nodig hebt. We maken eerst de scope scherp en geven daarna een concreet voorstel, zonder verrassingen."
        },
        {
            pattern: /bouw|bouwen|maken|maken jullie/,
            answer: "We bouwen websites, bedrijfssoftware, voicesoftware en chatbots op maat. Vertel wat je bedrijf nu nodig heeft, dan denk ik mee over de beste route."
        },
        {
            pattern: /website|webdesign|site/,
            answer: "We bouwen snelle, overtuigende websites die passen bij je merk en gericht zijn op aanvragen. Vertel gerust wat je nu mist."
        },
        {
            pattern: /bedrijfssoftware|software|crm|proces|automatis/,
            answer: "We bouwen maatwerksoftware voor processen die nu nog in losse Excel-bestanden, mailboxen of handwerk zitten."
        },
        {
            pattern: /voice|telefon|bellen|oproep/,
            answer: "Met voicesoftware kan een AI-agent gesprekken aannemen, kwalificeren en informatie doorzetten naar je team."
        },
        {
            pattern: /chatbot|bot|vragen|support/,
            answer: "Een chatbot kan veelgestelde vragen beantwoorden, bezoekers helpen kiezen en een goede aanvraag voorbereiden voor je team."
        },
        {
            pattern: /contact|whatsapp|afspraak|kennismak|spreken/,
            answer: "Je kunt via de contactknoppen op de pagina direct een bericht sturen of een kennismaking starten."
        },
        {
            pattern: /hoi|hallo|hey|goedemorgen|goedemiddag|goedenavond/,
            answer: "Hoi! Leuk dat je er bent. Vraag me iets over websites, bedrijfssoftware, voicesoftware of chatbots."
        }
    ];

    function scrollMessagesToBottom() {
        messages.scrollTop = messages.scrollHeight;
    }

    function addMessage(text, type) {
        const message = document.createElement("div");
        message.className = "softora-chatbot-message softora-chatbot-message--" + type;
        message.textContent = text;
        messages.appendChild(message);
        scrollMessagesToBottom();
    }

    function getBotResponse(value) {
        const normalized = String(value || "").trim().toLowerCase();
        const matchingRule = responseRules.find(function (rule) {
            return rule.pattern.test(normalized);
        });
        return matchingRule
            ? matchingRule.answer
            : "Goede vraag. Ik kan je helpen met websites, bedrijfssoftware, voicesoftware en chatbots. Welke richting past bij je vraag?";
    }

    function sendMessage(value) {
        const message = String(value || "").trim();
        if (!message) return;
        addMessage(message, "user");
        addMessage(getBotResponse(message), "bot");
    }

    function setTriggerState(expanded) {
        triggers.forEach(function (trigger) {
            trigger.setAttribute("aria-expanded", expanded ? "true" : "false");
        });
    }

    function openChatbot(event) {
        if (event) event.preventDefault();
        if (isOpen) return;
        previouslyFocused = document.activeElement;
        isOpen = true;
        dialog.hidden = false;
        dialog.setAttribute("aria-hidden", "false");
        setTriggerState(true);
        document.body.classList.add("chatbot-open");
        window.requestAnimationFrame(function () {
            input.focus();
            scrollMessagesToBottom();
        });
    }

    function closeChatbot(event) {
        if (event) event.preventDefault();
        if (!isOpen) return;
        isOpen = false;
        dialog.hidden = true;
        dialog.setAttribute("aria-hidden", "true");
        setTriggerState(false);
        document.body.classList.remove("chatbot-open");
        if (previouslyFocused && typeof previouslyFocused.focus === "function") {
            previouslyFocused.focus();
        }
    }

    triggers.forEach(function (trigger) {
        trigger.addEventListener("click", openChatbot);
        trigger.addEventListener("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") {
                openChatbot(event);
            }
        });
    });

    dialog.querySelectorAll("[data-chatbot-close]").forEach(function (closeButton) {
        closeButton.addEventListener("click", closeChatbot);
    });

    dialog.querySelectorAll("[data-chatbot-suggestion]").forEach(function (suggestion) {
        suggestion.addEventListener("click", function () {
            const value = suggestion.getAttribute("data-chatbot-suggestion") || "";
            input.value = value;
            form.requestSubmit();
        });
    });

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        sendMessage(input.value);
        input.value = "";
        input.focus();
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && isOpen) {
            closeChatbot(event);
        }
    });
})();
