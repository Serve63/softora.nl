import Foundation

extension AgendaStore {
    static var previewAuthenticated: AgendaStore {
        let store = AgendaStore(apiClient: SoftoraAPIClient())
        store.isCheckingSession = false
        store.isAuthenticated = true
        store.displayName = "Softora"
        store.selectedPlanner = .serve
        store.appointments = [
            AgendaAppointment(
                id: "1",
                title: "Klantmeeting website",
                date: AgendaDateFormatter.todayYMD(),
                time: "09:30",
                location: "Teams",
                who: .serve,
                summary: ""
            ),
            AgendaAppointment(
                id: "2",
                title: "Gezamenlijke intake",
                date: AgendaDateFormatter.todayYMD(),
                time: "13:00",
                location: "Kantoor",
                who: .both,
                summary: ""
            )
        ]
        return store
    }
}
