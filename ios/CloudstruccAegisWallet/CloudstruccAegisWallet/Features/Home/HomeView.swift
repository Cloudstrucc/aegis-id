import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var store: WalletStore
    @State private var pastedInvitation = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                importCard
                latestCard
            }
            .padding()
        }
        .background(CloudstruccTheme.mist)
        .navigationTitle("Aegis Wallet")
    }

    private var header: some View {
        CloudstruccCard {
            VStack(alignment: .leading, spacing: 10) {
                StatusBadge(text: "Cloudstrucc Lab", systemImage: "shield.lefthalf.filled", tint: CloudstruccTheme.green)
                Text("Aries connections")
                    .font(.largeTitle.bold())
                Text("Import out-of-band invitations from your local ACA-Py issuer and verifier agents.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var importCard: some View {
        CloudstruccCard {
            VStack(alignment: .leading, spacing: 12) {
                Label("Paste invitation", systemImage: "link.badge.plus")
                    .font(.headline)

                TextEditor(text: $pastedInvitation)
                    .frame(minHeight: 92)
                    .padding(8)
                    .background(CloudstruccTheme.mist)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(CloudstruccTheme.line)
                    )

                Button {
                    store.importInvitation(from: pastedInvitation)
                    pastedInvitation = ""
                } label: {
                    Label("Import invitation", systemImage: "square.and.arrow.down")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(CloudstruccTheme.blue)

                feedbackMessage
            }
        }
    }

    @ViewBuilder
    private var feedbackMessage: some View {
        if let message = store.lastImportMessage {
            Label(message, systemImage: "checkmark.circle")
                .foregroundStyle(CloudstruccTheme.green)
                .font(.subheadline.weight(.semibold))
        }

        if let error = store.lastImportError {
            Label(error, systemImage: "exclamationmark.triangle")
                .foregroundStyle(.red)
                .font(.subheadline.weight(.semibold))
        }
    }

    @ViewBuilder
    private var latestCard: some View {
        if let connection = store.connections.first {
            CloudstruccCard {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Latest")
                        .font(.headline)
                    Text(connection.invitation.label)
                        .font(.title3.bold())
                    StatusBadge(
                        text: connection.state.title,
                        systemImage: connection.state.symbolName,
                        tint: CloudstruccTheme.blue
                    )
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        HomeView()
            .environmentObject(WalletStore())
    }
}
