package ca.vanguardcs.aegisid.wallet.data

import ca.vanguardcs.aegisid.wallet.BuildConfig
import ca.vanguardcs.aegisid.wallet.model.AriesInvitation
import ca.vanguardcs.aegisid.wallet.model.WalletConnection
import ca.vanguardcs.aegisid.wallet.model.WalletConnectionState

/**
 * Wallet identity, contact changes, and recovery for [WalletStore].
 *
 * The device key is generated locally and never leaves the device; recovery
 * rotates it rather than restoring it, which is why nothing sensitive has to be
 * backed up. Identity lives in EncryptedSharedPreferences, not plain ones.
 *
 * These are extension functions on WalletStore so the identity work sits apart
 * from the connection and challenge handling, which is already a large file.
 */

// --- Registration ------------------------------------------------------------

suspend fun WalletStore.registerWallet(email: String, phone: String?) {
    val devicePublicKey = ensureDeviceKey()
    val result = registrationClientRef.register(
        email = email,
        phone = phone,
        devicePublicKey = devicePublicKey
    )

    val record = WalletIdentityRecord(
        walletId = result.walletId,
        email = result.email,
        phone = result.phone,
        deviceKeyId = devicePublicKey,
        registeredAt = System.currentTimeMillis()
    )
    persistIdentity(record)
    updateWalletPasskeySubject(result.email)

    // Recovery codes are shown once, during setup, and never persisted here.
    setPendingRecoveryCodes(registrationClientRef.generateRecoveryCodes(result.walletId))
}

/** Called once the holder confirms they have saved their recovery codes. */
fun WalletStore.completeSetup() {
    setPendingRecoveryCodes(emptyList())
    markWalletRegistered(true)
}

/**
 * Confirm the server still knows this wallet.
 *
 * A wallet can disappear server-side (a reset environment, a restore from an
 * older backup). The app trusts its local store, so without this check it would
 * show a registered wallet whose every request fails, with no way out but
 * clearing app data. Only a definite "not found" clears the identity — a
 * transport failure means we are offline, not that the wallet is gone.
 */
suspend fun WalletStore.verifyWalletStillRegistered() {
    val id = walletId ?: return
    try {
        registrationClientRef.fetchProfile(id)
        setWalletServerMismatch(false)
    } catch (error: WalletNotFoundException) {
        clearLocalIdentity()
        setWalletServerMismatch(true)
    } catch (error: Exception) {
        // Offline or a server error: keep the wallet and try again later.
    }
}

/**
 * Forget this device's wallet identity and return to first-run setup. The
 * wallet on the server, if any, is untouched.
 */
fun WalletStore.clearLocalIdentity() {
    clearIdentityStorage()
    markWalletRegistered(false)
    setPendingRecoveryCodes(emptyList())
}

/** Issue a fresh set of recovery codes, invalidating the previous set. */
suspend fun WalletStore.regenerateRecoveryCodes() {
    val id = walletId ?: throw WalletRegistrationException("This wallet is not registered yet.")
    setPendingRecoveryCodes(registrationClientRef.generateRecoveryCodes(id))
}

// --- Invitation guards -------------------------------------------------------

/**
 * Reject an invitation addressed to a different wallet before calling the
 * server, so the holder gets an immediate, clear explanation.
 */
fun WalletStore.assertInvitationMatchesWallet(inviteWalletId: String?) {
    if (inviteWalletId.isNullOrBlank()) {
        return // contact-bound invite; the server resolves the binding
    }
    if (!WalletIdFormat.matches(inviteWalletId, walletId)) {
        throw WalletMismatchException()
    }
}

// --- Contact changes (challenge gated) ---------------------------------------

suspend fun WalletStore.startContactChange(field: String, value: String): String {
    val id = walletId ?: throw WalletRegistrationException("This wallet is not registered yet.")
    val challengeId = registrationClientRef.startContactChange(id, field, value)
    setPendingContactChallenge(challengeId)
    return challengeId
}

