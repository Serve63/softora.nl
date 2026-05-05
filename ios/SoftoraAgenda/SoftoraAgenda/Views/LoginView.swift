import SwiftUI

struct PinAccessView: View {
    private let pinLength = 6
    let store: AgendaStore

    @State private var pin = ""
    @State private var planner: Planner
    @State private var didFail = false

    init(store: AgendaStore) {
        self.store = store
        _planner = State(initialValue: store.selectedPlanner)
    }

    var body: some View {
        ZStack {
            SoftoraPinBackground()

            VStack(spacing: 0) {
                Spacer(minLength: 18)

                VStack(spacing: 22) {
                    PinHeader()
                    identityPicker
                    PinDots(length: pinLength, filledCount: pin.count, didFail: didFail)
                    PinNumpad(
                        onDigit: appendDigit,
                        onClear: clearPin,
                        onBackspace: removeLastDigit,
                        isDisabled: store.isUnlocking
                    )
                    statusMessage
                }
                .padding(.horizontal, 28)
                .padding(.top, 40)
                .padding(.bottom, 28)
                .background(Color.softoraCard)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(
                            LinearGradient(
                                colors: [
                                    .clear,
                                    Color.softoraCrimson.opacity(0.55),
                                    .clear,
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(height: 3)
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(Color.softoraLine, lineWidth: 1)
                }
                .shadow(color: Color.softoraInk.opacity(0.08), radius: 28, x: 0, y: 18)
                .padding(.horizontal, 20)

                Spacer(minLength: 18)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    private var identityPicker: some View {
        HStack(spacing: 8) {
            ForEach(Planner.appAccessCases) { option in
                Button {
                    planner = option
                } label: {
                    Text(option.title)
                        .font(.softoraBody(14, weight: .semibold))
                        .textCase(.uppercase)
                        .foregroundStyle(planner == option ? Color.white : Color.softoraInk)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(planner == option ? Color.softoraCrimson : Color.softoraInput)
                        }
                        .overlay {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(
                                    planner == option
                                        ? Color.softoraCrimson
                                        : Color.softoraLine,
                                    lineWidth: 1
                                )
                        }
                }
                .buttonStyle(.plain)
                .disabled(store.isUnlocking)
            }
        }
        .padding(4)
        .background(Color.softoraInk.opacity(0.025))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    @ViewBuilder
    private var statusMessage: some View {
        if store.isUnlocking {
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
            }
            .font(.softoraBody(13, weight: .semibold))
            .foregroundStyle(Color.softoraMuted)
            .frame(minHeight: 20)
        } else {
            Text((store.alertMessage ?? "").softoraUppercased)
                .font(.softoraBody(12, weight: .semibold))
                .foregroundStyle(Color.softoraDanger)
                .multilineTextAlignment(.center)
                .frame(minHeight: 20)
        }
    }

    private func appendDigit(_ digit: String) {
        guard !store.isUnlocking, pin.count < pinLength else { return }
        didFail = false
        store.alertMessage = nil
        pin.append(digit)

        if pin.count == pinLength {
            openAgenda()
        }
    }

    private func clearPin() {
        guard !store.isUnlocking else { return }
        pin = ""
        didFail = false
        store.alertMessage = nil
    }

    private func removeLastDigit() {
        guard !store.isUnlocking, !pin.isEmpty else { return }
        pin.removeLast()
        didFail = false
        store.alertMessage = nil
    }

    private func openAgenda() {
        guard !store.isUnlocking, pin.count == pinLength else { return }
        Task {
            let success = await store.unlock(pin: pin, planner: planner)
            if !success {
                didFail = true
                pin = ""
            }
        }
    }
}

private struct PinHeader: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "lock")
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(Color.softoraCrimson)
                .frame(width: 52, height: 52)
                .background {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color.softoraCrimson.opacity(0.10),
                                    Color.softoraCrimson.opacity(0.04),
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.softoraCrimson.opacity(0.12), lineWidth: 1)
                }

            Text("Beveiligde toegang")
                .font(.softoraDisplay(13, weight: .semibold))
                .tracking(1.9)
                .textCase(.uppercase)
                .foregroundStyle(Color.softoraCrimson)
                .padding(.top, 8)

            Text("PIN INVOEREN")
                .font(.softoraBody(22, weight: .semibold))
                .foregroundStyle(Color.softoraInk)

        }
    }
}

