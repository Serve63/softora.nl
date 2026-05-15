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

struct DeleteAppointmentResponse: Decodable {
    let ok: Bool
    let deletedAppointmentId: Int?
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
    let privacyMasked: Bool

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
        case privacyMasked
    }

    init(
        id: String,
        title: String,
        date: String,
        time: String,
        location: String,
        who: Planner,
        summary: String,
        privacyMasked: Bool = false
    ) {
        self.id = id
        self.title = title
        self.date = date
        self.time = time
        self.location = location
        self.who = who
        self.summary = summary
        self.privacyMasked = privacyMasked
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
        let decodedPrivacyMasked = (try? container.decode(Bool.self, forKey: .privacyMasked)) ?? false

        self.init(
            id: decodedID.isEmpty ? "\(decodedDate)-\(decodedTime)-\(decodedTitle)" : decodedID,
            title: decodedPrivacyMasked ? "Bezet" : decodedTitle,
            date: decodedDate,
            time: decodedTime,
            location: decodedLocation,
            who: decodedWho,
            summary: decodedSummary,
            privacyMasked: decodedPrivacyMasked
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
    static let appointmentTargetCases: [Planner] = [.serve, .martijn, .both]
    static let leadOwnerCases: [Planner] = [.serve, .martijn]

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
    var leadOwner: Planner = .serve
    var title = ""
    var date = Date()
    var time = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Date()) ?? Date()
    var location = ""
    var notes = ""
    var repeatChoice: RepeatChoice = .none
    var appointmentType: AppointmentType = .personal
    var businessKind: BusinessAppointmentKind = .appointment
    var businessMeetingType: BusinessMeetingType = .website

    init(
        planner: Planner = .serve,
        leadOwner: Planner? = nil,
        date: Date = Date(),
        appointmentType: AppointmentType = .personal,
        businessKind: BusinessAppointmentKind = .appointment,
        businessMeetingType: BusinessMeetingType = .website
    ) {
        self.planner = planner
        self.leadOwner = leadOwner ?? planner
        self.date = date
        self.appointmentType = appointmentType
        self.businessKind = businessKind
        self.businessMeetingType = businessMeetingType
    }

    var canSubmit: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

enum AppointmentType: String, CaseIterable, Identifiable {
    case personal
    case business

    var id: String { rawValue }

    var apiValue: String {
        switch self {
        case .personal:
            "private"
        case .business:
            "business"
        }
    }

    var title: String {
        switch self {
        case .personal:
            "Privé"
        case .business:
            "Zakelijk"
        }
    }
}

enum BusinessAppointmentKind: String, Identifiable {
    case meeting
    case appointment

    var id: String { rawValue }

    var apiValue: String {
        switch self {
        case .meeting:
            "meeting"
        case .appointment:
            "appointment"
        }
    }

    var title: String {
        switch self {
        case .meeting:
            "Meeting"
        case .appointment:
            "Afspraak"
        }
    }
}

enum BusinessMeetingType: String, CaseIterable, Identifiable {
    case website
    case software
    case voice
    case chatbot

    var id: String { rawValue }

    var apiValue: String {
        switch self {
        case .website:
            "website"
        case .software:
            "business"
        case .voice:
            "voice"
        case .chatbot:
            "chatbot"
        }
    }

    var title: String {
        switch self {
        case .website:
            "Website"
        case .software:
            "Bedrijfssoftware"
        case .voice:
            "Voicesoftware"
        case .chatbot:
            "Chatbot"
        }
    }
}

enum RepeatChoice: String, CaseIterable, Identifiable {
    case none
    case daily
    case weekly
    case monthly
    case quarterly
    case yearly

    var id: String { rawValue }

    var apiValue: String { rawValue }

    var title: String {
        switch self {
        case .none:
            "Nooit"
        case .daily:
            "Dagelijks"
        case .weekly:
            "Wekelijks"
        case .monthly:
            "Maandelijks"
        case .quarterly:
            "Per kwartaal"
        case .yearly:
            "Jaarlijks"
        }
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
    let recurrence: String
    let repeatChoice: String
    let appointmentType: String
    let appointmentKind: String
    let businessMeetingType: String
    let manualLeadOwner: String
    let actor: String
}

struct DeleteAppointmentPayload: Encodable {
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
