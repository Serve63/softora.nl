import Foundation
import Observation

@MainActor
@Observable
final class AgendaStore {
    @ObservationIgnored private let accessStorage: AgendaAccessStorage
    private let apiClient: SoftoraAPIClient

    var isCheckingSession = true
    var isAuthenticated = false
    var isLoadingAppointments = false
    var isUnlocking = false
    var isSavingAppointment = false
    var appointments: [AgendaAppointment] = []
    var displayName = ""
    var email = ""
    var selectedPlanner: Planner
    var alertMessage: String?

    init(
        apiClient: SoftoraAPIClient,
        accessStorage: AgendaAccessStorage = AgendaAccessStorage()
    ) {
        self.apiClient = apiClient
        self.accessStorage = accessStorage
        self.selectedPlanner = accessStorage.selectedPlanner
    }

    func bootstrap() async {
        isCheckingSession = true
        defer { isCheckingSession = false }

        do {
            let session = try await apiClient.fetchSession()
            apply(session)
            if session.authenticated {
                await loadAppointments(fresh: true)
            }
        } catch {
            isAuthenticated = false
            alertMessage = error.localizedDescription
        }
    }

    func unlock(pin: String, planner: Planner) async -> Bool {
        isUnlocking = true
        alertMessage = nil
        defer { isUnlocking = false }

        do {
            let response = try await apiClient.unlockAgendaApp(
                pin: pin.trimmingCharacters(in: .whitespacesAndNewlines),
                who: planner
            )
            guard response.ok, response.authenticated == true else {
                throw SoftoraAPIError.server(response.error ?? "Pincode klopt niet.")
            }
            selectedPlanner = Planner(rawAPIValue: response.who ?? planner.apiValue)
            accessStorage.selectedPlanner = selectedPlanner
            let session = try await apiClient.fetchSession()
            apply(session)
            await loadAppointments(fresh: true)
            return true
        } catch {
            alertMessage = error.localizedDescription
            return false
        }
    }

    func logout() async {
        do {
            try await apiClient.logout()
        } catch {
            alertMessage = error.localizedDescription
        }
        isAuthenticated = false
        displayName = ""
        email = ""
        appointments = []
        accessStorage.clear()
    }

    func loadAppointments(fresh: Bool) async {
        isLoadingAppointments = true
        alertMessage = nil
        defer { isLoadingAppointments = false }

        do {
            appointments = try await apiClient.fetchAppointments(fresh: fresh)
                .filter(\.isUpcoming)
                .sorted { $0.sortKey < $1.sortKey }
        } catch {
            alertMessage = error.localizedDescription
            if error.localizedDescription == "Niet ingelogd." {
                isAuthenticated = false
            }
        }
    }

    func addAppointment(_ draft: NewAppointmentDraft) async -> Bool {
        isSavingAppointment = true
        alertMessage = nil
        defer { isSavingAppointment = false }

        do {
            if let created = try await apiClient.createManualAppointment(draft) {
                appointments.append(created)
                appointments = appointments
                    .filter(\.isUpcoming)
                    .sorted { $0.sortKey < $1.sortKey }
            }
            await loadAppointments(fresh: true)
            return true
        } catch {
            alertMessage = error.localizedDescription
            return false
        }
    }

    private func apply(_ session: PremiumSession) {
        isAuthenticated = session.authenticated
        displayName = session.displayName
        email = session.email
        if !session.configured {
            alertMessage = "Softora-login is nog niet volledig ingesteld op de server."
        }
    }
}

final class AgendaAccessStorage {
    private let defaults: UserDefaults
    private let plannerKey = "nl.softora.agenda.selectedPlanner"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var selectedPlanner: Planner {
        get {
            guard let rawValue = defaults.string(forKey: plannerKey),
                  let planner = Planner(rawValue: rawValue),
                  Planner.appAccessCases.contains(planner) else {
                return .serve
            }
            return planner
        }
        set {
            defaults.set(newValue.rawValue, forKey: plannerKey)
        }
    }

    func clear() {
        defaults.removeObject(forKey: plannerKey)
    }
}
