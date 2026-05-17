import SwiftUI

struct AgendaListView: View {
    let store: AgendaStore

    @State private var weekStart = AgendaDateFormatter.weekStart(containing: Date())
    @State private var pendingDate: Date?
    @State private var isChoosingAppointmentType = false
    @State private var isChoosingBusinessKind = false
    @State private var isChoosingBusinessType = false
    @State private var selectedBusinessType: BusinessMeetingType = .website
    @State private var addConfiguration: AddAppointmentConfiguration?
    @State private var selectedAppointment: AgendaAppointment?
    @State private var isShowingMailbox = false
    @State private var isShowingGym = false
    @State private var weekTransitionDirection = 1

    var body: some View {
        ZStack {
            Color.softoraShellBackground.ignoresSafeArea()

            VStack(spacing: 0) {
                AgendaTopBar(
                    weekStart: weekStart
                )

                ScrollView {
                    ZStack {
                        WeekGridView(
                            weekStart: weekStart,
                            appointments: appointmentsByDate,
                            onSelectDate: openAppointmentTypeChoice,
                            onSelectAppointment: openAppointmentDetail
                        )
                        .id(weekStart)
                        .transition(weekSlideTransition)
                    }
                    .clipped()
                    .animation(.smooth(duration: 0.42), value: weekStart)
                    .padding(.top, 1.5)
                }
                .scrollIndicators(.hidden)
                .refreshable {
                    await store.loadAppointments(fresh: true)
                }
                .gesture(
                    DragGesture(minimumDistance: 22)
                        .onEnded { value in
                            guard abs(value.translation.width) > abs(value.translation.height),
                                  abs(value.translation.width) > 70 else {
                                return
                            }
                            moveWeek(value.translation.width < 0 ? 1 : -1)
                        }
                )

                AgendaShortcutBar(
                    showGymShortcut: store.selectedPlanner == .serve,
                    onOpenMail: openMailbox,
                    onOpenGym: openGymShortcut
                )
            }
            .blur(radius: overlayIsOpen ? 7 : 0)

            if store.isLoadingAppointments && store.appointments.isEmpty {
                AgendaLoadingOverlay()
            }

            if isChoosingAppointmentType {
                AppointmentTypeOverlay(
                    onClose: closeAppointmentTypeChoice,
                    onSelectPersonal: {
                        openAddSheet(appointmentType: .personal)
                    },
                    onSelectBusiness: {
                        isChoosingAppointmentType = false
                        isChoosingBusinessKind = true
                    }
                )
            }

            if isChoosingBusinessKind {
                BusinessKindOverlay(
                    onBack: {
                        isChoosingBusinessKind = false
                        isChoosingAppointmentType = true
                    },
                    onSelectMeeting: {
                        selectedBusinessType = .website
                        isChoosingBusinessKind = false
                        isChoosingBusinessType = true
                    },
                    onSelectAppointment: {
                        openAddSheet(
                            appointmentType: .business,
                            businessKind: .appointment,
                            businessMeetingType: .software
                        )
                    }
                )
            }

            if isChoosingBusinessType {
                BusinessTypeOverlay(
                    selectedType: $selectedBusinessType,
                    onBack: {
                        isChoosingBusinessType = false
                        isChoosingBusinessKind = true
                    },
                    onNext: {
                        openAddSheet(
                            appointmentType: .business,
                            businessKind: .meeting,
                            businessMeetingType: selectedBusinessType
                        )
                    }
                )
            }
        }
        .fullScreenCover(item: $addConfiguration) { configuration in
            AddAppointmentView(
                store: store,
                date: configuration.date,
                appointmentType: configuration.appointmentType,
                businessKind: configuration.businessKind,
                businessMeetingType: configuration.businessMeetingType,
                prefilledTitle: configuration.prefilledTitle
            )
        }
        .fullScreenCover(item: $selectedAppointment) { appointment in
            AppointmentDetailView(store: store, appointment: appointment)
        }
        .fullScreenCover(isPresented: $isShowingMailbox) {
            MailboxView(apiClient: SoftoraAPIClient())
        }
        .fullScreenCover(isPresented: $isShowingGym) {
            GymWorkoutView()
        }
        .alert("MELDING", isPresented: alertBinding) {
            Button("OK", role: .cancel) {}
        } message: {
            Text((store.alertMessage ?? "").softoraUppercased)
        }
    }

    private var overlayIsOpen: Bool {
        isChoosingAppointmentType || isChoosingBusinessKind || isChoosingBusinessType
    }

    private var appointmentsByDate: [String: [AgendaAppointment]] {
        Dictionary(grouping: store.appointments) { $0.date }
            .mapValues { appointments in
                appointments.sorted { $0.sortKey < $1.sortKey }
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

    private var weekSlideTransition: AnyTransition {
        let insertionEdge: Edge = weekTransitionDirection > 0 ? .trailing : .leading
        let removalEdge: Edge = weekTransitionDirection > 0 ? .leading : .trailing

        return .asymmetric(
            insertion: .move(edge: insertionEdge).combined(with: .opacity),
            removal: .move(edge: removalEdge).combined(with: .opacity)
        )
    }

    private func moveWeek(_ delta: Int) {
        weekTransitionDirection = delta
        withAnimation(.smooth(duration: 0.42)) {
            weekStart = AgendaDateFormatter.addWeeks(delta, to: weekStart)
        }
    }

    private func openAppointmentTypeChoice(_ date: Date) {
        pendingDate = date
        isChoosingAppointmentType = true
    }

    private func openAppointmentDetail(_ appointment: AgendaAppointment) {
        selectedAppointment = appointment
    }

    private func closeAppointmentTypeChoice() {
        isChoosingAppointmentType = false
        isChoosingBusinessKind = false
        isChoosingBusinessType = false
        pendingDate = nil
    }

    private func openAddSheet(
        appointmentType: AppointmentType,
        businessKind: BusinessAppointmentKind = .appointment,
        businessMeetingType: BusinessMeetingType = .website
    ) {
        addConfiguration = AddAppointmentConfiguration(
            date: pendingDate ?? Date(),
            appointmentType: appointmentType,
            businessKind: businessKind,
            businessMeetingType: businessMeetingType
        )
        isChoosingAppointmentType = false
        isChoosingBusinessKind = false
        isChoosingBusinessType = false
    }

    private func openMailbox() {
        isShowingMailbox = true
    }

    private func openGymShortcut() {
        isShowingGym = true
        isChoosingAppointmentType = false
        isChoosingBusinessKind = false
        isChoosingBusinessType = false
        pendingDate = nil
    }
}

private struct AddAppointmentConfiguration: Identifiable {
    let id = UUID()
    let date: Date
    let appointmentType: AppointmentType
    let businessKind: BusinessAppointmentKind
    let businessMeetingType: BusinessMeetingType
    let prefilledTitle: String

    init(
        date: Date,
        appointmentType: AppointmentType,
        businessKind: BusinessAppointmentKind = .appointment,
        businessMeetingType: BusinessMeetingType = .website,
        prefilledTitle: String = ""
    ) {
        self.date = date
        self.appointmentType = appointmentType
        self.businessKind = businessKind
        self.businessMeetingType = businessMeetingType
        self.prefilledTitle = prefilledTitle
    }
}

private struct AgendaTopBar: View {
    let weekStart: Date

    var body: some View {
        VStack(spacing: 1) {
            Text("Week \(AgendaDateFormatter.weekNumber(for: weekStart))")
                .font(.softoraDisplay(19, weight: .semibold))
                .textCase(.uppercase)
                .tracking(0.7)
                .foregroundStyle(Color.softoraInk)

            Text(AgendaDateFormatter.weekRangeLabel(for: weekStart))
                .font(.softoraBody(11, weight: .regular))
                .foregroundStyle(Color.softoraMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 14)
        .background(Color.white)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Color.softoraPurpleLight)
                .frame(height: 1.5)
        }
    }
}

private struct GymWorkoutView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var selectedDay: GymWorkoutDay = .today
    @State private var isChoosingDay = false

