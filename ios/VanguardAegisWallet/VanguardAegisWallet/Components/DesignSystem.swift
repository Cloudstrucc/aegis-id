import SwiftUI

enum VanguardTheme {
    static let navy = Color(red: 0.03, green: 0.10, blue: 0.17)
    static let ink = Color(red: 0.08, green: 0.13, blue: 0.20)
    static let blue = Color(red: 0.06, green: 0.31, blue: 0.68)
    static let cyan = Color(red: 0.0, green: 0.61, blue: 0.68)
    static let green = Color(red: 0.08, green: 0.58, blue: 0.40)
    static let mist = Color(red: 0.95, green: 0.98, blue: 1.0)
    static let line = Color(red: 0.84, green: 0.89, blue: 0.94)
}

struct VanguardCard<Content: View>: View {
    var content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(VanguardTheme.line)
            )
    }
}

struct StatusBadge: View {
    var text: String
    var systemImage: String
    var tint: Color = VanguardTheme.blue

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.caption.weight(.bold))
            .foregroundStyle(tint)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(tint.opacity(0.12))
            .clipShape(Capsule())
    }
}

extension Color {
    init(hex: String?, fallback: Color) {
        let raw = String(hex ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard raw.count == 6, let value = Int(raw, radix: 16) else {
            self = fallback
            return
        }

        let red = Double((value >> 16) & 0xff) / 255.0
        let green = Double((value >> 8) & 0xff) / 255.0
        let blue = Double(value & 0xff) / 255.0
        self = Color(red: red, green: green, blue: blue)
    }
}
