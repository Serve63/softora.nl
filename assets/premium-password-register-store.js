(function (global) {
  "use strict";

  var PASSWORD_REGISTER_SCOPE = "premium_password_register";
  var PASSWORD_REGISTER_ENCRYPTED_KEY = "entries_encrypted_v1";
  var PASSWORD_REGISTER_LEGACY_ENTRIES_KEY = "entries_json";
  var PASSWORD_REGISTER_LEGACY_ENVELOPE_VERSION = 1;
  var PASSWORD_REGISTER_CURRENT_ENVELOPE_VERSION = 2;
  var PASSWORD_REGISTER_LEGACY_KDF_ITERATIONS = 210000;
  var PASSWORD_REGISTER_CURRENT_KDF_ITERATIONS = 600000;
  var PASSWORD_REGISTER_MIN_MASTER_SECRET_LENGTH = 20;
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

  function wipeEntries(entries) {
    (Array.isArray(entries) ? entries : []).forEach(function (entry) {
      if (!entry || typeof entry !== "object") return;
      Object.keys(entry).forEach(function (key) {
        entry[key] = "";
      });
    });
  }

  function sanitizeEntry(entry, index) {
    var safeIndex = Number.isFinite(Number(index)) ? Number(index) : 0;
    var safeId = Number(entry && entry.id);
    var name = normalizeString(entry && entry.naam) || "Inlog " + (safeIndex + 1);
    var url = normalizeString(entry && entry.url) || "onbekend";
    var user = normalizeString(entry && entry.user);
    var pw = String(entry && entry.pw != null ? entry.pw : "");
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

  function validateNewMasterSecret(masterSecret) {
    var normalizedSecret = normalizeString(masterSecret);
    var characterCount = Array.from(normalizedSecret).length;
    if (characterCount < PASSWORD_REGISTER_MIN_MASTER_SECRET_LENGTH) {
      return { ok: false, error: "Gebruik een unieke master-wachtzin van minimaal 20 tekens." };
    }
    if (new Set(Array.from(normalizedSecret.toLowerCase())).size < 4) {
      return {
        ok: false,
        error: "Kies een minder voorspelbare master-wachtzin met verschillende tekens."
      };
    }
    return { ok: true, error: "" };
  }

  function resolveEnvelopeParameters(payload) {
    var version = Number(payload && payload.version);
    var iterations = Number(payload && payload.iterations);
    var expectedIterations = version === PASSWORD_REGISTER_LEGACY_ENVELOPE_VERSION
      ? PASSWORD_REGISTER_LEGACY_KDF_ITERATIONS
      : PASSWORD_REGISTER_CURRENT_KDF_ITERATIONS;
    if (
      (version !== PASSWORD_REGISTER_LEGACY_ENVELOPE_VERSION && version !== PASSWORD_REGISTER_CURRENT_ENVELOPE_VERSION) ||
      normalizeString(payload && payload.algorithm) !== "AES-GCM" ||
      normalizeString(payload && payload.kdf) !== "PBKDF2-SHA256" ||
      !Number.isSafeInteger(iterations) ||
      iterations !== expectedIterations
    ) {
      throw new Error("Kluisformaat wordt niet ondersteund.");
    }
    return { version: version, iterations: iterations };
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

  async function deriveAesKey(masterSecret, saltBytes, iterations) {
    var cryptoObj = getWebCrypto();
    var encodedSecret = new TextEncoder().encode(normalizeString(masterSecret));
    if (!encodedSecret.length) {
      throw new Error("Master-wachtzin is verplicht om de kluis te openen.");
    }
    try {
      var baseKey = await cryptoObj.subtle.importKey("raw", encodedSecret, "PBKDF2", false, ["deriveKey"]);
      return await cryptoObj.subtle.deriveKey(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt: saltBytes,
          iterations: iterations
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
    } finally {
      encodedSecret.fill(0);
    }
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
    var currentEnvelopeSerialized = "";
    var sessionGeneration = 0;
    var writeQueue = Promise.resolve();
    var securityState = {
      envelopeVersion: null,
      kdfIterations: null,
      masterSecretMeetsPolicy: true,
      v2UpgradePending: false
    };
    var setStatus = typeof config.setStatus === "function" ? config.setStatus : function () {};

    function assertActiveGeneration(expectedGeneration) {
      if (expectedGeneration !== sessionGeneration) {
        var error = new Error("De kluis is tijdens de beveiligingsactie vergrendeld.");
        error.code = "PASSWORD_REGISTER_LOCKED";
        throw error;
      }
    }

    function markRequiresFreshUnlock(error, fallbackCode) {
      var safeError = error instanceof Error ? error : new Error("Kluisactie mislukt.");
      safeError.code = normalizeString(safeError.code) || String(fallbackCode || "PASSWORD_REGISTER_WRITE_UNCERTAIN");
      safeError.forceLock = true;
      safeError.requiresFreshRead = true;
      return safeError;
    }

    function enqueueWrite(operation) {
      var expectedGeneration = sessionGeneration;
      var queued = writeQueue.then(async function () {
        assertActiveGeneration(expectedGeneration);
        return operation(expectedGeneration);
      });
      writeQueue = queued.catch(function () {});
      return queued;
    }

    async function ensureUnlocked(masterSecret, preferredSaltBytes, expectedGeneration, enforcePolicy) {
      assertActiveGeneration(expectedGeneration);
      if (currentKey && currentSaltBytes) return;
      if (enforcePolicy) {
        var policy = validateNewMasterSecret(masterSecret);
        if (!policy.ok) throw new Error(policy.error);
      }
      var nextSaltBytes = preferredSaltBytes || getRandomBytes(16);
      var nextKey = await deriveAesKey(
        masterSecret,
        nextSaltBytes,
        PASSWORD_REGISTER_LEGACY_KDF_ITERATIONS
      );
      assertActiveGeneration(expectedGeneration);
      currentSaltBytes = nextSaltBytes;
      currentKey = nextKey;
      securityState = {
        envelopeVersion: PASSWORD_REGISTER_LEGACY_ENVELOPE_VERSION,
        kdfIterations: PASSWORD_REGISTER_LEGACY_KDF_ITERATIONS,
        masterSecretMeetsPolicy: validateNewMasterSecret(masterSecret).ok,
        v2UpgradePending: true
      };
    }

    async function encryptEntriesPayload(entries, key, saltBytes) {
      if (!key || !saltBytes) {
        throw new Error("Ontgrendel de kluis eerst met de master-wachtzin.");
      }
      var cryptoObj = getWebCrypto();
      var iv = getRandomBytes(12);
      var plainText = new TextEncoder().encode(JSON.stringify(sanitizeEntries(entries)));
      try {
        var cipherBytes = new Uint8Array(
          await cryptoObj.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, plainText)
        );
        return {
          version: PASSWORD_REGISTER_LEGACY_ENVELOPE_VERSION,
          algorithm: "AES-GCM",
          kdf: "PBKDF2-SHA256",
          iterations: PASSWORD_REGISTER_LEGACY_KDF_ITERATIONS,
          salt: bytesToBase64(saltBytes),
          iv: bytesToBase64(iv),
          ciphertext: bytesToBase64(cipherBytes)
        };
      } finally {
        plainText.fill(0);
      }
    }

    async function decryptEntriesPayload(serializedPayload, masterSecret, expectedGeneration) {
      var payload = JSON.parse(normalizeString(serializedPayload));
      var envelope = resolveEnvelopeParameters(payload);
      var saltBytes = base64ToBytes(payload.salt);
      var iv = base64ToBytes(payload.iv);
      var cipherBytes = base64ToBytes(payload.ciphertext);
      if (saltBytes.length !== 16 || iv.length !== 12 || cipherBytes.length < 17) {
        throw new Error("Kluisformaat wordt niet ondersteund.");
      }
      var key = await deriveAesKey(masterSecret, saltBytes, envelope.iterations);
      var decryptedBytes = new Uint8Array(
        await getWebCrypto().subtle.decrypt({ name: "AES-GCM", iv: iv }, key, cipherBytes)
      );
      try {
        var parsedEntries = JSON.parse(new TextDecoder().decode(decryptedBytes));
        if (!Array.isArray(parsedEntries)) {
          throw new Error("Kluisinhoud is ongeldig.");
        }
        assertActiveGeneration(expectedGeneration);
        var loadedEntries = sanitizeEntries(parsedEntries);
        if (envelope.version === PASSWORD_REGISTER_LEGACY_ENVELOPE_VERSION) {
          currentKey = key;
          currentSaltBytes = saltBytes;
        } else {
          var legacyWriteSaltBytes = getRandomBytes(16);
          var legacyWriteKey = await deriveAesKey(
            masterSecret,
            legacyWriteSaltBytes,
            PASSWORD_REGISTER_LEGACY_KDF_ITERATIONS
          );
          assertActiveGeneration(expectedGeneration);
          currentKey = legacyWriteKey;
          currentSaltBytes = legacyWriteSaltBytes;
        }
        currentEnvelopeSerialized = normalizeString(serializedPayload);
        securityState = {
          envelopeVersion: envelope.version,
          kdfIterations: envelope.iterations,
          masterSecretMeetsPolicy: validateNewMasterSecret(masterSecret).ok,
          v2UpgradePending: envelope.version !== PASSWORD_REGISTER_CURRENT_ENVELOPE_VERSION
        };
        wipeEntries(parsedEntries);
        return loadedEntries;
      } finally {
        decryptedBytes.fill(0);
      }
    }

    async function verifyMasterSecretAgainstEnvelope(serializedPayload, masterSecret) {
      if (!normalizeString(serializedPayload) || !normalizeString(masterSecret)) return false;
      var decryptedBytes = null;
      try {
        var payload = JSON.parse(normalizeString(serializedPayload));
        var envelope = resolveEnvelopeParameters(payload);
        var saltBytes = base64ToBytes(payload.salt);
        var iv = base64ToBytes(payload.iv);
        var cipherBytes = base64ToBytes(payload.ciphertext);
        if (saltBytes.length !== 16 || iv.length !== 12 || cipherBytes.length < 17) return false;
        var key = await deriveAesKey(masterSecret, saltBytes, envelope.iterations);
        decryptedBytes = new Uint8Array(
          await getWebCrypto().subtle.decrypt({ name: "AES-GCM", iv: iv }, key, cipherBytes)
        );
        JSON.parse(new TextDecoder().decode(decryptedBytes));
        return true;
      } catch (_) {
        return false;
      } finally {
        if (decryptedBytes) decryptedBytes.fill(0);
      }
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

    async function writeEntriesAuthoritatively(
      sanitized,
      actor,
      expectedGeneration,
      key,
      saltBytes,
      nextSecurityState
    ) {
      try {
        assertActiveGeneration(expectedGeneration);
        var encryptedPayload = await encryptEntriesPayload(sanitized, key, saltBytes);
        assertActiveGeneration(expectedGeneration);
        var payload = {
          patch: {
            [PASSWORD_REGISTER_ENCRYPTED_KEY]: JSON.stringify(encryptedPayload),
            [PASSWORD_REGISTER_LEGACY_ENTRIES_KEY]: "",
            updated_at: new Date().toISOString(),
            updated_by: String(actor || "save")
          }
        };
        var response = await fetchUiStateSetWithFallback(PASSWORD_REGISTER_SCOPE, payload);
        if (normalizeString(response && response.source) !== "supabase") {
          throw new Error("Supabase heeft de kluisopslag niet bevestigd.");
        }
        if (expectedGeneration !== sessionGeneration) {
          wipeEntries(sanitized);
          return { entries: [], response: response, stale: true };
        }
        wipeEntries(cachedEntries);
        cachedEntries = cloneEntries(sanitized);
        entriesLoaded = true;
        currentKey = key;
        currentSaltBytes = saltBytes;
        currentEnvelopeSerialized = JSON.stringify(encryptedPayload);
        securityState = Object.assign({}, nextSecurityState || securityState, {
          envelopeVersion: PASSWORD_REGISTER_LEGACY_ENVELOPE_VERSION,
          kdfIterations: PASSWORD_REGISTER_LEGACY_KDF_ITERATIONS,
          v2UpgradePending: true
        });
        setStatus(
          securityState.masterSecretMeetsPolicy
            ? "Versleutelde kluis rollback-veilig in v1 opgeslagen; de v2-upgrade volgt in de beveiligde migratiestap."
            : "Versleutelde kluis in v1 opgeslagen. Wijzig de bestaande master-wachtzin naar minimaal 20 tekens.",
          "warning"
        );
        return { entries: cloneEntries(sanitized), response: response, stale: false };
      } catch (error) {
        wipeEntries(sanitized);
        if (expectedGeneration === sessionGeneration) lock();
        throw markRequiresFreshUnlock(error, "PASSWORD_REGISTER_WRITE_UNCERTAIN");
      }
    }

    function persist(entries, actor) {
      var sanitized = cloneEntries(sanitizeEntries(entries));
      return enqueueWrite(function (expectedGeneration) {
        return writeEntriesAuthoritatively(
          sanitized,
          actor || "save",
          expectedGeneration,
          currentKey,
          currentSaltBytes,
          Object.assign({}, securityState)
        );
      }).catch(function (error) {
        wipeEntries(sanitized);
        throw error;
      });
    }

    async function load(masterSecret, expectedGeneration) {
      if (entriesLoaded && currentKey) return cloneEntries(cachedEntries);
      if (entriesLoadPromise) return entriesLoadPromise;

      entriesLoadPromise = (async function () {
        await writeQueue;
        assertActiveGeneration(expectedGeneration);
        var result = null;
        var loadedEntries;
        var source = "";
        result = await fetchUiStateGetWithFallback(PASSWORD_REGISTER_SCOPE);
        source = normalizeString(result && result.source);
        if (source !== "supabase" || !result.values || typeof result.values !== "object") {
          throw new Error("De kluis is niet gezaghebbend door Supabase bevestigd.");
        }
        assertActiveGeneration(expectedGeneration);

        var values = (result && result.values && typeof result.values === "object") ? result.values : {};
        var encryptedEntries = normalizeString(values[PASSWORD_REGISTER_ENCRYPTED_KEY]);
        var legacyEntries = normalizeString(values[PASSWORD_REGISTER_LEGACY_ENTRIES_KEY]);

        if (encryptedEntries) {
          try {
            loadedEntries = await decryptEntriesPayload(encryptedEntries, masterSecret, expectedGeneration);
          } catch (_) {
            if (expectedGeneration === sessionGeneration) {
              currentKey = null;
              currentSaltBytes = null;
            }
            throw new Error("Master-wachtzin klopt niet of de versleutelde kluis is beschadigd.");
          }
          if (securityState.envelopeVersion === PASSWORD_REGISTER_CURRENT_ENVELOPE_VERSION) {
            setStatus("V2-kluis rollback-veilig geopend; C schrijft tijdelijk v1 tot de atomaire migratiestap.", "warning");
          } else if (!securityState.masterSecretMeetsPolicy) {
            setStatus("V1-kluis geopend. Wijzig de bestaande master-wachtzin naar minimaal 20 tekens.", "warning");
          } else {
            setStatus("V1-kluis geopend; de sterkere v2-migratie volgt in de beveiligde eindstap.", "warning");
          }
        } else {
          var parsedLegacyEntries = parseLegacyEntries(legacyEntries);
          await ensureUnlocked(
            masterSecret,
            null,
            expectedGeneration,
            !(parsedLegacyEntries && parsedLegacyEntries.length)
          );
          if (parsedLegacyEntries && parsedLegacyEntries.length) {
            loadedEntries = sanitizeEntries(parsedLegacyEntries);
            wipeEntries(parsedLegacyEntries);
            await persist(loadedEntries, "legacy-migration");
            setStatus("Oude leesbare opslag is gemigreerd naar een versleutelde kluis.");
          } else {
            loadedEntries = sanitizeEntries(DEFAULT_PASSWORD_ENTRIES);
            setStatus(
              "Voorbeeldgegevens geladen. Vervang deze en sla daarna op om echte gegevens versleuteld te bewaren.",
              "warning"
            );
          }
        }

        assertActiveGeneration(expectedGeneration);
        wipeEntries(cachedEntries);
        cachedEntries = cloneEntries(loadedEntries);
        entriesLoaded = true;
        return cloneEntries(loadedEntries);
      })();

      try {
        return await entriesLoadPromise;
      } finally {
        if (expectedGeneration === sessionGeneration) entriesLoadPromise = null;
      }
    }

    async function unlock(masterSecret) {
      lock();
      return load(masterSecret, sessionGeneration);
    }

    function changeMasterSecret(currentMasterSecret, newMasterSecret, entries, actor) {
      var policy = validateNewMasterSecret(newMasterSecret);
      if (!policy.ok) throw new Error(policy.error);
      var sanitized = cloneEntries(sanitizeEntries(entries));
      return enqueueWrite(async function (expectedGeneration) {
        try {
          if (!currentKey || !currentSaltBytes || !entriesLoaded || !currentEnvelopeSerialized) {
            var missingError = new Error("Ontgrendel een opgeslagen kluis voordat je de master-wachtzin wijzigt.");
            missingError.code = "PASSWORD_REGISTER_CURRENT_MASTER_REQUIRED";
            throw missingError;
          }
          var currentSecretValid = await verifyMasterSecretAgainstEnvelope(
            currentEnvelopeSerialized,
            currentMasterSecret
          );
          assertActiveGeneration(expectedGeneration);
          if (!currentSecretValid) {
            var invalidError = new Error("De huidige master-wachtzin klopt niet.");
            invalidError.code = "PASSWORD_REGISTER_CURRENT_MASTER_INVALID";
            throw invalidError;
          }
          var nextSaltBytes = getRandomBytes(16);
          var nextKey = await deriveAesKey(
            newMasterSecret,
            nextSaltBytes,
            PASSWORD_REGISTER_LEGACY_KDF_ITERATIONS
          );
          assertActiveGeneration(expectedGeneration);
          return await writeEntriesAuthoritatively(
            sanitized,
            actor || "master-secret-change",
            expectedGeneration,
            nextKey,
            nextSaltBytes,
            {
              envelopeVersion: PASSWORD_REGISTER_LEGACY_ENVELOPE_VERSION,
              kdfIterations: PASSWORD_REGISTER_LEGACY_KDF_ITERATIONS,
              masterSecretMeetsPolicy: true,
              v2UpgradePending: true
            }
          );
        } catch (error) {
          if (error && error.forceLock) throw error;
          wipeEntries(sanitized);
          if (expectedGeneration === sessionGeneration) lock();
          throw markRequiresFreshUnlock(error, "PASSWORD_REGISTER_REKEY_UNCERTAIN");
        }
      }).catch(function (error) {
        wipeEntries(sanitized);
        throw error;
      });
    }

    function getSecurityState() {
      return Object.assign({}, securityState);
    }

    function lock() {
      sessionGeneration += 1;
      currentKey = null;
      currentSaltBytes = null;
      currentEnvelopeSerialized = "";
      wipeEntries(cachedEntries);
      cachedEntries = [];
      entriesLoaded = false;
      entriesLoadPromise = null;
      securityState = {
        envelopeVersion: null,
        kdfIterations: null,
        masterSecretMeetsPolicy: true,
        v2UpgradePending: false
      };
    }

    return {
      changeMasterSecret: changeMasterSecret,
      getNextId: getNextId,
      getSecurityState: getSecurityState,
      load: function (masterSecret) { return load(masterSecret, sessionGeneration); },
      lock: lock,
      normalizeString: normalizeString,
      persist: persist,
      sanitizeEntries: sanitizeEntries,
      sanitizeEntry: sanitizeEntry,
      unlock: unlock,
      validateNewMasterSecret: validateNewMasterSecret
    };
  }

  global.SoftoraPasswordRegisterStore = {
    CURRENT_ENVELOPE_VERSION: PASSWORD_REGISTER_CURRENT_ENVELOPE_VERSION,
    CURRENT_KDF_ITERATIONS: PASSWORD_REGISTER_CURRENT_KDF_ITERATIONS,
    LEGACY_ENVELOPE_VERSION: PASSWORD_REGISTER_LEGACY_ENVELOPE_VERSION,
    LEGACY_KDF_ITERATIONS: PASSWORD_REGISTER_LEGACY_KDF_ITERATIONS,
    create: createStore,
    validateNewMasterSecret: validateNewMasterSecret
  };
})(window);
