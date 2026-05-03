import SwiftUI

struct PinAccessView: View {
    let store: AgendaStore

    @State private var pin = ""
    @State private var planner: Planner

    init(store: AgendaStore) {
        self.store = store
        _planner = State(initialValue: store.selectedPlanner)
    }

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
            Image(systemName: "lock.shield")
                .font(.system(size: 44, weight: .semibold))
                .foregroundStyle(Color.softoraBlue)

            Text("Agenda openen")
                .font(.largeTitle.bold())
                .foregroundStyle(Color.softoraInk)

            Text("Kies wie je bent en vul je pincode in.")
                .font(.body)
                .foregroundStyle(Color.softoraMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var form: some View {
        VStack(spacing: 14) {
            Picker("Wie ben je?", selection: $planner) {
                ForEach(Planner.appAccessCases) { planner in
                    Text(planner.title).tag(planner)
                }
            }
            .pickerStyle(.segmented)

            SecureField("Pincode", text: $pin)
                .softoraOneTimeCodeInput()
                .submitLabel(.go)
                .onSubmit(openAgenda)

            Button(action: openAgenda) {
                HStack {
                    if store.isUnlocking {
                        ProgressView()
                    }
                    Text(store.isUnlocking ? "Openen..." : "Open agenda")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(store.isUnlocking || pin.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .textFieldStyle(.roundedBorder)
        .softoraCard()
    }

    private func openAgenda() {
        guard !store.isUnlocking else { return }
        Task {
            await store.unlock(pin: pin, planner: planner)
        }
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

struct PinAccessView_Previews: PreviewProvider {
    static var previews: some View {
        PinAccessView(store: AgendaStore(apiClient: SoftoraAPIClient()))
    }
}
