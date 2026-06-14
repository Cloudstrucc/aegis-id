import SwiftUI

@main
struct CloudstruccAegisWalletApp: App {
    @StateObject private var walletStore = WalletStore()

    var body: some Scene {
        WindowGroup {
            AppView()
                .environmentObject(walletStore)
                .onOpenURL { url in
                    walletStore.importInvitation(from: url.absoluteString)
                }
        }
    }
}
