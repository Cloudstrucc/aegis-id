import CryptoKit
import Foundation

// Wallet identity, contact changes, and recovery state for WalletStore.
//
// The device key is generated locally and never leaves the device; recovery
// rotates it rather than restoring it, which is why nothing sensitive has to be
// backed up. Identity is held in the Keychain, not UserDefaults.
@MainActor
extension WalletStore {
    private static let identityService = "ca.vanguardcs.aegisid.wallet.identity"
    private static let deviceKeyService = "ca.vanguardcs.aegisid.wallet.device-key"

    // MARK: - Registration

    func registerWallet(email: String, phone: String?) async throws {
        let devicePublicKey = try ensureDeviceKey()
        let result = try await registrationClient.register(
            email: email,
            phone: phone,
            devicePublicKey: devicePublicKey,
            displayName: nil
        )

        let record = WalletIdentityRecord(
            walletId: result.walletId,
            email: result.email,
            phone: result.phone,
            deviceKeyId: devicePublicKey,
            registeredAt: Date()
        )
        persistIdentity(record)
        identity = record
        walletPasskeySubject = result.email

        // Recovery codes are shown once, during setup, and never persisted here.
        let codes = try await registrationClient.generateRecoveryCodes(walletId: result.walletId)
        pendingRecoveryCodes = codes.codes
    }

    /// Called once the holder confirms they have saved their recovery codes.
    func completeSetup() {
        pendingRecoveryCodes = []
        isWalletRegistered = true
    }

    var walletId: String? { identity?.walletId }

    /// Confirm the server still knows this wallet.
    ///
    /// A wallet can disappear server-side (a reset environment, a restore from an
    /// older backup). The app trusts its local Keychain, so without this check it
    /// would show a registered wallet whose every request fails, with no way out
    /// but deleting the app. Only a definite "not found" clears the identity —
    /// a transport failure means we are offline, not that the wallet is gone.
    func verifyWalletStillRegistered() async {
        guard let walletId = identity?.walletId else {
            return
        }

        do {
            _ = try await registrationClient.fetchProfile(walletId: walletId)
            walletServerMismatch = false
        } catch WalletRegistrationError.notFound {
            clearLocalIdentity()
            walletServerMismatch = true
        } catch {
            // Offline or a server error: keep the wallet and try again later.
        }
    }

    /// Forget this device's wallet identity and return to first-run setup. The
    /// wallet on the server, if any, is untouched.
    func clearLocalIdentity() {
        deleteKeychain(service: Self.identityService)
        identity = nil
        isWalletRegistered = false
        pendingRecoveryCodes = []
    }

    /// Issue a fresh set of recovery codes, invalidating the previous set.
    func regenerateRecoveryCodes() async throws {
        guard let walletId = identity?.walletId else {
            throw WalletRegistrationError.server("This wallet is not registered yet.")
        }
        let result = try await registrationClient.generateRecoveryCodes(walletId: walletId)
        pendingRecoveryCodes = result.codes
    }

    // MARK: - Invitation guards

    /// Reject an invitation addressed to a different wallet before calling the
    /// server, so the holder gets an immediate, clear explanation.
    func assertInvitationMatchesWallet(inviteWalletId: String?) throws {
        guard let inviteWalletId, !inviteWalletId.isEmpty else {
            return // contact-bound invite; the server resolves the binding
        }
        guard WalletIdFormat.matches(inviteWalletId, identity?.walletId) else {
            throw WalletRegistrationError.walletMismatch
        }
    }

    // MARK: - Contact changes (challenge gated)

    func startContactChange(field: String, value: String) async throws -> String {
        guard let walletId = identity?.walletId else {
            throw WalletRegistrationError.server("This wallet is not registered yet.")
        }
        let challenge = try await registrationClient.startContactChange(
            walletId: walletId,
            field: field,
            value: value
        )
        pendingContactChallengeId = challenge.id
        return challenge.id
    }

    func resolveContactChange(approve: Bool) async throws {
        guard let challengeId = pendingContactChallengeId else {
            return
        }
        _ = try await registrationClient.resolveContactChange(challengeId: challengeId, approve: approve)
        pendingContactChallengeId = nil

        if approve, let walletId = identity?.walletId, var record = identity {
            // Reflect the approved change locally.
            record = WalletIdentityRecord(
                walletId: walletId,
                email: record.email,
                phone: record.phone,
                deviceKeyId: record.deviceKeyId,
                registeredAt: record.registeredAt
            )
            persistIdentity(record)
            identity = record
        }
    }

