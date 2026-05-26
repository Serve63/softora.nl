import SwiftUI

struct AddAppointmentView: View {
    let store: AgendaStore

    @Environment(\.dismiss) private var dismiss
    @FocusState private var focusedField: Field?
    @State private var draft: NewAppointmentDraft
    @State private var timeText = ""
    @State private var isChoosingRepeat = false

    init(
        store: AgendaStore,
        date: Date = Date(),
        appointmentType: AppointmentType = .personal,
        businessKind: BusinessAppointmentKind = .appointment,
        businessMeetingType: BusinessMeetingType = .website
    ) {
        self.store = store
        _draft = State(
            initialValue: NewAppointmentDraft(
                planner: store.selectedPlanner,
                date: date,
                appointmentType: appointmentType,
                businessKind: businessKind,
                businessMeetingType: businessMeetingType
            )
        )
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [.white, Color.softoraSheetBackground],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    sheetHeader

                    VStack(alignment: .leading, spacing: 11) {
                        if showsPlannerChoices {
                            FormLabel("Wie heeft deze lead geregeld?")
                            plannerChoices
                        }

                        FormLabel("Titel")
                        SoftoraTextField(
                            placeholder: "Titel van de afspraak",
                            text: $draft.title,
                            fontSize: 13
                        )
                        .focused($focusedField, equals: .title)

                        FormLabel("Tijdstip")
                        SoftoraTextField(
                            placeholder: "--:--",
                            text: $timeText,
                            keyboardType: .numberPad
                        )
                        .focused($focusedField, equals: .time)
                        .onChange(of: timeText) { _, value in
                            normalizeTimeInput(value)
                        }

                        FormLabel("Herhalen")
                        repeatRow

                        FormLabel("Locatie")
                        SoftoraTextField(
                            placeholder: "Bijv. kantoor, Teams, klantlocatie",
                            text: $draft.location,
                            fontSize: 13
                        )
                        .focused($focusedField, equals: .location)

                        FormLabel("Opmerkingen")
                        notesEditor

                        SheetActionButton(title: store.isSavingAppointment ? "Opslaan..." : "Toevoegen", isPrimary: true) {
                            save()
                        }
                        .disabled(store.isSavingAppointment)
                        .padding(.top, 12)
                        .overlay(alignment: .top) {
                            Rectangle()
                                .fill(Color.softoraPurpleLight)
                                .frame(height: 1)
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 12)
                    .padding(.bottom, 24)
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .scrollIndicators(.hidden)

            if isChoosingRepeat {
                RepeatChoiceOverlay(
                    selectedChoice: $draft.repeatChoice,
                    onClose: { isChoosingRepeat = false }
                )
            }
        }
        .presentationBackground(.clear)
        .presentationDragIndicator(.hidden)
        .alert("MELDING", isPresented: alertBinding) {
            Button("OK", role: .cancel) {}
        } message: {
            Text((store.alertMessage ?? "").softoraUppercased)
        }
    }

    private var sheetHeader: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                Text("Afspraak toevoegen")
                    .font(.softoraDisplay(13, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(1.1)
                    .foregroundStyle(Color.softoraCrimson)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 8)
                    .background(Color.softoraPurpleLight)

                Spacer()

                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(Color.softoraMuted)
                        .frame(width: 42, height: 42)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(Color.softoraPurpleLight, lineWidth: 1)
                        }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Sluiten")
            }

            Text(AgendaDateFormatter.sheetDateTitle(draft.date))
                .font(.softoraDisplay(24, weight: .bold))
                .textCase(.uppercase)
                .tracking(1.3)
                .foregroundStyle(Color.softoraInk)
                .padding(.top, 18)
        }
        .padding(.horizontal, 24)
        .padding(.top, 24)
        .padding(.bottom, 10)
    }

    private var plannerChoices: some View {
        HStack(spacing: 10) {
            ForEach(plannerOptions) { planner in
                Button {
                    draft.planner = planner
                } label: {
                    Text(planner.title)
                        .font(.softoraDisplay(14, weight: .bold))
                        .textCase(.uppercase)
                        .tracking(0.7)
                        .foregroundStyle(Color.softoraInk)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(draft.planner == planner ? Color.softoraCrimson : Color.softoraPurpleLight, lineWidth: draft.planner == planner ? 2 : 1)
                        }
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var plannerOptions: [Planner] {
        Planner.appAccessCases
    }

    private var showsPlannerChoices: Bool {
        draft.appointmentType == .business && draft.businessKind == .meeting
    }

    private var repeatRow: some View {
        Button {
            focusedField = nil
            isChoosingRepeat = true
        } label: {
            HStack {
                Text("HERHALEN")
                    .font(.softoraBody(13))
                    .foregroundStyle(Color.softoraInk)

                Spacer()

                Text(draft.repeatChoice.title.softoraUppercased)
                    .font(.softoraBody(13, weight: .semibold))
                    .foregroundStyle(Color.softoraMuted)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 15)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.softoraPurpleLight, lineWidth: 1)
            }
            .shadow(color: Color.softoraInk.opacity(0.04), radius: 18, x: 0, y: 8)
        }
        .buttonStyle(.plain)
    }

    private var notesEditor: some View {
        TextEditor(
            text: Binding(
                get: { draft.notes },
                set: { draft.notes = $0.softoraUppercased }
            )
        )
            .font(.softoraBody(16))
            .foregroundStyle(Color.softoraInk)
            .textInputAutocapitalization(.characters)
            .scrollContentBackground(.hidden)
            .frame(minHeight: 130)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.softoraPurpleLight, lineWidth: 1)
            }
            .shadow(color: Color.softoraInk.opacity(0.04), radius: 18, x: 0, y: 8)
            .focused($focusedField, equals: .notes)
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

    private func normalizeTimeInput(_ value: String) {
        let digits = value.filter(\.isNumber).prefix(4)
        var normalized = ""
        for (index, character) in digits.enumerated() {
            if index == 2 {
                normalized.append(":")
            }
            normalized.append(character)
        }
        if normalized != value {
            timeText = normalized
        }
    }

    private func save() {
        if draft.appointmentType == .personal || draft.businessKind == .appointment {
            draft.planner = store.selectedPlanner
        }

        let trimmedTime = timeText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedTime.count == 5, trimmedTime.contains(":") else {
            store.alertMessage = "Vul een tijdstip in als HH:MM."
            return
        }

        draft.time = AgendaDateFormatter.timeDate(from: trimmedTime, fallback: draft.date)
        focusedField = nil

        Task {
            if await store.addAppointment(draft) {
                dismiss()
            }
        }
    }

    private enum Field {
        case title
        case time
        case location
        case notes
    }
}

