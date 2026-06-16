import SwiftUI

struct AppView: View {
    @EnvironmentObject private var store: WalletStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab: AppTab = .home

    var body: some View {
        TabView(selection: $selectedTab) {
            ForEach(AppTab.allCases) { tab in
                NavigationStack {
                    tab.content
                }
                .tabItem { tab.label }
                .tag(tab)
                .badge(tab == .ledger ? store.pendingChallengeCount : 0)
            }
        }
        .safeAreaInset(edge: .top) {
            if let banner = store.challengeBanner {
                WalletChallengeBannerView(
                    banner: banner,
                    openLedger: {
                        selectedTab = .ledger
                        store.dismissChallengeBanner()
                    },
                    dismiss: {
                        store.dismissChallengeBanner()
                    }
                )
                .padding(.horizontal, 14)
                .padding(.top, 8)
                .padding(.bottom, 4)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.32, dampingFraction: 0.88), value: store.challengeBanner?.id)
        .onOpenURL { url in
            store.importInvitation(from: url.absoluteString)
            selectedTab = .home
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else {
                return
            }

            await store.autoRefreshOIDCWalletChallenges()

            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: 12_000_000_000)
                } catch {
                    return
                }

                await store.autoRefreshOIDCWalletChallenges()
            }
        }
    }
}

private struct WalletChallengeBannerView: View {
    var banner: WalletChallengeBanner
    var openLedger: () -> Void
    var dismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "bolt.shield.fill")
                .font(.title3)
                .foregroundStyle(.white)
                .frame(width: 38, height: 38)
                .background(VanguardTheme.blue)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                Text(banner.title)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(VanguardTheme.ink)
                    .lineLimit(1)
                Text(banner.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer(minLength: 8)

            Button(action: openLedger) {
                Text("Open")
                    .font(.caption.weight(.bold))
            }
            .buttonStyle(.borderedProminent)
            .tint(VanguardTheme.green)

            Button(action: dismiss) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss wallet challenge banner")
        }
        .padding(12)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(VanguardTheme.line)
        )
        .shadow(color: VanguardTheme.navy.opacity(0.18), radius: 14, y: 8)
    }
}

enum AppTab: String, CaseIterable, Identifiable {
    case home
    case scan
    case organizations
    case ledger
    case connections
    case settings

    var id: String { rawValue }

    @ViewBuilder
    var content: some View {
        switch self {
        case .home:
            HomeView()
        case .scan:
            ScanView()
        case .organizations:
            OrganizationsView()
        case .ledger:
            LedgerView()
        case .connections:
            ConnectionsView()
        case .settings:
            SettingsView()
        }
    }

    @ViewBuilder
    var label: some View {
        switch self {
        case .home:
            Label("Home", systemImage: "house")
        case .scan:
            Label("Scan", systemImage: "qrcode.viewfinder")
        case .organizations:
            Label("Orgs", systemImage: "building.2.crop.circle")
        case .ledger:
            Label("Ledger", systemImage: "list.bullet.rectangle.portrait")
        case .connections:
            Label("Connections", systemImage: "link")
        case .settings:
            Label("Settings", systemImage: "gearshape")
        }
    }
}