private struct PinDots: View {
    let length: Int
    let filledCount: Int
    let didFail: Bool

    var body: some View {
        HStack(spacing: 10) {
            ForEach(0..<length, id: \.self) { index in
                Circle()
                    .fill(fillColor(for: index))
                    .frame(width: 11, height: 11)
                    .overlay {
                        Circle()
                            .stroke(strokeColor(for: index), lineWidth: 2)
                    }
                    .scaleEffect(index < filledCount ? 1.12 : 1)
                    .shadow(
                        color: index < filledCount && !didFail
                            ? Color.softoraCrimson.opacity(0.18)
                            : .clear,
                        radius: 0,
                        x: 0,
                        y: 0
                    )
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.softoraInk.opacity(0.025))
        .overlay {
            Capsule().stroke(Color.softoraInk.opacity(0.05), lineWidth: 1)
        }
        .clipShape(Capsule())
    }

    private func fillColor(for index: Int) -> Color {
        if didFail { return Color.softoraDanger }
        return index < filledCount ? Color.softoraCrimson : .clear
    }

    private func strokeColor(for index: Int) -> Color {
        if didFail { return Color.softoraDanger }
        return index < filledCount ? Color.softoraCrimson : Color.softoraInk.opacity(0.12)
    }
}

private struct PinNumpad: View {
    let onDigit: (String) -> Void
    let onClear: () -> Void
    let onBackspace: () -> Void
    let isDisabled: Bool

    private let rows: [[PinKey]] = [
        [.digit("1"), .digit("2"), .digit("3")],
        [.digit("4"), .digit("5"), .digit("6")],
        [.digit("7"), .digit("8"), .digit("9")],
        [.clear, .digit("0"), .backspace],
    ]

    var body: some View {
        VStack(spacing: 11) {
            ForEach(rows, id: \.self) { row in
                HStack(spacing: 11) {
                    ForEach(row, id: \.self) { key in
                        Button {
                            handle(key)
                        } label: {
                            keyLabel(for: key)
                                .frame(maxWidth: .infinity, minHeight: 54)
                        }
                        .buttonStyle(SoftoraPinKeyButtonStyle())
                        .disabled(isDisabled)
                        .accessibilityLabel(key.accessibilityLabel)
                    }
                }
            }
        }
        .frame(maxWidth: 280)
    }

    @ViewBuilder
    private func keyLabel(for key: PinKey) -> some View {
        switch key {
        case .digit(let value):
            Text(value)
                .font(.softoraBody(22, weight: .medium))
                .monospacedDigit()
        case .clear:
            Image(systemName: "trash")
                .font(.system(size: 18, weight: .medium))
        case .backspace:
            Image(systemName: "delete.left")
                .font(.system(size: 18, weight: .medium))
        }
    }

    private func handle(_ key: PinKey) {
        switch key {
        case .digit(let value):
            onDigit(value)
        case .clear:
            onClear()
        case .backspace:
            onBackspace()
        }
    }
}

private enum PinKey: Hashable {
    case digit(String)
    case clear
    case backspace

    var accessibilityLabel: String {
        switch self {
        case .digit(let value):
            return "Cijfer \(value)"
        case .clear:
            return "Volledige PIN wissen"
        case .backspace:
            return "Laatste cijfer wissen"
        }
    }
}

private struct SoftoraPinKeyButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(configuration.isPressed ? Color.softoraCrimson : Color.softoraInk)
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.white,
                                Color(red: 0.98, green: 0.98, blue: 0.98),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
            }
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(
                        configuration.isPressed
                            ? Color.softoraCrimson.opacity(0.22)
                            : Color.softoraInk.opacity(0.08),
                        lineWidth: 1
                    )
            }
            .shadow(color: Color.black.opacity(0.04), radius: 2, x: 0, y: 1)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
    }
}

private struct SoftoraPinBackground: View {
    var body: some View {
        Color.softoraBackground
            .ignoresSafeArea()
    }
}

struct PinAccessView_Previews: PreviewProvider {
    static var previews: some View {
        PinAccessView(store: AgendaStore(apiClient: SoftoraAPIClient()))
    }
}