    private var exercises: [GymExercise] {
        selectedDay.exercises
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [.white, Color.softoraSheetBackground],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                gymHeader

                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Oefeningen")
                            .font(.softoraDisplay(18, weight: .bold))
                            .textCase(.uppercase)
                            .tracking(1.0)
                            .foregroundStyle(Color.softoraInk)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 20)
                            .padding(.top, 16)

                        LazyVStack(spacing: 10) {
                            ForEach(exercises) { exercise in
                                GymExerciseRow(exercise: exercise)
                            }
                        }
                        .padding(.horizontal, 18)
                        .padding(.bottom, 28)
                    }
                }
                .scrollIndicators(.hidden)
            }

            if isChoosingDay {
                GymDayPickerOverlay(
                    selectedDay: selectedDay,
                    onSelect: { day in
                        selectedDay = day
                        isChoosingDay = false
                    },
                    onClose: {
                        isChoosingDay = false
                    }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.smooth(duration: 0.24), value: isChoosingDay)
    }

    private var gymHeader: some View {
        ZStack {
            VStack(spacing: 2) {
                Text("Gym")
                    .font(.softoraDisplay(22, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(1.0)
                    .foregroundStyle(Color.softoraInk)

                Button {
                    isChoosingDay = true
                } label: {
                    Text(selectedDay.title)
                        .font(.softoraBody(12, weight: .semibold))
                        .textCase(.uppercase)
                        .foregroundStyle(Color.softoraMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dag kiezen")
            }

            HStack {
                Spacer()

                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(Color.softoraMuted)
                        .frame(width: 42, height: 42)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 13, style: .continuous)
                                .stroke(Color.softoraPurpleLight, lineWidth: 1)
                        }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Sluiten")
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 14)
        .background(Color.white)
    }
}

private enum GymWorkoutDay: String, CaseIterable, Identifiable {
    case today
    case monday
    case tuesday
    case wednesday
    case thursday
    case friday
    case saturday
    case sunday

    var id: String { rawValue }

    var title: String {
        switch self {
        case .today:
            "Vandaag"
        case .monday:
            "Maandag"
        case .tuesday:
            "Dinsdag"
        case .wednesday:
            "Woensdag"
        case .thursday:
            "Donderdag"
        case .friday:
            "Vrijdag"
        case .saturday:
            "Zaterdag"
        case .sunday:
            "Zondag"
        }
    }

    var exercises: [GymExercise] {
        GymExercise.defaultWorkout
    }
}

private struct GymDayPickerOverlay: View {
    let selectedDay: GymWorkoutDay
    let onSelect: (GymWorkoutDay) -> Void
    let onClose: () -> Void

    private let columns = [
        GridItem(.flexible(), spacing: 10),
        GridItem(.flexible(), spacing: 10)
    ]

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.softoraInk.opacity(0.28)
                .ignoresSafeArea()
                .onTapGesture(perform: onClose)

            VStack(spacing: 16) {
                Text("Kies dag")
                    .font(.softoraDisplay(21, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(1.0)
                    .foregroundStyle(Color.softoraInk)

                LazyVGrid(columns: columns, spacing: 10) {
                    ForEach(GymWorkoutDay.allCases) { day in
                        GymDayButton(
                            day: day,
                            isSelected: day == selectedDay,
                            onSelect: { onSelect(day) }
                        )
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 22)
            .padding(.bottom, 28)
            .frame(maxWidth: .infinity)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
            .padding(.horizontal, 12)
            .padding(.bottom, 10)
        }
    }
}

private struct GymDayButton: View {
    let day: GymWorkoutDay
    let isSelected: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            Text(day.title)
                .font(.softoraDisplay(13, weight: .bold))
                .textCase(.uppercase)
                .tracking(0.8)
                .foregroundStyle(isSelected ? Color.white : Color.softoraInk)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(isSelected ? Color.softoraCrimson : Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay {
                    if !isSelected {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(Color.softoraPurpleLight, lineWidth: 1)
                    }
                }
        }
        .buttonStyle(.plain)
    }
}

private struct GymExerciseRow: View {
    let exercise: GymExercise

    @State private var sets: String
    @State private var reps: String
    @State private var kilograms: String

    init(exercise: GymExercise) {
        self.exercise = exercise
        _sets = State(initialValue: exercise.defaultSets)
        _reps = State(initialValue: exercise.defaultReps)
        _kilograms = State(initialValue: "")
    }

    var body: some View {
        HStack(alignment: .top, spacing: 13) {
            Text(String(format: "%02d", exercise.order))
                .font(.softoraDisplay(14, weight: .bold))
                .tracking(0.8)
                .foregroundStyle(Color.white)
                .frame(width: 42, height: 42)
                .background(Color.softoraCrimson)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .top, spacing: 8) {
                    Text(exercise.title)
                        .font(.softoraDisplay(15, weight: .bold))
                        .textCase(.uppercase)
                        .tracking(0.7)
                        .foregroundStyle(Color.softoraInk)
                        .lineLimit(2)
                        .minimumScaleFactor(0.82)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    HStack(spacing: 5) {
                        GymMetricField(label: "Sets", value: $sets, keyboardType: .numberPad)
                        GymMetricField(label: "Reps", value: $reps, keyboardType: .numberPad)
                        GymMetricField(label: "Kg", value: $kilograms, keyboardType: .decimalPad)
                    }
                }

                Text(exercise.details)
                    .font(.softoraBody(12, weight: .semibold))
                    .textCase(.uppercase)
                    .foregroundStyle(Color.softoraMuted)
            }

            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .stroke(Color.softoraPurpleLight, lineWidth: 1)
        }
    }
}

private struct GymExercise: Identifiable {
    var id: Int { order }

    let order: Int
    let title: String
    let details: String
    let defaultSets: String
    let defaultReps: String

    static let defaultWorkout: [GymExercise] = [
        GymExercise(order: 1, title: "Bankdrukken", details: "4 sets - 8 tot 10 herhalingen", defaultSets: "4", defaultReps: "10"),
        GymExercise(order: 2, title: "Schuine dumbbell press", details: "3 sets - 10 herhalingen", defaultSets: "3", defaultReps: "10"),
        GymExercise(order: 3, title: "Seated row", details: "4 sets - 10 herhalingen", defaultSets: "4", defaultReps: "10"),
        GymExercise(order: 4, title: "Lat pulldown", details: "3 sets - 10 herhalingen", defaultSets: "3", defaultReps: "10"),
        GymExercise(order: 5, title: "Shoulder press", details: "3 sets - 8 tot 10 herhalingen", defaultSets: "3", defaultReps: "10"),
        GymExercise(order: 6, title: "Biceps curl", details: "3 sets - 12 herhalingen", defaultSets: "3", defaultReps: "12"),
        GymExercise(order: 7, title: "Triceps pushdown", details: "3 sets - 12 herhalingen", defaultSets: "3", defaultReps: "12"),
        GymExercise(order: 8, title: "Plank", details: "3 rondes - 45 seconden", defaultSets: "3", defaultReps: "45")
    ]
}

private struct GymMetricField: View {
    let label: String
    @Binding var value: String
    let keyboardType: UIKeyboardType

    var body: some View {
        VStack(spacing: 2) {
            TextField("", text: $value)
                .font(.softoraDisplay(11, weight: .bold))
                .foregroundStyle(Color.softoraInk)
                .multilineTextAlignment(.center)
                .keyboardType(keyboardType)
                .frame(width: 30, height: 18)

            Text(label)
                .font(.softoraDisplay(7.5, weight: .bold))
                .textCase(.uppercase)
                .tracking(0.4)
                .foregroundStyle(Color.softoraMuted.opacity(0.78))
        }
        .frame(width: 36)
        .padding(.vertical, 4)
        .background(Color.softoraSheetBackground.opacity(0.64))
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(Color.softoraPurpleLight.opacity(0.75), lineWidth: 1)
        }
    }
}

