import Foundation

@MainActor
final class WalletStore: ObservableObject {
    @Published private(set) var connections: [WalletConnection] = []
    @Published private(set) var transactions: [WalletTransaction] = []
    @Published var lastImportMessage: String?
    @Published var lastImportError: String?
    @Published var lastLabMessage: String?
    @Published var lastLabError: String?

    private let storageKey = "cloudstrucc.aegis.wallet.connections"
    private let transactionsStorageKey = "cloudstrucc.aegis.wallet.transactions"
    private let labClient = LabAgentClient()

    init() {
        load()
        loadTransactions()
    }

    func importInvitation(from rawText: String) {
        lastImportMessage = nil
        lastImportError = nil

        do {
            let invitation = try OOBInvitationParser.parse(rawText)
            if connections.contains(where: { $0.invitation.id == invitation.id }) {
                lastImportMessage = "Invitation already saved."
                return
            }

            connections.insert(WalletConnection(invitation: invitation), at: 0)
            if let connection = connections.first {
                transactions.insert(
                    WalletTransaction(
                        connectionId: connection.id,
                        type: .invitation,
                        status: .received,
                        title: "Invitation imported",
                        detail: invitation.label
                    ),
                    at: 0
                )
                saveTransactions()
            }
            save()
            lastImportMessage = "Invitation saved."
        } catch {
            lastImportError = error.localizedDescription
        }
    }

    func connection(id: UUID) -> WalletConnection? {
        connections.first(where: { $0.id == id })
    }

    func transactions(for connection: WalletConnection) -> [WalletTransaction] {
        transactions.filter { $0.connectionId == connection.id }
    }

    func acceptInLab(_ connection: WalletConnection) async {
        clearLabMessages()

        do {
            let acceptance = try await labClient.acceptInvitation(rawURL: connection.invitation.rawURL)
            update(connection) { item in
                item.holderConnectionId = acceptance.holderConnectionId
                item.issuerConnectionId = acceptance.issuerConnectionId
                item.state = .connected
            }
            addTransaction(
                connectionId: connection.id,
                type: .invitation,
                status: .accepted,
                title: "Invitation accepted",
                detail: "Holder \(acceptance.holderState), issuer \(acceptance.issuerState ?? "pending")",
                remoteId: acceptance.invitationMessageId
            )
            lastLabMessage = "Invitation accepted through the local holder."
        } catch {
            markFailed(connection)
            lastLabError = error.localizedDescription
        }
    }

    func issueMockCredential(_ connection: WalletConnection) async {
        clearLabMessages()

        guard let issuerConnectionId = current(connection)?.issuerConnectionId else {
            lastLabError = "Accept the invitation before issuing a mock credential."
            return
        }

        do {
            try await labClient.issueMockCredential(
                issuerConnectionId: issuerConnectionId,
                subjectEmail: "identity@cloudstrucc.com"
            )
            update(connection) { item in
                item.state = .credentialOffered
            }
            addTransaction(
                connectionId: connection.id,
                type: .credential,
                status: .pendingAcceptance,
                title: "Mock credential offered",
                detail: "CloudstruccEmployeeCredential for identity@cloudstrucc.com"
            )
            lastLabMessage = "Mock credential offer delivered to the wallet."
        } catch {
            lastLabError = error.localizedDescription
        }
    }

    func sendWalletChallenge(_ connection: WalletConnection) async {
        clearLabMessages()

        guard let issuerConnectionId = current(connection)?.issuerConnectionId else {
            lastLabError = "Accept the invitation before sending a challenge."
            return
        }

        do {
            let threadId = try await labClient.sendChallenge(issuerConnectionId: issuerConnectionId)
            update(connection) { item in
                item.state = .challengeReceived
            }
            addTransaction(
                connectionId: connection.id,
                type: .challenge,
                status: .pendingAcceptance,
                title: "Wallet challenge received",
                detail: "Cloudstrucc DIDComm trust ping and basic message challenge.",
                remoteId: threadId
            )
            lastLabMessage = "Wallet challenge received."
        } catch {
            lastLabError = error.localizedDescription
        }
    }

    func refreshOIDCWalletChallenges(_ connection: WalletConnection) async {
        clearLabMessages()

        guard let issuerConnectionId = current(connection)?.issuerConnectionId else {
            lastLabError = "Accept the invitation before checking web app challenges."
            return
        }

        do {
            let challenges = try await labClient.fetchOIDCWalletChallenges(issuerConnectionId: issuerConnectionId)
            var added = 0
            for challenge in challenges where !transactions.contains(where: { $0.webSessionId == challenge.sessionId }) {
                addTransaction(
                    connectionId: connection.id,
                    type: .challenge,
                    status: .pendingAcceptance,
                    title: "OIDC wallet challenge",
                    detail: "Web app sign-in challenge for \(challenge.subject)",
                    remoteId: challenge.nonce,
                    webSessionId: challenge.sessionId
                )
                added += 1
            }

            if added > 0 {
                update(connection) { item in
                    item.state = .challengeReceived
                }
                lastLabMessage = "\(added) web app challenge\(added == 1 ? "" : "s") received."
            } else {
                lastLabMessage = "No pending web app challenges."
            }
        } catch {
            lastLabError = error.localizedDescription
        }
    }

