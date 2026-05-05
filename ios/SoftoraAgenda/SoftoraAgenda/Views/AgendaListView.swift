import SwiftUI

struct AgendaListView: View {
    let store: AgendaStore

    @State private var weekStart = AgendaDateFormatter.weekStart(containing: Date())
    @State private var pendingDate: Date?
    @State private var isChoosingAppointmentType = false
    @State private var isChoosingBusinessType = false
    @State private var selectedBusinessType: BusinessMeetingType = .website
    @State private var addConfiguration: AddAppointmentConfiguration?
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
                            onSelectDate: openAppointmentTypeChoice
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
                        selectedBusinessType = .website
                        isChoosingAppointmentType = false
                        isChoosingBusinessType = true
                    }
                )
            }

            if isChoosingBusinessType {
                BusinessTypeOverlay(
                    selectedType: $selectedBusinessType,
                    onBack: {
                        isChoosingBusinessType = false
                        isChoosingAppointmentType = true
                    },
                    onNext: {
                        openAddSheet(
                            appointmentType: .business,
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
                businessMeetingType: configuration.businessMeetingType
            )
        }
        .alert("Melding", isPresented: alertBinding) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(store.alertMessage ?? "")
        }
    }

    private var overlayIsOpen: Bool {
        isChoosingAppointmentType || isChoosingBusinessType
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

    private func closeAppointmentTypeChoice() {
        isChoosingAppointmentType = false
        pendingDate = nil
    }

    private func openAddSheet(
        appointmentType: AppointmentType,
        businessMeetingType: BusinessMeetingType = .website
    ) {
        addConfiguration = AddAppointmentConfiguration(
            date: pendingDate ?? Date(),
            appointmentType: appointmentType,
            businessMeetingType: businessMeetingType
        )
        isChoosingAppointmentType = false
        isChoosingBusinessType = false
    }
}

private struct AddAppointmentConfiguration: Identifiable {
    let id = UUID()
    let date: Date
    let appointmentType: AppointmentType
    let businessMeetingType: BusinessMeetingType
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

private struct WeekGridView: View {
    let weekStart: Date
    let appointments: [String: [AgendaAppointment]]
    let onSelectDate: (Date) -> Void

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
                        appointments: appointments[AgendaDateFormatter.ymd(from: date)] ?? []
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
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
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
                    CalendarEventChip(appointment: appointment)
                }

                if appointments.count > 4 {
                    Text("+\(appointments.count - 4) meer")
                        .font(.softoraBody(11, weight: .semibold))
                        .foregroundStyle(Color.softoraMuted)
                        .padding(.top, 2)
                }

                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
            .padding(.top, 14)
            .padding(.horizontal, 14)
            .padding(.bottom, 10)
            .background(cellBackground)
            .overlay {
                if AgendaDateFormatter.isToday(date) {
                    Rectangle()
                        .stroke(Color.softoraCrimsonDim, lineWidth: 1.5)
                }
            }
        }
        .buttonStyle(.plain)
    }

    private var dayNumber: String {
        let day = Calendar.current.component(.day, from: date)
        return String(day)
    }

    private var cellBackground: Color {
        AgendaDateFormatter.isToday(date) ? Color.softoraPurpleLight : .white
    }
}

private struct CalendarEventChip: View {
    let appointment: AgendaAppointment

    var body: some View {
        HStack(spacing: 7) {
            Text(appointment.time)
                .font(.softoraBody(10, weight: .bold))
                .foregroundStyle(Color.white)
                .lineLimit(1)
                .padding(.horizontal, 5)
                .padding(.vertical, 2)
                .background(Color.softoraCrimson)
                .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))

            Text(appointment.title)
                .font(.softoraBody(12, weight: .medium))
                .foregroundStyle(Color.softoraCrimson)
                .lineLimit(1)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.softoraPurpleLight)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
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

                Button("Annuleer", action: onClose)
                    .font(.softoraBody(15, weight: .medium))
                    .foregroundStyle(Color.softoraMuted)
                    .padding(.top, 2)
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
                            isSelected: selectedType == type
                        ) {
                            selectedType = type
                        }
                    }
                }

                HStack(spacing: 10) {
                    ActionChoiceButton(title: "Terug", isPrimary: false, action: onBack)
                    ActionChoiceButton(title: "Volgende", isPrimary: true, action: onNext)
                }
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
                .font(.softoraBody(16, weight: .bold))
                .foregroundStyle(isPrimary ? Color.white : Color.softoraInk)
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
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.softoraBody(15, weight: .bold))
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
                        .stroke(isSelected ? Color.softoraCrimson : Color.clear, lineWidth: 2)
                }
        }
        .buttonStyle(.plain)
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

            Text("Agenda laden...")
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
