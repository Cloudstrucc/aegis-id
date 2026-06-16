import SwiftUI
import UIKit

struct HomeView: View {
    @EnvironmentObject private var store: WalletStore
    @State private var pastedInvitation = ""
    @State private var isAcceptingInvitation = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                landingHero
                statusGrid
                nextActionCard
                importCard
            }
            .padding()
        }
        .background(
            LinearGradient(
                colors: [VanguardTheme.mist, .white],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .navigationTitle("Aegis ID")
    }

    private var landingHero: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 8) {
                    VanguardLogoImage()

                    Text("Aegis ID Wallet")
                        .font(.system(size: 38, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                    Text("Hold lab credentials, accept issuer invitations, and respond to wallet challenges for enterprise identity pilots.")
                        .font(.body)
                        .foregroundStyle(.white.opacity(0.84))
                }

                Spacer()
            }

            HStack(spacing: 10) {
                HeroPill(value: "\(store.connections.count)", label: "Connections")
                HeroPill(value: "\(store.credentialOrganizations.count)", label: "Orgs")
                HeroPill(value: "\(store.transactions.count)", label: "Events")
            }
        }
        .padding(22)
        .background(
            LinearGradient(
                colors: [VanguardTheme.navy, VanguardTheme.blue],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var statusGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            StatusMetricCard(
                title: "Credential orgs",
                value: "\(store.credentialOrganizations.count)",
                systemImage: "building.2.crop.circle",
                tint: VanguardTheme.blue
            )
            StatusMetricCard(
                title: "Pending actions",
                value: "\(store.pendingTransactionCount)",
                systemImage: "bolt.shield",
                tint: VanguardTheme.green
            )
        }
    }

    @ViewBuilder
    private var nextActionCard: some View {
        if let connection = store.latestPendingInvitation {
            VanguardCard {
                VStack(alignment: .leading, spacing: 12) {
                    StatusBadge(text: "Ready to accept", systemImage: "tray.and.arrow.down", tint: VanguardTheme.blue)

                    Text(connection.invitation.label)
                        .font(.title3.bold())

                    Text("This invitation is saved locally. Accept it through the lab bridge before issuing credentials or fetching OIDC wallet challenges.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    Button {
                        acceptLatestInvitation()
                    } label: {
                        Label("Accept invitation in lab", systemImage: "arrow.triangle.2.circlepath")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(VanguardTheme.blue)
                    .disabled(isAcceptingInvitation)
                }
            }
        } else {
            VanguardCard {
                VStack(alignment: .leading, spacing: 12) {
                    StatusBadge(text: "Ready for QR import", systemImage: "qrcode.viewfinder", tint: VanguardTheme.green)
                    Text("Start with an issuer invitation")
                        .font(.title3.bold())
                    Text("Scan or paste an Aegis ID issuer invitation from the web dashboard. Accepted organizations will appear in the Organizations tab.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var importCard: some View {
        VanguardCard {
            VStack(alignment: .leading, spacing: 12) {
                Label("Paste invitation", systemImage: "link.badge.plus")
                    .font(.headline)

                TextEditor(text: $pastedInvitation)
                    .frame(minHeight: 92)
                    .padding(8)
                    .background(VanguardTheme.mist)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(VanguardTheme.line)
                    )

                Button {
                    store.importInvitation(from: pastedInvitation)
                    pastedInvitation = ""
                } label: {
                    Label("Import invitation", systemImage: "square.and.arrow.down")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(VanguardTheme.blue)

                feedbackMessage
            }
        }
    }

    @ViewBuilder
    private var feedbackMessage: some View {
        if let message = store.lastImportMessage {
            Label(message, systemImage: "checkmark.circle")
                .foregroundStyle(VanguardTheme.green)
                .font(.subheadline.weight(.semibold))
        }

        if let error = store.lastImportError {
            Label(error, systemImage: "exclamationmark.triangle")
                .foregroundStyle(.red)
                .font(.subheadline.weight(.semibold))
        }

        if isAcceptingInvitation {
            Label("Accepting invitation through the local holder...", systemImage: "hourglass")
                .foregroundStyle(.secondary)
                .font(.subheadline.weight(.semibold))
        }

        if let message = store.lastLabMessage {
            Label(message, systemImage: "checkmark.circle")
                .foregroundStyle(VanguardTheme.green)
                .font(.subheadline.weight(.semibold))
        }

        if let error = store.lastLabError {
            Label(error, systemImage: "exclamationmark.triangle")
                .foregroundStyle(.red)
                .font(.subheadline.weight(.semibold))
                .textSelection(.enabled)
        }
    }

    private func acceptLatestInvitation() {
        guard !isAcceptingInvitation else {
            return
        }

        isAcceptingInvitation = true
        Task {
            await store.acceptLatestInvitationInLab()
            isAcceptingInvitation = false
        }
    }
}

private struct HeroPill: View {
    var value: String
    var label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.headline.bold())
                .foregroundStyle(.white)
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.72))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.white.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

private struct VanguardLogoImage: View {
    var body: some View {
        if let image = Self.logoImage {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(width: 254, height: 62, alignment: .leading)
                .clipped()
                .accessibilityLabel("Vanguard Cloud Services")
        } else {
            Text("Vanguard Cloud Services")
                .font(.headline.bold())
                .foregroundStyle(.white)
                .accessibilityLabel("Vanguard Cloud Services")
        }
    }

    private static var logoImage: UIImage? {
        guard let path = Bundle.main.path(forResource: "vanguard-logo", ofType: "png") else {
            return UIImage(named: "vanguard-logo")
        }
        return UIImage(contentsOfFile: path)
    }
}

private struct StatusMetricCard: View {
    var title: String
    var value: String
    var systemImage: String
    var tint: Color

    var body: some View {
        VanguardCard {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: systemImage)
                    .font(.title2)
                    .foregroundStyle(tint)
                Text(value)
                    .font(.title.bold())
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
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
