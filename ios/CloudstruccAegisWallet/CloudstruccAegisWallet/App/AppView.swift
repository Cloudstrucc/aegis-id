import SwiftUI

struct AppView: View {
    @State private var selectedTab: AppTab = .home

    var body: some View {
        TabView(selection: $selectedTab) {
            ForEach(AppTab.allCases) { tab in
                NavigationStack {
                    tab.content
                }
                .tabItem { tab.label }
                .tag(tab)
            }
        }
    }
}

enum AppTab: String, CaseIterable, Identifiable {
    case home
    case scan
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
        case .connections:
            Label("Connections", systemImage: "link")
        case .settings:
            Label("Settings", systemImage: "gearshape")
        }
    }
}
