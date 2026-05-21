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
        VStack {
            Image("SoftoraLaunchLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 68, height: 68)
                .accessibilityLabel("Softora")
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
