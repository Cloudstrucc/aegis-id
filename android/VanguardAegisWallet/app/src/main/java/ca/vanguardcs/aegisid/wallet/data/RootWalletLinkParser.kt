package ca.vanguardcs.aegisid.wallet.data

import android.net.Uri
import ca.vanguardcs.aegisid.wallet.BuildConfig

/**
 * `aegisid://root-wallet-confirm?wallet_id=…&token=…`
 *
 * An organization has nominated this wallet as one that can recover
 * administrative control. Nominating alone grants nothing — a Wallet ID is an
 * identifier, not a secret — so the token in this link is what turns a
 * nomination into a confirmed root wallet. It travels in the QR and appears
 * nowhere on the page that produced it.
 *
 * The Wallet ID is in the link because the organization nominated a *specific*
 * wallet, so the app can refuse one addressed elsewhere before calling out.
 */
data class RootWalletConfirmation(
    val walletId: String,
    val token: String,
    val sourceWebAppUrl: String?,
    val rawUrl: String
)

/**
 * `aegisid://break-glass-authorise?token=…`
 *
 * A root wallet granting the standing permission that makes a break-glass code
 * usable if every root wallet is later lost. The link deliberately carries no
 * Wallet ID: *any* of the organization's confirmed root wallets may authorise,
 * so the scanning wallet supplies its own. That is what makes the record mean
 * "a root wallet of this organization agreed" rather than "somebody had a URL".
 */
data class BreakGlassAuthorisation(
    val token: String,
    val sourceWebAppUrl: String?,
    val rawUrl: String
)

/**
 * `aegisid://recovery-approve?request_id=…&token=…`
 *
 * An administrator of an organization this wallet is a root wallet of has lost
 * their device. Two root wallets have to approve before they are re-enrolled.
 *
 * The token names *this* wallet and was sent to its holder's own address, never
 * to the person recovering — which is what stops a stolen inbox from approving
 * its own recovery. The wallet still supplies its own Wallet ID.
 */
data class RecoveryApproval(
    val requestId: String,
    val token: String,
    val sourceWebAppUrl: String?,
    val rawUrl: String
)

object RootWalletLinkParser {
    private const val CONFIRM_HOST = "root-wallet-confirm"
    private const val AUTHORISE_HOST = "break-glass-authorise"
    private const val APPROVE_HOST = "recovery-approve"

    fun canParseConfirmation(rawText: String?): Boolean = uri(rawText)?.let { isHost(it, CONFIRM_HOST) } == true

    fun canParseBreakGlass(rawText: String?): Boolean = uri(rawText)?.let { isHost(it, AUTHORISE_HOST) } == true

    fun canParseRecoveryApproval(rawText: String?): Boolean = uri(rawText)?.let { isHost(it, APPROVE_HOST) } == true

    fun parseRecoveryApproval(rawText: String?): RecoveryApproval? {
        val trimmed = rawText?.trim().orEmpty()
        val uri = uri(trimmed) ?: return null
        if (!isHost(uri, APPROVE_HOST)) return null

        val requestId = value(uri, "request_id", "requestId") ?: return null
        val token = value(uri, "token") ?: return null

        return RecoveryApproval(
            requestId = requestId,
            token = token,
            sourceWebAppUrl = value(uri, "vanguard_web_app_url"),
            rawUrl = trimmed
        )
    }

    fun parseConfirmation(rawText: String?): RootWalletConfirmation? {
        val trimmed = rawText?.trim().orEmpty()
        val uri = uri(trimmed) ?: return null
        if (!isHost(uri, CONFIRM_HOST)) return null

        val walletId = value(uri, "wallet_id", "walletId") ?: return null
        val token = value(uri, "token") ?: return null

        return RootWalletConfirmation(
            walletId = walletId,
            token = token,
            sourceWebAppUrl = value(uri, "vanguard_web_app_url"),
            rawUrl = trimmed
        )
    }

    fun parseBreakGlass(rawText: String?): BreakGlassAuthorisation? {
        val trimmed = rawText?.trim().orEmpty()
        val uri = uri(trimmed) ?: return null
        if (!isHost(uri, AUTHORISE_HOST)) return null

        val token = value(uri, "token") ?: return null

        return BreakGlassAuthorisation(
            token = token,
            sourceWebAppUrl = value(uri, "vanguard_web_app_url"),
            rawUrl = trimmed
        )
    }

    private fun uri(rawText: String?): Uri? =
        runCatching { Uri.parse(rawText?.trim().orEmpty()) }.getOrNull()

    private fun isHost(uri: Uri, host: String): Boolean {
        val scheme = uri.scheme?.lowercase()
        // Every flavour registers its own scheme (aegisid, aegisid-dev,
        // aegisid-qa, aegisid-local), so matching the literal "aegisid" would
        // silently reject every link outside the prod build.
        val isAegisScheme = scheme == BuildConfig.AEGIS_URL_SCHEME.lowercase() ||
            scheme?.startsWith("aegisid") == true
        return isAegisScheme &&
            (uri.host?.lowercase() == host || uri.path?.lowercase()?.contains(host) == true)
    }

    private fun value(uri: Uri, vararg names: String): String? {
        for (name in names) {
            val found = runCatching { uri.getQueryParameter(name) }.getOrNull()
            if (!found.isNullOrBlank()) return found
        }
        return null
    }
}
