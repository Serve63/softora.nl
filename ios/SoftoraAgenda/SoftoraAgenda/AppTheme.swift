import SwiftUI

extension Color {
    static let softoraBlue = Color(red: 0.12, green: 0.45, blue: 0.94)
    static let softoraGreen = Color(red: 0.10, green: 0.62, blue: 0.46)
    static let softoraInk = Color(red: 0.08, green: 0.10, blue: 0.14)
    static let softoraMuted = Color(red: 0.42, green: 0.46, blue: 0.54)
    static let softoraBackground = Color(red: 0.96, green: 0.97, blue: 0.99)
    static let softoraLine = Color(red: 0.86, green: 0.88, blue: 0.92)
}

extension View {
    func softoraCard() -> some View {
        self
            .padding(16)
            .background(.background)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color.softoraLine, lineWidth: 1)
            }
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