    // MARK: - Recovery

    func startRecovery(identifier: String) async throws {
        let trimmed = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        let walletId = WalletIdFormat.parse(trimmed)
        let result = try await registrationClient.startRecovery(
            walletId: walletId,
            email: walletId == nil ? trimmed : nil
        )
        recoveryRequestId = result.request.id
        recoveryWalletId = result.request.walletId
        // Outside production the server echoes the OTP so local testing needs no
        // SMS or email provider.
        devDeliveredOtp = result.otp
    }

    func verifyRecoveryOtp(otp: String) async throws {
        guard let requestId = recoveryRequestId else {
            throw WalletRegistrationError.server("Start the recovery again.")
        }
        _ = try await registrationClient.verifyRecoveryOtp(requestId: requestId, otp: otp)
    }

    @discardableResult
    func loadRecoveryOptions() async throws -> WalletRegistrationClient.RecoveryOptions {
        guard let walletId = recoveryWalletId else {
            throw WalletRegistrationError.server("Start the recovery again.")
        }
        let options = try await registrationClient.recoveryOptions(walletId: walletId)
        recoveryOptions = options
        return options
    }

    func redeemRecoveryCode(code: String) async throws {
        guard let requestId = recoveryRequestId else {
            throw WalletRegistrationError.server("Start the recovery again.")
        }
        _ = try await registrationClient.redeemRecoveryCode(requestId: requestId, code: code)
    }

    func requestOrgAttestation(organizationId: String) async throws {
        guard let requestId = recoveryRequestId else {
            throw WalletRegistrationError.server("Start the recovery again.")
        }
        _ = try await registrationClient.requestOrgAttestation(
            requestId: requestId,
            organizationId: organizationId
        )
    }

    func isRecoveryApproved() async throws -> Bool {
        guard let requestId = recoveryRequestId else {
            return false
        }
        let request = try await registrationClient.recoveryStatus(requestId: requestId)
        return request.status == "approved"
    }

    /// Binds a freshly generated device key to the recovered wallet.
    func completeRecovery() async throws -> String {
        guard let requestId = recoveryRequestId else {
            throw WalletRegistrationError.server("Start the recovery again.")
        }

        let devicePublicKey = try rotateDeviceKey()
        let result = try await registrationClient.completeRecovery(
            requestId: requestId,
            devicePublicKey: devicePublicKey
        )

        let record = WalletIdentityRecord(
            walletId: result.walletId,
            email: identity?.email ?? "",
            phone: identity?.phone,
            deviceKeyId: devicePublicKey,
            registeredAt: Date()
        )
        persistIdentity(record)
        identity = record
        isWalletRegistered = true
        recoveryRequestId = nil

        if result.suspendsHighAssurance {
            return "Your wallet is back on this device. High-assurance credentials stay suspended until an organization re-verifies you, and high-value actions are paused for 24 hours."
        }
        return "Your wallet is back on this device, with your organization's credentials restored."
    }

    // MARK: - Device key + Keychain

    /// Reuse the existing device key, or create one on first run.
    func ensureDeviceKey() throws -> String {
        if let existing = readKeychain(service: Self.deviceKeyService) {
            return existing
        }
        return try rotateDeviceKey()
    }

    /// Generate a new device key, replacing any previous one (used on recovery).
    @discardableResult
    func rotateDeviceKey() throws -> String {
        let key = P256.Signing.PrivateKey()
        let publicKey = key.publicKey.rawRepresentation.base64EncodedString()
        writeKeychain(service: Self.deviceKeyService, value: publicKey)
        writeKeychain(service: "\(Self.deviceKeyService).private", value: key.rawRepresentation.base64EncodedString())
        return publicKey
    }

    func loadIdentity() -> WalletIdentityRecord? {
        guard let raw = readKeychain(service: Self.identityService),
              let data = raw.data(using: .utf8) else {
            return nil
        }
        return try? JSONDecoder().decode(WalletIdentityRecord.self, from: data)
    }

    private func persistIdentity(_ record: WalletIdentityRecord) {
        guard let data = try? JSONEncoder().encode(record),
              let raw = String(data: data, encoding: .utf8) else {
            return
        }
        writeKeychain(service: Self.identityService, value: raw)
    }

    private func readKeychain(service: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private func deleteKeychain(service: String) {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service
        ] as CFDictionary)
    }

    private func writeKeychain(service: String, value: String) {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service
        ]
        SecItemDelete(base as CFDictionary)

        var insert = base
        insert[kSecValueData as String] = Data(value.utf8)
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(insert as CFDictionary, nil)
    }
}

