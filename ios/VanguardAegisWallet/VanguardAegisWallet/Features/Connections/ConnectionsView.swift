import SwiftUI

struct ConnectionsView: View {
    @EnvironmentObject private var store: WalletStore

    var body: some View {
        List {
            if store.connections.isEmpty {
                ContentUnavailableView(
                    "No connections",
                    systemImage: "link.badge.plus",
                    description: Text("Import an Aegis credential invitation, OpenID VC request, or Aries lab out-of-band invitation.")
                )
            } else {
                ForEach(store.connections) { connection in
                    NavigationLink(value: connection.id) {
                        ConnectionRow(connection: connection)
                    }
                }
                .onDelete(perform: store.deleteConnections)
            }
        }
        .navigationTitle("Connections")
        .navigationDestination(for: UUID.self) { connectionId in
            ConnectionDetailView(connectionId: connectionId)
        }
    }
}

private struct ConnectionRow: View {
    var connection: WalletConnection

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(connection.invitation.label)
                    .font(.headline)
                Spacer()
                Image(systemName: connection.state.symbolName)
                    .foregroundStyle(VanguardTheme.blue)
            }

            Text(connection.invitation.endpoint ?? "Endpoint pending")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            StatusBadge(text: connection.state.title, systemImage: connection.state.symbolName)
        }
        .padding(.vertical, 4)
    }
}

private struct ConnectionDetailView: View {
    @EnvironmentObject private var store: WalletStore
    @State private var isWorking = false
    var connectionId: UUID

    var body: some View {
        Group {
            if let connection = store.connection(id: connectionId) {
                List {
                    Section("Connection") {
                        LabeledContent("Label", value: connection.invitation.label)
                        if let organizationName = connection.invitation.organizationName {
                            LabeledContent("Organization", value: organizationName)
                        }
                        LabeledContent("State", value: connection.state.title)
                        LabeledContent("Endpoint", value: connection.invitation.endpoint ?? "Unknown")
                        if let holderConnectionId = connection.holderConnectionId {
                            LabeledContent("Holder connection", value: holderConnectionId)
                        }
                        if let issuerConnectionId = connection.issuerConnectionId {
                            LabeledContent("Issuer connection", value: issuerConnectionId)
                        }
                    }

                    Section("Lab actions") {
                        Button {
                            run { await store.acceptInLab(connection) }
                        } label: {
                            Label("Accept invitation in lab", systemImage: "arrow.triangle.2.circlepath")
                        }
                        .disabled(isWorking || connection.holderConnectionId != nil)

                        Button {
                            run { await store.issueMockCredential(connection) }
                        } label: {
                            Label("Issue mock credential", systemImage: "person.text.rectangle")
                        }
                        .disabled(isWorking || connection.issuerConnectionId == nil)

                        Button {
                            run { await store.sendWalletChallenge(connection) }
                        } label: {
                            Label("Send wallet challenge", systemImage: "bolt.shield")
                        }
                        .disabled(isWorking || connection.issuerConnectionId == nil)

                        Button {
                            run { await store.refreshOIDCWalletChallenges(connection) }
                        } label: {
                            Label("Fetch OIDC challenges", systemImage: "network")
                        }
                        .disabled(isWorking || connection.issuerConnectionId == nil)

                        feedbackMessage
                    }

                    transactionsSection(connection: connection)

                    Section("Handshake") {
                        if connection.invitation.handshakeProtocols.isEmpty {
                            Text("No handshake protocols advertised.")
                        } else {
                            ForEach(connection.invitation.handshakeProtocols, id: \.self) { item in
                                Text(item)
                            }
                        }
                    }

                    Section("Services") {
                        if connection.invitation.services.isEmpty {
                            Text("No services advertised.")
                        } else {
                            ForEach(connection.invitation.services, id: \.self) { item in
                                Text(item)
                                    .textSelection(.enabled)
                            }
                        }
                    }
                }
                .navigationTitle(connection.invitation.label)
            } else {
                ContentUnavailableView("Connection missing", systemImage: "exclamationmark.triangle")
            }
        }
    }

    @ViewBuilder
    private var feedbackMessage: some View {
        if isWorking {
            Label("Working with local ACA-Py lab...", systemImage: "hourglass")
                .foregroundStyle(.secondary)
        }
        if let message = store.lastLabMessage {
            Label(message, systemImage: "checkmark.circle")
                .foregroundStyle(VanguardTheme.green)
        }
        if let error = store.lastLabError {
            Label(error, systemImage: "exclamationmark.triangle")
                .foregroundStyle(.red)
                .font(.footnote)
                .textSelection(.enabled)
        }
    }

    private func transactionsSection(connection: WalletConnection) -> some View {
        Section("Wallet transactions") {
            let transactions = store.transactions(for: connection)
            if transactions.isEmpty {
                Text("No transactions yet.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(transactions) { transaction in
                    TransactionRow(transaction: transaction) {
                        run { await store.acceptTransaction(transaction, for: connection) }
                    }
                }
            }
        }
    }

    private func run(_ operation: @escaping () async -> Void) {
        guard !isWorking else {
            return
        }

        isWorking = true
        Task {
            await operation()
            isWorking = false
        }
    }
}

private struct TransactionRow: View {
    var transaction: WalletTransaction
    var onAccept: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Label(transaction.title, systemImage: transaction.type.symbolName)
                    .font(.headline)
                Spacer()
                Text(transaction.status.title)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(statusTint)
            }

            Text(transaction.detail)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            if let appName = transaction.appName {
                Text("\(appName) - \(transaction.action ?? "challenge")")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(VanguardTheme.blue)
            }

            if let remoteId = transaction.remoteId {
                Text(remoteId)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            if transaction.status == .pendingAcceptance {
                Button {
                    onAccept()
                } label: {
                    Label(acceptLabel, systemImage: "checkmark.circle")
                }
                .buttonStyle(.borderedProminent)
                .tint(VanguardTheme.green)
            }
        }
        .padding(.vertical, 4)
    }

    private var acceptLabel: String {
        transaction.type == .credential ? "Accept credential" : "Accept challenge"
    }

    private var statusTint: Color {
        switch transaction.status {
        case .accepted, .sent:
            return VanguardTheme.green
        case .pendingAcceptance, .received:
            return VanguardTheme.blue
        case .declined:
            return .red
        case .failed:
            return .red
        }
    }
}

#Preview {
    NavigationStack {
        ConnectionsView()
            .environmentObject(WalletStore())
    }
}
