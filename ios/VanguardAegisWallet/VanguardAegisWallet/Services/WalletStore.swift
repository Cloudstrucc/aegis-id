import AuthenticationServices
import Foundation
import UIKit

@MainActor
final class WalletStore: ObservableObject {
    @Published private(set) var connections: [WalletConnection] = []
    @Published private(set) var transactions: [WalletTransaction] = []
    @Published var lastImportMessage: String?
    @Published var lastImportError: String?
    @Published var lastLabMessage: String?
    @Published var lastLabError: String?
    @Published var challengeBanner: WalletChallengeBanner?
    @Published private(set) var organizationProfiles: [String: OrganizationProfile] = [:]
    @Published private(set) var walletPasskeyStatus: WalletPasskeyStatus?
    @Published var walletPasskeySubject: String = "identity@vanguardcs.ca"

    private let storageKey = "vanguard.aegis.wallet.connections"
    private let transactionsStorageKey = "vanguard.aegis.wallet.transactions"
    private let organizationProfilesStorageKey = "vanguard.aegis.wallet.organization-profiles"
    private let walletPasskeySubjectStorageKey = "vanguard.aegis.wallet.passkey-subject"
    private let labClient = LabAgentClient()
    private let passkeyCoordinator = WalletPasskeyCoordinator()
    private var isAutoRefreshingChallenges = false