private struct AgendaShortcutBar: View {
    let showGymShortcut: Bool
    let onOpenMail: () -> Void
    let onOpenGym: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            AgendaShortcutButton(
                title: "Mail",
                systemImage: "envelope.fill",
                action: onOpenMail
            )

            if showGymShortcut {
                AgendaShortcutButton(
                    title: "Gym",
                    systemImage: "dumbbell.fill",
                    action: onOpenGym
                )
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 10)
        .padding(.bottom, 10)
        .background(Color.white)
    }
}

private struct AgendaShortcutButton: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .bold))

                Text(title)
                    .font(.softoraDisplay(13, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(0.8)
            }
            .foregroundStyle(Color.softoraInk)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.softoraCrimson, lineWidth: 1.5)
            }
        }
        .buttonStyle(.plain)
    }
}

private struct MailboxView: View {
    @Environment(\.dismiss) private var dismiss

    let apiClient: SoftoraAPIClient

    @State private var accounts: [MailboxAccount] = []
    @State private var selectedAccount: MailboxAccount?
    @State private var selectedFolder: MailboxFolder = .inbox
    @State private var messages: [MailboxMessage] = []
    @State private var selectedMessage: MailboxMessage?
    @State private var isShowingFolderMenu = false
    @State private var isLoadingAccounts = false
    @State private var isLoadingMessages = false
    @State private var alertMessage: String?

