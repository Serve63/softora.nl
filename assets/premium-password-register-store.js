(function (global) {
  "use strict";

  var PASSWORD_REGISTER_SCOPE = "premium_password_register";
  var PASSWORD_REGISTER_ENTRIES_KEY = "entries_json";
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

  async function fetchWithTimeout(url, options, timeoutMs) {
    var controller = new AbortController();
    var timeoutId = window.setTimeout(function () {
      controller.abort();
    }, timeoutMs || 12000);
    try {
      return await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function fetchUiStateGetWithFallback(scope) {
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
    var setStatus = typeof config.setStatus === "function" ? config.setStatus : function () {};

    async function persist(entries, actor) {
      var sanitized = sanitizeEntries(entries).map(function (entry) {
        return Object.assign({}, entry);
      });
      var payload = {
        patch: {
          [PASSWORD_REGISTER_ENTRIES_KEY]: JSON.stringify(sanitized),
          updated_at: new Date().toISOString(),
          updated_by: String(actor || "save")
        }
      };
      var response = await fetchUiStateSetWithFallback(PASSWORD_REGISTER_SCOPE, payload);
      var source = normalizeString(response && response.source);
      cachedEntries = cloneEntries(sanitized);
      entriesLoaded = true;
      if (source === "supabase") {
        setStatus("Wijzigingen zijn opgeslagen in Supabase.");
      } else {
        setStatus("Wijzigingen zijn tijdelijk opgeslagen, maar nog niet bevestigd vanuit Supabase.", "warning");
      }
      return { entries: cloneEntries(sanitized), response: response };
    }

    async function load() {
      if (entriesLoaded) return cloneEntries(cachedEntries);
      if (entriesLoadPromise) return entriesLoadPromise;

      entriesLoadPromise = (async function () {
        var loadedEntries;
        try {
          var result = await fetchUiStateGetWithFallback(PASSWORD_REGISTER_SCOPE);
          var remoteEntries = null;
          var serializedEntries = normalizeString(result && result.values && result.values[PASSWORD_REGISTER_ENTRIES_KEY]);

          if (serializedEntries) {
            try {
              var parsedEntries = JSON.parse(serializedEntries);
              if (Array.isArray(parsedEntries)) remoteEntries = parsedEntries;
            } catch (_) {
              remoteEntries = null;
            }
          }

          if (remoteEntries && remoteEntries.length) {
            loadedEntries = sanitizeEntries(remoteEntries);
            if (normalizeString(result && result.source) === "supabase") {
              setStatus("Inloggegevens geladen vanuit Supabase.");
            } else {
              setStatus("Inloggegevens geladen uit fallback-opslag.");
            }
          } else {
            loadedEntries = sanitizeEntries(DEFAULT_PASSWORD_ENTRIES);
            setStatus(
              "Voorbeeldgegevens geladen. Vervang deze en sla daarna op om echte gegevens veilig te bewaren.",
              "warning"
            );
          }
        } catch (_) {
          loadedEntries = sanitizeEntries(DEFAULT_PASSWORD_ENTRIES);
          setStatus(
            "Kon Supabase niet laden. Veilige voorbeeldgegevens zijn lokaal geladen totdat je later opslaat.",
            "warning"
          );
        }

        cachedEntries = cloneEntries(loadedEntries);
        entriesLoaded = true;
        entriesLoadPromise = null;
        return cloneEntries(loadedEntries);
      })();

      return entriesLoadPromise;
    }

    return {
      getNextId: getNextId,
      load: load,
      normalizeString: normalizeString,
      persist: persist,
      sanitizeEntries: sanitizeEntries,
      sanitizeEntry: sanitizeEntry
    };
  }

  global.SoftoraPasswordRegisterStore = {
    create: createStore
  };
})(window);
