import SwiftUI

struct AddAppointmentView: View {
    let store: AgendaStore

    @Environment(\.dismiss) private var dismiss
    @State private var draft = NewAppointmentDraft()

    init(store: AgendaStore) {
        self.store = store
        _draft = State(initialValue: NewAppointmentDraft(planner: store.selectedPlanner))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Voor wie") {
                    Picker("Voor wie", selection: $draft.planner) {
                        ForEach(Planner.allCases) { planner in
                            Text(planner.title).tag(planner)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section("Afspraak") {
                    TextField("Titel", text: $draft.title)
                        .softoraSentenceInput()

                    DatePicker("Datum", selection: $draft.date, displayedComponents: .date)

                    DatePicker("Tijd", selection: $draft.time, displayedComponents: .hourAndMinute)

                    TextField("Locatie", text: $draft.location)
                        .softoraSentenceInput()
                }

                Section("Opmerkingen") {
                    TextEditor(text: $draft.notes)
                        .frame(minHeight: 110)
                }
            }
            .navigationTitle("Nieuwe afspraak")
            .softoraInlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuleer") {
                        dismiss()
                    }
                    .disabled(store.isSavingAppointment)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task {
                            if await store.addAppointment(draft) {
                                dismiss()
                            }
                        }
                    } label: {
                        if store.isSavingAppointment {
                            ProgressView()
                        } else {
                            Text("Bewaar")
                        }
                    }
                    .disabled(!draft.canSubmit || store.isSavingAppointment)
                }
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

struct AddAppointmentView_Previews: PreviewProvider {
    static var previews: some View {
        AddAppointmentView(store: AgendaStore.previewAuthenticated)
    }
}