    var body: some View {
        ZStack(alignment: .leading) {
            LinearGradient(
                colors: [.white, Color.softoraSheetBackground],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                mailboxHeader

                HStack {
                    Text(selectedFolder.title)
                        .font(.softoraDisplay(18, weight: .bold))
                        .textCase(.uppercase)
                        .tracking(1.0)
                        .foregroundStyle(Color.softoraInk)

                    Spacer()

                    if isLoadingMessages {
                        ProgressView()
                            .tint(Color.softoraCrimson)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 14)
                .padding(.bottom, 8)

                mailboxContent

                MailboxAccountSelector(
                    accounts: accounts,
                    selectedAccount: selectedAccount,
                    isLoading: isLoadingAccounts,
                    isLocked: selectedMessage != nil,
                    onSelect: selectAccount
                )
            }

            if isShowingFolderMenu {
                MailboxFolderDrawer(
                    selectedFolder: selectedFolder,
                    onSelect: selectFolder,
                    onClose: { isShowingFolderMenu = false }
                )
                .transition(.move(edge: .leading).combined(with: .opacity))
            }
        }
        .animation(.smooth(duration: 0.24), value: isShowingFolderMenu)
        .task {
            await loadAccounts()
        }
        .alert("MELDING", isPresented: alertBinding) {
            Button("OK", role: .cancel) {}
        } message: {
            Text((alertMessage ?? "").softoraUppercased)
        }
    }

    private var mailboxHeader: some View {
        ZStack {
            Text("Mailbox")
                .font(.softoraDisplay(21, weight: .bold))
                .textCase(.uppercase)
                .tracking(1.0)
                .foregroundStyle(Color.softoraInk)

            HStack {
                Button {
                    isShowingFolderMenu = true
                } label: {
                    Image(systemName: "line.3.horizontal")
                        .font(.system(size: 19, weight: .bold))
                        .foregroundStyle(Color.softoraInk)
                        .frame(width: 42, height: 42)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 13, style: .continuous)
                                .stroke(Color.softoraPurpleLight, lineWidth: 1)
                        }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Mappen")

                Spacer()

                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(Color.softoraMuted)
                        .frame(width: 42, height: 42)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 13, style: .continuous)
                                .stroke(Color.softoraPurpleLight, lineWidth: 1)
                        }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Sluiten")
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 12)
        .background(Color.white)
    }

    @ViewBuilder
    private var mailboxContent: some View {
        if isLoadingMessages && messages.isEmpty {
            VStack(spacing: 10) {
                ProgressView()
                    .tint(Color.softoraCrimson)

                Text("MAILS LADEN...")
                    .font(.softoraBody(13, weight: .semibold))
                    .foregroundStyle(Color.softoraMuted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let selectedMessage {
            MailboxMessageDetail(
                message: selectedMessage,
                selectedAccount: selectedAccount,
                apiClient: apiClient
            ) {
                self.selectedMessage = nil
            }
        } else if messages.isEmpty {
            VStack(spacing: 8) {
                Text(emptyTitle)
                    .font(.softoraDisplay(20, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(1.0)
                    .foregroundStyle(Color.softoraInk)

                Text(emptySubtitle)
                    .font(.softoraBody(13, weight: .medium))
                    .foregroundStyle(Color.softoraMuted)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 28)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(messages) { message in
                        MailboxMessageRow(message: message) {
                            selectedMessage = message
                        }
                    }
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 20)
            }
            .refreshable {
                await loadMessages()
            }
            .scrollIndicators(.hidden)
        }
    }

    private var emptyTitle: String {
        selectedAccount?.imapConfigured == false ? "Mailbox niet gekoppeld" : "Geen mails"
    }

    private var emptySubtitle: String {
        selectedAccount?.imapConfigured == false
            ? "Deze mailbox heeft nog geen IMAP-koppeling."
            : "Deze map is leeg."
    }

    private var alertBinding: Binding<Bool> {
        Binding(
            get: { alertMessage != nil },
            set: { isPresented in
                if !isPresented {
                    alertMessage = nil
                }
            }
        )
    }

    private func loadAccounts() async {
        guard !isLoadingAccounts else { return }
        isLoadingAccounts = true
        alertMessage = nil
        defer { isLoadingAccounts = false }

        do {
            let loadedAccounts = try await apiClient.fetchMailboxAccounts()
            accounts = loadedAccounts
            if selectedAccount == nil || !loadedAccounts.contains(where: { $0.id == selectedAccount?.id }) {
                selectedAccount = loadedAccounts.first(where: \.imapConfigured) ?? loadedAccounts.first
            }
            await loadMessages()
        } catch {
            guard !error.isMailboxCancellation else { return }
            alertMessage = error.localizedDescription
        }
    }

    private func loadMessages() async {
        guard let account = selectedAccount else {
            messages = []
            selectedMessage = nil
            return
        }
        guard account.imapConfigured else {
            messages = []
            selectedMessage = nil
            return
        }

        isLoadingMessages = true
        alertMessage = nil
        defer { isLoadingMessages = false }

        do {
            messages = try await apiClient.fetchMailboxMessages(
                account: account.email,
                folder: selectedFolder.apiValue,
                limit: 50
            )
            selectedMessage = nil
        } catch {
            guard !error.isMailboxCancellation else { return }
            alertMessage = error.localizedDescription
        }
    }

    private func selectAccount(_ account: MailboxAccount) {
        guard account.id != selectedAccount?.id else { return }
        selectedAccount = account
        Task { await loadMessages() }
    }

    private func selectFolder(_ folder: MailboxFolder) {
        selectedFolder = folder
        isShowingFolderMenu = false
        Task { await loadMessages() }
    }
}

private extension Error {
    var isMailboxCancellation: Bool {
        if self is CancellationError {
            return true
        }
        if let urlError = self as? URLError, urlError.code == .cancelled {
            return true
        }

        let nsError = self as NSError
        return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
    }
}

private enum MailboxFolder: String, CaseIterable, Identifiable {
    case inbox
    case important
    case promotions
    case spam
    case sent
    case drafts
    case trash

    var id: String { rawValue }

    var apiValue: String {
        switch self {
        case .important:
            "starred"
        case .promotions:
            "promotions"
        default:
            rawValue
        }
    }

    var title: String {
        switch self {
        case .inbox:
            "Inkomend"
        case .important:
            "Belangrijk"
        case .promotions:
            "Reclame"
        case .spam:
            "Spam"
        case .sent:
            "Verzonden"
        case .drafts:
            "Concepten"
        case .trash:
            "Prullenbak"
        }
    }

    var systemImage: String {
        switch self {
        case .inbox:
            "tray.fill"
        case .important:
            "star.fill"
        case .promotions:
            "tag.fill"
        case .spam:
            "exclamationmark.octagon.fill"
        case .sent:
            "paperplane.fill"
        case .drafts:
            "doc.fill"
        case .trash:
            "trash.fill"
        }
    }
}

private struct MailboxFolderDrawer: View {
    let selectedFolder: MailboxFolder
    let onSelect: (MailboxFolder) -> Void
    let onClose: () -> Void

    var body: some View {
        ZStack(alignment: .leading) {
            Color.softoraInk.opacity(0.30)
                .ignoresSafeArea()
                .onTapGesture(perform: onClose)

            VStack(alignment: .leading, spacing: 10) {
                Text("Mappen")
                    .font(.softoraDisplay(19, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(1.0)
                    .foregroundStyle(Color.softoraInk)
                    .padding(.bottom, 6)

                ForEach(MailboxFolder.allCases) { folder in
                    Button {
                        onSelect(folder)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: folder.systemImage)
                                .font(.system(size: 14, weight: .bold))
                                .frame(width: 20)

                            Text(folder.title)
                                .font(.softoraDisplay(14, weight: .bold))
                                .textCase(.uppercase)
                                .tracking(0.7)

                            Spacer()
                        }
                        .foregroundStyle(selectedFolder == folder ? Color.white : Color.softoraInk)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 13)
                        .background(selectedFolder == folder ? Color.softoraCrimson : Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay {
                            if selectedFolder != folder {
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .stroke(Color.softoraPurpleLight, lineWidth: 1)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }

                Spacer()
            }
            .padding(.horizontal, 18)
            .padding(.top, 60)
            .padding(.bottom, 24)
            .frame(width: 282)
            .frame(maxHeight: .infinity)
            .background(Color.softoraSheetBackground)
            .shadow(color: Color.softoraInk.opacity(0.20), radius: 24, x: 16, y: 0)
        }
    }
}

private struct MailboxMessageRow: View {
    let message: MailboxMessage
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text(message.from.isEmpty ? "ONBEKEND" : message.from.softoraUppercased)
                        .font(.softoraDisplay(14, weight: message.unread ? .bold : .semibold))
                        .tracking(0.5)
                        .foregroundStyle(Color.softoraInk)
                        .lineLimit(1)

                    Spacer()

                    if message.starred {
                        Image(systemName: "star.fill")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Color.softoraCrimson)
                    }

                    Text(MailboxDateFormatter.label(message.date))
                        .font(.softoraBody(10, weight: .semibold))
                        .foregroundStyle(Color.softoraMuted)
                }

                Text(message.subject.isEmpty ? "(GEEN ONDERWERP)" : message.subject.softoraUppercased)
                    .font(.softoraBody(13, weight: message.unread ? .bold : .semibold))
                    .foregroundStyle(Color.softoraInk)
                    .lineLimit(1)

                Text(message.preview.softoraUppercased)
                    .font(.softoraBody(12))
                    .foregroundStyle(Color.softoraMuted)
                    .lineLimit(2)
            }
            .padding(15)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(message.unread ? Color.softoraCrimson : Color.softoraPurpleLight, lineWidth: message.unread ? 1.5 : 1)
            }
        }
        .buttonStyle(.plain)
    }
}

