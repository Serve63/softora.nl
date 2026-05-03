import SwiftUI

struct AgendaListView: View {
    let store: AgendaStore

    @State private var isShowingAddAppointment = false

    var body: some View {
        NavigationStack {
            Group {
                if store.isLoadingAppointments && store.appointments.isEmpty {
                    ProgressView("Agenda laden...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if store.appointments.isEmpty {
                    EmptyAgendaView {
                        isShowingAddAppointment = true
                    }
                } else {
                    List {
                        Section {
                            ForEach(store.appointments) { appointment in
                                AppointmentRowView(appointment: appointment)
                            }
                        } header: {
                            Text("Aankomende afspraken")
                        }
                    }
                    .softoraAgendaListStyle()
                    .refreshable {
                        await store.loadAppointments(fresh: true)
                    }
                }
            }
            .background(Color.softoraBackground)
            .navigationTitle("Agenda")
            .toolbar {
                #if os(iOS)
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        Task { await store.logout() }
                    } label: {
                        Image(systemName: "person.crop.circle.badge.arrow.forward")
                    }
                    .accessibilityLabel("Wissel persoon")
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        isShowingAddAppointment = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                    }
                    .accessibilityLabel("Afspraak toevoegen")
                }
                #else
                ToolbarItem(placement: .automatic) {
                    Button {
                        Task { await store.logout() }
                    } label: {
                        Image(systemName: "person.crop.circle.badge.arrow.forward")
                    }
                    .accessibilityLabel("Wissel persoon")
                }

                ToolbarItem(placement: .automatic) {
                    Button {
                        isShowingAddAppointment = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                    }
                    .accessibilityLabel("Afspraak toevoegen")
                }
                #endif
            }
            .safeAreaInset(edge: .top) {
                if store.isAuthenticated {
                    Text("Binnen als \(store.selectedPlanner.title)")
                        .font(.caption)
                        .foregroundStyle(Color.softoraMuted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(.thinMaterial)
                }
            }
            .sheet(isPresented: $isShowingAddAppointment) {
                AddAppointmentView(store: store)
            }
            .alert("Melding", isPresented: alertBinding) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(store.alertMessage ?? "")
            }
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

private struct EmptyAgendaView: View {
    let onAdd: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "calendar")
                .font(.system(size: 42, weight: .semibold))
                .foregroundStyle(Color.softoraBlue)

            Text("Geen aankomende afspraken")
                .font(.title2.bold())

            Text("Voeg een afspraak toe of trek omlaag om opnieuw te verversen.")
                .font(.body)
                .foregroundStyle(Color.softoraMuted)
                .multilineTextAlignment(.center)

            Button {
                onAdd()
            } label: {
                Label("Afspraak toevoegen", systemImage: "plus")
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct AgendaListView_Previews: PreviewProvider {
    static var previews: some View {
        AgendaListView(store: AgendaStore.previewAuthenticated)
    }
}
