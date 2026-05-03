import Foundation

struct PremiumSession: Decodable {
    let ok: Bool
    let configured: Bool
    let authenticated: Bool
    let mfaEnabled: Bool
    let displayName: String
    let email: String
    let error: String?
}

struct AgendaAppLoginResponse: Decodable {
    let ok: Bool
    let authenticated: Bool?
    let who: String?
    let email: String?
    let displayName: String?
    let error: String?
}

struct AgendaAppointmentsResponse: Decodable {
    let ok: Bool
    let count: Int?
    let appointments: [AgendaAppointment]
}

struct ManualAppointmentResponse: Decodable {
    let ok: Bool
    let persistencePending: Bool?
    let appointment: AgendaAppointment?
    let error: String?
}

struct APIErrorEnvelope: Decodable {
    let ok: Bool?
    let error: String?
    let mfaRequired: Bool?
}

struct AgendaAppointment: Identifiable, Decodable, Hashable {
    let id: String
    let title: String
    let date: String
    let time: String
    let location: String
    let who: Planner
    let summary: String

    enum CodingKeys: String, CodingKey {
        case id
        case company
        case title
        case activity
        case name
        case date
        case time
        case location
        case appointmentLocation
        case manualPlannerWho
        case manualWho
        case who
        case summary
    }

    init(
        id: String,
        title: String,
        date: String,
        time: String,
        location: String,
        who: Planner,
        summary: String
    ) {
        self.id = id
        self.title = title
        self.date = date
        self.time = time
        self.location = location
        self.who = who
        self.summary = summary
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedDate = container.firstString(for: [.date])
        let decodedTime = container.firstString(for: [.time], fallback: "09:00")
        let decodedTitle = container.firstString(
            for: [.company, .title, .activity, .name],
            fallback: "Afspraak"
        )
        let decodedLocation = container.firstString(for: [.location, .appointmentLocation])
        let decodedWho = Planner(rawAPIValue: container.firstString(for: [.manualPlannerWho, .manualWho, .who]))
        let decodedSummary = container.firstString(for: [.summary])
        let decodedID = container.firstString(for: [.id])

        self.init(
            id: decodedID.isEmpty ? "\(decodedDate)-\(decodedTime)-\(decodedTitle)" : decodedID,
            title: decodedTitle,
            date: decodedDate,
            time: decodedTime,
            location: decodedLocation,
            who: decodedWho,
            summary: decodedSummary
        )
    }

    var isUpcoming: Bool {
        guard !date.isEmpty else { return false }
        return date >= AgendaDateFormatter.todayYMD()
    }

    var sortKey: String {
        "\(date)T\(time)"
    }
}

enum Planner: String, CaseIterable, Codable, Identifiable {
    case serve
    case martijn
    case both
    case other

    var id: String { rawValue }

    static let appAccessCases: [Planner] = [.serve, .martijn]

    init(rawAPIValue: String) {
        let normalized = rawAPIValue
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        if normalized == "martijn" {
            self = .martijn
        } else if ["both", "allebei", "beide", "serve-martijn"].contains(normalized) {
            self = .both
        } else if ["overig", "other"].contains(normalized) {
            self = .other
        } else {
            self = .serve
        }
    }

    var apiValue: String {
        switch self {
        case .serve:
            "serve"
        case .martijn:
            "martijn"
        case .both:
            "both"
        case .other:
            "overig"
        }
    }

    var title: String {
        switch self {
        case .serve:
            "Servé"
        case .martijn:
            "Martijn"
        case .both:
            "Allebei"
        case .other:
            "Overig"
        }
    }
}

struct NewAppointmentDraft {
    var planner: Planner = .serve
    var title = ""
    var date = Date()
    var time = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Date()) ?? Date()
    var location = ""
    var notes = ""

    init(planner: Planner = .serve) {
        self.planner = planner
    }

    var canSubmit: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

struct ManualAppointmentPayload: Encodable {
    let date: String
    let who: String
    let title: String
    let time: String
    let activityTime: String
    let legendChoice: String
    let activity: String
    let location: String
    let notes: String
    let actor: String
}

private extension KeyedDecodingContainer {
    func firstString(for keys: [Key], fallback: String = "") -> String {
        for key in keys {
            if let value = try? decode(String.self, forKey: key) {
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    return trimmed
                }
            }
            if let value = try? decode(Int.self, forKey: key) {
                return String(value)
            }
            if let value = try? decode(Double.self, forKey: key) {
                return String(value)
            }
        }
        return fallback
    }
}