private struct MailboxMessageDetail: View {
    let message: MailboxMessage
    let selectedAccount: MailboxAccount?
    let apiClient: SoftoraAPIClient
    let onBack: () -> Void

    @State private var isReplying = false
    @State private var replyBody = ""
    @State private var isSendingReply = false
    @State private var isImprovingReply = false
    @State private var replyStatus: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Button(action: onBack) {
                    HStack(spacing: 8) {
                        Image(systemName: "chevron.left")
                        Text("Terug")
                    }
                    .font(.softoraDisplay(13, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(0.8)
                    .foregroundStyle(Color.softoraCrimson)
                }
                .buttonStyle(.plain)

                Text(message.subject.isEmpty ? "(GEEN ONDERWERP)" : message.subject.softoraUppercased)
                    .font(.softoraDisplay(24, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(0.9)
                    .foregroundStyle(Color.softoraInk)

                VStack(alignment: .leading, spacing: 8) {
                    MailboxDetailMeta(label: "Van", value: message.from)
                    MailboxDetailMeta(label: "Aan", value: message.to)
                    MailboxDetailMeta(label: "Datum", value: MailboxDateFormatter.label(message.date))
                }

                Text((message.body.isEmpty ? message.preview : message.body).trimmingCharacters(in: .whitespacesAndNewlines))
                    .font(.softoraBody(14))
                    .foregroundStyle(Color.softoraInk)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(Color.softoraPurpleLight, lineWidth: 1)
                    }

                replyComposer
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
    }

    @ViewBuilder
    private var replyComposer: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation(.smooth(duration: 0.22)) {
                    isReplying.toggle()
                }
            } label: {
                HStack(spacing: 9) {
                    Image(systemName: "arrowshape.turn.up.left.fill")
                        .font(.system(size: 13, weight: .bold))

                    Text(isReplying ? "Antwoord sluiten" : "Beantwoorden")
                        .font(.softoraDisplay(13, weight: .bold))
                        .textCase(.uppercase)
                        .tracking(0.9)
                }
                .foregroundStyle(Color.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Color.softoraCrimson)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)

            if isReplying {
                VStack(alignment: .leading, spacing: 10) {
                    MailboxDetailMeta(label: "Aan", value: replyRecipient)
                    MailboxDetailMeta(label: "Onderwerp", value: replySubject)

                    ZStack(alignment: .topLeading) {
                        TextEditor(text: $replyBody)
                            .font(.softoraBody(14))
                            .foregroundStyle(Color.softoraInk)
                            .frame(minHeight: 142)
                            .padding(10)
                            .scrollContentBackground(.hidden)
                            .background(Color.white)

                        if replyBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Text("TYP JE ANTWOORD...")
                                .font(.softoraBody(13, weight: .medium))
                                .foregroundStyle(Color.softoraMuted.opacity(0.55))
                                .padding(.horizontal, 16)
                                .padding(.vertical, 18)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(Color.softoraPurpleLight, lineWidth: 1)
                    }

                    HStack(spacing: 10) {
                        Button {
                            Task { await improveReply() }
                        } label: {
                            Image(systemName: "wand.and.stars")
                                .font(.system(size: 17, weight: .bold))
                                .foregroundStyle(Color.softoraCrimson)
                                .frame(width: 50, height: 48)
                                .background(Color.white)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .stroke(Color.softoraPurpleLight, lineWidth: 1)
                                }
                        }
                        .buttonStyle(.plain)
                        .disabled(isImprovingReply || isSendingReply)
                        .opacity((isImprovingReply || isSendingReply) ? 0.55 : 1)
                        .accessibilityLabel("Mailtekst verbeteren")

                        Button {
                            Task { await sendReply() }
                        } label: {
                            HStack(spacing: 8) {
                                if isSendingReply {
                                    ProgressView()
                                        .tint(Color.white)
                                } else {
                                    Image(systemName: "paperplane.fill")
                                }

                                Text("Versturen")
                                    .font(.softoraDisplay(13, weight: .bold))
                                    .textCase(.uppercase)
                                    .tracking(0.9)
                            }
                            .foregroundStyle(Color.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 48)
                            .background(canSendReply ? Color.softoraCrimson : Color.softoraMuted.opacity(0.35))
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .disabled(!canSendReply || isSendingReply || isImprovingReply)
                    }

                    if isImprovingReply {
                        Text("AI VERBETERT JE TEKST...")
                            .font(.softoraDisplay(11, weight: .bold))
                            .textCase(.uppercase)
                            .tracking(0.9)
                            .foregroundStyle(Color.softoraMuted)
                    }

                    if let replyStatus {
                        Text(replyStatus.softoraUppercased)
                            .font(.softoraDisplay(11, weight: .bold))
                            .textCase(.uppercase)
                            .tracking(0.9)
                            .foregroundStyle(replyStatus == "Verzonden" ? Color.softoraCrimson : Color.softoraMuted)
                    }
                }
                .padding(14)
                .background(Color.softoraSheetBackground)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.softoraPurpleLight, lineWidth: 1)
                }
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
    }

    private var replyRecipient: String {
        firstReplyEmail(from: message.email)
    }

    private var replySubject: String {
        let subject = message.subject.trimmingCharacters(in: .whitespacesAndNewlines)
        if subject.range(of: #"^re\s*:"#, options: .regularExpression) != nil {
            return subject
        }
        return "Re: \(subject.isEmpty ? "Geen onderwerp" : subject)"
    }

    private var canSendReply: Bool {
        selectedAccount?.smtpConfigured == true &&
            !replyRecipient.isEmpty &&
            !replyBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func improveReply() async {
        let cleanBody = replyBody.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanBody.isEmpty else {
            replyStatus = "Schrijf eerst je antwoord"
            return
        }
        guard let selectedAccount else {
            replyStatus = "Kies eerst een mailadres"
            return
        }

        isImprovingReply = true
        replyStatus = nil
        defer { isImprovingReply = false }

        do {
            replyBody = try await apiClient.improveMailboxDraft(
                account: selectedAccount.email,
                to: replyRecipient,
                subject: replySubject,
                body: cleanBody,
                context: replyContext
            )
            replyStatus = "Tekst verbeterd"
        } catch {
            replyStatus = error.localizedDescription
        }
    }

    private func sendReply() async {
        guard let selectedAccount else {
            replyStatus = "Kies eerst een mailadres"
            return
        }
        guard selectedAccount.smtpConfigured else {
            replyStatus = "Deze mailbox kan nog niet verzenden"
            return
        }
        let cleanBody = replyBody.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanBody.isEmpty else {
            replyStatus = "Schrijf eerst je antwoord"
            return
        }

        isSendingReply = true
        replyStatus = nil
        defer { isSendingReply = false }

        do {
            try await apiClient.sendMailboxMessage(
                account: selectedAccount.email,
                to: replyRecipient,
                subject: replySubject,
                body: cleanBody
            )
            replyBody = ""
            replyStatus = "Verzonden"
        } catch {
            replyStatus = error.localizedDescription
        }
    }

    private var replyContext: MailboxDraftContextPayload {
        MailboxDraftContextPayload(
            from: message.from,
            fromEmail: message.email,
            to: message.to,
            date: message.date,
            subject: message.subject,
            preview: message.preview,
            body: message.body.isEmpty ? message.preview : message.body
        )
    }

    private func firstReplyEmail(from raw: String) -> String {
        let candidates = raw
            .split(separator: ",")
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
        let pattern = #"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}"#
        for candidate in candidates {
            if let range = candidate.range(of: pattern, options: [.regularExpression, .caseInsensitive]) {
                return String(candidate[range]).lowercased()
            }
        }
        return ""
    }
}

