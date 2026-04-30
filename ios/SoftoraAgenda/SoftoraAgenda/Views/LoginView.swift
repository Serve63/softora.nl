import SwiftUI

struct LoginView: View {
    let store: AgendaStore

    @State private var email = ""
    @State private var password = ""
    @State private var otp = ""
    @State private var remember = true

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header
                    form
                }
                .padding(20)
            }
            .background(Color.softoraBackground)
            .navigationTitle("Softora Agenda")
            .alert("Melding", isPresented: alertBinding) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(store.alertMessage ?? "")
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 44, weight: .semibold))
                .foregroundStyle(Color.softoraBlue)

            Text("Inloggen")
                .font(.largeTitle.bold())
                .foregroundStyle(Color.softoraInk)

            Text("Gebruik je bestaande Softora-login om de agenda te openen.")
                .font(.body)
                .foregroundStyle(Color.softoraMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var form: some View {
        VStack(spacing: 14) {
            TextField("E-mailadres", text: $email)
                .softoraEmailInput()
                .autocorrectionDisabled()
                .submitLabel(.next)

            SecureField("Wachtwoord", text: $password)
                .softoraPasswordInput()
                .submitLabel(store.mfaRequired ? .next : .go)

            if store.mfaRequired {
                TextField("2FA-code", text: $otp)
                    .softoraOneTimeCodeInput()
            }

            Toggle("Onthoud mij", isOn: $remember)

            Button {
                Task {
                    await store.login(
                        email: email,
                        password: password,
                        otp: otp,
                        remember: remember
                    )
                }
            } label: {
                HStack {
                    if store.isLoggingIn {
                        ProgressView()
                    }
                    Text(store.isLoggingIn ? "Inloggen..." : "Inloggen")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(store.isLoggingIn || email.isEmpty || password.isEmpty)
        }
        .textFieldStyle(.roundedBorder)
        .softoraCard()
    }

    private var alertBinding: Binding<Bool> {
        Binding(
            get: { store.alertMessage != nil },
            set: { isPresented in
                if !isPresented {
                    store.alertMessage = nil
                }
            }
        )
    }
}

struct LoginView_Previews: PreviewProvider {
    static var previews: some View {
        LoginView(store: AgendaStore(apiClient: SoftoraAPIClient()))
    }
}
