import Foundation

enum SoftoraAPIError: LocalizedError {
    case server(String)
    case mfaRequired(String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .server(let message):
            message
        case .mfaRequired(let message):
            message
        case .invalidResponse:
            "De server gaf een onverwacht antwoord."
        }
    }
}

struct SoftoraAPIClient {
    private let baseURL: URL
    private let urlSession: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(
        baseURL: URL = Bundle.main.softoraAPIBaseURL,
        urlSession: URLSession = .softoraAgenda
    ) {
        self.baseURL = baseURL
        self.urlSession = urlSession
    }

    func fetchSession() async throws -> PremiumSession {
        try await get("/api/auth/session")
    }

    func login(email: String, password: String, otp: String, remember: Bool) async throws -> LoginResponse {
        try await post(
            "/api/auth/login",
            body: LoginPayload(
                email: email,
                password: password,
                otp: otp,
                remember: remember,
                next: "/premium-personeel-agenda"
            )
        )
    }

    func logout() async throws {
        let _: APIErrorEnvelope = try await post("/api/auth/logout", body: EmptyPayload())
    }

    func fetchAppointments(fresh: Bool) async throws -> [AgendaAppointment] {
        let suffix = fresh ? "?limit=250&fresh=1" : "?limit=250"
        let response: AgendaAppointmentsResponse = try await get("/api/agenda/appointments\(suffix)")
        return response.appointments
    }

    func createManualAppointment(_ draft: NewAppointmentDraft) async throws -> AgendaAppointment? {
        let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let location = draft.location.trimmingCharacters(in: .whitespacesAndNewlines)
        let notes = draft.notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let time = AgendaDateFormatter.time(from: draft.time)
        let payload = ManualAppointmentPayload(
            date: AgendaDateFormatter.ymd(from: draft.date),
            who: draft.planner.apiValue,
            title: title,
            time: time,
            activityTime: time,
            legendChoice: "manual-overig",
            activity: title,
            location: location,
            notes: notes,
            actor: "softora-ios-agenda"
        )
        let response: ManualAppointmentResponse = try await post(
            "/api/agenda/appointments/manual",
            body: payload
        )
        return response.appointment
    }

    private func get<Response: Decodable>(_ path: String) async throws -> Response {
        try await send(path: path, method: "GET", body: Optional<EmptyPayload>.none)
    }

    private func post<Response: Decodable, Body: Encodable>(_ path: String, body: Body) async throws -> Response {
        try await send(path: path, method: "POST", body: body)
    }

    private func send<Response: Decodable, Body: Encodable>(
        path: String,
        method: String,
        body: Body?
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw SoftoraAPIError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(baseURL.origin, forHTTPHeaderField: "Origin")
        request.cachePolicy = .reloadIgnoringLocalCacheData

        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await urlSession.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw SoftoraAPIError.invalidResponse
        }

        if !(200...299).contains(httpResponse.statusCode) {
            if let errorEnvelope = try? decoder.decode(APIErrorEnvelope.self, from: data) {
                if errorEnvelope.mfaRequired == true {
                    throw SoftoraAPIError.mfaRequired(errorEnvelope.error ?? "Vul je 2FA-code in.")
                }
                throw SoftoraAPIError.server(errorEnvelope.error ?? "Verzoek mislukt.")
            }
            throw SoftoraAPIError.invalidResponse
        }

        if let errorEnvelope = try? decoder.decode(APIErrorEnvelope.self, from: data),
           errorEnvelope.ok == false {
            if errorEnvelope.mfaRequired == true {
                throw SoftoraAPIError.mfaRequired(errorEnvelope.error ?? "Vul je 2FA-code in.")
            }
            throw SoftoraAPIError.server(errorEnvelope.error ?? "Verzoek mislukt.")
        }

        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw SoftoraAPIError.invalidResponse
        }
    }
}

private struct LoginPayload: Encodable {
    let email: String
    let password: String
    let otp: String
    let remember: Bool
    let next: String
}

private struct EmptyPayload: Encodable {}

private extension URLSession {
    static let softoraAgenda: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = .shared
        configuration.httpCookieAcceptPolicy = .always
        configuration.httpShouldSetCookies = true
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 30
        return URLSession(configuration: configuration)
    }()
}

private extension URL {
    var origin: String {
        "\(scheme ?? "https")://\(host ?? "www.softora.nl")"
    }
}

private extension Bundle {
    var softoraAPIBaseURL: URL {
        let raw = object(forInfoDictionaryKey: "SoftoraAPIBaseURL") as? String
        return URL(string: raw ?? "https://www.softora.nl")!
    }
}