private struct MailboxDetailMeta: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.softoraDisplay(11, weight: .bold))
                .textCase(.uppercase)
                .tracking(1.0)
                .foregroundStyle(Color.softoraMuted)

            Text(value.isEmpty ? "—" : value.softoraUppercased)
                .font(.softoraBody(12, weight: .semibold))
                .foregroundStyle(Color.softoraInk)
        }
    }
}

private struct MailboxAccountSelector: View {
    let accounts: [MailboxAccount]
    let selectedAccount: MailboxAccount?
    let isLoading: Bool
    let isLocked: Bool
    let onSelect: (MailboxAccount) -> Void

    @State private var isExpanded = true

    var body: some View {
        VStack(spacing: 8) {
            Button {
                withAnimation(.smooth(duration: 0.22)) {
                    isExpanded.toggle()
                }
            } label: {
                ZStack {
                    Text("Kies het gewenste mailadres")
                        .font(.softoraDisplay(12, weight: .bold))
                        .textCase(.uppercase)
                        .tracking(1.0)
                        .foregroundStyle(Color.softoraMuted)
                        .frame(maxWidth: .infinity, alignment: .center)

                    HStack {
                        Spacer()
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Color.softoraMuted)
                    }
                }
                .padding(.horizontal, 18)
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isExpanded ? "Mailadressen inklappen" : "Mailadressen uitklappen")

            if isExpanded {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        if isLoading && accounts.isEmpty {
                            Text("LADEN...")
                                .font(.softoraBody(12, weight: .semibold))
                                .foregroundStyle(Color.softoraMuted)
                                .padding(.horizontal, 18)
                        } else {
                            ForEach(accounts) { account in
                                let isSelected = selectedAccount?.id == account.id
                                let lockedBackground = isSelected ? Color.softoraCrimson.opacity(0.52) : Color.white.opacity(0.72)
                                let enabledBackground = isSelected ? Color.softoraCrimson : Color.white

                                Button {
                                    onSelect(account)
                                } label: {
                                    Text(account.email)
                                        .font(.softoraDisplay(11.5, weight: .bold))
                                        .textCase(.uppercase)
                                        .tracking(0.4)
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.78)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                    .foregroundStyle(isSelected ? Color.white : (isLocked ? Color.softoraMuted : Color.softoraInk))
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 16)
                                    .frame(width: 178, alignment: .leading)
                                    .background(isLocked ? lockedBackground : enabledBackground)
                                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                    .overlay {
                                        if isSelected && isLocked {
                                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                                .stroke(Color.softoraPurpleLight, lineWidth: 1)
                                        } else if !isSelected {
                                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                                .stroke(Color.softoraPurpleLight, lineWidth: 1)
                                        }
                                    }
                                    .opacity(account.imapConfigured ? (isLocked ? 0.72 : 1) : 0.38)
                                }
                                .buttonStyle(.plain)
                                .disabled(isLocked)
                            }
                        }
                    }
                    .padding(.horizontal, 18)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.top, 10)
        .padding(.bottom, 10)
        .background(Color.white)
    }
}

private enum MailboxDateFormatter {
    static let isoFormatterWithFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "nl_NL")
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    static let displayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "nl_NL")
        formatter.dateFormat = "d MMM HH:mm"
        return formatter
    }()

    static let displayFormatterWithYear: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "nl_NL")
        formatter.dateFormat = "d MMM yyyy HH:mm"
        return formatter
    }()

    static func label(_ value: String, now: Date = Date(), calendar: Calendar = .current) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let date = parseDate(trimmed) else {
            return trimmed.isEmpty ? "—" : trimmed
        }

        if date <= now, now.timeIntervalSince(date) < 300 {
            return "ZOJUIST"
        }

        let time = timeFormatter.string(from: date)
        if calendar.isDateInToday(date) {
            return "VANDAAG \(time)"
        }
        if calendar.isDateInYesterday(date) {
            return "GISTEREN \(time)"
        }
        if calendar.component(.year, from: date) == calendar.component(.year, from: now) {
            return displayFormatter.string(from: date).uppercased(with: Locale(identifier: "nl_NL"))
        }
        return displayFormatterWithYear.string(from: date).uppercased(with: Locale(identifier: "nl_NL"))
    }

    private static func parseDate(_ value: String) -> Date? {
        isoFormatterWithFractionalSeconds.date(from: value) ?? isoFormatter.date(from: value)
    }
}

private struct WeekGridView: View {
    let weekStart: Date
    let appointments: [String: [AgendaAppointment]]
    let onSelectDate: (Date) -> Void
    let onSelectAppointment: (AgendaAppointment) -> Void

    private let columns = [
        GridItem(.flexible(), spacing: 1.5),
        GridItem(.flexible(), spacing: 1.5),
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 1.5) {
            ForEach(displayDays.indices, id: \.self) { index in
                if let date = displayDays[index] {
                    DayCellView(
                        date: date,
                        appointments: appointments[AgendaDateFormatter.ymd(from: date)] ?? [],
                        onSelectAppointment: onSelectAppointment
                    ) {
                        onSelectDate(date)
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                } else {
                    Color.white
                        .frame(minHeight: 150)
                }
            }
        }
        .background(Color.softoraGridLine)
    }

