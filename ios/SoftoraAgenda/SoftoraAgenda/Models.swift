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

struct MailboxAccountsResponse: Decodable {
    let ok: Bool
    let accounts: [MailboxAccount]
    let error: String?
}

struct MailboxMessagesResponse: Decodable {
    let ok: Bool
    let messages: [MailboxMessage]
    let error: String?
    let detail: String?
}

struct MailboxSendResponse: Decodable {
    let ok: Bool
    let error: String?
    let detail: String?
}

struct MailboxMarkReadResponse: Decodable {
    let ok: Bool
    let error: String?
    let detail: String?
}

struct MailboxImproveDraftResponse: Decodable {
    let ok: Bool
    let draft: String?
    let error: String?
    let detail: String?
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

    var sortKey: String {
        "\(date)T\(time)"
    }
}

struct MailboxAccount: Identifiable, Decodable, Hashable {
    let email: String
    let name: String
    let imapConfigured: Bool
    let smtpConfigured: Bool

    var id: String { email }

    var displayName: String {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmedName.isEmpty ? email : trimmedName
    }
}

struct MailboxMessage: Identifiable, Decodable, Hashable {
    let id: String
    let uid: Int
    let folder: String
    let from: String
    let email: String
    let to: String
    let subject: String
    let preview: String
    let body: String
    let links: [MailboxLink]
    let inlineImages: [MailboxInlineImage]
    let date: String
    let unread: Bool
    let starred: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case uid
        case folder
        case from
        case email
        case to
        case subject
        case preview
        case body
        case links
        case inlineImages
        case bodyImages
        case date
        case unread
        case starred
    }

    init(
        id: String,
        uid: Int = 0,
        folder: String = "inbox",
        from: String,
        email: String = "",
        to: String = "",
        subject: String,
        preview: String,
        body: String,
        links: [MailboxLink] = [],
        inlineImages: [MailboxInlineImage] = [],
        date: String,
        unread: Bool = false,
        starred: Bool = false
    ) {
        self.id = id
        self.uid = uid
        self.folder = folder
        self.from = from
        self.email = email
        self.to = to
        self.subject = subject
        self.preview = preview
        self.body = body
        self.links = links
        self.inlineImages = inlineImages
        self.date = date
        self.unread = unread
        self.starred = starred
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedID = (try? container.decode(String.self, forKey: .id)) ?? UUID().uuidString
        let decodedInlineImages = (try? container.decode([MailboxInlineImage].self, forKey: .inlineImages)) ?? []
        let decodedBodyImages = (try? container.decode([MailboxBodyImage].self, forKey: .bodyImages)) ?? []
        let resolvedImages = decodedInlineImages.isEmpty
            ? decodedBodyImages.enumerated().compactMap { index, image in image.inlineImage(index: index) }
            : decodedInlineImages

        self.init(
            id: decodedID,
            uid: (try? container.decode(Int.self, forKey: .uid)) ?? 0,
            folder: (try? container.decode(String.self, forKey: .folder)) ?? "inbox",
            from: (try? container.decode(String.self, forKey: .from)) ?? "Onbekend",
            email: (try? container.decode(String.self, forKey: .email)) ?? "",
            to: (try? container.decode(String.self, forKey: .to)) ?? "",
            subject: (try? container.decode(String.self, forKey: .subject)) ?? "(Geen onderwerp)",
            preview: (try? container.decode(String.self, forKey: .preview)) ?? "",
            body: (try? container.decode(String.self, forKey: .body)) ?? "",
            links: (try? container.decode([MailboxLink].self, forKey: .links)) ?? [],
            inlineImages: resolvedImages,
            date: (try? container.decode(String.self, forKey: .date)) ?? "",
            unread: (try? container.decode(Bool.self, forKey: .unread)) ?? false,
            starred: (try? container.decode(Bool.self, forKey: .starred)) ?? false
        )
    }
}

struct MailboxLink: Identifiable, Decodable, Hashable {
    let label: String
    let href: String

    var id: String { "\(label)-\(href)" }
}

struct MailboxInlineImage: Identifiable, Decodable, Hashable {
    let id: String
    let cid: String
    let alt: String
    let filename: String
    let contentType: String
    let contentBase64: String
    let url: String
}

private struct MailboxBodyImage: Decodable {
    let cid: String
    let alt: String
    let contentType: String
    let dataUrl: String

    enum CodingKeys: String, CodingKey {
        case cid
        case alt
        case contentType
        case dataUrl
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        cid = (try? container.decode(String.self, forKey: .cid)) ?? ""
        alt = (try? container.decode(String.self, forKey: .alt)) ?? ""
        contentType = (try? container.decode(String.self, forKey: .contentType)) ?? ""
        dataUrl = (try? container.decode(String.self, forKey: .dataUrl)) ?? ""
    }

    func inlineImage(index: Int) -> MailboxInlineImage? {
        let trimmedDataUrl = dataUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        let marker = ";base64,"
        guard let markerRange = trimmedDataUrl.range(of: marker, options: .caseInsensitive) else {
            return nil
        }
        let mimePart = String(trimmedDataUrl[..<markerRange.lowerBound])
            .replacingOccurrences(of: "data:", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let base64Part = String(trimmedDataUrl[markerRange.upperBound...])
            .replacingOccurrences(of: "\n", with: "")
            .replacingOccurrences(of: "\r", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !base64Part.isEmpty else { return nil }

        let resolvedAlt = alt.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedContentType = contentType.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? mimePart
            : contentType
        let resolvedID = cid.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "\(resolvedAlt.isEmpty ? "image" : resolvedAlt)-\(index + 1)"
            : cid

        return MailboxInlineImage(
            id: resolvedID,
            cid: cid,
            alt: resolvedAlt,
            filename: "",
            contentType: resolvedContentType,
            contentBase64: base64Part,
            url: ""
        )
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

    var leadOwnerFullName: String {
        switch self {
        case .serve:
            "Servé Creusen"
        case .martijn:
            "Martijn van de Ven"
        case .both, .other:
            ""
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
    let leadOwnerKey: String
    let leadOwnerName: String
    let leadOwnerFullName: String
    let leadOwnerEmail: String
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