    init() {
        walletPasskeySubject = UserDefaults.standard.string(forKey: walletPasskeySubjectStorageKey) ?? walletPasskeySubject
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
            if AegisCredentialInviteParser.canParse(rawText) {
                let credentialInvite = try AegisCredentialInviteParser.parse(rawText)
                importCredentialInvite(credentialInvite)
                return
            }

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

    private func importCredentialInvite(_ invite: AegisCredentialInvite) {
        if transactions.contains(where: { $0.type == .credential && $0.remoteId == invite.credentialId }) {
            lastImportMessage = "Credential invite already saved."
            return
        }

        let connectionId: UUID
        if let existing = connections.first(where: { organizationKey(for: $0) == invite.organizationId }) {
            connectionId = existing.id
            update(existing) { item in
                item.state = .credentialOffered
            }
        } else {
            var connection = WalletConnection(
                invitation: AriesInvitation(
                    id: "credential-\(invite.credentialId)",
                    label: invite.organizationName,
                    rawURL: invite.rawURL,
                    endpoint: AegisWalletEnvironment.webAppURL.absoluteString,
                    organizationId: invite.organizationId,
                    organizationName: invite.organizationName,
                    subscriptionId: nil,
                    handshakeProtocols: [],
                    services: [],
                    receivedAt: Date()
                )
            )
            connection.state = .credentialOffered
            connection.holderConnectionId = "aegis-credential-invite:\(invite.credentialId)"
            connections.insert(connection, at: 0)
            connectionId = connection.id
            save()
        }

        transactions.insert(
            WalletTransaction(
                connectionId: connectionId,
                type: .credential,
                status: .pendingAcceptance,
                title: "Credential invite received",
                detail: "\(invite.organizationName) invited \(invite.holderEmail.isEmpty ? "this wallet" : invite.holderEmail) to accept an organization credential.",
                remoteId: invite.credentialId,
                appName: "Vanguard Aegis ID",
                action: "accept-credential",
                resourceType: "credential-invitation",
                resourceId: invite.credentialId,
                payloadFields: [
                    WalletChallengePayloadField(key: "organizationId", value: invite.organizationId),
                    WalletChallengePayloadField(key: "organizationName", value: invite.organizationName),
                    WalletChallengePayloadField(key: "credentialId", value: invite.credentialId),
                    WalletChallengePayloadField(key: "holderEmail", value: invite.holderEmail),
                    WalletChallengePayloadField(key: "expiresAt", value: invite.expiresAt ?? "Not provided")
                ]
            ),
            at: 0
        )
        saveTransactions()
        Task { await refreshOrganizationProfile(organizationId: invite.organizationId) }
        lastImportMessage = "Credential invite saved. Open Ledger to accept it."
    }

    func connection(id: UUID) -> WalletConnection? {
        connections.first(where: { $0.id == id })
    }

    func transaction(id: UUID) -> WalletTransaction? {
        transactions.first(where: { $0.id == id })
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

    var pendingChallengeCount: Int {
        transactions.filter { $0.type == .challenge && $0.status == .pendingAcceptance }.count
    }

    var credentialOrganizations: [CredentialOrganization] {
        let grouped = Dictionary(grouping: connections, by: organizationKey)
        return grouped.map { key, items in
            let itemIds = Set(items.map(\.id))
            let orgTransactions = transactions.filter { itemIds.contains($0.connectionId) }
            let latestConnection = items.max { $0.updatedAt < $1.updatedAt }
            let profile = organizationProfiles[key]
            let profileCredentialCount = profile?.credentials.count ?? 0
            let profileDisabled = profileCredentialCount > 0 && (profile?.credentials.allSatisfy { $0.status == "revoked" } == true)
            return CredentialOrganization(
                id: key,
                name: profile?.organizationName ?? organizationName(for: items.first),
                connectionCount: items.count,
                credentialCount: profileCredentialCount > 0 ? profileCredentialCount : orgTransactions.filter { $0.type == .credential }.count,
                challengeCount: orgTransactions.filter { $0.type == .challenge }.count,
                latestState: profileDisabled ? .disabled : latestConnection?.state ?? .invitationReceived,
                latestUpdatedAt: latestConnection?.updatedAt ?? Date.distantPast
            )
        }
        .sorted { $0.latestUpdatedAt > $1.latestUpdatedAt }
    }

    func dismissChallengeBanner() {
        challengeBanner = nil
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

        guard current(connection)?.issuerConnectionId != nil else {
            lastLabError = "Accept the invitation before checking web app challenges."
            return
        }

        do {
            let added = try await importOIDCWalletChallenges(for: connection)
            if !added.isEmpty {
                showChallengeBanner(for: added)
                lastLabMessage = "\(added.count) web app challenge\(added.count == 1 ? "" : "s") received."
            } else {
                lastLabMessage = "No pending web app challenges."
            }
        } catch {
            lastLabError = error.localizedDescription
        }
    }

    func autoRefreshOIDCWalletChallenges() async {
        guard !isAutoRefreshingChallenges else {
            return
        }

        let refreshableConnections = connections.filter { $0.issuerConnectionId != nil }
        guard !refreshableConnections.isEmpty else {
            return
        }

        isAutoRefreshingChallenges = true
        defer { isAutoRefreshingChallenges = false }

        var addedTransactions: [WalletTransaction] = []
        for connection in refreshableConnections {
            if Task.isCancelled {
                return
            }

            do {
                addedTransactions.append(contentsOf: try await importOIDCWalletChallenges(for: connection))
            } catch is CancellationError {
                return
            } catch {
                continue
            }
        }

        if !addedTransactions.isEmpty {
            showChallengeBanner(for: addedTransactions)
            lastLabMessage = "\(addedTransactions.count) new wallet challenge\(addedTransactions.count == 1 ? "" : "s") received."
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

    func updateWalletPasskeySubject(_ subject: String) {
        walletPasskeySubject = subject.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        UserDefaults.standard.set(walletPasskeySubject, forKey: walletPasskeySubjectStorageKey)
    }

    func refreshWalletPasskeyStatus() async {
        do {
            walletPasskeyStatus = try await labClient.fetchWalletPasskeyStatus(subject: walletPasskeySubject)
        } catch {
            lastLabError = "Passkey status refresh failed: \(error.localizedDescription)"
        }
    }

    func registerWalletPasskey() async {
        clearLabMessages()

        do {
            let registration = try await labClient.startWalletPasskeyRegistration(
                subject: walletPasskeySubject,
                displayName: walletPasskeySubject
            )
            let response = try await passkeyCoordinator.register(options: registration.options)
            let verification = try await labClient.finishWalletPasskeyRegistration(
                subject: walletPasskeySubject,
                response: response
            )
            walletPasskeyStatus = verification.status
            lastLabMessage = "Wallet passkey registered for \(walletPasskeySubject)."
        } catch {
            lastLabError = "Wallet passkey registration failed: \(error.localizedDescription)"
        }
    }

    func acceptTransaction(_ transaction: WalletTransaction, for connection: WalletConnection) async {
        clearLabMessages()

        do {
            var passkeyResponse: WalletPasskeyCeremonyResponse?
            if transaction.requiresPasskey == true {
                let auth = try await labClient.startWalletPasskeyAuthentication(
                    subject: walletPasskeySubject,
                    challengeId: transaction.webSessionId ?? transaction.remoteId
                )
                passkeyResponse = try await passkeyCoordinator.authenticate(options: auth.options)
            }

            if transaction.type == .challenge,
               let holderConnectionId = current(connection)?.holderConnectionId {
                try await labClient.sendHolderMessage(
                    holderConnectionId: holderConnectionId,
                    content: "Vanguard Aegis ID Wallet simulator accepted challenge \(transaction.remoteId ?? transaction.id.uuidString)."
                )
            }
            if transaction.type == .credential,
               transaction.resourceType == "credential-invitation",
               let credentialId = transaction.remoteId ?? transaction.resourceId,
               let organizationId = connection.invitation.organizationId ?? payloadValue("organizationId", in: transaction) {
                try await labClient.acceptCredentialInvitation(
                    credentialId: credentialId,
                    organizationId: organizationId,
                    holderEmail: payloadValue("holderEmail", in: transaction)
                )
            } else if let webAcceptPath = transaction.webAcceptPath {
                if let passkeyResponse {
                    try await labClient.acceptWalletChallenge(
                        acceptPath: transaction.passkeyAcceptPath ?? webAcceptPath,
                        subject: walletPasskeySubject,
                        challengeId: transaction.webSessionId ?? transaction.remoteId,
                        passkeyResponse: passkeyResponse
                    )
                } else {
                    try await labClient.acceptWalletChallenge(acceptPath: webAcceptPath)
                }
            } else if let webSessionId = transaction.webSessionId {
                try await labClient.acceptOIDCWalletChallenge(sessionId: webSessionId)
            }

            updateTransaction(transaction) { item in
                item.status = .accepted
                if passkeyResponse != nil {
                    item.passkeyEvidenceLabel = "Passkey verified for \(walletPasskeySubject)"
                }
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

            lastLabMessage = transaction.type == .credential ? "Credential accepted." : "Challenge accepted and response sent."
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

    private func importOIDCWalletChallenges(for connection: WalletConnection) async throws -> [WalletTransaction] {
        guard let issuerConnectionId = current(connection)?.issuerConnectionId else {
            return []
        }

        let challenges = try await labClient.fetchOIDCWalletChallenges(issuerConnectionId: issuerConnectionId)
        var addedTransactions: [WalletTransaction] = []

        for challenge in challenges where !transactions.contains(where: { $0.webSessionId == challenge.sessionId }) {
            let transaction = WalletTransaction(
                connectionId: connection.id,
                type: .challenge,
                status: .pendingAcceptance,
                title: challenge.title ?? "\(challenge.appName ?? "Connected app") wallet challenge",
                detail: challenge.detail ?? "\(challenge.organizationName) \(challenge.action ?? "sign-in") challenge for \(challenge.subject)",
                remoteId: challenge.nonce,
                webSessionId: challenge.sessionId,
                webAcceptPath: challenge.acceptPath,
                appName: challenge.appName,
                action: challenge.action,
                resourceType: challenge.resourceType,
                resourceId: challenge.resourceId,
                requiresPasskey: challenge.requiresPasskey ?? false,
                requiredAssurance: challenge.requiredAssurance,
                passkeyAcceptPath: challenge.passkeyAcceptPath,
                payloadFields: challenge.payloadFields
            )
            transactions.insert(transaction, at: 0)
            addedTransactions.append(transaction)
        }

        if !addedTransactions.isEmpty {
            saveTransactions()
            update(connection) { item in
                item.state = .challengeReceived
            }
        }

        return addedTransactions
    }

    private func showChallengeBanner(for transactions: [WalletTransaction]) {
        guard let latest = transactions.first else {
            return
        }

        challengeBanner = WalletChallengeBanner(
            count: transactions.count,
            title: transactions.count == 1 ? latest.title : "\(transactions.count) wallet challenges received",
            detail: latest.detail
        )
    }

    private func organizationKey(for connection: WalletConnection) -> String {
        connection.invitation.organizationId ?? connection.invitation.organizationName ?? connection.invitation.label
    }

    private func organizationName(for connection: WalletConnection?) -> String {
        connection?.invitation.organizationName ?? connection?.invitation.label ?? "Unassigned organization"
    }

    private func payloadValue(_ key: String, in transaction: WalletTransaction) -> String? {
        transaction.payloadFields?.first(where: { $0.key == key })?.value
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
        webSessionId: String? = nil,
        webAcceptPath: String? = nil,
        appName: String? = nil,
        action: String? = nil,
        resourceType: String? = nil,
        resourceId: String? = nil,
        payloadFields: [WalletChallengePayloadField]? = nil
    ) {
        transactions.insert(
            WalletTransaction(
                connectionId: connectionId,
                type: type,
                status: status,
                title: title,
                detail: detail,
                remoteId: remoteId,
                webSessionId: webSessionId,
                webAcceptPath: webAcceptPath,
                appName: appName,
                action: action,
                resourceType: resourceType,
                resourceId: resourceId,
                payloadFields: payloadFields
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

private final class WalletPasskeyCoordinator: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<WalletPasskeyCeremonyResponse, Error>?

    func register(options: WalletPasskeyOptions) async throws -> WalletPasskeyCeremonyResponse {
        guard let challenge = Data(base64URLEncoded: options.challenge),
              let userId = Data(base64URLEncoded: options.user?.id ?? ""),
              let relyingPartyId = options.rp?.id,
              !relyingPartyId.isEmpty
        else {
            throw WalletPasskeyError.invalidOptions
        }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: relyingPartyId)
        let request = provider.createCredentialRegistrationRequest(
            challenge: challenge,
            name: options.user?.name ?? "identity@vanguardcs.ca",
            userID: userId
        )
        request.displayName = options.user?.displayName ?? options.user?.name ?? "Vanguard Aegis ID Wallet"
        return try await perform(request)
    }

    func authenticate(options: WalletPasskeyOptions) async throws -> WalletPasskeyCeremonyResponse {
        guard let challenge = Data(base64URLEncoded: options.challenge),
              let relyingPartyId = options.rp?.id,
              !relyingPartyId.isEmpty
        else {
            throw WalletPasskeyError.invalidOptions
        }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: relyingPartyId)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        return try await perform(request)
    }

    private func perform(_ request: ASAuthorizationRequest) async throws -> WalletPasskeyCeremonyResponse {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        defer { continuation = nil }

        if let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration {
            continuation?.resume(
                returning: WalletPasskeyCeremonyResponse(
                    id: credential.credentialID.base64URLEncodedString(),
                    rawId: credential.credentialID.base64URLEncodedString(),
                    type: "public-key",
                    authenticatorAttachment: "platform",
                    response: WalletPasskeyAuthenticatorResponse(
                        clientDataJSON: credential.rawClientDataJSON.base64URLEncodedString(),
                        attestationObject: credential.rawAttestationObject?.base64URLEncodedString(),
                        authenticatorData: nil,
                        signature: nil,
                        userHandle: nil,
                        transports: ["internal"]
                    )
                )
            )
            return
        }

        if let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion {
            continuation?.resume(
                returning: WalletPasskeyCeremonyResponse(
                    id: credential.credentialID.base64URLEncodedString(),
                    rawId: credential.credentialID.base64URLEncodedString(),
                    type: "public-key",
                    authenticatorAttachment: "platform",
                    response: WalletPasskeyAuthenticatorResponse(
                        clientDataJSON: credential.rawClientDataJSON.base64URLEncodedString(),
                        attestationObject: nil,
                        authenticatorData: credential.rawAuthenticatorData.base64URLEncodedString(),
                        signature: credential.signature.base64URLEncodedString(),
                        userHandle: credential.userID?.base64URLEncodedString(),
                        transports: nil
                    )
                )
            )
            return
        }

        continuation?.resume(throwing: WalletPasskeyError.unsupportedCredential)
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}

private enum WalletPasskeyError: LocalizedError {
    case invalidOptions
    case unsupportedCredential

    var errorDescription: String? {
        switch self {
        case .invalidOptions:
            return "Aegis ID did not return usable passkey options for this wallet."
        case .unsupportedCredential:
            return "The platform returned a passkey credential type this wallet does not support yet."
        }
    }
}

private extension Data {
    init?(base64URLEncoded value: String) {
        var base64 = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64.append(String(repeating: "=", count: 4 - remainder))
        }
        self.init(base64Encoded: base64)
    }

    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
