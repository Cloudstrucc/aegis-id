package ca.vanguardcs.aegisid.wallet.data

import android.net.Uri
import ca.vanguardcs.aegisid.wallet.BuildConfig

/**
 * `aegisid://org-invite?...` — the ACA-Py-free organization invitation.
 *
 * The wallet accepts these through the product API, so joining an organization
 * works on deployments where the Aries lab is not running.
 */
data class OrganizationInvite(
    val invitationId: String,
    val organizationId: String,
    val organizationName: String,
    val sourceWebAppUrl: String?,
    val rawUrl: String
)

object OrganizationInviteParser {
    fun canParse(rawText: String?): Boolean {
        val uri = runCatching { Uri.parse(rawText?.trim().orEmpty()) }.getOrNull() ?: return false
        return isOrganizationInvite(uri)
    }

    fun parse(rawText: String?): OrganizationInvite? {
        val trimmed = rawText?.trim().orEmpty()
        val uri = runCatching { Uri.parse(trimmed) }.getOrNull() ?: return null
        if (!isOrganizationInvite(uri)) return null

        val invitationId = value(uri, "invitation_id", "invitationId") ?: return null
        val organizationId = value(uri, "organization_id", "organizationId") ?: return null

        return OrganizationInvite(
            invitationId = invitationId,
            organizationId = organizationId,
            organizationName = value(uri, "organization_name", "organizationName")
                ?: "Vanguard organization",
            sourceWebAppUrl = value(uri, "vanguard_web_app_url"),
            rawUrl = trimmed
        )
    }

    private fun isOrganizationInvite(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase()
        val host = uri.host?.lowercase()
        val path = uri.path?.lowercase().orEmpty()
        // Every flavour registers its own scheme (aegisid, aegisid-dev,
        // aegisid-qa, aegisid-local), so matching the literal "aegisid" would
        // silently reject every invite outside the prod build.
        val isAegisScheme = scheme == BuildConfig.AEGIS_URL_SCHEME.lowercase() ||
            scheme?.startsWith("aegisid") == true
        return isAegisScheme && (host == "org-invite" || path.contains("org-invite"))
    }

    private fun value(uri: Uri, vararg names: String): String? {
        for (name in names) {
            val found = runCatching { uri.getQueryParameter(name) }.getOrNull()
            if (!found.isNullOrBlank()) return found
        }
        return null
    }
}
