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
    var isDeletingAppointment = false
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
                .sorted { $0.sortKey < $1.sortKey }
        } catch {
            guard !error.isSoftoraCancellation else { return }
            guard !isRecoverableSupabaseHydrationIssue(error) else { return }
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
                    .sorted { $0.sortKey < $1.sortKey }
            }
            await loadAppointments(fresh: true)
            return true
        } catch {
            alertMessage = error.localizedDescription
            return false
        }
    }

    func deleteAppointment(_ appointment: AgendaAppointment) async -> Bool {
        isDeletingAppointment = true
        alertMessage = nil
        defer { isDeletingAppointment = false }

        do {
            try await apiClient.deleteAppointment(id: appointment.id)
            appointments.removeAll { $0.id == appointment.id }
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

    private func isRecoverableSupabaseHydrationIssue(_ error: Error) -> Bool {
        let message = error.localizedDescription.lowercased()
        return message.contains("gedeelde supabase-opslag") &&
            (message.contains("niet veilig geladen") || message.contains("nog niet geladen"))
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

private extension Error {
    var isSoftoraCancellation: Bool {
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
