(function (global) {
  "use strict";

  var PASSWORD_REGISTER_SCOPE = "premium_password_register";
  var PASSWORD_REGISTER_ENCRYPTED_KEY = "entries_encrypted_v1";
  var PASSWORD_REGISTER_LEGACY_ENTRIES_KEY = "entries_json";
  var PASSWORD_REGISTER_KDF_ITERATIONS = 210000;
  var DEFAULT_PASSWORD_ENTRIES = [
    { id: 1, naam: "Hostinger", url: "hostinger.com", user: "hosting@example.test", pw: "voorbeeld-hosting", cat: "Hosting" },
    { id: 2, naam: "TransIP", url: "transip.nl", user: "dns@example.test", pw: "voorbeeld-domein", cat: "Hosting" },
    { id: 3, naam: "Google Workspace", url: "workspace.google.com", user: "workspace@example.test", pw: "voorbeeld-tools", cat: "Tools" },
    { id: 4, naam: "Instagram", url: "instagram.com", user: "socials@example.test", pw: "voorbeeld-socials", cat: "Socials" },
    { id: 5, naam: "LinkedIn", url: "linkedin.com", user: "sales@example.test", pw: "voorbeeld-linkedin", cat: "Socials" }
  ];

  function normalizeString(value) {
    return String(value == null ? "" : value).trim();
  }

  function cloneEntries(entries) {
    return (Array.isArray(entries) ? entries : []).map(function (entry) {
      return Object.assign({}, entry);
    });
  }

  function sanitizeEntry(entry, index) {
    var safeIndex = Number.isFinite(Number(index)) ? Number(index) : 0;
    var safeId = Number(entry && entry.id);
    var name = normalizeString(entry && entry.naam) || "Inlog " + (safeIndex + 1);
    var url = normalizeString(entry && entry.url) || "onbekend";
    var user = normalizeString(entry && entry.user);
    var pw = normalizeString(entry && entry.pw);
    var cat = normalizeString(entry && entry.cat) || "Overig";

    return {
      id: Number.isFinite(safeId) && safeId > 0 ? safeId : safeIndex + 1,
      naam: name,
      url: url,
      user: user,
      pw: pw,
      cat: cat
    };
  }

  function sanitizeEntries(rawEntries) {
    if (!Array.isArray(rawEntries)) {
      return DEFAULT_PASSWORD_ENTRIES.map(function (entry, index) {
        return sanitizeEntry(entry, index);
      });
    }

    var dedupedIds = new Set();
    var sanitized = rawEntries
      .map(function (entry, index) {
        return sanitizeEntry(entry, index);
      })
      .filter(function (entry) {
        if (dedupedIds.has(entry.id)) return false;
        dedupedIds.add(entry.id);
        return true;
      });

    if (sanitized.length) return sanitized;
    return DEFAULT_PASSWORD_ENTRIES.map(function (entry, index) {
      return sanitizeEntry(entry, index);
    });
  }

  function getNextId(entries) {
    return (Array.isArray(entries) ? entries : []).reduce(function (maxId, entry) {
      return Math.max(maxId, Number(entry && entry.id) || 0);
    }, 0) + 1;
  }

  function getWebCrypto() {
    var cryptoObj = global.crypto || {};
    if (!cryptoObj.subtle || typeof cryptoObj.getRandomValues !== "function") {
      throw new Error("Deze browser ondersteunt geen veilige WebCrypto-kluis.");
    }
    if (typeof TextEncoder !== "function" || typeof TextDecoder !== "function") {
      throw new Error("Deze browser mist tekstcodering voor de versleutelde kluis.");
    }
    return cryptoObj;
  }

  function getRandomBytes(length) {
    var bytes = new Uint8Array(length);
    getWebCrypto().getRandomValues(bytes);
    return bytes;
  }

  function bytesToBase64(bytes) {
    var chunks = [];
    var chunkSize = 0x8000;
    for (var index = 0; index < bytes.length; index += chunkSize) {
      chunks.push(String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize)));
    }
    return global.btoa(chunks.join(""));
  }

  function base64ToBytes(value) {
    var binary = global.atob(normalizeString(value));
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  async function deriveAesKey(masterSecret, saltBytes) {
    var cryptoObj = getWebCrypto();
    var encodedSecret = new TextEncoder().encode(normalizeString(masterSecret));
    if (!encodedSecret.length) {
      throw new Error("Master-wachtzin is verplicht om de kluis te openen.");
    }
    var baseKey = await cryptoObj.subtle.importKey("raw", encodedSecret, "PBKDF2", false, ["deriveKey"]);
    return cryptoObj.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: saltBytes,
        iterations: PASSWORD_REGISTER_KDF_ITERATIONS
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    var controller = new AbortController();
    var timeoutId = global.setTimeout(function () {
      controller.abort();
    }, timeoutMs || 12000);
    try {
      return await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
    } finally {
      global.clearTimeout(timeoutId);
    }
  }

  async function fetchUiStateGetWithFallback(scope) {
    if (global.SoftoraUiStateClient && typeof global.SoftoraUiStateClient.get === "function") {
      return global.SoftoraUiStateClient.get(scope);
    }
    var encodedScope = encodeURIComponent(String(scope || ""));
    var urls = ["/api/ui-state-get?scope=" + encodedScope, "/api/ui-state/" + encodedScope];
    var lastError = null;

    for (var index = 0; index < urls.length; index += 1) {
      try {
        var response = await fetchWithTimeout(urls[index], {
          method: "GET",
          cache: "no-store"
        }, 12000);
        if (!response.ok) {
          throw new Error("UI state GET mislukt (" + response.status + ")");
        }
        return await response.json().catch(function () {
          return {};
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("UI state GET mislukt");
  }

  async function fetchUiStateSetWithFallback(scope, body) {
    if (global.SoftoraUiStateClient && typeof global.SoftoraUiStateClient.set === "function") {
      return global.SoftoraUiStateClient.set(scope, body, { timeoutMs: 12000 });
    }
    var encodedScope = encodeURIComponent(String(scope || ""));
    var urls = ["/api/ui-state-set?scope=" + encodedScope, "/api/ui-state/" + encodedScope];
    var lastError = null;

    for (var index = 0; index < urls.length; index += 1) {
      try {
        var response = await fetchWithTimeout(urls[index], {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body || {})
        }, 12000);
        var data = await response.json().catch(function () {
          return {};
        });
        if (!response.ok) {
          throw new Error(normalizeString(data && data.error) || "UI state POST mislukt (" + response.status + ")");
        }
        return data;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("UI state POST mislukt");
  }

  function createStore(options) {
    var config = options || {};
    var cachedEntries = [];
    var entriesLoaded = false;
    var entriesLoadPromise = null;
    var currentKey = null;
    var currentSaltBytes = null;
    var setStatus = typeof config.setStatus === "function" ? config.setStatus : function () {};

    async function ensureUnlocked(masterSecret, preferredSaltBytes) {
      if (currentKey && currentSaltBytes) return;
      currentSaltBytes = preferredSaltBytes || getRandomBytes(16);
      currentKey = await deriveAesKey(masterSecret, currentSaltBytes);
    }

    async function encryptEntriesPayload(entries) {
      if (!currentKey || !currentSaltBytes) {
        throw new Error("Ontgrendel de kluis eerst met de master-wachtzin.");
      }
      var cryptoObj = getWebCrypto();
      var iv = getRandomBytes(12);
      var plainText = new TextEncoder().encode(JSON.stringify(sanitizeEntries(entries)));
      var cipherBytes = new Uint8Array(
        await cryptoObj.subtle.encrypt({ name: "AES-GCM", iv: iv }, currentKey, plainText)
      );
      return {
        version: 1,
        algorithm: "AES-GCM",
        kdf: "PBKDF2-SHA256",
        iterations: PASSWORD_REGISTER_KDF_ITERATIONS,
        salt: bytesToBase64(currentSaltBytes),
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(cipherBytes)
      };
    }

    async function decryptEntriesPayload(serializedPayload, masterSecret) {
      var payload = JSON.parse(normalizeString(serializedPayload));
      if (
        Number(payload && payload.version) !== 1 ||
        normalizeString(payload && payload.algorithm) !== "AES-GCM" ||
        normalizeString(payload && payload.kdf) !== "PBKDF2-SHA256"
      ) {
        throw new Error("Kluisformaat wordt niet ondersteund.");
      }
      var saltBytes = base64ToBytes(payload.salt);
      var iv = base64ToBytes(payload.iv);
      var cipherBytes = base64ToBytes(payload.ciphertext);
      var key = await deriveAesKey(masterSecret, saltBytes);
      var decrypted = await getWebCrypto().subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        cipherBytes
      );
      var parsedEntries = JSON.parse(new TextDecoder().decode(new Uint8Array(decrypted)));
      if (!Array.isArray(parsedEntries)) {
        throw new Error("Kluisinhoud is ongeldig.");
      }
      currentKey = key;
      currentSaltBytes = saltBytes;
      return sanitizeEntries(parsedEntries);
    }

    function parseLegacyEntries(serializedEntries) {
      if (!serializedEntries) return null;
      try {
        var parsedEntries = JSON.parse(serializedEntries);
        return Array.isArray(parsedEntries) ? parsedEntries : null;
      } catch (_) {
        return null;
      }
    }

    async function persist(entries, actor) {
      var sanitized = sanitizeEntries(entries).map(function (entry) {
        return Object.assign({}, entry);
      });
      var encryptedPayload = await encryptEntriesPayload(sanitized);
      var payload = {
        patch: {
          [PASSWORD_REGISTER_ENCRYPTED_KEY]: JSON.stringify(encryptedPayload),
          [PASSWORD_REGISTER_LEGACY_ENTRIES_KEY]: "",
          updated_at: new Date().toISOString(),
          updated_by: String(actor || "save")
        }
      };
      var response = await fetchUiStateSetWithFallback(PASSWORD_REGISTER_SCOPE, payload);
      var source = normalizeString(response && response.source);
      cachedEntries = cloneEntries(sanitized);
      entriesLoaded = true;
      if (source === "supabase") {
        setStatus("Versleutelde kluis is opgeslagen in Supabase.");
      } else {
        setStatus("Versleutelde kluis is tijdelijk opgeslagen, maar nog niet bevestigd vanuit Supabase.", "warning");
      }
      return { entries: cloneEntries(sanitized), response: response };
    }

    async function load(masterSecret) {
      if (entriesLoaded && currentKey) return cloneEntries(cachedEntries);
      if (entriesLoadPromise) return entriesLoadPromise;

      entriesLoadPromise = (async function () {
        var result = null;
        var loadedEntries;
        var source = "";
        try {
          result = await fetchUiStateGetWithFallback(PASSWORD_REGISTER_SCOPE);
          source = normalizeString(result && result.source);
        } catch (_) {
          result = null;
        }

        var values = (result && result.values && typeof result.values === "object") ? result.values : {};
        var encryptedEntries = normalizeString(values[PASSWORD_REGISTER_ENCRYPTED_KEY]);
        var legacyEntries = normalizeString(values[PASSWORD_REGISTER_LEGACY_ENTRIES_KEY]);

        if (encryptedEntries) {
          try {
            loadedEntries = await decryptEntriesPayload(encryptedEntries, masterSecret);
          } catch (_) {
            currentKey = null;
            currentSaltBytes = null;
            throw new Error("Master-wachtzin klopt niet of de versleutelde kluis is beschadigd.");
          }
          setStatus(source === "supabase" ? "Versleutelde kluis geladen vanuit Supabase." : "Versleutelde kluis geladen uit fallback-opslag.");
        } else {
          await ensureUnlocked(masterSecret);
          var parsedLegacyEntries = parseLegacyEntries(legacyEntries);
          if (parsedLegacyEntries && parsedLegacyEntries.length) {
            loadedEntries = sanitizeEntries(parsedLegacyEntries);
            await persist(loadedEntries, "legacy-migration");
            setStatus("Oude leesbare opslag is gemigreerd naar een versleutelde kluis.");
          } else {
            loadedEntries = sanitizeEntries(DEFAULT_PASSWORD_ENTRIES);
            setStatus(
              result
                ? "Voorbeeldgegevens geladen. Vervang deze en sla daarna op om echte gegevens versleuteld te bewaren."
                : "Kon Supabase niet laden. Veilige voorbeeldgegevens zijn lokaal geladen totdat je later opslaat.",
              "warning"
            );
          }
        }

        cachedEntries = cloneEntries(loadedEntries);
        entriesLoaded = true;
        return cloneEntries(loadedEntries);
      })();

      try {
        return await entriesLoadPromise;
      } finally {
        entriesLoadPromise = null;
      }
    }

    async function unlock(masterSecret) {
      currentKey = null;
      currentSaltBytes = null;
      cachedEntries = [];
      entriesLoaded = false;
      entriesLoadPromise = null;
      return load(masterSecret);
    }

    function lock() {
      currentKey = null;
      currentSaltBytes = null;
      cachedEntries = [];
      entriesLoaded = false;
      entriesLoadPromise = null;
    }

    return {
      getNextId: getNextId,
      load: load,
      lock: lock,
      normalizeString: normalizeString,
      persist: persist,
      sanitizeEntries: sanitizeEntries,
      sanitizeEntry: sanitizeEntry,
      unlock: unlock
    };
  }

  global.SoftoraPasswordRegisterStore = {
    create: createStore
  };
})(window);
