const memoryStore = new Map();

export const FORWARD_STORE_KEY = 'softora.paperResearch.forwardState.v1';
export const IMPROVEMENT_STORE_KEY = 'softora.paperResearch.improvementState.v1';

function getStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function readJson(key, fallback, storage) {
  const activeStorage = getStorage(storage);

  try {
    const raw = activeStorage ? activeStorage.getItem(key) : memoryStore.get(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key, value, storage) {
  const raw = JSON.stringify(value);
  const activeStorage = getStorage(storage);

  if (activeStorage) {
    activeStorage.setItem(key, raw);
  } else {
    memoryStore.set(key, raw);
  }

  return value;
}

export function removeJson(key, storage) {
  const activeStorage = getStorage(storage);
  if (activeStorage) {
    activeStorage.removeItem(key);
  } else {
    memoryStore.delete(key);
  }
}

export function loadForwardState(storage) {
  return readJson(FORWARD_STORE_KEY, null, storage);
}

export function saveForwardState(state, storage) {
  return writeJson(FORWARD_STORE_KEY, state, storage);
}

export function clearForwardState(storage) {
  removeJson(FORWARD_STORE_KEY, storage);
}

export function loadImprovementState(storage) {
  return readJson(IMPROVEMENT_STORE_KEY, null, storage);
}

export function saveImprovementState(state, storage) {
  return writeJson(IMPROVEMENT_STORE_KEY, state, storage);
}

export function clearImprovementState(storage) {
  removeJson(IMPROVEMENT_STORE_KEY, storage);
}

export function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}
