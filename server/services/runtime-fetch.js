const { withOpenAiContextHeaders } = require('./openai-request-context');

function createRuntimeFetchController(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal) {
    if (parentSignal.aborted) abortFromParent();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener?.('abort', abortFromParent);
    },
  };
}

async function fetchJsonWithTimeout(url, options, timeoutMs = 15000) {
  const controller = createRuntimeFetchController(options?.signal, timeoutMs);

  try {
    const response = await fetch(
      url,
      withOpenAiContextHeaders(url, { ...options, signal: controller.signal })
    );
    const text = await response.text();
    let data = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    return { response, data };
  } finally {
    controller.cleanup();
  }
}

async function fetchTextWithTimeout(url, options, timeoutMs = 15000) {
  const controller = createRuntimeFetchController(options?.signal, timeoutMs);

  try {
    const response = await fetch(
      url,
      withOpenAiContextHeaders(url, { ...options, signal: controller.signal })
    );
    const text = await response.text();
    return { response, text };
  } finally {
    controller.cleanup();
  }
}

async function fetchBinaryWithTimeout(url, options, timeoutMs = 15000) {
  const controller = createRuntimeFetchController(options?.signal, timeoutMs);

  try {
    const response = await fetch(
      url,
      withOpenAiContextHeaders(url, { ...options, signal: controller.signal })
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    return { response, bytes };
  } finally {
    controller.cleanup();
  }
}

module.exports = {
  fetchBinaryWithTimeout,
  fetchJsonWithTimeout,
  fetchTextWithTimeout,
};
