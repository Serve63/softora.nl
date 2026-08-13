import SwiftUI

struct SecureLoginView: View {
    let store: AgendaStore

    @State private var email = ""
    @State private var password = ""
    @State private var otp = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                header

                VStack(spacing: 14) {
                    TextField("naam@softora.nl", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .softoraLoginField()

                    SecureField("Wachtwoord", text: $password)
                        .textContentType(.password)
                        .softoraLoginField()

                    if store.mfaRequired {
                        TextField("2FA- of recoverycode", text: $otp)
                            .textContentType(.oneTimeCode)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .softoraLoginField()
                    }

                    if store.mfaEnrollmentRequired, !store.mfaSetupKey.isEmpty {
                        enrollmentPanel
                    }

                    if let message = store.alertMessage, !message.isEmpty {
                        Text(message)
                            .font(.softoraBody(13, weight: .semibold))
                            .foregroundStyle(Color.softoraDanger)
                            .multilineTextAlignment(.center)
                    }

                    Button(action: submit) {
                        HStack(spacing: 10) {
                            if store.isUnlocking { ProgressView().tint(.white) }
                            Text(store.isUnlocking ? "Bezig..." : "Veilig inloggen")
                                .font(.softoraBody(16, weight: .semibold))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.softoraCrimson)
                    .disabled(store.isUnlocking || email.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty)
                }
                .padding(24)
                .background(Color.softoraCard)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(Color.softoraLine, lineWidth: 1)
                }
            }
            .padding(20)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .background(Color.softoraBackground.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    private var header: some View {
        VStack(spacing: 10) {
            Image(systemName: "person.badge.key.fill")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(Color.softoraCrimson)
            Text("Beveiligde toegang")
                .font(.softoraDisplay(14, weight: .semibold))
                .tracking(1.8)
                .textCase(.uppercase)
                .foregroundStyle(Color.softoraCrimson)
            Text("Softora Agenda")
                .font(.softoraBody(25, weight: .semibold))
                .foregroundStyle(Color.softoraInk)
            Text("Log in met je persoonlijke account en tweestapsverificatie.")
                .font(.softoraBody(14))
                .foregroundStyle(Color.softoraMuted)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 32)
    }

    private var enrollmentPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Persoonlijke 2FA instellen")
                .font(.softoraBody(15, weight: .semibold))
                .foregroundStyle(Color.softoraInk)
            Text("Voeg deze sleutel toe in je authenticator-app. Bewaar de recoverycodes offline; ze worden één keer getoond.")
                .font(.softoraBody(13))
                .foregroundStyle(Color.softoraMuted)
            securityValue(title: "Setup-sleutel", value: store.mfaSetupKey)
            securityValue(title: "Recoverycodes", value: store.mfaRecoveryCodes.joined(separator: "  "))
        }
        .padding(14)
        .background(Color.softoraCrimson.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func securityValue(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.softoraBody(12, weight: .semibold))
            Text(value)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .textSelection(.enabled)
        }
        .foregroundStyle(Color.softoraInk)
    }

    private func submit() {
        Task {
            let success = await store.login(email: email, password: password, otp: otp)
            if success {
                password = ""
                otp = ""
            } else if store.mfaRequired {
                otp = ""
            }
        }
    }
}

private extension View {
    func softoraLoginField() -> some View {
        padding(.horizontal, 14)
            .padding(.vertical, 13)
            .background(Color.softoraInput)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.softoraLine, lineWidth: 1)
            }
    }
}

struct SecureLoginView_Previews: PreviewProvider {
    static var previews: some View {
        SecureLoginView(store: AgendaStore(apiClient: SoftoraAPIClient()))
    }
}
