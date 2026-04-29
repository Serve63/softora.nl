import SwiftUI

@main
struct SoftoraAgendaApp: App {
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
