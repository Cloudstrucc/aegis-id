package ca.vanguardcs.aegisid.wallet.data

import android.net.Uri
import android.util.Base64
import ca.vanguardcs.aegisid.wallet.model.AriesInvitation
import org.json.JSONArray
import org.json.JSONObject

object OobInvitationParser {
    fun parse(rawText: String): AriesInvitation {
        val normalized = normalizeInvitationUrl(rawText.trim())
        val uri = Uri.parse(normalized)
        val encoded = uri.getQueryParameter("oob")
            ?: throw InvitationParseException("Paste an Aries out-of-band invitation URL containing an oob parameter.")
        val payload = JSONObject(String(decodeBase64Url(encoded), Charsets.UTF_8))
        val endpoint = uri.getQueryParameter("endpoint") ?: endpointDescription(uri)

        return AriesInvitation(
            id = payload.optString("@id"),
            label = payload.optString("label", "Aries Invitation"),
            rawUrl = normalized,
            endpoint = endpoint,
            organizationId = queryValue(uri, "vanguard_org_id", "cloudstrucc_org_id"),
            organizationName = queryValue(uri, "vanguard_org_name", "cloudstrucc_org_name"),
            subscriptionId = queryValue(uri, "vanguard_subscription_id", "cloudstrucc_subscription_id"),
            handshakeProtocols = payload.optJSONArray("handshake_protocols").stringList(),
            services = payload.optJSONArray("services").serviceList()
        )
    }

    private fun normalizeInvitationUrl(value: String): String {
        val uri = Uri.parse(value)
        if (uri.getQueryParameter("oob") != null) {
            return value
        }

        val wrappedNames = listOf("invitation", "invitation_url", "invitationUrl", "url", "requestUrl")
        for (name in wrappedNames) {
            val wrapped = uri.getQueryParameter(name) ?: continue
            val wrappedUri = Uri.parse(wrapped)
            if (wrappedUri.getQueryParameter("oob") != null) {
                return wrapped
            }
        }

        throw InvitationParseException("Paste an Aries out-of-band invitation URL containing an oob parameter.")
    }

    private fun decodeBase64Url(value: String): ByteArray {
        val padded = value.padEnd(value.length + ((4 - value.length % 4) % 4), '=')
        return try {
            Base64.decode(padded, Base64.URL_SAFE or Base64.NO_WRAP)
        } catch (error: IllegalArgumentException) {
            throw InvitationParseException("The out-of-band invitation could not be decoded.")
        }
    }

    private fun endpointDescription(uri: Uri): String? {
        val scheme = uri.scheme ?: return null
        val host = uri.host ?: return null
        val port = uri.port.takeIf { it != -1 }
        return if (port == null) "$scheme://$host" else "$scheme://$host:$port"
    }

    private fun queryValue(uri: Uri, vararg names: String): String? {
        for (name in names) {
            val value = uri.getQueryParameter(name)
            if (!value.isNullOrBlank()) {
                return value
            }
        }
        return null
    }
}

class InvitationParseException(message: String) : IllegalArgumentException(message)

private fun JSONArray?.stringList(): List<String> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { index ->
        optString(index).takeIf { it.isNotBlank() }
    }
}

private fun JSONArray?.serviceList(): List<String> {
    if (this == null) return emptyList()
    return (0 until length()).map { index ->
        val item = opt(index)
        when (item) {
            is String -> item
            is JSONObject -> item.optString("serviceEndpoint", item.optString("id", "service"))
            else -> "service"
        }
    }
}
