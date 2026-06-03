import SwiftUI
import WebKit

struct RootView: View {
    var body: some View {
        ImotaMatcherWebView()
            .ignoresSafeArea()
            .background(Color(red: 0.969, green: 0.965, blue: 0.957))
    }
}

struct ImotaMatcherWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: Self.previewBridgeScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: false
            )
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.969, green: 0.965, blue: 0.957, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        loadLocalHTML(in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    private func loadLocalHTML(in webView: WKWebView) {
        guard let url = Bundle.main.url(forResource: "imota-matcher", withExtension: "html") else {
            webView.loadHTMLString("<h1>IMOTA preview kon de HTML niet vinden.</h1>", baseURL: nil)
            return
        }

        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    private static let previewBridgeScript = #"""
    (() => {
      const originalFetch = window.fetch ? window.fetch.bind(window) : null;
      const names = [
        "Jeroen van Loon",
        "Martijn de Wit",
        "Bas Verhoeven",
        "Rick van Dijk",
        "Sander Maas",
        "Thomas Janssen",
        "Niels van den Berg",
        "Koen Peeters"
      ];
      const photos = [
        "https://randomuser.me/api/portraits/men/32.jpg",
        "https://randomuser.me/api/portraits/men/75.jpg",
        "https://randomuser.me/api/portraits/men/45.jpg",
        "https://randomuser.me/api/portraits/men/62.jpg",
        "https://randomuser.me/api/portraits/men/22.jpg",
        "https://randomuser.me/api/portraits/men/36.jpg",
        "https://randomuser.me/api/portraits/men/51.jpg",
        "https://randomuser.me/api/portraits/men/18.jpg"
      ];
      const regions = ["Noord-Brabant", "Tilburg", "Den Bosch", "Eindhoven", "Breda", "Waalwijk"];
      const skillMap = {
        "Onderhoud & Revisie": ["Preventief onderhoud", "Revisie", "Storingsanalyse", "Machineveiligheid", "Lagermontage"],
        "Modificatie": ["Machineombouw", "Constructiewerk", "Inbedrijfstelling", "Tekening lezen", "Procesoptimalisatie"],
        "Machinehandling": ["Hijsen", "Verplaatsen", "Uitlijnen", "Montageplanning", "Veilig werken"],
        "Engineering": ["3D CAD", "Werkvoorbereiding", "Machineontwerp", "Tekeningen", "Materiaalkeuze"],
        "Lassen": ["TIG", "MIG/MAG", "RVS", "Constructielassen", "Pijplassen"],
        "Hydraulica": ["Hydrauliekschema's", "Slangenservice", "Pompen", "Cilinders", "Drukmetingen"],
        "PLC / Elektrotechniek": ["PLC storing zoeken", "Sensoriek", "Schakelkasten", "Elektroschema's", "Aandrijftechniek"],
        "Pneumatiek": ["Pneumatische schema's", "Ventielen", "Cilinders", "Luchtbehandeling", "Storingsdiagnose"],
        "Montage": ["Mechanische montage", "Uitlijnen", "Assemblage", "Tekening lezen", "Kwaliteitscontrole"],
        "Storingsonderhoud": ["Storing zoeken", "Root cause analyse", "Mechanica", "Elektro basis", "Snel schakelen"]
      };

      function extractField(prompt, label) {
        const match = prompt.match(new RegExp("- " + label + ":\\s*([^\\n]+)", "i"));
        return match ? match[1].trim() : "";
      }

      function wantedCount(prompt) {
        const match = prompt.match(/Genereer PRECIES\s+(\d+)/i);
        const count = match ? Number(match[1]) : 1;
        return Math.max(1, Math.min(50, count || 1));
      }

      function initials(name) {
        return name
          .split(" ")
          .filter(part => part.length > 2)
          .slice(0, 2)
          .map(part => part[0])
          .join("")
          .toUpperCase();
      }

      function makeProfile(index, prompt) {
        const werkzaamheden = extractField(prompt, "Werkzaamheden") || "Onderhoud & Revisie";
        const branche = extractField(prompt, "Branche") || "industrie";
        const urgentie = extractField(prompt, "Urgentie") || "Normaal";
        const startdatum = extractField(prompt, "Startdatum") || "Zo snel mogelijk";
        const skills = skillMap[werkzaamheden] || skillMap["Onderhoud & Revisie"];
        const name = names[index % names.length];
        const score = Math.max(70, 97 - index * 4);

        return {
          naam: name,
          initialen: initials(name),
          photoUrl: photos[index % photos.length],
          rol: werkzaamheden + " specialist",
          matchScore: score,
          vaardigheden: skills.slice(0, 5),
          beschikbaar: startdatum,
          ervaring: index % 3 === 0 ? "Senior (7-15 jaar)" : "Medior (3-7 jaar)",
          regio: regions[index % regions.length],
          motivatie: "Sterke demo-match voor " + werkzaamheden + " binnen " + branche + ". Past goed bij urgentie " + urgentie.toLowerCase() + " en kan snel meedraaien.",
          highlightSkills: skills.slice(0, 2)
        };
      }

      window.fetch = function(resource, options) {
        const url = typeof resource === "string" ? resource : (resource && resource.url);
        if (String(url || "").includes("api.anthropic.com/v1/messages")) {
          let prompt = "";
          try {
            const body = JSON.parse((options && options.body) || "{}");
            prompt = (((body.messages || [])[0] || {}).content) || "";
          } catch (error) {}

          const count = wantedCount(prompt);
          const profiles = Array.from({ length: count }, (_, index) => makeProfile(index, prompt));
          const payload = { content: [{ text: JSON.stringify(profiles) }] };
          return Promise.resolve(new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }));
        }

        if (!originalFetch) {
          return Promise.reject(new Error("Fetch is not available in this preview."));
        }

        return originalFetch(resource, options);
      };
    })();
    """#
}

struct RootView_Previews: PreviewProvider {
    static var previews: some View {
        RootView()
    }
}
