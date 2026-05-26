import SwiftUI

extension Color {
    static let softoraCrimson = Color(red: 0.545, green: 0.133, blue: 0.322)
    static let softoraCrimsonLight = Color(red: 0.710, green: 0.173, blue: 0.439)
    static let softoraCrimsonDim = Color(red: 0.851, green: 0.627, blue: 0.733)
    static let softoraBlue = Color.softoraCrimson
    static let softoraGreen = Color(red: 0.141, green: 0.698, blue: 0.420)
    static let softoraMeetingWebsite = Color.softoraCrimson
    static let softoraMeetingBusiness = Color(red: 0.204, green: 0.596, blue: 0.859)
    static let softoraMeetingVoice = Color(red: 0.180, green: 0.800, blue: 0.443)
    static let softoraMeetingChatbot = Color(red: 0.953, green: 0.612, blue: 0.071)
    static let softoraInk = Color(red: 0.090, green: 0.090, blue: 0.153)
    static let softoraMuted = Color(red: 0.467, green: 0.459, blue: 0.525)
    static let softoraBackground = Color(red: 0.965, green: 0.949, blue: 0.957)
    static let softoraShellBackground = Color.white
    static let softoraPurpleLight = Color(red: 0.969, green: 0.910, blue: 0.941)
    static let softoraGridLine = Color(red: 0.847, green: 0.745, blue: 0.796)
    static let softoraSheetBackground = Color(red: 0.969, green: 0.949, blue: 0.961)
    static let softoraCard = Color.white
    static let softoraLine = Color.softoraInk.opacity(0.10)
    static let softoraInput = Color(red: 0.984, green: 0.980, blue: 0.973)
    static let softoraDanger = Color(red: 0.753, green: 0.224, blue: 0.169)
}

extension Font {
    static func softoraBody(_ size: CGFloat, weight: Weight = .regular) -> Font {
        .custom("Inter", size: size).weight(weight)
    }

    static func softoraDisplay(_ size: CGFloat, weight: Weight = .semibold) -> Font {
        .custom("Oswald", size: size).weight(weight)
    }
}

extension String {
    var softoraUppercased: String {
        uppercased(with: Locale(identifier: "nl_NL"))
    }
}

extension View {
    func softoraCard() -> some View {
        self
            .padding(16)
            .background(Color.softoraCard)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(Color.softoraLine, lineWidth: 1)
            }
            .shadow(color: Color.softoraInk.opacity(0.08), radius: 24, x: 0, y: 14)
    }

    @ViewBuilder
    func softoraEmailInput() -> some View {
        #if os(iOS)
        self
            .textInputAutocapitalization(.never)
            .keyboardType(.emailAddress)
            .textContentType(.username)
        #else
        self
        #endif
    }

    @ViewBuilder
    func softoraPasswordInput() -> some View {
        #if os(iOS)
        self.textContentType(.password)
        #else
        self
        #endif
    }

    @ViewBuilder
    func softoraOneTimeCodeInput() -> some View {
        #if os(iOS)
        self
            .keyboardType(.numberPad)
            .textContentType(.oneTimeCode)
        #else
        self
        #endif
    }

    @ViewBuilder
    func softoraSentenceInput() -> some View {
        #if os(iOS)
        self.textInputAutocapitalization(.sentences)
        #else
        self
        #endif
    }

    @ViewBuilder
    func softoraInlineNavigationTitle() -> some View {
        #if os(iOS)
        self.navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }

    @ViewBuilder
    func softoraAgendaListStyle() -> some View {
        #if os(iOS)
        self.listStyle(.insetGrouped)
        #else
        self.listStyle(.automatic)
        #endif
    }
}
