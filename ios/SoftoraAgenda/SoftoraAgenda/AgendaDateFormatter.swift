import Foundation

enum AgendaDateFormatter {
    private static let ymdFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "nl_NL")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "nl_NL")
        formatter.timeZone = .current
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    private static let longDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "nl_NL")
        formatter.timeZone = .current
        formatter.dateFormat = "EEEE d MMMM"
        return formatter
    }()

    static func ymd(from date: Date) -> String {
        ymdFormatter.string(from: date)
    }

    static func time(from date: Date) -> String {
        timeFormatter.string(from: date)
    }

    static func todayYMD() -> String {
        ymd(from: Date())
    }

    static func displayDate(_ ymd: String) -> String {
        guard let date = ymdFormatter.date(from: ymd) else { return ymd }
        return longDateFormatter.string(from: date)
    }
}
