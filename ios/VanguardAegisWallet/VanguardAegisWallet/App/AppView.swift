import SwiftUI

struct AppView: View {
    @EnvironmentObject private var store: WalletStore
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var router = AppRouter()

    var body: some View {
        if store.isWalletRegistered {
            walletTabs
                .environmentObject(router)
                // Confirm the server still knows this wallet whenever the app
                // comes to the foreground, so a wiped environment sends the
                // holder back to setup instead of failing every request.
                .task(id: scenePhase) {
                    guard scenePhase == .active else { return }
                    await store.verifyWalletStillRegistered()
                }
        } else {
            // Setup gate: no credential can bind to this wallet until it has a
            // Wallet ID, so the tabs stay unavailable until registration finishes.
            WalletSetupView()
        }
    }

    /// Waits for an answer, so unlike a flash notice it never dismisses itself.
    @ViewBuilder
    private var challengeBanner: some View {
        if let banner = store.challengeBanner {
            WalletChallengeBannerView(
                banner: banner,
                openLedger: {
                    router.show(.ledger)
                    store.dismissChallengeBanner()
                },
                dismiss: {
                    store.dismissChallengeBanner()
                }
            )
            .padding(.horizontal, 14)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    private var walletTabs: some View {
        TabView(selection: $router.selectedTab) {
            ForEach(AppTab.allCases) { tab in
                Group {
                    // Organizations brings its own stack, because it drives a
                    // navigation path — another tab can open one organization
                    // directly. Nesting a second stack around it would swallow
                    // that path.
                    if tab.providesOwnNavigationStack {
                        tab.content
                    } else {
                        NavigationStack {
                            tab.content
                        }
                    }
                }
                .tabItem { tab.label }
                .tag(tab)
                .badge(tab == .ledger ? store.pendingChallengeCount : 0)
            }
        }
        .safeAreaInset(edge: .top) {
            VStack(spacing: 8) {
                if let flash = router.flash {
                    FlashNoticeView(notice: flash) { router.dismissFlash() }
                        .padding(.horizontal, 14)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
                challengeBanner
            }
            .animation(.spring(response: 0.32, dampingFraction: 0.88), value: router.flash)
            .animation(.spring(response: 0.32, dampingFraction: 0.88), value: store.challengeBanner?.id)
        }
        .onOpenURL { url in
            store.importInvitation(from: url.absoluteString)
            router.show(.home)
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
        case .settings:
            SettingsView()
        }
    }

    /// True where the tab manages its own navigation path.
    var providesOwnNavigationStack: Bool {
        self == .organizations
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
        case .settings:
            Label("Settings", systemImage: "gearshape")
        }
    }
}
