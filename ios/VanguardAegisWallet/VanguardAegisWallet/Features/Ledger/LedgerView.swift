import SwiftUI

struct LedgerView: View {
    @EnvironmentObject private var store: WalletStore

    private var challengeTransactions: [WalletTransaction] {
        store.transactions
            .filter { $0.type == .challenge }
            .sorted { $0.createdAt > $1.createdAt }
    }

    var body: some View {
        List {
            if challengeTransactions.isEmpty {
                ContentUnavailableView(
                    "No wallet ledger entries",
                    systemImage: "list.bullet.rectangle.portrait",
                    description: Text("Fetch connected app challenges after Verified ID or YubiKey web sign-in, then accept them to build a local high-assurance action ledger.")
                )
            } else {
                Section("Wallet challenge ledger") {
                    ForEach(challengeTransactions) { transaction in
                        NavigationLink {
                            LedgerDetailView(transactionId: transaction.id)
                        } label: {
                            LedgerRow(transaction: transaction)
                        }
                    }
                }
            }
        }
        .navigationTitle("Ledger")
    }
}

private struct LedgerRow: View {
    var transaction: WalletTransaction

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(transaction.appName ?? "Aegis ID")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text(transaction.status.title)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(statusTint)
            }

            Text(actionTitle)
                .font(.headline)

            Text(transaction.detail)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            if let resource = resourceLabel {
                Text(resource)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }

            if transaction.requiresPasskey == true {
                Label("Passkey required", systemImage: "person.badge.key")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(VanguardTheme.blue)
            }
        }
        .padding(.vertical, 4)
    }

    private var actionTitle: String {
        let action = (transaction.action ?? "challenge").replacingOccurrences(of: "-", with: " ")
        return action.capitalized
    }

    private var resourceLabel: String? {
        guard let resourceType = transaction.resourceType, let resourceId = transaction.resourceId else {
            return nil
        }
        return "\(resourceType): \(resourceId)"
    }

    private var statusTint: Color {
        switch transaction.status {
        case .accepted, .sent:
            return VanguardTheme.green
        case .pendingAcceptance, .received:
            return VanguardTheme.blue
        case .failed:
            return .red
        }
    }
}

private struct LedgerDetailView: View {
    @EnvironmentObject private var store: WalletStore
    @State private var isWorking = false
    var transactionId: UUID

    var body: some View {
        Group {
            if let transaction = store.transaction(id: transactionId) {
                List {
                    Section("Challenge") {
                        LabeledContent("Application", value: transaction.appName ?? "Aegis ID")
                        LabeledContent("Action", value: transaction.action ?? "challenge")
                        LabeledContent("Status", value: transaction.status.title)
                        if let resourceType = transaction.resourceType {
                            LabeledContent("Resource type", value: resourceType)
                        }
                        if let resourceId = transaction.resourceId {
                            LabeledContent("Resource ID", value: resourceId)
                        }
                        if let remoteId = transaction.remoteId {
                            LabeledContent("Nonce", value: remoteId)
                        }
                        if transaction.requiresPasskey == true {
                            LabeledContent("Required assurance", value: transaction.requiredAssurance ?? "passkey")
                        }
                        if let passkeyEvidenceLabel = transaction.passkeyEvidenceLabel {
                            LabeledContent("Passkey evidence", value: passkeyEvidenceLabel)
                        }
                    }

                    Section("Decision") {
                        decisionContent(for: transaction)
                    }

                    Section("Payload") {
                        if let payloadFields = transaction.payloadFields, !payloadFields.isEmpty {
                            ForEach(payloadFields) { field in
                                LabeledContent(field.key, value: field.value)
                            }
                        } else {
                            Text(transaction.detail)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Section("Timestamps") {
                        LabeledContent("Created", value: transaction.createdAt.formatted(date: .abbreviated, time: .standard))
                        LabeledContent("Updated", value: transaction.updatedAt.formatted(date: .abbreviated, time: .standard))
                    }
                }
            } else {
                ContentUnavailableView("Ledger entry missing", systemImage: "exclamationmark.triangle")
            }
        }
        .navigationTitle("Ledger Entry")
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private func decisionContent(for transaction: WalletTransaction) -> some View {
        switch transaction.status {
        case .pendingAcceptance, .received, .failed:
            if let connection = store.connection(id: transaction.connectionId) {
                Button {
                    accept(transaction, connection: connection)
                } label: {
                    if isWorking {
                        Label("Recording decision...", systemImage: "hourglass")
                    } else if transaction.requiresPasskey == true {
                        Label("Verify Passkey And \(actionButtonTitle(for: transaction))", systemImage: "person.badge.key")
                    } else {
                        Label(actionButtonTitle(for: transaction), systemImage: "checkmark.shield")
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(VanguardTheme.green)
                .disabled(isWorking)
            } else {
                Label("Connection unavailable", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
            }

            if let error = store.lastLabError {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }
        case .accepted, .sent:
            Label("Decision accepted", systemImage: "checkmark.seal.fill")
                .foregroundStyle(VanguardTheme.green)
        }
    }

    private func accept(_ transaction: WalletTransaction, connection: WalletConnection) {
        guard !isWorking else {
            return
        }

        isWorking = true
        Task {
            await store.acceptTransaction(transaction, for: connection)
            isWorking = false
        }
    }

    private func actionButtonTitle(for transaction: WalletTransaction) -> String {
        let action = actionLabel(transaction.action)
        guard let resourceType = transaction.resourceType?.trimmingCharacters(in: .whitespacesAndNewlines),
              !resourceType.isEmpty
        else {
            return "Accept \(action.lowercased()) challenge"
        }
        return "\(action) \(resourceType.lowercased())"
    }

    private func actionLabel(_ value: String?) -> String {
        let normalized = String(value ?? "challenge")
            .replacingOccurrences(of: "-", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? "Accept" : normalized.capitalized
    }
}

#Preview {
    NavigationStack {
        LedgerView()
            .environmentObject(WalletStore())
    }
}