suspend fun WalletStore.resolveContactChange(approve: Boolean) {
    val challengeId = pendingContactChallengeId ?: return
    registrationClientRef.resolveContactChange(challengeId, approve)
    setPendingContactChallenge(null)

    if (approve) {
        // Re-read from the server rather than guessing what it applied.
        walletId?.let { id ->
            runCatching { registrationClientRef.fetchProfile(id) }.getOrNull()?.let { profile ->
                identity?.let { current ->
                    persistIdentity(current.copy(email = profile.email, phone = profile.phone))
                }
            }
        }
    }
}

// --- Recovery ----------------------------------------------------------------

suspend fun WalletStore.startRecovery(identifier: String) {
    val trimmed = identifier.trim()
    val parsed = WalletIdFormat.parse(trimmed)
    val request = registrationClientRef.startRecovery(
        walletId = parsed,
        email = if (parsed == null) trimmed else null
    )
    setRecoveryRequest(request.id, request.walletId)
}

suspend fun WalletStore.verifyRecoveryOtp(otp: String) {
    val requestId = recoveryRequestId ?: throw WalletRegistrationException("Start the recovery again.")
    registrationClientRef.verifyRecoveryOtp(requestId, otp)
}

suspend fun WalletStore.loadRecoveryOptions(): WalletRegistrationClient.RecoveryOptions {
    val id = recoveryWalletId ?: throw WalletRegistrationException("Start the recovery again.")
    val options = registrationClientRef.recoveryOptions(id)
    setRecoveryOptions(options)
    return options
}

suspend fun WalletStore.redeemRecoveryCode(code: String) {
    val requestId = recoveryRequestId ?: throw WalletRegistrationException("Start the recovery again.")
    registrationClientRef.redeemRecoveryCode(requestId, code)
}

suspend fun WalletStore.requestOrgAttestation(organizationId: String) {
    val requestId = recoveryRequestId ?: throw WalletRegistrationException("Start the recovery again.")
    registrationClientRef.requestOrgAttestation(requestId, organizationId)
}

suspend fun WalletStore.isRecoveryApproved(): Boolean {
    val requestId = recoveryRequestId ?: return false
    return registrationClientRef.recoveryStatus(requestId).status == "approved"
}

/** Binds a freshly generated device key to the recovered wallet. */
suspend fun WalletStore.completeRecovery(): String {
    val requestId = recoveryRequestId ?: throw WalletRegistrationException("Start the recovery again.")

    val devicePublicKey = rotateDeviceKey()
    val result = registrationClientRef.completeRecovery(requestId, devicePublicKey)

    persistIdentity(
        WalletIdentityRecord(
            walletId = result.walletId,
            email = identity?.email.orEmpty(),
            phone = identity?.phone,
            deviceKeyId = devicePublicKey,
            registeredAt = System.currentTimeMillis()
        )
    )
    markWalletRegistered(true)
    setRecoveryRequest(null, recoveryWalletId)

    return if (result.suspendsHighAssurance) {
        "Your wallet is back on this device. High-assurance credentials stay suspended until an organization re-verifies you, and high-value actions are paused for 24 hours."
    } else {
        "Your wallet is back on this device, with your organization's credentials restored."
    }
}

// --- Organization invitations ------------------------------------------------

/**
 * Accept an organization invitation through the product API. This is the
 * product path: it needs no ACA-Py holder agent, so it works on deployments
 * where the Aries lab is not running.
 */
suspend fun WalletStore.acceptOrganizationInvite(invite: OrganizationInvite) {
    val id = walletId
    if (id == null) {
        setImportResult(error = "Finish setting up your wallet before joining an organization.")
        return
    }

    try {
        registrationClientRef.acceptOrganizationInvitation(
            invitationId = invite.invitationId,
            walletId = id,
            sourceWebAppUrl = invite.sourceWebAppUrl
        )

        // Record a connection so the organization appears in the wallet and so
        // challenge polling has something to iterate.
        registerProductOrganizationConnection(invite)
        setImportResult(message = "Connected to ${invite.organizationName}.")
        refreshOrganizationProfiles()
    } catch (error: Exception) {
        setImportResult(error = error.message ?: "The invitation could not be accepted.")
    }
}

