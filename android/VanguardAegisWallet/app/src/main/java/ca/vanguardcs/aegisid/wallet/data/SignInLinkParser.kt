package ca.vanguardcs.aegisid.wallet.data

import android.net.Uri
import ca.vanguardcs.aegisid.wallet.BuildConfig

/**
 * `aegisid://sign-in?challenge=…`
 *
 * An application — Business Expenses, the Aegis web app itself — is asking the
 * holder to prove it is them by approving from this wallet. The link carries
 * the challenge and nothing else: no email, no Wallet ID, no organization. It
 * is shown on a screen for anyone to photograph, and what makes that safe is
 * that there is nothing in it worth having. The wallet supplies its own
 * identity when it answers.
 */
data class SignInRequest(
    val challengeId: String,
    val sourceWebAppUrl: String?,
    val rawUrl: String
)

object SignInLinkParser {
    private const val HOST = "sign-in"

    fun canParse(rawText: String?): Boolean = uri(rawText)?.let { isHost(it) } == true

    fun parse(rawText: String?): SignInRequest? {
        val trimmed = rawText?.trim().orEmpty()
        val uri = uri(trimmed) ?: return null
        if (!isHost(uri)) return null
        val challengeId = runCatching { uri.getQueryParameter("challenge") }.getOrNull()
        if (challengeId.isNullOrBlank()) return null
        return SignInRequest(
            challengeId = challengeId,
            sourceWebAppUrl = runCatching { uri.getQueryParameter("vanguard_web_app_url") }.getOrNull(),
            rawUrl = trimmed
        )
    }

    private fun uri(rawText: String?): Uri? =
        runCatching { Uri.parse(rawText?.trim().orEmpty()) }.getOrNull()

    private fun isHost(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase()
        val isAegisScheme = scheme == BuildConfig.AEGIS_URL_SCHEME.lowercase() ||
            scheme?.startsWith("aegisid") == true
        return isAegisScheme &&
            (uri.host?.lowercase() == HOST || uri.path?.lowercase()?.contains(HOST) == true)
    }
}
