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
    var mfaRequired = false
    var mfaEnrollmentRequired = false
    var mfaSetupKey = ""
    var mfaRecoveryCodes: [String] = []

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

    func login(email: String, password: String, otp: String) async -> Bool {
        isUnlocking = true
        alertMessage = nil
        defer { isUnlocking = false }

        do {
            let response = try await apiClient.login(
                email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                password: password,
                otp: otp.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            guard response.ok, response.authenticated == true else {
                mfaRequired = response.mfaRequired == true
                mfaEnrollmentRequired = response.mfaEnrollmentRequired == true
                if let setupKey = response.setupKey, !setupKey.isEmpty {
                    mfaSetupKey = setupKey
                }
                if let recoveryCodes = response.recoveryCodes, !recoveryCodes.isEmpty {
                    mfaRecoveryCodes = recoveryCodes
                }
                alertMessage = response.error ?? "Inloggen mislukt."
                return false
            }
            let session = try await apiClient.fetchSession()
            apply(session)
            clearMfaEnrollmentData()
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
        clearMfaEnrollmentData()
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

    private func clearMfaEnrollmentData() {
        mfaRequired = false
        mfaEnrollmentRequired = false
        mfaSetupKey = ""
        mfaRecoveryCodes = []
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
