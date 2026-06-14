import SwiftUI

enum CloudstruccTheme {
    static let navy = Color(red: 0.02, green: 0.09, blue: 0.15)
    static let blue = Color(red: 0.09, green: 0.41, blue: 0.88)
    static let cyan = Color(red: 0.0, green: 0.72, blue: 0.78)
    static let green = Color(red: 0.10, green: 0.73, blue: 0.48)
    static let mist = Color(red: 0.96, green: 0.98, blue: 1.0)
    static let line = Color(red: 0.86, green: 0.90, blue: 0.95)
}

struct CloudstruccCard<Content: View>: View {
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
                    .stroke(CloudstruccTheme.line)
            )
    }
}

struct StatusBadge: View {
    var text: String
    var systemImage: String
    var tint: Color = CloudstruccTheme.blue

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