private struct FormLabel: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title)
            .font(.softoraDisplay(13, weight: .bold))
            .textCase(.uppercase)
            .tracking(1.5)
            .foregroundStyle(Color.softoraMuted)
    }
}

private struct SoftoraTextField: View {
    let placeholder: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var fontSize: CGFloat = 16

    var body: some View {
        TextField(placeholder.softoraUppercased, text: uppercasedText)
            .font(.softoraBody(fontSize))
            .foregroundStyle(Color.softoraInk)
            .keyboardType(keyboardType)
            .textInputAutocapitalization(.characters)
            .padding(.horizontal, 16)
            .padding(.vertical, 15)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.softoraPurpleLight, lineWidth: 1)
            }
            .shadow(color: Color.softoraInk.opacity(0.04), radius: 18, x: 0, y: 8)
    }

    private var uppercasedText: Binding<String> {
        Binding(
            get: { text },
            set: { text = $0.softoraUppercased }
        )
    }
}

private struct SheetActionButton: View {
    let title: String
    let isPrimary: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.softoraDisplay(15, weight: .bold))
                .textCase(.uppercase)
                .tracking(0.75)
                .foregroundStyle(isPrimary ? Color.white : Color.softoraMuted)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(isPrimary ? Color.softoraCrimson : Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                .overlay {
                    if !isPrimary {
                        RoundedRectangle(cornerRadius: 13, style: .continuous)
                            .stroke(Color.softoraPurpleLight, lineWidth: 1)
                    }
                }
        }
        .buttonStyle(.plain)
    }
}

private struct RepeatChoiceOverlay: View {
    @Binding var selectedChoice: RepeatChoice
    let onClose: () -> Void

    var body: some View {
        ZStack {
            Color.softoraInk.opacity(0.58)
                .ignoresSafeArea()
                .onTapGesture(perform: onClose)

            VStack(spacing: 14) {
                Text("Herhalen")
                    .font(.softoraDisplay(20, weight: .semibold))
                    .textCase(.uppercase)
                    .tracking(0.8)
                    .foregroundStyle(Color.softoraInk)

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(RepeatChoice.allCases) { choice in
                        Button {
                            selectedChoice = choice
                            onClose()
                        } label: {
                            Text(choice.title)
                                .font(.softoraBody(13, weight: .bold))
                                .textCase(.uppercase)
                                .foregroundStyle(Color.softoraInk)
                                .lineLimit(1)
                                .minimumScaleFactor(0.82)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 18)
                                .padding(.horizontal, 8)
                                .background(Color.white)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .stroke(selectedChoice == choice ? Color.softoraCrimson : Color.clear, lineWidth: 2)
                                }
                        }
                        .buttonStyle(.plain)
                    }
                }

                Color.clear
                    .frame(height: 20)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 24)
            .frame(maxWidth: 390)
            .background(
                LinearGradient(
                    colors: [.white, Color.softoraSheetBackground],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(Color.softoraCrimson.opacity(0.12), lineWidth: 1)
            }
            .shadow(color: Color.softoraInk.opacity(0.24), radius: 36, x: 0, y: 22)
            .padding(.horizontal, 18)
        }
    }
}

struct AddAppointmentView_Previews: PreviewProvider {
    static var previews: some View {
        AddAppointmentView(store: AgendaStore.previewAuthenticated)
    }
}