// MARK: - Organization invitations

@MainActor
extension WalletStore {
    /// Accept an organization invitation through the product API. This replaces
    /// the old lab bridge path, which required an ACA-Py holder agent and hung
    /// on deployments where none is running.
    func acceptOrganizationInvite(_ invite: AegisOrganizationInvite) async {
        lastImportError = nil
        lastImportMessage = nil

        guard let walletId = identity?.walletId else {
            lastImportError = "Finish setting up your wallet before joining an organization."
            return
        }

        do {
            try await registrationClient.acceptOrganizationInvitation(
                invitationId: invite.invitationId,
                walletId: walletId,
                sourceWebAppURL: invite.sourceWebAppURL
            )
            // Record a connection so the organization appears in the wallet and
            // so challenge polling has something to iterate.
            registerProductOrganizationConnection(invite)

            lastImportMessage = "Connected to \(invite.organizationName)."
            await refreshOrganizationProfiles()
        } catch {
            lastImportError = error.localizedDescription
        }
    }
}

// MARK: - Root wallets and break glass

@MainActor
extension WalletStore {
    /// Confirm this wallet's nomination as a root wallet of an organization.
    ///
    /// A Wallet ID is an identifier, not a secret, so a nomination on its own
    /// grants nothing: the token in the QR is what proves the nominated device
    /// is the one holding the link. Refused here when it names a different
    /// wallet, so the holder gets an immediate explanation rather than a
    /// server-side "not valid" that reads like a fault.
    func confirmRootWalletNomination(_ confirmation: AegisRootWalletConfirmation) async {
        lastImportError = nil
        lastImportMessage = nil

        guard let walletId = identity?.walletId else {
            lastImportError = "Finish setting up your wallet before confirming a root wallet nomination."
            return
        }

        guard WalletIdFormat.matches(confirmation.walletId, walletId) else {
            lastImportError = "This nomination is for wallet \(confirmation.walletId), not this one."
            return
        }

        do {
            let result = try await registrationClient.confirmRootWallet(
                walletId: walletId,
                token: confirmation.token,
                sourceWebAppURL: confirmation.sourceWebAppURL
            )
            lastImportMessage = result.message
                ?? "This wallet can now recover control of the organization."
        } catch {
            lastImportError = error.localizedDescription
        }
    }

    /// Grant the standing permission that makes a break-glass code usable.
    ///
    /// The link carries only the token. **This wallet supplies its own Wallet
    /// ID** — never one from the link — because any of the organization's
    /// confirmed root wallets may authorise, and it is the server's check that
    /// this wallet is one of them that gives the authorisation its meaning.
    func authoriseBreakGlassCode(_ authorisation: AegisBreakGlassAuthorisation) async {
        lastImportError = nil
        lastImportMessage = nil

        guard let walletId = identity?.walletId else {
            lastImportError = "Finish setting up your wallet before authorising a break-glass code."
            return
        }

        do {
            let result = try await registrationClient.authoriseBreakGlass(
                walletId: walletId,
                token: authorisation.token,
                sourceWebAppURL: authorisation.sourceWebAppURL
            )
            lastImportMessage = result.message
                ?? "The organization can now be recovered with this code if every root wallet is lost."
        } catch {
            lastImportError = error.localizedDescription
        }
    }
}

@MainActor
extension WalletStore {
    /// Approve an organization administrator's recovery.
    ///
    /// This wallet is one of the organization's root wallets, and two of them
    /// have to agree before the administrator is re-enrolled. The link reached
    /// this holder's own address rather than the person recovering, which is
    /// what keeps a stolen inbox from approving itself; this wallet still
    /// supplies its own Wallet ID, so the approval names a device.
    func approveAccountRecovery(_ approval: AegisRecoveryApproval) async {
        lastImportError = nil
        lastImportMessage = nil

        guard let walletId = identity?.walletId else {
            lastImportError = "Finish setting up your wallet before approving a recovery."
            return
        }

        do {
            let result = try await registrationClient.approveAccountRecovery(
                walletId: walletId,
                requestId: approval.requestId,
                token: approval.token,
                sourceWebAppURL: approval.sourceWebAppURL
            )
            lastImportMessage = result.message
                ?? "Approved. \(result.approvalCount) of \(result.approvalsRequired) approvals."
        } catch {
            lastImportError = error.localizedDescription
        }
    }
}