    func acceptTransaction(_ transaction: WalletTransaction, for connection: WalletConnection) async {
        clearLabMessages()

        do {
            if transaction.type == .challenge,
               let holderConnectionId = current(connection)?.holderConnectionId {
                try await labClient.sendHolderMessage(
                    holderConnectionId: holderConnectionId,
                    content: "Cloudstrucc Aegis Wallet simulator accepted challenge \(transaction.remoteId ?? transaction.id.uuidString)."
                )
            }
            if let webSessionId = transaction.webSessionId {
                try await labClient.acceptOIDCWalletChallenge(sessionId: webSessionId)
            }

            updateTransaction(transaction) { item in
                item.status = .accepted
            }

            if transaction.type == .credential {
                update(connection) { item in
                    item.state = .connected
                }
            }
            if transaction.type == .challenge {
                update(connection) { item in
                    item.state = .connected
                }
            }

            lastLabMessage = transaction.type == .credential ? "Mock credential accepted." : "Challenge accepted and response sent."
        } catch {
            updateTransaction(transaction) { item in
                item.status = .failed
            }
            lastLabError = error.localizedDescription
        }
    }

    func markReadyForDidExchange(_ connection: WalletConnection) {
        update(connection) { item in
            item.state = .readyForDidExchange
        }
    }

    func markConnected(_ connection: WalletConnection) {
        update(connection) { item in
            item.state = .connected
        }
    }

    func deleteConnections(at offsets: IndexSet) {
        let deletedIds = offsets.map { connections[$0].id }
        connections.remove(atOffsets: offsets)
        transactions.removeAll { deletedIds.contains($0.connectionId) }
        saveTransactions()
        save()
    }

    private func current(_ connection: WalletConnection) -> WalletConnection? {
        connections.first(where: { $0.id == connection.id })
    }

    private func markFailed(_ connection: WalletConnection) {
        update(connection) { item in
            item.state = .failed
        }
    }

    private func update(_ connection: WalletConnection, mutate: (inout WalletConnection) -> Void) {
        guard let index = connections.firstIndex(where: { $0.id == connection.id }) else {
            return
        }

        mutate(&connections[index])
        connections[index].updatedAt = Date()
        save()
    }

    private func addTransaction(
        connectionId: UUID,
        type: WalletTransactionType,
        status: WalletTransactionStatus,
        title: String,
        detail: String,
        remoteId: String? = nil,
        webSessionId: String? = nil
    ) {
        transactions.insert(
            WalletTransaction(
                connectionId: connectionId,
                type: type,
                status: status,
                title: title,
                detail: detail,
                remoteId: remoteId,
                webSessionId: webSessionId
            ),
            at: 0
        )
        saveTransactions()
    }

    private func updateTransaction(_ transaction: WalletTransaction, mutate: (inout WalletTransaction) -> Void) {
        guard let index = transactions.firstIndex(where: { $0.id == transaction.id }) else {
            return
        }

        mutate(&transactions[index])
        transactions[index].updatedAt = Date()
        saveTransactions()
    }

    private func clearLabMessages() {
        lastLabMessage = nil
        lastLabError = nil
    }

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: storageKey) else {
            return
        }

        do {
            connections = try JSONDecoder.walletDecoder.decode([WalletConnection].self, from: data)
        } catch {
            connections = []
            lastImportError = "Stored wallet state could not be loaded."
        }
    }

    private func save() {
        do {
            let data = try JSONEncoder.walletEncoder.encode(connections)
            UserDefaults.standard.set(data, forKey: storageKey)
        } catch {
            lastImportError = "Wallet state could not be saved."
        }
    }

    private func loadTransactions() {
        guard let data = UserDefaults.standard.data(forKey: transactionsStorageKey) else {
            return
        }

        do {
            transactions = try JSONDecoder.walletDecoder.decode([WalletTransaction].self, from: data)
        } catch {
            transactions = []
            lastLabError = "Stored transaction state could not be loaded."
        }
    }

    private func saveTransactions() {
        do {
            let data = try JSONEncoder.walletEncoder.encode(transactions)
            UserDefaults.standard.set(data, forKey: transactionsStorageKey)
        } catch {
            lastLabError = "Wallet transactions could not be saved."
        }
    }
}

extension JSONDecoder {
    static var walletDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

extension JSONEncoder {
    static var walletEncoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
