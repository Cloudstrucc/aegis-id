import SwiftUI

@main
struct VanguardAegisWalletApp: App {
    @StateObject private var walletStore = WalletStore()

    var body: some Scene {
        WindowGroup {
            AppView()
                .environmentObject(walletStore)
        }
    }
}