    private var displayDays: [Date?] {
        let days = (0..<7).map { AgendaDateFormatter.addDays($0, to: weekStart) }
        return [
            days[0],
            days[3],
            days[1],
            days[4],
            days[2],
            days[5],
            nil,
            days[6],
        ]
    }
}

private struct DayCellView: View {
    let date: Date
    let appointments: [AgendaAppointment]
    let onSelectAppointment: (AgendaAppointment) -> Void
    let onTap: () -> Void

    var body: some View {
        ZStack {
            if isClientWorkDay {
                Text("Klantwerk")
                    .font(.softoraDisplay(15, weight: .semibold))
                    .textCase(.uppercase)
                    .tracking(1.8)
                    .foregroundStyle(Color.softoraMuted.opacity(0.32))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 5) {
                    Text(AgendaDateFormatter.shortWeekday(date))
                        .font(.softoraBody(12))
                        .foregroundStyle(Color.softoraMuted)

                    Text(dayNumber)
                        .font(.softoraBody(15, weight: .bold))
                        .foregroundStyle(Color.softoraInk)
                        .frame(width: 26, height: 26)

                    Text(AgendaDateFormatter.shortMonth(date))
                        .font(.softoraBody(11))
                        .foregroundStyle(Color.softoraMuted)
                }

                ForEach(appointments.prefix(4)) { appointment in
                    CalendarEventChip(appointment: appointment) {
                        onSelectAppointment(appointment)
                    }
                }

                if appointments.count > 4 {
                    Text("+\(appointments.count - 4) meer")
                        .font(.softoraBody(11, weight: .semibold))
                        .foregroundStyle(Color.softoraMuted)
                        .padding(.top, 2)
                }

                Spacer(minLength: 0)
            }
            .padding(.top, 14)
            .padding(.horizontal, 14)
            .padding(.bottom, 10)
        }
        .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
        .background(cellBackground)
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
        .overlay {
            if AgendaDateFormatter.isToday(date) {
                Rectangle()
                    .stroke(Color.softoraCrimsonDim, lineWidth: 1.5)
            }
        }
    }

    private var dayNumber: String {
        let day = Calendar.current.component(.day, from: date)
        return String(day)
    }

    private var cellBackground: Color {
        AgendaDateFormatter.isToday(date) ? Color.softoraPurpleLight : .white
    }

    private var isClientWorkDay: Bool {
        let weekday = Calendar.current.component(.weekday, from: date)
        return weekday == 4 || weekday == 7
    }
}

private struct CalendarEventChip: View {
    let appointment: AgendaAppointment
    let onOpen: () -> Void

    @ViewBuilder
    var body: some View {
        Button(action: onOpen) {
            if hasTime {
                eventContent
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                eventContent
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.softoraPurpleLight)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
        }
        .buttonStyle(.plain)
    }

    private var eventContent: some View {
        HStack(spacing: 7) {
            if hasTime {
                Text(appointment.time)
                    .font(.softoraBody(10, weight: .bold))
                    .foregroundStyle(Color.white)
                    .lineLimit(1)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(Color.softoraCrimson)
                    .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
            }

            Text(appointment.privacyMasked ? "Bezet" : appointment.title)
                .font(.softoraBody(12, weight: .medium))
                .foregroundStyle(Color.softoraCrimson)
                .lineLimit(1)
        }
    }

    private var hasTime: Bool {
        let trimmedTime = appointment.time.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmedTime.isEmpty && trimmedTime != "—" && trimmedTime != "--:--"
    }
}

private struct AppointmentDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var isShowingDeleteConfirmation = false

    let store: AgendaStore
    let appointment: AgendaAppointment

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [.white, Color.softoraSheetBackground],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(alignment: .top) {
                        Text("Afspraak")
                            .font(.softoraDisplay(14, weight: .semibold))
                            .textCase(.uppercase)
                            .tracking(0.8)
                            .foregroundStyle(Color.softoraCrimson)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(Color.softoraPurpleLight)

                        Spacer()

                        Button {
                            dismiss()
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 17, weight: .bold))
                                .foregroundStyle(Color.softoraMuted)
                                .frame(width: 44, height: 44)
                                .background(Color.white)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .stroke(Color.softoraPurpleLight, lineWidth: 1)
                                }
                        }
                        .buttonStyle(.plain)
                    }

                    Text(displayTitle)
                        .font(.softoraDisplay(25, weight: .bold))
                        .textCase(.uppercase)
                        .tracking(1.0)
                        .foregroundStyle(Color.softoraInk)
                        .lineLimit(3)
                        .minimumScaleFactor(0.82)

                    VStack(spacing: 12) {
                        AppointmentDetailRow(label: "Datum", value: AgendaDateFormatter.displayDate(appointment.date))
                        AppointmentDetailRow(label: "Tijdstip", value: appointment.time)
                        AppointmentDetailRow(label: "Voor wie", value: appointment.who.title)

                        if !appointment.privacyMasked {
                            AppointmentDetailRow(label: "Locatie", value: detailValue(appointment.location))
                        }
                    }

                    if !appointment.privacyMasked, !appointment.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        VStack(alignment: .leading, spacing: 9) {
                            Text("Opmerkingen")
                                .font(.softoraDisplay(12, weight: .semibold))
                                .textCase(.uppercase)
                                .tracking(1.1)
                                .foregroundStyle(Color.softoraMuted)

                            Text(appointment.summary.softoraUppercased)
                                .font(.softoraBody(13))
                                .foregroundStyle(Color.softoraInk)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(16)
                                .background(Color.white)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .stroke(Color.softoraPurpleLight, lineWidth: 1)
                                }
                        }
                    }

                    if !appointment.privacyMasked {
                        Button {
                            isShowingDeleteConfirmation = true
                        } label: {
                            Text(store.isDeletingAppointment ? "Verwijderen..." : "Verwijderen")
                                .font(.softoraDisplay(15, weight: .bold))
                                .textCase(.uppercase)
                                .tracking(0.75)
                                .foregroundStyle(Color.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                                .background(Color.softoraCrimson)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .disabled(store.isDeletingAppointment)
                    }
                }
                .padding(.horizontal, 26)
                .padding(.top, 28)
                .padding(.bottom, 34)
            }

            if isShowingDeleteConfirmation, !appointment.privacyMasked {
                BottomChoiceOverlay(onClose: hideDeleteConfirmation) {
                    HStack(spacing: 10) {
                        ActionChoiceButton(title: "Annuleer", isPrimary: false, action: hideDeleteConfirmation)

                        ActionChoiceButton(
                            title: store.isDeletingAppointment ? "Verwijderen..." : "Verwijderen",
                            isPrimary: true
                        ) {
                            Task {
                                if await store.deleteAppointment(appointment) {
                                    dismiss()
                                }
                            }
                        }
                        .disabled(store.isDeletingAppointment)
                    }
                }
            }
        }
    }

    private var displayTitle: String {
        appointment.privacyMasked ? "Bezet" : appointment.title
    }

    private func detailValue(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty || trimmed == "—" ? "Niet ingevuld" : trimmed
    }

    private func hideDeleteConfirmation() {
        guard !store.isDeletingAppointment else { return }
        isShowingDeleteConfirmation = false
    }
}

