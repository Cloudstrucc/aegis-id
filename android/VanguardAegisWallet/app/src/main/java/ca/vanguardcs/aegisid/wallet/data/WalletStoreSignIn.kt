package ca.vanguardcs.aegisid.wallet.data

import ca.vanguardcs.aegisid.wallet.model.WalletTransaction
import ca.vanguardcs.aegisid.wallet.model.WalletTransactionStatus
import ca.vanguardcs.aegisid.wallet.model.WalletTransactionType
import java.util.UUID

/**
 * A sign-in request waiting for the holder's answer.
 *
 * Held on the store rather than on a screen, because the link can arrive from
 * anywhere — the camera, a paste, a deep link — and the sheet that asks the
 * question has to appear over whichever tab is showing.
 */
data class PendingSignIn(
    val request: SignInRequest,
    val appName: String,
    val clientId: String,
    val requestedOrganizationId: String?,
    val expiresAt: String?
)

/** Read what the request is, then ask. Nothing is decided here. */
suspend fun WalletStore.loadSignIn(request: SignInRequest) {
    if (walletId == null) {
        setImportResult(error = "Finish setting up your wallet before approving a sign-in.")
        return
    }
    try {
        val view = registrationClientRef.describeSignIn(request.challengeId, request.sourceWebAppUrl)
        if (view.optString("status") != "pending") {
            setImportResult(error = "That sign-in request has already been answered.")
            return
        }
        pendingSignIn = PendingSignIn(
            request = request,
            appName = view.optString("appName").ifBlank { view.optString("clientId") },
            clientId = view.optString("clientId"),
            requestedOrganizationId = view.optString("requestedOrganizationId").ifBlank { null },
            expiresAt = view.optString("expiresAt").ifBlank { null }
        )
    } catch (error: Exception) {
        setImportResult(error = error.message ?: "That sign-in request could not be read.")
    }
}

/**
 * Answer the request. The caller has already put the holder through the
 * device's biometric or credential when approving — the wallet is the second
 * factor here, and one anybody holding the phone could approve with is not
 * one. Returns the ledger entry, so the caller can send the holder to it.
 */
suspend fun WalletStore.answerSignIn(pending: PendingSignIn, approve: Boolean): WalletTransaction? {
    val id = walletId
    if (id == null) {
        setImportResult(error = "Finish setting up your wallet before approving a sign-in.")
        return null
    }
    return try {
        registrationClientRef.answerSignIn(
            challengeId = pending.request.challengeId,
            walletId = id,
            approve = approve,
            sourceWebAppUrl = pending.request.sourceWebAppUrl
        )
        pendingSignIn = null
        val connectionId = pending.requestedOrganizationId
            ?.let { orgId -> connections.firstOrNull { organizationIdFor(it) == orgId }?.id }
            ?: connections.firstOrNull()?.id
            ?: UUID.randomUUID().toString()
        val transaction = WalletTransaction(
            connectionId = connectionId,
            type = WalletTransactionType.Challenge,
            status = if (approve) WalletTransactionStatus.Accepted else WalletTransactionStatus.Declined,
            title = "Sign in to ${pending.appName}",
            detail = if (approve) "Approved from this wallet with your biometric." else "Declined from this wallet.",
            remoteId = pending.request.challengeId,
            appName = pending.appName,
            action = "sign-in"
        )
        insertTransaction(transaction)
        setImportResult(
            message = if (approve) "Signed in to ${pending.appName}." else "Declined signing in to ${pending.appName}."
        )
        transaction
    } catch (error: Exception) {
        setImportResult(error = error.message ?: "That sign-in could not be answered.")
        null
    }
}

fun WalletStore.dismissSignIn() {
    pendingSignIn = null
}
