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

    private static let sheetDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "nl_NL")
        formatter.timeZone = .current
        formatter.dateFormat = "EEEE d MMMM yyyy"
        return formatter
    }()

    private static let shortWeekdayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "nl_NL")
        formatter.timeZone = .current
        formatter.dateFormat = "E"
        return formatter
    }()

    private static let shortMonthFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "nl_NL")
        formatter.timeZone = .current
        formatter.dateFormat = "MMM"
        return formatter
    }()

    private static let monthFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "nl_NL")
        formatter.timeZone = .current
        formatter.dateFormat = "MMMM"
        return formatter
    }()

    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "nl_NL")
        calendar.firstWeekday = 2
        calendar.minimumDaysInFirstWeek = 4
        return calendar
    }

    static func ymd(from date: Date) -> String {
        ymdFormatter.string(from: date)
    }

    static func time(from date: Date) -> String {
        timeFormatter.string(from: date)
    }

    static func timeDate(from text: String, fallback: Date = Date()) -> Date {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let parts = trimmed.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]),
              (0...23).contains(hour),
              (0...59).contains(minute) else {
            return fallback
        }
        return calendar.date(bySettingHour: hour, minute: minute, second: 0, of: fallback) ?? fallback
    }

    static func date(fromYMD value: String) -> Date? {
        ymdFormatter.date(from: value)
    }

    static func todayYMD() -> String {
        ymd(from: Date())
    }

    static func displayDate(_ ymd: String) -> String {
        guard let date = ymdFormatter.date(from: ymd) else { return ymd }
        return longDateFormatter.string(from: date)
    }

    static func sheetDateTitle(_ date: Date) -> String {
        sheetDateFormatter.string(from: date).capitalized(with: Locale(identifier: "nl_NL"))
    }

    static func shortWeekday(_ date: Date) -> String {
        shortWeekdayFormatter.string(from: date)
            .replacingOccurrences(of: ".", with: "")
            .capitalized(with: Locale(identifier: "nl_NL"))
    }

    static func shortMonth(_ date: Date) -> String {
        shortMonthFormatter.string(from: date)
            .replacingOccurrences(of: ".", with: "")
            .lowercased()
    }

    static func addDays(_ days: Int, to date: Date) -> Date {
        calendar.date(byAdding: .day, value: days, to: date) ?? date
    }

    static func addWeeks(_ weeks: Int, to date: Date) -> Date {
        addDays(weeks * 7, to: date)
    }

    static func weekStart(containing date: Date) -> Date {
        let startOfDay = calendar.startOfDay(for: date)
        let weekday = calendar.component(.weekday, from: startOfDay)
        let distanceToMonday = weekday == 1 ? -6 : 2 - weekday
        return addDays(distanceToMonday, to: startOfDay)
    }

    static func weekNumber(for monday: Date) -> Int {
        calendar.component(.weekOfYear, from: monday)
    }

    static func weekRangeLabel(for monday: Date) -> String {
        let sunday = addDays(6, to: monday)
        let startDay = calendar.component(.day, from: monday)
        let endDay = calendar.component(.day, from: sunday)
        let startMonth = calendar.component(.month, from: monday)
        let endMonth = calendar.component(.month, from: sunday)

        if startMonth == endMonth {
            return "\(startDay) - \(endDay) \(monthFormatter.string(from: sunday))"
        }

        return "\(startDay) \(shortMonth(monday)) - \(endDay) \(shortMonth(sunday))"
    }

    static func isToday(_ date: Date) -> Bool {
        calendar.isDateInToday(date)
    }
}