private struct AppointmentDetailRow: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label)
                .font(.softoraDisplay(12, weight: .semibold))
                .textCase(.uppercase)
                .tracking(1.1)
                .foregroundStyle(Color.softoraMuted)

            Text(value.softoraUppercased)
                .font(.softoraBody(14, weight: .semibold))
                .foregroundStyle(Color.softoraInk)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 15)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(Color.softoraPurpleLight, lineWidth: 1)
                }
        }
    }
}

private struct AppointmentTypeOverlay: View {
    let onClose: () -> Void
    let onSelectPersonal: () -> Void
    let onSelectBusiness: () -> Void

    var body: some View {
        BottomChoiceOverlay(onClose: onClose) {
            VStack(spacing: 14) {
                Text("Kies afspraak type")
                    .font(.softoraDisplay(20, weight: .semibold))
                    .textCase(.uppercase)
                    .tracking(0.8)
                    .foregroundStyle(Color.softoraInk)

                HStack(spacing: 10) {
                    TypeChoiceButton(title: AppointmentType.business.title, isPrimary: true, action: onSelectBusiness)
                    TypeChoiceButton(title: AppointmentType.personal.title, isPrimary: false, action: onSelectPersonal)
                }

                Color.clear
                    .frame(height: 20)
                    .padding(.top, 2)
                    .accessibilityHidden(true)
            }
        }
    }
}

private struct BusinessTypeOverlay: View {
    @Binding var selectedType: BusinessMeetingType
    let onBack: () -> Void
    let onNext: () -> Void

    var body: some View {
        BottomChoiceOverlay(onClose: onBack) {
            VStack(spacing: 14) {
                Text("Welke meeting?")
                    .font(.softoraDisplay(20, weight: .semibold))
                    .textCase(.uppercase)
                    .tracking(0.8)
                    .foregroundStyle(Color.softoraInk)

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(BusinessMeetingType.allCases) { type in
                        SelectableChoiceButton(
                            title: type.title,
                            isSelected: selectedType == type,
                            selectedColor: type.selectionColor
                        ) {
                            selectedType = type
                        }
                    }
                }

                ActionChoiceButton(title: "Volgende", isPrimary: true, action: onNext)
            }
        }
    }
}

private struct BusinessKindOverlay: View {
    let onBack: () -> Void
    let onSelectMeeting: () -> Void
    let onSelectAppointment: () -> Void

    var body: some View {
        BottomChoiceOverlay(onClose: onBack) {
            VStack(spacing: 14) {
                Text("Maak een keuze")
                    .font(.softoraDisplay(20, weight: .semibold))
                    .textCase(.uppercase)
                    .tracking(0.8)
                    .foregroundStyle(Color.softoraInk)

                HStack(spacing: 10) {
                    TypeChoiceButton(title: BusinessAppointmentKind.meeting.title, isPrimary: true, action: onSelectMeeting)
                    TypeChoiceButton(title: BusinessAppointmentKind.appointment.title, isPrimary: false, action: onSelectAppointment)
                }

                Color.clear
                    .frame(height: 20)
                    .padding(.top, 2)
                    .accessibilityHidden(true)
            }
        }
    }
}

private struct BottomChoiceOverlay<Content: View>: View {
    let onClose: () -> Void
    @ViewBuilder let content: Content

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .bottom) {
                Color.softoraInk.opacity(0.58)
                    .ignoresSafeArea()
                    .onTapGesture(perform: onClose)

                VStack {
                    content
                }
                .padding(.horizontal, 18)
                .padding(.top, 22)
                .padding(.bottom, 24 + proxy.safeAreaInsets.bottom)
                .frame(maxWidth: 430)
                .background(
                    LinearGradient(
                        colors: [.white, Color.softoraSheetBackground],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .clipShape(UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24))
                .shadow(color: Color.softoraInk.opacity(0.24), radius: 36, x: 0, y: -22)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .ignoresSafeArea(edges: .bottom)
    }
}

private struct TypeChoiceButton: View {
    let title: String
    let isPrimary: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.softoraBody(13, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(isPrimary ? Color.white : Color.softoraInk)
                .lineLimit(1)
                .minimumScaleFactor(0.9)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
                .background(isPrimary ? Color.softoraCrimson : Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct SelectableChoiceButton: View {
    let title: String
    let isSelected: Bool
    let selectedColor: Color
    let action: () -> Void

    init(
        title: String,
        isSelected: Bool,
        selectedColor: Color = .softoraCrimson,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.isSelected = isSelected
        self.selectedColor = selectedColor
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.softoraBody(13, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(Color.softoraInk)
                .lineLimit(1)
                .minimumScaleFactor(0.9)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
                .padding(.horizontal, 8)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(isSelected ? selectedColor : Color.clear, lineWidth: 2)
                }
        }
        .buttonStyle(.plain)
    }
}

private extension BusinessMeetingType {
    var selectionColor: Color {
        switch self {
        case .website:
            Color.softoraMeetingWebsite
        case .software:
            Color.softoraMeetingBusiness
        case .voice:
            Color.softoraMeetingVoice
        case .chatbot:
            Color.softoraMeetingChatbot
        }
    }
}

private struct ActionChoiceButton: View {
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
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay {
                    if !isPrimary {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(Color.softoraPurpleLight, lineWidth: 1)
                    }
                }
        }
        .buttonStyle(.plain)
    }
}

private struct AgendaLoadingOverlay: View {
    var body: some View {
        VStack(spacing: 10) {
            ProgressView()
                .tint(Color.softoraCrimson)

            Text("AGENDA LADEN...")
                .font(.softoraBody(13, weight: .semibold))
                .foregroundStyle(Color.softoraMuted)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct AgendaListView_Previews: PreviewProvider {
    static var previews: some View {
        AgendaListView(store: AgendaStore.previewAuthenticated)
    }
}
