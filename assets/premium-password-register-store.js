(function (global) {
  "use strict";

  var AbortController = global.AbortController;
  var TextDecoder = global.TextDecoder;
  var TextEncoder = global.TextEncoder;
  var fetch = global.fetch;

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
    return rawEntries
      .map(function (entry, index) {
        return sanitizeEntry(entry, index);
      })
      .filter(function (entry) {
        if (dedupedIds.has(entry.id)) return false;
        dedupedIds.add(entry.id);
        return true;
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
    if (typeof global.TextEncoder !== "function" || typeof global.TextDecoder !== "function") {
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

  function validateNewMasterSecret(masterSecret) {
    var normalizedSecret = normalizeString(masterSecret);
    var characterCount = Array.from(normalizedSecret).length;
    if (characterCount < PASSWORD_REGISTER_MIN_MASTER_SECRET_LENGTH) {
      return {
        ok: false,
        error: "Gebruik een unieke master-wachtzin van minimaal 20 tekens."
      };
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
    if (typeof AbortController !== "function" || typeof fetch !== "function") {
      throw new Error("Deze browser kan de beveiligde kluisverbinding niet veilig uitvoeren.");
    }
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

  function createRequestError(message, status, data) {
    var error = new Error(normalizeString(message) || "Kluisverzoek mislukt.");
    error.status = Number(status) || 0;
    error.code = normalizeString(data && data.code);
    return error;
  }

  function validateAuthoritativeSnapshot(result, requireValues, expectedScope) {
    var revision = Number(result && result.revision);
    var rawUpdatedAt = result && result.updatedAt;
    var updatedAt = rawUpdatedAt == null ? null : String(rawUpdatedAt);
    if (
      !result ||
      result.ok !== true ||
      result.source !== "supabase" ||
      (expectedScope && result.scope !== expectedScope) ||
      typeof result.revision !== "number" ||
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      (updatedAt !== null && !Number.isFinite(Date.parse(updatedAt))) ||
      (revision > 0 && updatedAt === null) ||
      (requireValues && (!result.values || typeof result.values !== "object" || Array.isArray(result.values)))
    ) {
      throw createRequestError("De kluis is niet gezaghebbend door Supabase bevestigd.", 0, result);
    }
    return { revision: revision, updatedAt: updatedAt };
  }

  async function fetchUiStateReadAuthoritative(scope, writeProof) {
    var encodedScope = encodeURIComponent(String(scope || ""));
    var response = await fetchWithTimeout("/api/ui-state-read?scope=" + encodedScope, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Softora-Requested-With": "premium"
      },
      body: JSON.stringify({ writeProof: String(writeProof || "") })
    }, 12000);
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      throw createRequestError(data && data.error || "Kluis ophalen mislukt (" + response.status + ").", response.status, data);
    }
    validateAuthoritativeSnapshot(data, true, String(scope || ""));
    return data;
  }

  async function fetchUiStateSetAuthoritative(scope, body) {
    var encodedScope = encodeURIComponent(String(scope || ""));
    var response = await fetchWithTimeout("/api/ui-state-set?scope=" + encodedScope, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Softora-Requested-With": "premium"
      },
      body: JSON.stringify(body || {})
    }, 12000);
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      throw createRequestError(data && data.error || "Kluis opslaan mislukt (" + response.status + ").", response.status, data);
    }
    validateAuthoritativeSnapshot(data, false, String(scope || ""));
    return data;
  }

  function createStore(options) {
    var config = options || {};
    var cachedEntries = [];
    var entriesLoaded = false;
    var entriesLoadPromise = null;
    var currentKey = null;
    var currentSaltBytes = null;
    var currentEnvelopeSerialized = "";
    var baseRevision = null;
    var baseUpdatedAt = null;
    var sessionGeneration = 0;
    var writeQueue = Promise.resolve();
    var securityState = {
      envelopeVersion: null,
      kdfIterations: null,
      masterSecretMeetsPolicy: true,
      migrationPending: false
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

    function requireWriteProof(writeProof) {
      var normalizedProof = String(writeProof == null ? "" : writeProof).trim();
      if (!normalizedProof || normalizedProof.length > 4096) {
        throw createRequestError("De beveiligingsbevestiging ontbreekt of is verlopen.", 0, {
          code: "PASSWORD_REGISTER_WRITE_PROOF_REQUIRED"
        });
      }
      return normalizedProof;
    }

    function enqueueWrite(operation) {
      var expectedGeneration = sessionGeneration;
      var queued = writeQueue.then(async function () {
        assertActiveGeneration(expectedGeneration);
        return operation(expectedGeneration);
      });
      writeQueue = queued.then(
        function () { return undefined; },
        function () { return undefined; }
      );
      return queued;
    }

    async function deriveCurrentKey(masterSecret) {
      var saltBytes = getRandomBytes(16);
      var key = await deriveAesKey(masterSecret, saltBytes, PASSWORD_REGISTER_CURRENT_KDF_ITERATIONS);
      return { key: key, saltBytes: saltBytes };
    }

    async function ensureUnlocked(masterSecret, enforcePolicy, expectedGeneration) {
      if (currentKey && currentSaltBytes) return;
      if (enforcePolicy) {
        var policy = validateNewMasterSecret(masterSecret);
        if (!policy.ok) throw new Error(policy.error);
      }
      var derived = await deriveCurrentKey(masterSecret);
      assertActiveGeneration(expectedGeneration);
      currentKey = derived.key;
      currentSaltBytes = derived.saltBytes;
      securityState = {
        envelopeVersion: PASSWORD_REGISTER_CURRENT_ENVELOPE_VERSION,
        kdfIterations: PASSWORD_REGISTER_CURRENT_KDF_ITERATIONS,
        masterSecretMeetsPolicy: validateNewMasterSecret(masterSecret).ok,
        migrationPending: false
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
          version: PASSWORD_REGISTER_CURRENT_ENVELOPE_VERSION,
          algorithm: "AES-GCM",
          kdf: "PBKDF2-SHA256",
          iterations: PASSWORD_REGISTER_CURRENT_KDF_ITERATIONS,
          salt: bytesToBase64(saltBytes),
          iv: bytesToBase64(iv),
          ciphertext: bytesToBase64(cipherBytes)
        };
      } finally {
        plainText.fill(0);
      }
    }

    async function decryptEntriesPayload(serializedPayload, masterSecret) {
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
      var parsedEntries = null;
      try {
        parsedEntries = JSON.parse(new TextDecoder().decode(decryptedBytes));
        if (!Array.isArray(parsedEntries)) {
          throw new Error("Kluisinhoud is ongeldig.");
        }
        var needsMigration = envelope.version !== PASSWORD_REGISTER_CURRENT_ENVELOPE_VERSION;
        var nextKey = key;
        var nextSaltBytes = saltBytes;
        if (needsMigration) {
          var derived = await deriveCurrentKey(masterSecret);
          nextKey = derived.key;
          nextSaltBytes = derived.saltBytes;
        }
        var sanitizedEntries = sanitizeEntries(parsedEntries);
        return {
          entries: sanitizedEntries,
          key: nextKey,
          saltBytes: nextSaltBytes,
          securityState: {
            envelopeVersion: envelope.version,
            kdfIterations: envelope.iterations,
            masterSecretMeetsPolicy: validateNewMasterSecret(masterSecret).ok,
            migrationPending: needsMigration
          }
        };
      } finally {
        wipeEntries(parsedEntries);
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
      writeProof,
      expectedGeneration,
      key,
      saltBytes,
      nextSecurityState,
      staleErrorCode
    ) {
      try {
        assertActiveGeneration(expectedGeneration);
        var confirmedWriteProof = requireWriteProof(writeProof);
        if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
          throw createRequestError("Ontgrendel de kluis opnieuw voordat je opslaat.", 0, {
            code: "PASSWORD_REGISTER_REVISION_REQUIRED"
          });
        }
        var expectedRevision = baseRevision;
        var expectedUpdatedAt = baseUpdatedAt;
        var encryptedPayload = await encryptEntriesPayload(sanitized, key, saltBytes);
        assertActiveGeneration(expectedGeneration);
        var payload = {
          patch: {
            [PASSWORD_REGISTER_ENCRYPTED_KEY]: JSON.stringify(encryptedPayload),
            [PASSWORD_REGISTER_LEGACY_ENTRIES_KEY]: "",
            updated_at: new Date().toISOString(),
            updated_by: String(actor || "save")
          },
          expectedRevision: expectedRevision,
          expectedUpdatedAt: expectedUpdatedAt,
          writeProof: confirmedWriteProof
        };
        var response = await fetchUiStateSetAuthoritative(PASSWORD_REGISTER_SCOPE, payload);
        var confirmed = validateAuthoritativeSnapshot(response, false, PASSWORD_REGISTER_SCOPE);
        if (confirmed.revision !== expectedRevision + 1) {
          throw createRequestError("Supabase bevestigde geen geldige nieuwe kluisrevisie.", 0, {
            code: "PASSWORD_REGISTER_REVISION_INVALID"
          });
        }
        if (expectedGeneration !== sessionGeneration) {
          wipeEntries(sanitized);
          if (staleErrorCode) {
            throw createRequestError("De uitkomst van de wachtzinwijziging moet opnieuw worden gecontroleerd.", 0, {
              code: staleErrorCode
            });
          }
          return { entries: [], response: response, stale: true };
        }
        baseRevision = confirmed.revision;
        baseUpdatedAt = confirmed.updatedAt;
        currentKey = key;
        currentSaltBytes = saltBytes;
        currentEnvelopeSerialized = JSON.stringify(encryptedPayload);
        wipeEntries(cachedEntries);
        cachedEntries = cloneEntries(sanitized);
        entriesLoaded = true;
        securityState = Object.assign({}, nextSecurityState || securityState, {
          envelopeVersion: PASSWORD_REGISTER_CURRENT_ENVELOPE_VERSION,
          kdfIterations: PASSWORD_REGISTER_CURRENT_KDF_ITERATIONS,
          migrationPending: false
        });
        if (!securityState.masterSecretMeetsPolicy) {
          setStatus("Kluis opgeslagen. De bestaande master-wachtzin is te zwak; wijzig hem naar minimaal 20 tekens.", "warning");
        } else {
          setStatus("Versleutelde kluis is door Supabase bevestigd.");
        }
        return { entries: cloneEntries(sanitized), response: response, stale: false };
      } catch (error) {
        wipeEntries(sanitized);
        if (expectedGeneration === sessionGeneration) lock();
        throw markRequiresFreshUnlock(error, "PASSWORD_REGISTER_WRITE_UNCERTAIN");
      }
    }

    function persist(entries, actor, writeProof) {
      var sanitized = cloneEntries(sanitizeEntries(entries));
      var requestedWriteProof = String(writeProof == null ? "" : writeProof);
      return enqueueWrite(function (expectedGeneration) {
        return writeEntriesAuthoritatively(
          sanitized,
          actor || "save",
          requestedWriteProof,
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

    async function load(masterSecret, writeProof, expectedGeneration) {
      if (entriesLoaded && currentKey) return cloneEntries(cachedEntries);
      if (entriesLoadPromise) return entriesLoadPromise;

      entriesLoadPromise = (async function () {
        var loadedEntries = null;
        try {
          await writeQueue;
          assertActiveGeneration(expectedGeneration);
          var result;
        result = await fetchUiStateReadAuthoritative(PASSWORD_REGISTER_SCOPE, writeProof);
        var confirmedSnapshot = validateAuthoritativeSnapshot(result, true, PASSWORD_REGISTER_SCOPE);
        assertActiveGeneration(expectedGeneration);
        baseRevision = confirmedSnapshot.revision;
        baseUpdatedAt = confirmedSnapshot.updatedAt;

        var values = result.values;
        var encryptedEntries = normalizeString(values[PASSWORD_REGISTER_ENCRYPTED_KEY]);
        var legacyEntries = normalizeString(values[PASSWORD_REGISTER_LEGACY_ENTRIES_KEY]);

        if (encryptedEntries) {
          var decrypted;
          try {
            decrypted = await decryptEntriesPayload(encryptedEntries, masterSecret);
          } catch (_) {
            throw new Error("Master-wachtzin klopt niet of de versleutelde kluis is beschadigd.");
          }
          loadedEntries = decrypted.entries;
          decrypted.entries = null;
          assertActiveGeneration(expectedGeneration);
          currentKey = decrypted.key;
          currentSaltBytes = decrypted.saltBytes;
          currentEnvelopeSerialized = encryptedEntries;
          securityState = decrypted.securityState;
          if (securityState.migrationPending) {
            await persist(loadedEntries, "v1-kdf-migration", writeProof);
            assertActiveGeneration(expectedGeneration);
            if (!securityState.masterSecretMeetsPolicy) {
              setStatus(
                "Kluis naar de sterkere sleutelafleiding gemigreerd. Wijzig ook de bestaande master-wachtzin naar minimaal 20 tekens.",
                "warning"
              );
            } else {
              setStatus("Kluis automatisch naar de sterkere sleutelafleiding gemigreerd.");
            }
          } else if (!securityState.masterSecretMeetsPolicy) {
            setStatus("Kluis geopend. De bestaande master-wachtzin is te zwak; wijzig hem naar minimaal 20 tekens.", "warning");
          } else {
            setStatus("Versleutelde kluis gezaghebbend geladen vanuit Supabase.");
          }
        } else {
          var parsedLegacyEntries = parseLegacyEntries(legacyEntries);
          await ensureUnlocked(masterSecret, !(parsedLegacyEntries && parsedLegacyEntries.length), expectedGeneration);
          if (parsedLegacyEntries && parsedLegacyEntries.length) {
            loadedEntries = sanitizeEntries(parsedLegacyEntries);
            wipeEntries(parsedLegacyEntries);
            parsedLegacyEntries = null;
            await persist(loadedEntries, "legacy-migration", writeProof);
            assertActiveGeneration(expectedGeneration);
            if (!securityState.masterSecretMeetsPolicy) {
              setStatus("Oude opslag is versleuteld, maar wijzig de bestaande master-wachtzin naar minimaal 20 tekens.", "warning");
            } else {
              setStatus("Oude leesbare opslag is gemigreerd naar een versleutelde kluis.");
            }
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
        } finally {
          wipeEntries(loadedEntries);
        }
      })();

      try {
        return await entriesLoadPromise;
      } finally {
        if (expectedGeneration === sessionGeneration) entriesLoadPromise = null;
      }
    }

    async function unlock(masterSecret, writeProof) {
      lock();
      var expectedGeneration = sessionGeneration;
      var confirmedWriteProof = requireWriteProof(writeProof);
      return load(masterSecret, confirmedWriteProof, expectedGeneration);
    }

    function changeMasterSecret(currentMasterSecret, newMasterSecret, entries, actor, writeProof) {
      var policy = validateNewMasterSecret(newMasterSecret);
      if (!policy.ok) throw new Error(policy.error);
      var sanitized = cloneEntries(sanitizeEntries(entries));
      var rekeyWriteProof = String(writeProof == null ? "" : writeProof);
      return enqueueWrite(async function (expectedGeneration) {
        try {
          if (!currentKey || !currentSaltBytes || !entriesLoaded || !currentEnvelopeSerialized) {
            throw createRequestError("Ontgrendel een opgeslagen kluis voordat je de master-wachtzin wijzigt.", 0, {
              code: "PASSWORD_REGISTER_CURRENT_MASTER_REQUIRED"
            });
          }
          var currentSecretValid = await verifyMasterSecretAgainstEnvelope(
            currentEnvelopeSerialized,
            currentMasterSecret
          );
          assertActiveGeneration(expectedGeneration);
          if (!currentSecretValid) {
            throw createRequestError("De huidige master-wachtzin klopt niet.", 0, {
              code: "PASSWORD_REGISTER_CURRENT_MASTER_INVALID"
            });
          }
          var derived = await deriveCurrentKey(newMasterSecret);
          assertActiveGeneration(expectedGeneration);
          return await writeEntriesAuthoritatively(
            sanitized,
            actor || "master-secret-change",
            rekeyWriteProof,
            expectedGeneration,
            derived.key,
            derived.saltBytes,
            {
              envelopeVersion: PASSWORD_REGISTER_CURRENT_ENVELOPE_VERSION,
              kdfIterations: PASSWORD_REGISTER_CURRENT_KDF_ITERATIONS,
              masterSecretMeetsPolicy: true,
              migrationPending: false
            },
            "PASSWORD_REGISTER_REKEY_UNCERTAIN"
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

    function getRevisionState() {
      return { revision: baseRevision, updatedAt: baseUpdatedAt };
    }

    function lock() {
      sessionGeneration += 1;
      currentKey = null;
      currentSaltBytes = null;
      currentEnvelopeSerialized = "";
      baseRevision = null;
      baseUpdatedAt = null;
      wipeEntries(cachedEntries);
      cachedEntries = [];
      entriesLoaded = false;
      entriesLoadPromise = null;
      securityState = {
        envelopeVersion: null,
        kdfIterations: null,
        masterSecretMeetsPolicy: true,
        migrationPending: false
      };
    }

    return {
      changeMasterSecret: changeMasterSecret,
      getNextId: getNextId,
      getRevisionState: getRevisionState,
      getSecurityState: getSecurityState,
      load: function (masterSecret, writeProof) {
        var confirmedWriteProof = requireWriteProof(writeProof);
        return load(masterSecret, confirmedWriteProof, sessionGeneration);
      },
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
