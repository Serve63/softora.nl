import Foundation
import Observation

@MainActor
@Observable
final class AgendaStore {
    private let apiClient: SoftoraAPIClient

    var isCheckingSession = true
    var isAuthenticated = false
    var isLoadingAppointments = false
    var isLoggingIn = false
    var isSavingAppointment = false
    var appointments: [AgendaAppointment] = []
    var displayName = ""
    var email = ""
    var mfaRequired = false
    var alertMessage: String?

    init(apiClient: SoftoraAPIClient) {
        self.apiClient = apiClient
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

    func login(email: String, password: String, otp: String, remember: Bool) async {
        isLoggingIn = true
        alertMessage = nil
        defer { isLoggingIn = false }

        do {
            let response = try await apiClient.login(
                email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                password: password,
                otp: otp.trimmingCharacters(in: .whitespacesAndNewlines),
                remember: remember
            )
            mfaRequired = response.mfaRequired == true
            guard response.ok, response.authenticated == true else {
                throw SoftoraAPIError.server(response.error ?? "Inloggen mislukt.")
            }
            let session = try await apiClient.fetchSession()
            apply(session)
            await loadAppointments(fresh: true)
        } catch SoftoraAPIError.mfaRequired(let message) {
            mfaRequired = true
            alertMessage = message
        } catch {
            alertMessage = error.localizedDescription
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
        mfaRequired = session.mfaEnabled
        if !session.configured {
            alertMessage = "Softora-login is nog niet volledig ingesteld op de server."
        }
    }
}
