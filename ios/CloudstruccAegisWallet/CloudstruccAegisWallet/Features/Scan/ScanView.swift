import SwiftUI

struct ScanView: View {
    @EnvironmentObject private var store: WalletStore

    var body: some View {
        VStack(spacing: 16) {
            QRCodeScannerView { value in
                store.importInvitation(from: value)
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(alignment: .center) {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(.white.opacity(0.82), lineWidth: 3)
                    .frame(width: 230, height: 230)
            }
            .overlay(alignment: .topLeading) {
                StatusBadge(text: "OOB QR", systemImage: "qrcode.viewfinder", tint: CloudstruccTheme.cyan)
                    .padding()
            }

            feedbackMessage
                .padding(.horizontal)
        }
        .padding()
        .background(CloudstruccTheme.navy)
        .navigationTitle("Scan")
        .navigationBarTitleDisplayMode(.inline)
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
            Label("Scan an Aries invitation", systemImage: "camera")
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
