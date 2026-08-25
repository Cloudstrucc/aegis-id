import Foundation
import SwiftUI

/// Where the wallet is, and where a screen wants to send it.
///
/// The tab bar used to be the only thing that could change tabs, which meant a
/// button on Home could describe an action on Scan but not perform it. Holders
/// read "scan a QR code", tapped it, and then had to go and find the tab
/// themselves.
///
/// Routing lives here rather than in `WalletStore` because none of it is wallet
/// state: it is not persisted, it does not survive a relaunch, and nothing about
/// a credential depends on it.
@MainActor
final class AppRouter: ObservableObject {
    @Published var selectedTab: AppTab = .home

    /// The organization the Organizations tab should open, set when somebody
    /// arrives from somewhere else — picking a connection in Settings, say.
    /// Cleared once consumed, so going back and returning shows the list again
    /// rather than trapping the holder in one organization.
    @Published var focusedOrganizationId: String?

    /// A short-lived confirmation, shown over whichever tab is on screen.
    ///
    /// Separate from the wallet challenge banner: that one waits for an answer
    /// and must not disappear on its own. This one reports something that has
    /// already happened and gets out of the way.
    @Published var flash: FlashNotice?

    private var flashDismissal: Task<Void, Never>?

    func show(_ tab: AppTab) {
        selectedTab = tab
    }

    func openOrganization(_ organizationId: String) {
        focusedOrganizationId = organizationId
        selectedTab = .organizations
    }

    func consumeFocusedOrganization() -> String? {
        defer { focusedOrganizationId = nil }
        return focusedOrganizationId
    }

    func flash(_ notice: FlashNotice) {
        flashDismissal?.cancel()
        flash = notice

        // Replacing a notice restarts the clock rather than letting the first
        // one's timer cut the second one short.
        flashDismissal = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_400_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.35)) {
                self?.flash = nil
            }
        }
    }

    func dismissFlash() {
        flashDismissal?.cancel()
        withAnimation(.easeOut(duration: 0.25)) {
            flash = nil
        }
    }
}

struct FlashNotice: Identifiable, Equatable {
    enum Tone: Equatable {
        case success
        case failure

        var systemImage: String {
            switch self {
            case .success: return "checkmark.circle.fill"
            case .failure: return "exclamationmark.triangle.fill"
            }
        }

        var tint: Color {
            switch self {
            case .success: return VanguardTheme.green
            case .failure: return .red
            }
        }
    }

    let id = UUID()
    var tone: Tone
    var message: String
}

/// The transient confirmation itself.
///
/// Tappable to dismiss early, but it does not require a tap — a holder who has
/// already moved on should not be left with a banner to clear.
struct FlashNoticeView: View {
    var notice: FlashNotice
    var dismiss: () -> Void

    var body: some View {
        Button(action: dismiss) {
            HStack(spacing: 10) {
                Image(systemName: notice.tone.systemImage)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(notice.tone.tint)
                Text(notice.message)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(VanguardTheme.ink)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 11)
            .padding(.horizontal, 14)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(notice.tone.tint.opacity(0.35))
            )
            .shadow(color: VanguardTheme.navy.opacity(0.14), radius: 12, y: 6)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(notice.message)
    }
}
