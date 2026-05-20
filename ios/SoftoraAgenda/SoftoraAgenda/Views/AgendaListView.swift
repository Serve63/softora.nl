import SwiftUI
import UIKit

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
    @State private var exercises: [GymExercise] = GymExercisePlanStorage.exercises(for: .today)

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
                        exercisesHeader

                        Group {
                            if exercises.isEmpty {
                                GymRestDayView(day: selectedDay)
                                    .padding(.horizontal, 18)
                                    .padding(.top, 2)
                            } else {
                                LazyVStack(spacing: 10) {
                                    ForEach(exercises) { exercise in
                                        GymExerciseSwipeRow(
                                            day: selectedDay,
                                            exercise: exercise,
                                            onDelete: { deleteExercise(exercise) }
                                        )
                                            .id("\(selectedDay.storageID)-\(exercise.id)")
                                    }
                                }
                                .padding(.horizontal, 18)
                            }
                        }
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
                        reloadExercises(for: day)
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

    private var exercisesHeader: some View {
        HStack(spacing: 12) {
            Text("Oefeningen")
                .font(.softoraDisplay(18, weight: .bold))
                .textCase(.uppercase)
                .tracking(1.0)
                .foregroundStyle(Color.softoraInk)

            Spacer()

            Button(action: addExercise) {
                Image(systemName: "plus")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Color.softoraCrimson)
                    .frame(width: 40, height: 36)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(Color.softoraPurpleLight, lineWidth: 1)
                    }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Oefening toevoegen")
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
    }

    private var gymHeader: some View {
        ZStack {
            VStack(spacing: 2) {
                Text("Servé's logboek")
                    .font(.softoraDisplay(19, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(1.0)
                    .foregroundStyle(Color.softoraInk)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                    .allowsTightening(true)

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

    private func reloadExercises(for day: GymWorkoutDay) {
        exercises = GymExercisePlanStorage.exercises(for: day)
    }

    private func addExercise() {
        let addedExercise = GymExercisePlanStorage.addExercise(for: selectedDay)
        exercises = GymExercisePlanStorage.exercises(for: selectedDay)
        UserDefaults.standard.set(
            addedExercise.title.softoraUppercased,
            forKey: GymExerciseStorage.key(day: selectedDay, exercise: addedExercise, field: .name)
        )
        UserDefaults.standard.set(
            addedExercise.details.softoraUppercased,
            forKey: GymExerciseStorage.key(day: selectedDay, exercise: addedExercise, field: .notes)
        )
    }

    private func deleteExercise(_ exercise: GymExercise) {
        GymExercisePlanStorage.deleteExercise(exercise, for: selectedDay)
        exercises = GymExercisePlanStorage.exercises(for: selectedDay)
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

    var storageID: String {
        switch self {
        case .today:
            Self.currentWeekday.rawValue
        default:
            rawValue
        }
    }

    private static var currentWeekday: GymWorkoutDay {
        switch Calendar.current.component(.weekday, from: Date()) {
        case 1:
            .sunday
        case 2:
            .monday
        case 3:
            .tuesday
        case 4:
            .wednesday
        case 5:
            .thursday
        case 6:
            .friday
        default:
            .saturday
        }
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
            Color.clear
                .ignoresSafeArea()
                .contentShape(Rectangle())
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

private struct GymRestDayView: View {
    let day: GymWorkoutDay

    var body: some View {
        Text("\(day.title) is een rustdag")
            .font(.softoraBody(13, weight: .medium))
            .foregroundStyle(Color.softoraMuted)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, 18)
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

private struct GymExerciseSwipeRow: View {
    let day: GymWorkoutDay
    let exercise: GymExercise
    let onDelete: () -> Void

    @State private var settledOffset: CGFloat = 0
    @State private var dragOffset: CGFloat = 0

    private let revealWidth: CGFloat = 112

    private var currentOffset: CGFloat {
        max(0, min(revealWidth, settledOffset + dragOffset))
    }

    var body: some View {
        ZStack(alignment: .leading) {
            Button {
                withAnimation(.smooth(duration: 0.2)) {
                    onDelete()
                    settledOffset = 0
                    dragOffset = 0
                }
            } label: {
                HStack(spacing: 7) {
                    Image(systemName: "trash.fill")
                        .font(.system(size: 12, weight: .bold))

                    Text("Verwijder")
                        .font(.softoraDisplay(11, weight: .bold))
                        .textCase(.uppercase)
                        .tracking(0.7)
                }
                .foregroundStyle(Color.white)
                .frame(width: revealWidth, height: 72)
                .background(Color.softoraCrimson)
                .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
            }
            .buttonStyle(.plain)

            GymExerciseRow(day: day, exercise: exercise)
                .offset(x: currentOffset)
                .gesture(
                    DragGesture(minimumDistance: 18)
                        .onChanged { value in
                            guard abs(value.translation.width) > abs(value.translation.height) else {
                                return
                            }
                            dragOffset = max(-settledOffset, min(revealWidth - settledOffset, value.translation.width))
                        }
                        .onEnded { value in
                            guard abs(value.translation.width) > abs(value.translation.height) else {
                                dragOffset = 0
                                return
                            }
                            let predictedOffset = settledOffset + value.predictedEndTranslation.width
                            withAnimation(.smooth(duration: 0.22)) {
                                settledOffset = predictedOffset > revealWidth * 0.48 ? revealWidth : 0
                                dragOffset = 0
                            }
                        }
                )
        }
        .animation(.smooth(duration: 0.2), value: currentOffset)
    }
}

private struct GymExerciseRow: View {
    let day: GymWorkoutDay
    let exercise: GymExercise

    @AppStorage private var exerciseName: String
    @AppStorage private var notes: String
    @AppStorage private var sets: String
    @AppStorage private var reps: String
    @AppStorage private var kilograms: String

    init(day: GymWorkoutDay, exercise: GymExercise) {
        self.day = day
        self.exercise = exercise
        _exerciseName = AppStorage(
            wrappedValue: exercise.title.softoraUppercased,
            GymExerciseStorage.key(day: day, exercise: exercise, field: .name)
        )
        _notes = AppStorage(
            wrappedValue: exercise.details.softoraUppercased,
            GymExerciseStorage.key(day: day, exercise: exercise, field: .notes)
        )
        _sets = AppStorage(
            wrappedValue: exercise.defaultSets,
            GymExerciseStorage.key(day: day, exercise: exercise, field: .sets)
        )
        _reps = AppStorage(
            wrappedValue: exercise.defaultReps,
            GymExerciseStorage.key(day: day, exercise: exercise, field: .reps)
        )
        _kilograms = AppStorage(
            wrappedValue: "",
            GymExerciseStorage.key(day: day, exercise: exercise, field: .kilograms)
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .center, spacing: 8) {
                TextField("OEFENING", text: uppercasedExerciseName)
                    .font(.softoraDisplay(14, weight: .bold))
                    .tracking(0.35)
                    .foregroundStyle(Color.softoraInk)
                    .lineLimit(1)
                    .minimumScaleFactor(0.58)
                    .allowsTightening(true)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled(true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                HStack(spacing: 5) {
                    GymMetricField(label: "Sets", value: $sets, keyboardType: .numberPad)
                    GymMetricField(label: "Reps", value: $reps, keyboardType: .numberPad)
                    GymMetricField(label: "Kg", value: $kilograms, keyboardType: .decimalPad)
                }
            }

            TextField("NOTITIES", text: uppercasedNotes, axis: .vertical)
                .font(.softoraBody(12, weight: .semibold))
                .foregroundStyle(Color.softoraMuted)
                .lineLimit(1...2)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled(true)
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

    private var uppercasedExerciseName: Binding<String> {
        Binding(
            get: { exerciseName },
            set: { exerciseName = $0.softoraUppercased }
        )
    }

    private var uppercasedNotes: Binding<String> {
        Binding(
            get: { notes },
            set: { notes = $0.softoraUppercased }
        )
    }
}

private enum GymExerciseStorageField: String {
    case name
    case notes
    case sets
    case reps
    case kilograms
}

private enum GymExerciseStorage {
    static func key(day: GymWorkoutDay, exercise: GymExercise, field: GymExerciseStorageField) -> String {
        "nl.softora.agenda.gym.\(day.storageID).exercise.\(exercise.order).\(field.rawValue)"
    }
}

private enum GymExercisePlanStorage {
    private static let defaultOrders = Array(GymExercise.defaultWorkout.prefix(4)).map(\.order)

    static func exercises(for day: GymWorkoutDay) -> [GymExercise] {
        orders(for: day).map(exercise(for:))
    }

    @discardableResult
    static func addExercise(for day: GymWorkoutDay) -> GymExercise {
        var storedOrders = orders(for: day)
        let nextOrder = max((storedOrders + [100]).max() ?? 100, 100) + 1
        storedOrders.append(nextOrder)
        saveOrders(storedOrders, for: day)
        return exercise(for: nextOrder)
    }

    static func deleteExercise(_ exercise: GymExercise, for day: GymWorkoutDay) {
        let nextOrders = orders(for: day).filter { $0 != exercise.order }
        saveOrders(nextOrders, for: day)
    }

    private static func exercise(for order: Int) -> GymExercise {
        if let defaultExercise = GymExercise.defaultWorkout.first(where: { $0.order == order }) {
            return defaultExercise
        }
        return GymExercise(order: order, title: "Nieuwe oefening", details: "Notities", defaultSets: "", defaultReps: "")
    }

    private static func orders(for day: GymWorkoutDay) -> [Int] {
        let key = orderKey(for: day)
        guard UserDefaults.standard.object(forKey: key) != nil else {
            return defaultOrders
        }
        let rawValue = UserDefaults.standard.string(forKey: key) ?? ""
        let storedOrders = rawValue
            .split(separator: ",")
            .compactMap { Int($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
        return storedOrders
    }

    private static func saveOrders(_ orders: [Int], for day: GymWorkoutDay) {
        let normalizedOrders = orders.reduce(into: [Int]()) { result, order in
            guard !result.contains(order) else {
                return
            }
            result.append(order)
        }
        UserDefaults.standard.set(
            normalizedOrders.map(String.init).joined(separator: ","),
            forKey: orderKey(for: day)
        )
    }

    private static func orderKey(for day: GymWorkoutDay) -> String {
        "nl.softora.agenda.gym.\(day.storageID).exercise.order"
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
                    title: "Servé's logboek",
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
                    .lineLimit(1)
                    .minimumScaleFactor(0.62)
                    .allowsTightening(true)
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
    @State private var selectedMessageKey: String?
    @State private var isShowingFolderMenu = false
    @State private var isShowingAccountMenu = false
    @State private var isLoadingAccounts = false
    @State private var isLoadingMessages = false
    @State private var isLoadingMessageDetail = false
    @State private var alertMessage: String?
    @State private var mailboxStatusMessage: String?
    @AppStorage("softora.mailbox.accountOrder") private var mailboxAccountOrder = ""
    @AppStorage("softora.mailbox.pinnedAccount") private var pinnedMailboxAccountEmail = ""

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

                if selectedMessage == nil {
                    HStack {
                        Text(selectedFolder.title)
                            .font(.softoraDisplay(18, weight: .bold))
                            .textCase(.uppercase)
                            .tracking(1.0)
                            .foregroundStyle(Color.softoraInk)

                        Spacer()
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 14)
                    .padding(.bottom, 8)
                }

                mailboxContent
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
        VStack(spacing: 0) {
            ZStack {
                Button {
                    withAnimation(.smooth(duration: 0.22)) {
                        isShowingFolderMenu = false
                        isShowingAccountMenu.toggle()
                    }
                } label: {
                    HStack(spacing: 7) {
                        Text("Mailbox")
                            .font(.softoraDisplay(21, weight: .bold))
                            .textCase(.uppercase)
                            .tracking(1.0)

                        Image(systemName: isShowingAccountMenu ? "chevron.up" : "chevron.down")
                            .font(.system(size: 11, weight: .bold))
                    }
                    .foregroundStyle(Color.softoraInk)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
                .disabled(accounts.isEmpty && !isLoadingAccounts)
                .accessibilityLabel("Mailadres kiezen")

                HStack {
                    Button {
                        withAnimation(.smooth(duration: 0.22)) {
                            if selectedMessage == nil {
                                isShowingAccountMenu = false
                                isShowingFolderMenu = true
                            } else {
                                clearSelectedMessage()
                            }
                        }
                    } label: {
                        Image(systemName: selectedMessage == nil ? "line.3.horizontal" : "chevron.left")
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
                    .accessibilityLabel(selectedMessage == nil ? "Mappen" : "Terug")

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
                .padding(.horizontal, 18)
            }
            .padding(.top, 18)
            .padding(.bottom, isShowingAccountMenu ? 8 : 12)

            if isShowingAccountMenu {
                MailboxAccountDropdown(
                    accounts: orderedAccounts,
                    selectedAccount: selectedAccount,
                    isLoading: isLoadingAccounts,
                    onSelect: selectAccount
                )
                .padding(.horizontal, 18)
                .padding(.bottom, 12)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
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
                apiClient: apiClient,
                isLoadingDetail: isLoadingMessageDetail,
                statusMessage: mailboxStatusMessage
            )
        } else if let mailboxStatusMessage, messages.isEmpty {
            VStack(spacing: 12) {
                Text("Mailbox niet geladen")
                    .font(.softoraDisplay(20, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(1.0)
                    .foregroundStyle(Color.softoraInk)

                Text(mailboxStatusMessage.softoraUppercased)
                    .font(.softoraBody(13, weight: .medium))
                    .foregroundStyle(Color.softoraMuted)
                    .multilineTextAlignment(.center)

                Button {
                    Task {
                        if selectedAccount == nil {
                            await loadAccounts()
                        } else {
                            await loadMessages()
                        }
                    }
                } label: {
                    Text("Opnieuw proberen")
                        .font(.softoraDisplay(13, weight: .bold))
                        .textCase(.uppercase)
                        .tracking(0.9)
                        .foregroundStyle(Color.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(Color.softoraCrimson)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
                .padding(.top, 2)
            }
            .padding(.horizontal, 28)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
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
                LazyVStack(spacing: 8) {
                    if let mailboxStatusMessage {
                        MailboxStatusBanner(message: mailboxStatusMessage)
                    }

                    ForEach(messages) { message in
                        MailboxMessageRow(message: message, isUnread: isUnread(message)) {
                            openMessage(message)
                        }
                    }
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 20)
            }
            .refreshable {
                await loadMessages(fresh: true)
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

    private var orderedAccounts: [MailboxAccount] {
        Self.sortedMailboxAccounts(accounts, order: mailboxAccountOrder, pinnedEmail: pinnedMailboxAccountEmail)
    }

    private func isUnread(_ message: MailboxMessage) -> Bool {
        message.unread
    }

    private func openMessage(_ message: MailboxMessage) {
        guard let account = selectedAccount else { return }
        let selectionKey = messageKey(accountEmail: account.email, message: message)
        isLoadingMessageDetail = message.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        selectedMessage = message
        selectedMessageKey = selectionKey
        if message.unread {
            markMessageLocallyRead(message, selectionKey: selectionKey)
        }
        Task {
            await loadMessageDetail(for: message, accountEmail: account.email, selectionKey: selectionKey)
            if message.unread {
                await markMessageReadOnServer(message, accountEmail: account.email, selectionKey: selectionKey)
            }
        }
    }

    private func markMessageReadOnServer(
        _ message: MailboxMessage,
        accountEmail: String,
        selectionKey: String
    ) async {
        guard message.uid > 0 else { return }

        do {
            try await apiClient.markMailboxMessageRead(
                account: accountEmail,
                folder: message.folder,
                uid: message.uid
            )
        } catch {
            guard !error.isMailboxCancellation else { return }
            if selectedMessageKey == selectionKey {
                mailboxStatusMessage = "Gelezen-status kon niet worden opgeslagen."
            }
        }
    }

    private func markMessageLocallyRead(_ message: MailboxMessage, selectionKey: String) {
        let readMessage = readVersion(of: message)
        if selectedMessageKey == selectionKey {
            selectedMessage = readMessage
        }
        if let index = messages.firstIndex(where: { isSameMailboxMessage($0, as: message) }) {
            messages[index] = readMessage
        }
    }

    private func clearSelectedMessage() {
        selectedMessage = nil
        selectedMessageKey = nil
        isLoadingMessageDetail = false
    }

    private func messageKey(accountEmail: String, message: MailboxMessage) -> String {
        "\(accountEmail.lowercased())|\(message.folder.lowercased())|\(message.uid)"
    }

    private func isSameMailboxMessage(_ left: MailboxMessage, as right: MailboxMessage) -> Bool {
        left.uid == right.uid && left.folder.caseInsensitiveCompare(right.folder) == .orderedSame
    }

    private func readVersion(of message: MailboxMessage) -> MailboxMessage {
        MailboxMessage(
            id: message.id,
            uid: message.uid,
            folder: message.folder,
            from: message.from,
            email: message.email,
            to: message.to,
            subject: message.subject,
            preview: message.preview,
            body: message.body,
            links: message.links,
            inlineImages: message.inlineImages,
            date: message.date,
            unread: false,
            starred: message.starred
        )
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
        mailboxStatusMessage = nil
        defer { isLoadingAccounts = false }

        do {
            let loadedAccounts = try await apiClient.fetchMailboxAccounts()
            accounts = loadedAccounts
            if selectedAccount == nil || !loadedAccounts.contains(where: { $0.id == selectedAccount?.id }) {
                let preferredAccounts = Self.sortedMailboxAccounts(
                    loadedAccounts,
                    order: mailboxAccountOrder,
                    pinnedEmail: pinnedMailboxAccountEmail
                )
                selectedAccount = preferredAccounts.first(where: \.imapConfigured) ?? preferredAccounts.first
            }
            await loadMessages(fresh: true)
        } catch {
            guard !error.isMailboxCancellation else { return }
            mailboxStatusMessage = error.mailboxDisplayMessage
        }
    }

    private func loadMessages(fresh: Bool = false) async {
        guard let account = selectedAccount else {
            messages = []
            clearSelectedMessage()
            return
        }
        guard account.imapConfigured else {
            messages = []
            clearSelectedMessage()
            return
        }

        let requestAccountEmail = account.email
        let requestFolder = selectedFolder
        isLoadingMessages = true
        alertMessage = nil
        mailboxStatusMessage = nil
        defer { isLoadingMessages = false }

        do {
            let loadedMessages = try await apiClient.fetchMailboxMessages(
                account: requestAccountEmail,
                folder: requestFolder.apiValue,
                limit: 25,
                summaryOnly: true,
                fresh: fresh
            )
            guard selectedAccount?.email == requestAccountEmail && selectedFolder == requestFolder else { return }
            messages = loadedMessages
            if pinnedMailboxAccountEmail.caseInsensitiveCompare(requestAccountEmail) == .orderedSame {
                await MailboxPushRegistrar.shared.registerPinnedMailbox(lastKnownUid: loadedMessages.first?.uid ?? 0)
            }
            if selectedMessage == nil {
                isLoadingMessageDetail = false
            }
        } catch {
            guard !error.isMailboxCancellation else { return }
            mailboxStatusMessage = error.mailboxDisplayMessage
        }
    }

    private func loadMessageDetail(
        for message: MailboxMessage,
        accountEmail: String,
        selectionKey: String
    ) async {
        guard message.uid > 0 else { return }
        isLoadingMessageDetail = true
        mailboxStatusMessage = nil
        defer {
            if selectedMessageKey == selectionKey {
                isLoadingMessageDetail = false
            }
        }

        do {
            let loadedMessage = try await apiClient.fetchMailboxMessageDetail(
                account: accountEmail,
                folder: message.folder,
                uid: message.uid
            )
            guard selectedMessageKey == selectionKey else { return }
            if isSameMailboxMessage(loadedMessage, as: message) {
                selectedMessage = messageWithContentFallback(loadedMessage, fallback: message)
            } else if let fallbackMessage = try await matchingMessageDetailFallback(
                for: message,
                accountEmail: accountEmail,
                selectionKey: selectionKey
            ) {
                selectedMessage = messageWithContentFallback(fallbackMessage, fallback: message)
            } else {
                mailboxStatusMessage = "Mail kon niet veilig geladen worden. Open de mail opnieuw."
            }
        } catch {
            guard !error.isMailboxCancellation else { return }
            if selectedMessageKey == selectionKey {
                mailboxStatusMessage = error.mailboxDisplayMessage
            }
        }
    }

    private func matchingMessageDetailFallback(
        for message: MailboxMessage,
        accountEmail: String,
        selectionKey: String
    ) async throws -> MailboxMessage? {
        guard selectedMessageKey == selectionKey else { return nil }
        let fullMessages = try await apiClient.fetchMailboxMessages(
            account: accountEmail,
            folder: message.folder,
            limit: 25,
            summaryOnly: false,
            fresh: true
        )
        guard selectedMessageKey == selectionKey else { return nil }
        return fullMessages.first { isSameMailboxMessage($0, as: message) }
    }

    private func messageWithContentFallback(_ message: MailboxMessage, fallback: MailboxMessage) -> MailboxMessage {
        let body = message.body.trimmingCharacters(in: .whitespacesAndNewlines)
        let preview = message.preview.trimmingCharacters(in: .whitespacesAndNewlines)
        guard body.isEmpty || preview.isEmpty else { return message }

        return MailboxMessage(
            id: message.id,
            uid: message.uid,
            folder: message.folder,
            from: message.from,
            email: message.email,
            to: message.to,
            subject: message.subject,
            preview: preview.isEmpty ? fallback.preview : message.preview,
            body: body.isEmpty ? fallback.body : message.body,
            links: message.links,
            inlineImages: message.inlineImages,
            date: message.date,
            unread: message.unread,
            starred: message.starred
        )
    }

    private func selectAccount(_ account: MailboxAccount) {
        withAnimation(.smooth(duration: 0.22)) {
            isShowingAccountMenu = false
        }
        guard account.id != selectedAccount?.id else { return }
        clearSelectedMessage()
        selectedAccount = account
        Task { await loadMessages(fresh: true) }
    }

    private func moveMailboxAccount(_ account: MailboxAccount, direction: Int) {
        var emails = orderedAccounts.map(\.email)
        guard let currentIndex = emails.firstIndex(where: { $0.caseInsensitiveCompare(account.email) == .orderedSame }) else { return }
        let targetIndex = currentIndex + direction
        guard emails.indices.contains(targetIndex) else { return }
        emails.swapAt(currentIndex, targetIndex)
        mailboxAccountOrder = emails.joined(separator: ",")
    }

    private func togglePinnedMailboxAccount(_ account: MailboxAccount) {
        let nextPinnedAccountEmail = pinnedMailboxAccountEmail.caseInsensitiveCompare(account.email) == .orderedSame
            ? ""
            : account.email
        pinnedMailboxAccountEmail = nextPinnedAccountEmail
        let lastKnownUid = nextPinnedAccountEmail.caseInsensitiveCompare(selectedAccount?.email ?? "") == .orderedSame
            ? messages.first?.uid ?? 0
            : 0
        MailboxPushRegistrar.shared.updatePinnedMailbox(nextPinnedAccountEmail, lastKnownUid: lastKnownUid)
    }

    private func selectFolder(_ folder: MailboxFolder) {
        clearSelectedMessage()
        selectedFolder = folder
        isShowingFolderMenu = false
        isShowingAccountMenu = false
        Task { await loadMessages(fresh: true) }
    }

    private static func sortedMailboxAccounts(
        _ accounts: [MailboxAccount],
        order: String,
        pinnedEmail: String
    ) -> [MailboxAccount] {
        let orderEmails = order
            .split(separator: ",")
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty }
        var used = Set<String>()
        var sorted: [MailboxAccount] = []

        for email in orderEmails {
            guard let account = accounts.first(where: { $0.email.lowercased() == email }), !used.contains(email) else { continue }
            sorted.append(account)
            used.insert(email)
        }

        for account in accounts {
            let email = account.email.lowercased()
            guard !used.contains(email) else { continue }
            sorted.append(account)
            used.insert(email)
        }

        let pinned = pinnedEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !pinned.isEmpty, let pinnedIndex = sorted.firstIndex(where: { $0.email.lowercased() == pinned }) {
            let pinnedAccount = sorted.remove(at: pinnedIndex)
            sorted.insert(pinnedAccount, at: 0)
        }

        return sorted
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

    var mailboxDisplayMessage: String {
        if isMailboxTimeout {
            return "Mailbox reageert te langzaam. Probeer het zo opnieuw."
        }

        let message = localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        return message.isEmpty ? "Mailbox laden mislukt. Probeer het zo opnieuw." : message
    }

    private var isMailboxTimeout: Bool {
        if let urlError = self as? URLError, urlError.code == .timedOut {
            return true
        }

        let nsError = self as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorTimedOut {
            return true
        }

        return localizedDescription.lowercased().contains("timed out")
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

private struct MailboxStatusBanner: View {
    let message: String

    var body: some View {
        Text(message.softoraUppercased)
            .font(.softoraBody(12, weight: .semibold))
            .foregroundStyle(Color.softoraMuted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Color.softoraSheetBackground)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.softoraPurpleLight, lineWidth: 1)
            }
    }
}

private struct MailboxMessageRow: View {
    let message: MailboxMessage
    let isUnread: Bool
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 8) {
                    Text(message.from.isEmpty ? "ONBEKEND" : message.from.softoraUppercased)
                        .font(.softoraDisplay(14, weight: isUnread ? .bold : .semibold))
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
                    .font(.softoraBody(13, weight: isUnread ? .bold : .semibold))
                    .foregroundStyle(Color.softoraInk)
                    .lineLimit(1)
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.softoraPurpleLight, lineWidth: 1)
            }
            .overlay(alignment: .leading) {
                if isUnread {
                    Circle()
                        .fill(Color.softoraCrimson)
                        .frame(width: 6, height: 6)
                        .padding(.leading, 7)
                        .accessibilityHidden(true)
                }
            }
        }
        .buttonStyle(.plain)
    }
}

private struct MailboxMessageDetail: View {
    let message: MailboxMessage
    let selectedAccount: MailboxAccount?
    let apiClient: SoftoraAPIClient
    let isLoadingDetail: Bool
    let statusMessage: String?

    @State private var isReplying = false
    @State private var replyBody = ""
    @State private var isSendingReply = false
    @State private var isImprovingReply = false
    @State private var replyStatus: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(message.subject.isEmpty ? "(GEEN ONDERWERP)" : message.subject.softoraUppercased)
                    .font(.softoraDisplay(24, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(0.9)
                    .foregroundStyle(Color.softoraInk)

                VStack(alignment: .leading, spacing: 8) {
                    MailboxDetailMeta(label: "Van", value: senderAddress)
                    MailboxDetailMeta(label: "Aan", value: message.to)
                    MailboxDetailMeta(label: "Datum", value: MailboxDateFormatter.detailLabel(message.date))
                }

                if let statusMessage {
                    MailboxStatusBanner(message: statusMessage)
                }

                if isLoadingDetail && !shouldShowBody {
                    MailboxBodyPendingView()
                } else if shouldShowBody {
                    MailboxBodyView(presentation: bodyPresentation) {
                        replyComposer
                    }
                } else {
                    replyComposer
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
    }

    private var senderAddress: String {
        let email = message.email.trimmingCharacters(in: .whitespacesAndNewlines)
        return email.isEmpty ? message.from : email
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

    private var bodyPresentation: MailboxBodyPresentation {
        MailboxBodyFormatter.presentation(
            rawBody: detailBodyText,
            images: message.inlineImages,
            links: message.links
        )
    }

    private var shouldShowBody: Bool {
        !detailBodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            !message.inlineImages.isEmpty ||
            !message.links.isEmpty
    }

    private var detailBodyText: String {
        let body = message.body.trimmingCharacters(in: .whitespacesAndNewlines)
        if !body.isEmpty {
            return message.body
        }

        let preview = message.preview.trimmingCharacters(in: .whitespacesAndNewlines)
        return preview.isEmpty ? "" : message.preview
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
            body: detailBodyText
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

private struct MailboxBodyPendingView: View {
    var body: some View {
        Text("VOLLEDIG BERICHT LADEN...")
            .font(.softoraDisplay(11, weight: .bold))
            .textCase(.uppercase)
            .tracking(0.9)
            .foregroundStyle(Color.softoraMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(Color.softoraSheetBackground)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.softoraPurpleLight, lineWidth: 1)
            }
    }
}

private struct MailboxBodyView<ReplyComposer: View>: View {
    let presentation: MailboxBodyPresentation
    @ViewBuilder let replyComposer: () -> ReplyComposer

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(presentation.sections.indices, id: \.self) { index in
                let section = presentation.sections[index]
                MailboxBodySectionView(section: section)

                if index == replyPlacementIndex {
                    replyComposer()
                }
            }

            if replyPlacementIndex == nil {
                replyComposer()
            }
        }
    }

    private var replyPlacementIndex: Int? {
        presentation.sections.firstIndex { !$0.isQuoted }
    }
}

private struct MailboxBodySectionView: View {
    let section: MailboxBodySection

    var body: some View {
        HStack(spacing: 0) {
            Rectangle()
                .fill(section.isQuoted ? Color.softoraMuted.opacity(0.35) : Color.softoraCrimson)
                .frame(width: 4)

            VStack(alignment: .leading, spacing: 12) {
                Text(section.title)
                    .font(.softoraDisplay(11, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(0.9)
                    .foregroundStyle(section.isQuoted ? Color.softoraMuted : Color.softoraCrimson)

                ForEach(section.blocks) { block in
                    switch block {
                    case .text(let text, _):
                        Text(text)
                            .font(.softoraBody(14))
                            .foregroundStyle(Color.softoraInk)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    case .textLink(let text, let link, _):
                        MailboxInlineTextLinkView(text: text, link: link)
                    case .image(let image, _):
                        MailboxInlineImageView(image: image)
                    case .link(let link, _):
                        MailboxBodyLinkView(link: link)
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(section.isQuoted ? Color.softoraSheetBackground : Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(section.isQuoted ? Color.softoraPurpleLight : Color.softoraCrimson.opacity(0.28), lineWidth: 1)
        }
    }
}

private struct MailboxInlineTextLinkView: View {
    let text: String
    let link: MailboxLink

    var body: some View {
        if let destination = URL(string: link.href) {
            Link(destination: destination) {
                Text(text)
                    .font(.softoraBody(14, weight: .semibold))
                    .foregroundStyle(Color.softoraCrimson)
                    .underline()
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            Text(text)
                .font(.softoraBody(14))
                .foregroundStyle(Color.softoraInk)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct MailboxInlineImageView: View {
    let image: MailboxInlineImage

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            imageContent

            if !image.alt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text(image.alt.softoraUppercased)
                    .font(.softoraDisplay(10, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(0.8)
                    .foregroundStyle(Color.softoraMuted)
            }
        }
    }

    @ViewBuilder
    private var imageContent: some View {
        if let uiImage {
            Image(uiImage: uiImage)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color.softoraPurpleLight, lineWidth: 1)
                }
        } else if let remoteURL {
            AsyncImage(url: remoteURL) { phase in
                switch phase {
                case .success(let renderedImage):
                    renderedImage
                        .resizable()
                        .scaledToFit()
                case .failure:
                    MailboxImagePlaceholder(text: "AFBEELDING KON NIET LADEN")
                case .empty:
                    MailboxImagePlaceholder(text: "AFBEELDING LADEN")
                @unknown default:
                    MailboxImagePlaceholder(text: "AFBEELDING LADEN")
                }
            }
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.softoraPurpleLight, lineWidth: 1)
            }
        }
    }

    private var uiImage: UIImage? {
        let cleanBase64 = image.contentBase64
            .replacingOccurrences(of: "\n", with: "")
            .replacingOccurrences(of: "\r", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            !cleanBase64.isEmpty,
            let data = Data(base64Encoded: cleanBase64)
        else {
            return nil
        }
        return UIImage(data: data)
    }

    private var remoteURL: URL? {
        let trimmedURL = image.url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedURL.isEmpty else {
            return nil
        }
        return URL(string: trimmedURL)
    }
}

private struct MailboxImagePlaceholder: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.softoraDisplay(11, weight: .bold))
            .textCase(.uppercase)
            .tracking(0.8)
            .foregroundStyle(Color.softoraMuted)
            .frame(maxWidth: .infinity)
            .frame(height: 150)
            .background(Color.softoraPurpleLight.opacity(0.38))
    }
}

private struct MailboxBodyLinkView: View {
    let link: MailboxLink

    var body: some View {
        if let destination = URL(string: link.href) {
            Link(destination: destination) {
                HStack(spacing: 8) {
                    Image(systemName: "link")
                        .font(.system(size: 12, weight: .bold))

                    Text((link.label.isEmpty ? link.href : link.label).softoraUppercased)
                        .font(.softoraDisplay(12, weight: .bold))
                        .textCase(.uppercase)
                        .tracking(0.8)
                        .lineLimit(2)
                        .minimumScaleFactor(0.78)
                }
                .foregroundStyle(Color.softoraCrimson)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 11)
                .background(Color.softoraPurpleLight.opacity(0.45))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }
}

private struct MailboxBodyPresentation {
    let sections: [MailboxBodySection]
}

private struct MailboxBodySection: Identifiable {
    let id = UUID()
    let title: String
    let blocks: [MailboxBodyBlock]
    let isQuoted: Bool
}

private enum MailboxBodyBlock: Identifiable {
    case text(String, UUID = UUID())
    case textLink(String, MailboxLink, UUID = UUID())
    case image(MailboxInlineImage, UUID = UUID())
    case link(MailboxLink, UUID = UUID())

    var id: UUID {
        switch self {
        case .text(_, let id), .textLink(_, _, let id), .image(_, let id), .link(_, let id):
            id
        }
    }
}

private enum MailboxBodyFormatter {
    static func presentation(rawBody: String, images: [MailboxInlineImage], links: [MailboxLink]) -> MailboxBodyPresentation {
        let blocks = blocks(from: rawBody, images: images, links: links)
        let splitIndex = blocks.firstIndex { block in
            if case .text(let text, _) = block {
                return isReplyHeader(text)
            }
            return false
        }

        if let splitIndex, splitIndex > 0 {
            let replyBlocks = Array(blocks[..<splitIndex])
            let originalBlocks = Array(blocks[splitIndex...])
            return MailboxBodyPresentation(
                sections: [
                    MailboxBodySection(title: "Reactie", blocks: replyBlocks, isQuoted: false),
                    MailboxBodySection(title: "Eerdere mail", blocks: originalBlocks, isQuoted: true),
                ].filter { !$0.blocks.isEmpty }
            )
        }

        return MailboxBodyPresentation(
            sections: [
                MailboxBodySection(title: "Bericht", blocks: blocks.isEmpty ? [.text("Geen inhoud")] : blocks, isQuoted: false),
            ]
        )
    }

    static func readable(_ rawBody: String) -> String {
        rawBody
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n")
            .map(stripQuotePrefix)
            .joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func blocks(from rawBody: String, images: [MailboxInlineImage], links: [MailboxLink]) -> [MailboxBodyBlock] {
        let lines = readable(rawBody).components(separatedBy: "\n")
        var output: [MailboxBodyBlock] = []
        var paragraph: [String] = []
        var unusedImages = images
        var unusedLinks = uniqueLinks(links)

        func flushParagraph() {
            let text = paragraph
                .joined(separator: "\n")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                if let textLink = linkFromText(text) {
                    let link = takeLink(withHref: textLink.href, from: &unusedLinks) ?? textLink
                    output.append(.textLink(linkDisplayText(from: text, link: link), link))
                } else if let link = takeLink(matching: text, from: &unusedLinks) {
                    output.append(.textLink(linkDisplayText(from: text, link: link), link))
                } else {
                    output.append(.text(text))
                }
            }
            paragraph.removeAll()
        }

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                flushParagraph()
                continue
            }

            if let imageLabel = imagePlaceholderLabel(from: trimmed) {
                flushParagraph()
                if let image = takeImage(matching: imageLabel, from: &unusedImages) {
                    output.append(.image(image))
                }
                continue
            }

            if isReplyHeader(trimmed) {
                flushParagraph()
                output.append(.text(trimmed))
                continue
            }

            paragraph.append(line)
        }
        flushParagraph()

        for image in unusedImages {
            output.append(.image(image))
        }
        for link in unusedLinks {
            output.append(.link(link))
        }
        return output
    }

    private static func imagePlaceholderLabel(from line: String) -> String? {
        guard line.lowercased().hasPrefix("[image:") && line.hasSuffix("]") else {
            return nil
        }
        return String(line.dropFirst(7).dropLast())
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func takeImage(matching label: String, from images: inout [MailboxInlineImage]) -> MailboxInlineImage? {
        if let exactIndex = images.firstIndex(where: { normalizedImageText($0.alt) == normalizedImageText(label) }) {
            return images.remove(at: exactIndex)
        }
        if let looseIndex = images.firstIndex(where: { normalizedImageText($0.alt).contains(normalizedImageText(label)) || normalizedImageText(label).contains(normalizedImageText($0.alt)) }) {
            return images.remove(at: looseIndex)
        }
        guard !images.isEmpty else {
            return nil
        }
        return images.removeFirst()
    }

    private static func takeLink(matching text: String, from links: inout [MailboxLink]) -> MailboxLink? {
        let normalizedText = normalizedLinkText(text)
        guard !normalizedText.isEmpty else {
            return nil
        }
        guard let index = links.firstIndex(where: { link in
            let label = normalizedLinkText(link.label)
            let href = normalizedLinkText(link.href)
            return (!label.isEmpty && (normalizedText == label || normalizedText.contains(label) || label.contains(normalizedText))) ||
                (isUnsubscribeText(normalizedText) && isUnsubscribeLink(link)) ||
                (!href.isEmpty && normalizedText.contains(href))
        }) else {
            return nil
        }
        return links.remove(at: index)
    }

    private static func takeLink(withHref href: String, from links: inout [MailboxLink]) -> MailboxLink? {
        let normalizedHref = href.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard let index = links.firstIndex(where: { $0.href.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == normalizedHref }) else {
            return nil
        }
        return links.remove(at: index)
    }

    private static func linkFromText(_ text: String) -> MailboxLink? {
        let pattern = #"https?://[^\s<>\)"]+"#
        guard let range = text.range(of: pattern, options: .regularExpression) else {
            return nil
        }
        var href = String(text[range])
        while let last = href.last, ".,;:!?]".contains(last) {
            href.removeLast()
        }
        guard !href.isEmpty else {
            return nil
        }
        return MailboxLink(label: linkDisplayText(from: text, link: MailboxLink(label: "", href: href)), href: href)
    }

    private static func linkDisplayText(from text: String, link: MailboxLink) -> String {
        var displayText = text
        let hrefCandidates = [
            link.href,
            link.href.removingPercentEncoding ?? "",
        ]

        for href in hrefCandidates where !href.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            displayText = displayText.replacingOccurrences(of: href, with: "", options: .caseInsensitive)
        }

        displayText = displayText
            .replacingOccurrences(of: #"<?https?://\S+>?"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ":;-")))

        if displayText.isEmpty {
            let label = link.label.trimmingCharacters(in: .whitespacesAndNewlines)
            return label.isEmpty ? link.href : label
        }

        return displayText
    }

    private static func normalizedImageText(_ value: String) -> String {
        value
            .lowercased()
            .replacingOccurrences(of: ".png", with: "")
            .replacingOccurrences(of: ".jpg", with: "")
            .replacingOccurrences(of: ".jpeg", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func normalizedLinkText(_ value: String) -> String {
        value
            .lowercased()
            .replacingOccurrences(of: "https://", with: "")
            .replacingOccurrences(of: "http://", with: "")
            .replacingOccurrences(of: "www.", with: "")
            .replacingOccurrences(of: "\n", with: " ")
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func isUnsubscribeText(_ normalizedText: String) -> Bool {
        normalizedText.contains("geen interesse") ||
            normalizedText.contains("geen webdesign") ||
            normalizedText.contains("niet ontvangen") ||
            normalizedText.contains("afmelden") ||
            normalizedText.contains("uitschrijven")
    }

    private static func isUnsubscribeLink(_ link: MailboxLink) -> Bool {
        let normalizedHref = normalizedLinkText(link.href)
        let normalizedLabel = normalizedLinkText(link.label)
        return normalizedHref.contains("afmelden") ||
            normalizedHref.contains("unsubscribe") ||
            normalizedLabel.contains("afmelden") ||
            normalizedLabel.contains("unsubscribe") ||
            normalizedLabel.contains("geen interesse")
    }

    private static func uniqueLinks(_ links: [MailboxLink]) -> [MailboxLink] {
        var seen = Set<String>()
        return links.filter { link in
            guard !link.href.isEmpty, !seen.contains(link.href) else {
                return false
            }
            seen.insert(link.href)
            return true
        }
    }

    private static func isReplyHeader(_ text: String) -> Bool {
        let lowercased = text.lowercased()
        return lowercased.hasPrefix("op ") && lowercased.contains(" schreef") ||
            lowercased.hasPrefix("on ") && lowercased.contains(" wrote") ||
            lowercased.hasPrefix("from:") ||
            lowercased.hasPrefix("van:")
    }

    private static func stripQuotePrefix(from line: String) -> String {
        var output = line
        while output.trimmingCharacters(in: .whitespaces).hasPrefix(">") {
            output = output.trimmingCharacters(in: .whitespaces)
            output.removeFirst()
            if output.hasPrefix(" ") {
                output.removeFirst()
            }
        }
        return output
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

            Text(value.isEmpty ? "—" : value)
                .font(.softoraBody(12, weight: .semibold))
                .foregroundStyle(Color.softoraInk)
        }
    }
}

private struct MailboxAccountDropdown: View {
    let accounts: [MailboxAccount]
    let selectedAccount: MailboxAccount?
    let isLoading: Bool
    let onSelect: (MailboxAccount) -> Void

    var body: some View {
        VStack(spacing: 8) {
            if isLoading && accounts.isEmpty {
                Text("LADEN...")
                    .font(.softoraBody(12, weight: .semibold))
                    .foregroundStyle(Color.softoraMuted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(accounts) { account in
                            let isSelected = selectedAccount?.id == account.id

                            Button {
                                onSelect(account)
                            } label: {
                                HStack(spacing: 8) {
                                    Text(account.email)
                                        .font(.softoraDisplay(12, weight: .bold))
                                        .textCase(.uppercase)
                                        .tracking(0.4)
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.68)
                                        .frame(maxWidth: .infinity, alignment: .leading)

                                    if isSelected {
                                        Image(systemName: "checkmark")
                                            .font(.system(size: 11, weight: .bold))
                                    }
                                }
                                .foregroundStyle(isSelected ? Color.white : Color.softoraInk)
                                .padding(.horizontal, 13)
                                .frame(height: 46)
                                .background(isSelected ? Color.softoraCrimson : Color.softoraSheetBackground)
                                .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                                .overlay {
                                    if !isSelected {
                                        RoundedRectangle(cornerRadius: 13, style: .continuous)
                                            .stroke(Color.softoraPurpleLight, lineWidth: 1)
                                    }
                                }
                                .opacity(account.imapConfigured ? 1 : 0.42)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .frame(maxHeight: menuMaxHeight)
                .scrollIndicators(.hidden)
            }
        }
        .padding(10)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.softoraPurpleLight, lineWidth: 1)
        }
        .shadow(color: Color.softoraInk.opacity(0.08), radius: 18, x: 0, y: 10)
    }

    private var menuMaxHeight: CGFloat {
        min(CGFloat(max(accounts.count, 1)) * 54, 264)
    }
}

private struct MailboxAccountSelector: View {
    let accounts: [MailboxAccount]
    let selectedAccount: MailboxAccount?
    let isLoading: Bool
    let isLocked: Bool
    let pinnedEmail: String
    let onMove: (MailboxAccount, Int) -> Void
    let onTogglePin: (MailboxAccount) -> Void
    let onSelect: (MailboxAccount) -> Void

    @State private var isExpanded = true
    @State private var isEditingOrder = false

    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                Text("Kies het gewenste mailadres")
                    .font(.softoraDisplay(12, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(1.0)
                    .foregroundStyle(Color.softoraMuted)
                    .frame(maxWidth: .infinity, alignment: .center)

                HStack {
                    Button {
                        withAnimation(.smooth(duration: 0.22)) {
                            if !isExpanded {
                                isExpanded = true
                            }
                            isEditingOrder.toggle()
                        }
                    } label: {
                        Image(systemName: isEditingOrder ? "checkmark" : "arrow.up.arrow.down")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(isEditingOrder ? Color.softoraCrimson : Color.softoraMuted)
                            .frame(width: 34, height: 30)
                    }
                    .buttonStyle(.plain)
                    .disabled(isLocked)
                    .opacity(isLocked ? 0.3 : 1)
                    .accessibilityLabel(isEditingOrder ? "Volgorde klaar" : "Mailadressen volgorde aanpassen")

                    Spacer()

                    Button {
                        withAnimation(.smooth(duration: 0.22)) {
                            isExpanded.toggle()
                            if !isExpanded {
                                isEditingOrder = false
                            }
                        }
                    } label: {
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Color.softoraMuted)
                            .frame(width: 34, height: 30)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(isExpanded ? "Mailadressen inklappen" : "Mailadressen uitklappen")
                }
            }
            .padding(.horizontal, 18)
            .frame(maxWidth: .infinity)

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
                                let cardBackground = isLocked ? lockedBackground : enabledBackground

                                if isEditingOrder {
                                    VStack(alignment: .leading, spacing: 10) {
                                        accountLabel(account, isSelected: isSelected)

                                        HStack(spacing: 8) {
                                            editIconButton(
                                                systemName: "chevron.left",
                                                isDisabled: !canMoveAccount(account, direction: -1),
                                                isSelected: isSelected
                                            ) {
                                                onMove(account, -1)
                                            }

                                            editIconButton(
                                                systemName: isPinned(account) ? "pin.fill" : "pin",
                                                isDisabled: isLocked,
                                                isSelected: isSelected
                                            ) {
                                                onTogglePin(account)
                                            }

                                            editIconButton(
                                                systemName: "chevron.right",
                                                isDisabled: !canMoveAccount(account, direction: 1),
                                                isSelected: isSelected
                                            ) {
                                                onMove(account, 1)
                                            }
                                        }
                                    }
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 12)
                                    .frame(width: 196, alignment: .leading)
                                    .background(cardBackground)
                                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                    .overlay {
                                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                                            .stroke(isPinned(account) ? Color.softoraCrimson : Color.softoraPurpleLight, lineWidth: isPinned(account) ? 1.4 : 1)
                                    }
                                    .opacity(account.imapConfigured ? (isLocked ? 0.72 : 1) : 0.38)
                                } else {
                                    Button {
                                        onSelect(account)
                                    } label: {
                                        accountLabel(account, isSelected: isSelected)
                                            .padding(.horizontal, 14)
                                            .padding(.vertical, 16)
                                            .frame(width: 178, alignment: .leading)
                                            .background(cardBackground)
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

    private func accountLabel(_ account: MailboxAccount, isSelected: Bool) -> some View {
        HStack(spacing: 7) {
            Text(account.email)
                .font(.softoraDisplay(11.5, weight: .bold))
                .textCase(.uppercase)
                .tracking(0.4)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .frame(maxWidth: .infinity, alignment: .leading)

            if isPinned(account) {
                Image(systemName: "pin.fill")
                    .font(.system(size: 10, weight: .bold))
            }
        }
        .foregroundStyle(isSelected ? Color.white : (isLocked ? Color.softoraMuted : Color.softoraInk))
    }

    private func editIconButton(
        systemName: String,
        isDisabled: Bool,
        isSelected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(isSelected ? Color.softoraCrimson : Color.softoraInk)
                .frame(width: 42, height: 30)
                .background(isSelected ? Color.white : Color.softoraSheetBackground)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .stroke(Color.softoraPurpleLight, lineWidth: 1)
                }
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.35 : 1)
    }

    private func isPinned(_ account: MailboxAccount) -> Bool {
        pinnedEmail.caseInsensitiveCompare(account.email) == .orderedSame
    }

    private func canMoveAccount(_ account: MailboxAccount, direction: Int) -> Bool {
        guard !isLocked, !isPinned(account), direction != 0 else { return false }
        let movableAccounts = accounts.filter { !isPinned($0) }
        guard let currentIndex = movableAccounts.firstIndex(where: { $0.id == account.id }) else { return false }
        return movableAccounts.indices.contains(currentIndex + direction)
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

    static func detailLabel(_ value: String, now: Date = Date(), calendar: Calendar = .current) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let date = parseDate(trimmed) else {
            return trimmed.isEmpty ? "—" : trimmed
        }

        if date <= now, now.timeIntervalSince(date) < 300 {
            return "Zojuist"
        }

        let time = timeFormatter.string(from: date)
        if calendar.isDateInToday(date) {
            return "Vandaag \(time)"
        }
        if calendar.isDateInYesterday(date) {
            return "Gisteren \(time)"
        }
        if calendar.component(.year, from: date) == calendar.component(.year, from: now) {
            return displayFormatter.string(from: date)
        }
        return displayFormatterWithYear.string(from: date)
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