/**
 * A connection with no DIDComm identifiers, representing an organization joined
 * the product way. Challenge polling keys off organizationId, so this is enough
 * for challenges to arrive.
 */
private fun WalletStore.registerProductOrganizationConnection(invite: OrganizationInvite) {
    val existing = connections.firstOrNull { it.invitation.organizationId == invite.organizationId }
    if (existing != null) {
        return
    }

    addConnection(
        WalletConnection(
            invitation = AriesInvitation(
                id = "org-${invite.invitationId}",
                label = invite.organizationName,
                rawUrl = invite.rawUrl,
                endpoint = invite.sourceWebAppUrl ?: BuildConfig.AEGIS_WEB_APP_BASE_URL,
                organizationId = invite.organizationId,
                organizationName = invite.organizationName,
                subscriptionId = null,
                sourceWebAppUrl = invite.sourceWebAppUrl,
                handshakeProtocols = emptyList(),
                services = emptyList()
            ),
            state = WalletConnectionState.Connected
        )
    )
}

// --- Root wallets and break glass --------------------------------------------

/**
 * Confirm this wallet's nomination as a root wallet of an organization.
 *
 * A Wallet ID is an identifier, not a secret, so a nomination on its own grants
 * nothing: the token in the QR is what proves the nominated device is the one
 * holding the link. A nomination naming a different wallet is refused here, so
 * the holder gets an immediate explanation rather than a server-side
 * "not valid" that reads like a fault.
 */
suspend fun WalletStore.confirmRootWalletNomination(confirmation: RootWalletConfirmation) {
    val id = walletId
    if (id == null) {
        setImportResult(error = "Finish setting up your wallet before confirming a root wallet nomination.")
        return
    }

    if (!WalletIdFormat.matches(confirmation.walletId, id)) {
        setImportResult(error = "This nomination is for wallet ${confirmation.walletId}, not this one.")
        return
    }

    try {
        val message = registrationClientRef.confirmRootWallet(
            walletId = id,
            token = confirmation.token,
            sourceWebAppUrl = confirmation.sourceWebAppUrl
        )
        setImportResult(message = message)
    } catch (error: Exception) {
        setImportResult(error = error.message ?: "That nomination could not be confirmed.")
    }
}

/**
 * Grant the standing permission that makes a break-glass code usable.
 *
 * The link carries only the token. **This wallet supplies its own Wallet ID** —
 * never one from the link — because any of the organization's confirmed root
 * wallets may authorise, and it is the server's check that this wallet is one of
 * them that gives the authorisation its meaning.
 */
suspend fun WalletStore.authoriseBreakGlassCode(authorisation: BreakGlassAuthorisation) {
    val id = walletId
    if (id == null) {
        setImportResult(error = "Finish setting up your wallet before authorising a break-glass code.")
        return
    }

    try {
        val message = registrationClientRef.authoriseBreakGlass(
            walletId = id,
            token = authorisation.token,
            sourceWebAppUrl = authorisation.sourceWebAppUrl
        )
        setImportResult(message = message)
    } catch (error: Exception) {
        setImportResult(error = error.message ?: "That code could not be authorised.")
    }
}

/**
 * Approve an organization administrator's recovery.
 *
 * This wallet is one of the organization's root wallets, and two of them have to
 * agree before the administrator is re-enrolled. The link reached this holder's
 * own address rather than the person recovering, which is what keeps a stolen
 * inbox from approving itself; this wallet still supplies its own Wallet ID, so
 * the approval names a device.
 */
suspend fun WalletStore.approveAccountRecovery(approval: RecoveryApproval) {
    val id = walletId
    if (id == null) {
        setImportResult(error = "Finish setting up your wallet before approving a recovery.")
        return
    }

    try {
        val message = registrationClientRef.approveAccountRecovery(
            walletId = id,
            requestId = approval.requestId,
            token = approval.token,
            sourceWebAppUrl = approval.sourceWebAppUrl
        )
        setImportResult(message = message)
    } catch (error: Exception) {
        setImportResult(error = error.message ?: "That recovery could not be approved.")
    }
}
