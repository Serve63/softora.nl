import SwiftUI
import UIKit
import UserNotifications

@main
struct SoftoraAgendaApp: App {
    @UIApplicationDelegateAdaptor(SoftoraAgendaAppDelegate.self) private var appDelegate
    @State private var store = AgendaStore(apiClient: SoftoraAPIClient())

    var body: some Scene {
        WindowGroup {
            RootView(store: store)
                .task {
                    await store.bootstrap()
                }
        }
    }
}

final class SoftoraAgendaAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        MailboxPushRegistrar.shared.requestAuthorizationAndRegister()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        MailboxPushRegistrar.shared.updateDeviceToken(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        MailboxPushRegistrar.shared.noteRegistrationFailure(error)
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound, .badge]
    }
}

final class MailboxPushRegistrar {
    static let shared = MailboxPushRegistrar()

    private let apiClient = SoftoraAPIClient()
    private let defaults = UserDefaults.standard
    private let deviceTokenKey = "softora.mailbox.apnsDeviceToken"
    private let deviceIdKey = "softora.mailbox.deviceId"
    private let pinnedAccountKey = "softora.mailbox.pinnedAccount"

    private init() {}

    func requestAuthorizationAndRegister() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    func updateDeviceToken(_ deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        defaults.set(token, forKey: deviceTokenKey)
        Task {
            await registerPinnedMailbox()
        }
    }

    func noteRegistrationFailure(_ error: Error) {
        print("Softora mailbox push registratie mislukt: \(error.localizedDescription)")
    }

    func updatePinnedMailbox(_ email: String, lastKnownUid: Int? = nil) {
        defaults.set(email.trimmingCharacters(in: .whitespacesAndNewlines), forKey: pinnedAccountKey)
        Task {
            await registerPinnedMailbox(lastKnownUid: lastKnownUid)
        }
    }

    func registerPinnedMailbox(lastKnownUid: Int? = nil) async {
        let token = (defaults.string(forKey: deviceTokenKey) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { return }

        let pinnedAccount = (defaults.string(forKey: pinnedAccountKey) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            _ = try await apiClient.registerMailboxPushDevice(
                deviceId: deviceId,
                deviceToken: token,
                pinnedAccount: pinnedAccount,
                lastKnownUid: lastKnownUid ?? 0
            )
        } catch {
            print("Softora mailbox push synchroniseren mislukt: \(error.localizedDescription)")
        }
    }

    private var deviceId: String {
        if let existing = defaults.string(forKey: deviceIdKey), !existing.isEmpty {
            return existing
        }
        let nextID = UUID().uuidString
        defaults.set(nextID, forKey: deviceIdKey)
        return nextID
    }
}
