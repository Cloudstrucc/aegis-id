package ca.vanguardcs.aegisid.wallet.data

import android.net.Uri

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
        return scheme == "aegisid" && (host == "org-invite" || path.contains("org-invite"))
    }

    private fun value(uri: Uri, vararg names: String): String? {
        for (name in names) {
            val found = runCatching { uri.getQueryParameter(name) }.getOrNull()
            if (!found.isNullOrBlank()) return found
        }
        return null
    }
}
