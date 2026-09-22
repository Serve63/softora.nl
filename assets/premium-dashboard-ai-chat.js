(function (root, createChat) {
    if (typeof module === 'object' && module.exports) module.exports = createChat;
    else {
        root.SoftoraDashboardAiChat = createChat(root);
        root.SoftoraDashboardAiChat.mount();
    }
})(typeof window !== 'undefined' ? window : globalThis, function createChat(root) {
    let active = null;

    function mount(container = root.document) {
    const chatRoot = container?.id === 'dashboardAiChat'
        ? container
        : container?.querySelector?.('#dashboardAiChat');
    if (!chatRoot) return null;
    if (active?.root === chatRoot) return active;
    active?.dispose();
    const doc = chatRoot.ownerDocument || root.document;
    const find = (id) => chatRoot.querySelector(`#${id}`);

    const toggleButton = find('dashboardAiChatToggle');
    const closeButton = find('dashboardAiChatClose');
    const panel = find('dashboardAiChatPanel');
    const messagesEl = find('dashboardAiChatMessages');
    const statusEl = find('dashboardAiChatStatus');
    const form = find('dashboardAiChatForm');
    const input = find('dashboardAiChatInput');
    const sendButton = find('dashboardAiChatSend');

    if (!toggleButton || !closeButton || !panel || !messagesEl || !statusEl || !form || !input || !sendButton) {
        return null;
    }

    const requestController = new AbortController();
    const listeners = [];
    let disposed = false;
    let focusTimer = null;
    function listen(target, eventName, handler) {
        target.addEventListener(eventName, handler);
        listeners.push(() => target.removeEventListener(eventName, handler));
    }

    const CHAT_ENDPOINTS = ['/api/ai/ruben-chat', '/api/ai/dashboard-chat', '/api/ai-dashboard-chat'];
    const MAX_MESSAGES = 30;
    const state = {
        open: false,
        sending: false,
        messages: []
    };

    function normalizeStoredMessages(rawList) {
        if (!Array.isArray(rawList)) return [];
        return rawList
            .map((item) => {
                if (!item || typeof item !== 'object') return null;
                const role = item.role === 'assistant' ? 'assistant' : 'user';
                const content = String(item.content || '').trim();
                if (!content) return null;
                return { role, content };
            })
            .filter(Boolean)
            .slice(-MAX_MESSAGES);
    }

    function readStoredMessages() {
        return [];
    }

    function writeStoredMessages() {
        return;
    }

    function formatStatus(text, tone) {
        statusEl.textContent = String(text || '');
        statusEl.classList.toggle('is-ok', tone === 'ok');
        statusEl.classList.toggle('is-error', tone === 'error');
    }

    function escapeChatHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderChatInlineMarkdown(text) {
        return String(text || '')
            .replace(/`([^`]+)`/g, '<strong>$1</strong>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/__([^_]+)__/g, '<strong>$1</strong>');
    }

    function renderAssistantMarkdown(content) {
        const safeContent = escapeChatHtml(String(content || '').trim());
        if (!safeContent) return '';

        const lines = safeContent.split(/\r?\n/);
        const blocks = [];
        let paragraphLines = [];
        let listType = null;
        let listItems = [];

        function flushParagraph() {
            if (!paragraphLines.length) return;
            const text = paragraphLines.join(' ').trim();
            if (text) {
                blocks.push(`<p>${renderChatInlineMarkdown(text)}</p>`);
            }
            paragraphLines = [];
        }

        function flushList() {
            if (!listType || !listItems.length) {
                listType = null;
                listItems = [];
                return;
            }
            blocks.push(
                `<${listType}>${listItems
                    .map((item) => `<li>${renderChatInlineMarkdown(item)}</li>`)
                    .join('')}</${listType}>`
            );
            listType = null;
            listItems = [];
        }

        lines.forEach((rawLine) => {
            const line = String(rawLine || '').trim();
            if (!line) {
                flushParagraph();
                flushList();
                return;
            }

            const headingMatch = line.match(/^(#{2,4})\s+(.+)$/);
            if (headingMatch) {
                flushParagraph();
                flushList();
                const depth = Math.min(4, Math.max(2, headingMatch[1].length));
                blocks.push(`<h${depth}>${renderChatInlineMarkdown(headingMatch[2])}</h${depth}>`);
                return;
            }

            const bulletMatch = line.match(/^[-*]\s+(.+)$/);
            if (bulletMatch) {
                flushParagraph();
                if (listType !== 'ul') {
                    flushList();
                    listType = 'ul';
                }
                listItems.push(bulletMatch[1]);
                return;
            }

            const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
            if (orderedMatch) {
                flushParagraph();
                if (listType !== 'ol') {
                    flushList();
                    listType = 'ol';
                }
                listItems.push(orderedMatch[1]);
                return;
            }

            flushList();
            paragraphLines.push(line);
        });

        flushParagraph();
        flushList();

        return blocks.join('') || `<p>${renderChatInlineMarkdown(safeContent)}</p>`;
    }

    function renderMessageBubbleContent(bubble, item) {
        if (item.role === 'assistant') {
            bubble.innerHTML = renderAssistantMarkdown(item.content);
            return;
        }
        bubble.textContent = item.content;
    }

    function scrollMessagesToBottom() {
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderMessages(typing) {
        messagesEl.innerHTML = '';

        state.messages.forEach((item) => {
            const row = doc.createElement('div');
            row.className = `dashboard-ai-chat-message ${item.role === 'assistant' ? 'is-assistant' : 'is-user'}`;

            const bubble = doc.createElement('div');
            bubble.className = 'dashboard-ai-chat-bubble';
            renderMessageBubbleContent(bubble, item);

            row.appendChild(bubble);
            messagesEl.appendChild(row);
        });

        if (typing) {
            const row = doc.createElement('div');
            row.className = 'dashboard-ai-chat-message is-assistant is-typing';

            const bubble = doc.createElement('div');
            bubble.className = 'dashboard-ai-chat-bubble';
            bubble.textContent = 'Ruben Nijhuis denkt na...';

            row.appendChild(bubble);
            messagesEl.appendChild(row);
        }

        scrollMessagesToBottom();
    }

    function setOpen(nextOpen) {
        const shouldOpen = Boolean(nextOpen);
        state.open = shouldOpen;
        chatRoot.setAttribute('data-open', shouldOpen ? 'true' : 'false');
        panel.hidden = !shouldOpen;
        toggleButton.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
        if (shouldOpen) {
            if (focusTimer !== null) root.clearTimeout(focusTimer);
            focusTimer = root.setTimeout(() => {
                focusTimer = null;
                if (disposed || !state.open) return;
                input.focus();
                scrollMessagesToBottom();
            }, 0);
        }
    }

    function setSending(nextSending) {
        state.sending = Boolean(nextSending);
        input.disabled = state.sending;
        sendButton.disabled = state.sending || !String(input.value || '').trim();
    }

    function getActiveAiManagementContext() {
        const fallback = {
            mode: 'personnel',
            label: 'PERSONEEL BEHEER',
            instruction: 'AI-beheermodus: personeel. Focus op medewerkers, planning, agenda, rollen, bevestigingsmails en personeelsprocessen.',
        };
        const manager = root.SoftoraDashboardAiManagement;
        if (!manager || typeof manager.getContext !== 'function') return fallback;
        const context = manager.getContext();
        if (!context || typeof context !== 'object') return fallback;
        return {
            mode: context.mode === 'personnel' ? 'personnel' : 'software',
            label: String(context.label || fallback.label),
            instruction: String(context.instruction || fallback.instruction),
        };
    }

    function syncAiManagementChatInput() {
        const context = getActiveAiManagementContext();
        input.placeholder =
            context.mode === 'personnel'
                ? 'Vraag Ruben om personeel te regelen...'
                : 'Vraag Ruben om software te regelen...';
    }

    function appendMessage(role, content) {
        const safeRole = role === 'assistant' ? 'assistant' : 'user';
        const safeContent = String(content || '').trim();
        if (!safeContent) return;
        state.messages.push({
            role: safeRole,
            content: safeContent
        });
        if (state.messages.length > MAX_MESSAGES) {
            state.messages = state.messages.slice(-MAX_MESSAGES);
        }
        writeStoredMessages();
    }

    async function requestDashboardAi(payload) {
        let lastError = null;

        for (const url of CHAT_ENDPOINTS) {
            if (requestController.signal.aborted) throw new Error('AI request afgebroken');
            try {
                const response = await root.fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {}),
                    signal: requestController.signal,
                });
                const data = await response.json().catch(() => ({}));
                if (requestController.signal.aborted) throw new Error('AI request afgebroken');
                if (!response.ok || !data?.ok) {
                    throw new Error(
                        String(data?.detail || data?.error || `AI request mislukt (${response.status})`)
                    );
                }
                return data;
            } catch (error) {
                if (requestController.signal.aborted) throw error;
                lastError = error;
            }
        }

        throw lastError || new Error('AI request mislukt');
    }

    async function sendCurrentMessage() {
        if (disposed || state.sending) return;
        const question = String(input.value || '').trim();
        if (!question) return;

        input.value = '';
        appendMessage('user', question);
        renderMessages(true);
        formatStatus('Ruben Nijhuis verwerkt je vraag...', '');
        setSending(true);

        try {
            const history = state.messages
                .slice(0, -1)
                .slice(-10)
                .map((item) => ({
                    role: item.role === 'assistant' ? 'assistant' : 'user',
                    content: item.content
                }));
            const managementContext = getActiveAiManagementContext();

            const data = await requestDashboardAi({
                question,
                history: [
                    { role: 'user', content: managementContext.instruction },
                    ...history,
                ],
                aiManagementMode: managementContext.mode
            });
            if (disposed) return;
            const answer = String(data?.answer || '').trim() || 'Geen antwoord ontvangen.';
            appendMessage('assistant', answer);
            renderMessages(false);
            formatStatus('', '');
        } catch (error) {
            if (disposed) return;
            appendMessage(
                'assistant',
                'Ik kon nu geen antwoord ophalen. Probeer het opnieuw over een paar seconden.'
            );
            renderMessages(false);
            formatStatus(String(error?.message || 'Onbekende fout'), 'error');
        } finally {
            if (disposed) return;
            setSending(false);
            input.focus();
        }
    }

    state.messages = readStoredMessages();
    if (!state.messages.length) {
        appendMessage(
            'assistant',
            'Hoi, ik ben Ruben Nijhuis. Ik ken de Softora-software via actuele read-only context en geef kort antwoord over klanten, opdrachten, agenda, calls, database, mailbox en recente software-activiteit.'
        );
    }
    renderMessages(false);
    setSending(false);
    syncAiManagementChatInput();

    listen(root, 'softora-dashboard-ai-management-change', syncAiManagementChatInput);

    listen(toggleButton, 'click', () => {
        setOpen(!state.open);
    });

    listen(closeButton, 'click', () => {
        setOpen(false);
    });

    listen(form, 'submit', (event) => {
        event.preventDefault();
        void sendCurrentMessage();
    });

    listen(input, 'input', () => {
        sendButton.disabled = state.sending || !String(input.value || '').trim();
    });

    listen(input, 'keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void sendCurrentMessage();
        }
    });

    listen(doc, 'keydown', (event) => {
        if (event.key === 'Escape' && state.open) {
            setOpen(false);
        }
    });
    listen(root, 'pagehide', dispose);
    toggleButton.dataset.softoraActionBound = 'true';

    function dispose() {
        if (disposed) return;
        disposed = true;
        requestController.abort();
        if (focusTimer !== null) root.clearTimeout(focusTimer);
        listeners.forEach((remove) => remove());
        setOpen(false);
        input.disabled = false;
        sendButton.disabled = !String(input.value || '').trim();
        delete toggleButton.dataset.softoraActionBound;
        if (active?.root === chatRoot) active = null;
    }

    active = Object.freeze({ root: chatRoot, dispose });
    return active;
    }

    return Object.freeze({ mount, dispose: () => active?.dispose() });
});
