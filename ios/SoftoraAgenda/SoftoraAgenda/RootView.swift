import SwiftUI

struct RootView: View {
    let store: AgendaStore

    var body: some View {
        Group {
            if store.isCheckingSession {
                LaunchLoadingView()
            } else if store.isAuthenticated {
                AgendaListView(store: store)
            } else {
                PinAccessView(store: store)
            }
        }
        .tint(Color.softoraBlue)
        .font(.softoraBody(16))
    }
}

private struct LaunchLoadingView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 44, weight: .semibold))
                .foregroundStyle(Color.softoraBlue)

            ProgressView()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.softoraBackground)
    }
}

struct RootView_Previews: PreviewProvider {
    static var previews: some View {
        RootView(store: AgendaStore.previewAuthenticated)
    }
}
