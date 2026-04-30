import SwiftUI

struct AppointmentRowView: View {
    let appointment: AgendaAppointment

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 4) {
                Text(appointment.time)
                    .font(.headline)
                    .foregroundStyle(Color.softoraInk)

                Text(AgendaDateFormatter.displayDate(appointment.date))
                    .font(.caption)
                    .foregroundStyle(Color.softoraMuted)
                    .multilineTextAlignment(.center)
            }
            .frame(width: 86)

            VStack(alignment: .leading, spacing: 8) {
                Text(appointment.title)
                    .font(.headline)
                    .foregroundStyle(Color.softoraInk)

                HStack(spacing: 8) {
                    Label(appointment.who.title, systemImage: "person.fill")
                    if !appointment.location.isEmpty, appointment.location != "—" {
                        Label(appointment.location, systemImage: "mappin.and.ellipse")
                    }
                }
                .font(.caption)
                .foregroundStyle(Color.softoraMuted)
                .lineLimit(2)
            }
        }
        .padding(.vertical, 6)
    }
}

struct AppointmentRowView_Previews: PreviewProvider {
    static var previews: some View {
        List {
            AppointmentRowView(
                appointment: AgendaAppointment(
                    id: "1",
                    title: "Klantmeeting website",
                    date: AgendaDateFormatter.todayYMD(),
                    time: "09:30",
                    location: "Teams",
                    who: .serve,
                    summary: ""
                )
            )
        }
    }
}
