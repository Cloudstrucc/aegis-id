import Foundation

@MainActor
final class WalletStore: ObservableObject {
    @Published private(set) var connections: [WalletConnection] = []
    @Published private(set) var transactions: [WalletTransaction] = []
    @Published var lastImportMessage: String?
    @Published var lastImportError: String?
    @Published var lastLabMessage: String?
    @Published var lastLabError: String?
    @Published private(set) var organizationProfiles: [String: OrganizationProfile] = [:]

    private let storageKey = "vanguard.aegis.wallet.connections"
    private let transactionsStorageKey = "vanguard.aegis.wallet.transactions"
    private let organizationProfilesStorageKey = "vanguard.aegis.wallet.organization-profiles"
    private let legacyStorageKey = "cloudstrucc.aegis.wallet.connections"
    private let legacyTransactionsStorageKey = "cloudstrucc.aegis.wallet.transactions"
    private let labClient = LabAgentClient()

    init() {
        load()
        loadTransactions()
        loadOrganizationProfiles()
    }

    func importInvitation(from rawText: String) {
        lastImportMessage = nil
        lastImportError = nil
        lastLabMessage = nil
        lastLabError = nil

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
            lastImportMessage = "Invitation saved. Accept it in the lab to enable wallet challenges."
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

    func transactions(forOrganizationId organizationId: String) -> [WalletTransaction] {
        let connectionIds = Set(connections.filter { organizationKey(for: $0) == organizationId }.map(\.id))
        return transactions.filter { connectionIds.contains($0.connectionId) }
    }

    func organizationProfile(for organizationId: String) -> OrganizationProfile? {
        organizationProfiles[organizationId]
    }

    var latestPendingInvitation: WalletConnection? {
        connections.first { $0.holderConnectionId == nil }
    }

    var pendingTransactionCount: Int {
        transactions.filter { $0.status == .pendingAcceptance || $0.status == .received }.count
    }

    var credentialOrganizations: [CredentialOrganization] {
        let grouped = Dictionary(grouping: connections, by: organizationKey)
        return grouped.map { key, items in
            let itemIds = Set(items.map(\.id))
            let orgTransactions = transactions.filter { itemIds.contains($0.connectionId) }
            let latestConnection = items.max { $0.updatedAt < $1.updatedAt }
            return CredentialOrganization(
                id: key,
                name: organizationName(for: items.first),
                connectionCount: items.count,
                credentialCount: orgTransactions.filter { $0.type == .credential }.count,
                challengeCount: orgTransactions.filter { $0.type == .challenge }.count,
                latestState: latestConnection?.state ?? .invitationReceived,
                latestUpdatedAt: latestConnection?.updatedAt ?? Date.distantPast
            )
        }
        .sorted { $0.latestUpdatedAt > $1.latestUpdatedAt }
    }

    func acceptLatestInvitationInLab() async {
        guard let connection = latestPendingInvitation else {
            clearLabMessages()
            lastLabMessage = "No pending invitations to accept."
            return
        }

        await acceptInLab(connection)
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
                detail: acceptedInvitationDetail(for: connection, acceptance: acceptance),
                remoteId: acceptance.invitationMessageId
            )
            let registeredOrganization = await registerIssuerOrganizationIfNeeded(connection, acceptance: acceptance)
            if connection.invitation.organizationId != nil {
                await refreshOrganizationProfiles()
            }
            lastLabMessage = registeredOrganization.map {
                "Invitation accepted and registered for \($0)."
            } ?? "Invitation accepted through the local holder."
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
                subjectEmail: "identity@vanguardcs.ca"
            )
            update(connection) { item in
                item.state = .credentialOffered
            }
            addTransaction(
                connectionId: connection.id,
                type: .credential,
                status: .pendingAcceptance,
                title: "Mock credential offered",
                detail: "VanguardEmployeeCredential for identity@vanguardcs.ca"
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
                detail: "Vanguard Aegis ID DIDComm trust ping and basic message challenge.",
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
                    detail: "\(challenge.organizationName) sign-in challenge for \(challenge.subject)",
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

    func refreshOrganizationProfiles() async {
        for organization in credentialOrganizations {
            await refreshOrganizationProfile(organizationId: organization.id)
        }
    }

    func refreshOrganizationProfile(organizationId: String) async {
        do {
            let profile = try await labClient.fetchOrganizationProfile(organizationId: organizationId)
            organizationProfiles[organizationId] = profile
            saveOrganizationProfiles()
        } catch {
            lastLabError = "Organization profile refresh failed: \(error.localizedDescription)"
        }
    }

    func acceptTransaction(_ transaction: WalletTransaction, for connection: WalletConnection) async {
        clearLabMessages()

        do {
            if transaction.type == .challenge,
               let holderConnectionId = current(connection)?.holderConnectionId {
                try await labClient.sendHolderMessage(
                    holderConnectionId: holderConnectionId,
                    content: "Vanguard Aegis ID Wallet simulator accepted challenge \(transaction.remoteId ?? transaction.id.uuidString)."
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

    private func organizationKey(for connection: WalletConnection) -> String {
        connection.invitation.organizationId ?? connection.invitation.organizationName ?? connection.invitation.label
    }

    private func organizationName(for connection: WalletConnection?) -> String {
        connection?.invitation.organizationName ?? connection?.invitation.label ?? "Unassigned organization"
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

    private func acceptedInvitationDetail(for connection: WalletConnection, acceptance: LabAcceptance) -> String {
        var detail = "Holder \(acceptance.holderState), issuer \(acceptance.issuerState ?? "pending")"
        if let organizationName = connection.invitation.organizationName {
            detail += " for \(organizationName)"
        }
        return detail
    }

    private func registerIssuerOrganizationIfNeeded(_ connection: WalletConnection, acceptance: LabAcceptance) async -> String? {
        guard let organizationId = connection.invitation.organizationId,
              let organizationName = connection.invitation.organizationName else {
            return nil
        }

        do {
            try await labClient.registerIssuerOrganizationConnection(
                organizationId: organizationId,
                holderConnectionId: acceptance.holderConnectionId,
                issuerConnectionId: acceptance.issuerConnectionId,
                invitationId: acceptance.invitationMessageId
            )
            return organizationName
        } catch {
            lastLabError = "Invitation accepted, but org registration failed: \(error.localizedDescription)"
            return nil
        }
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
        guard let data = UserDefaults.standard.data(forKey: storageKey) ?? UserDefaults.standard.data(forKey: legacyStorageKey) else {
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
        guard let data = UserDefaults.standard.data(forKey: transactionsStorageKey) ?? UserDefaults.standard.data(forKey: legacyTransactionsStorageKey) else {
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

    private func loadOrganizationProfiles() {
        guard let data = UserDefaults.standard.data(forKey: organizationProfilesStorageKey) else {
            return
        }

        do {
            organizationProfiles = try JSONDecoder.walletDecoder.decode([String: OrganizationProfile].self, from: data)
        } catch {
            organizationProfiles = [:]
            lastLabError = "Stored organization profiles could not be loaded."
        }
    }

    private func saveOrganizationProfiles() {
        do {
            let data = try JSONEncoder.walletEncoder.encode(organizationProfiles)
            UserDefaults.standard.set(data, forKey: organizationProfilesStorageKey)
        } catch {
            lastLabError = "Organization profiles could not be saved."
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
