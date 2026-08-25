import SwiftUI

struct ScanView: View {
    @EnvironmentObject private var store: WalletStore
    @EnvironmentObject private var router: AppRouter

    var body: some View {
        VStack(spacing: 16) {
            QRCodeScannerView { value in
                handleScan(value)
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(alignment: .center) {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(.white.opacity(0.82), lineWidth: 3)
                    .frame(width: 230, height: 230)
            }
            .overlay(alignment: .topLeading) {
                StatusBadge(text: "Wallet QR", systemImage: "qrcode.viewfinder", tint: VanguardTheme.cyan)
                    .padding()
            }

            feedbackMessage
                .padding(.horizontal)
        }
        .padding()
        .background(VanguardTheme.navy)
        .navigationTitle("Scan")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// A successful scan leaves the camera and says so.
    ///
    /// Standing on a viewfinder that has already done its job is not a result.
    /// The ledger is where the thing that just arrived actually lives, so that
    /// is where this goes, with a notice that clears itself.
    private func handleScan(_ value: String) {
        store.importInvitation(from: value)

        Task { @MainActor in
            // The product path accepts an invitation over the network, so the
            // outcome is read once it has settled rather than assumed.
            try? await Task.sleep(nanoseconds: 900_000_000)

            if let error = store.lastImportError ?? store.lastLabError {
                router.flash(FlashNotice(tone: .failure, message: error))
                return
            }

            let message = store.lastImportMessage ?? store.lastLabMessage ?? "Invitation imported."
            router.flash(FlashNotice(tone: .success, message: message))
            router.show(.ledger)
        }
    }

    @ViewBuilder
    private var feedbackMessage: some View {
        if let message = store.lastImportMessage {
            Label(message, systemImage: "checkmark.circle")
                .foregroundStyle(.white)
                .font(.headline)
        } else if let error = store.lastImportError {
            Label(error, systemImage: "exclamationmark.triangle")
                .foregroundStyle(.white)
                .font(.headline)
        } else {
            Label("Scan an Aegis credential, OpenID VC request, or Aries lab invitation", systemImage: "camera")
                .foregroundStyle(.white.opacity(0.86))
                .font(.headline)
        }
    }
}

#Preview {
    NavigationStack {
        ScanView()
            .environmentObject(WalletStore())
    }
}
