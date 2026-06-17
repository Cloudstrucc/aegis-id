package ca.vanguardcs.aegisid.wallet.data

import ca.vanguardcs.aegisid.wallet.BuildConfig
import ca.vanguardcs.aegisid.wallet.model.LabAcceptance
import ca.vanguardcs.aegisid.wallet.model.OidcWalletChallenge
import ca.vanguardcs.aegisid.wallet.model.OrganizationProfile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class LabAgentClient(
    private val baseUrl: String = BuildConfig.AEGIS_WEB_APP_BASE_URL.trimEnd('/')
) {
    suspend fun acceptInvitation(rawUrl: String): LabAcceptance {
        val payload = JSONObject().put("rawInvitationUrl", rawUrl)
        return LabAcceptance.fromJson(postJson("/api/wallet-lab/accept-invitation", payload))
    }

    suspend fun issueMockCredential(issuerConnectionId: String, subjectEmail: String) {
        postJson(
            "/api/wallet-lab/issuer-mock-credential",
            JSONObject()
                .put("issuerConnectionId", issuerConnectionId)
                .put("subjectEmail", subjectEmail)
        )
    }

    suspend fun sendChallenge(issuerConnectionId: String): String? {
        return postJson(
            "/api/wallet-lab/issuer-challenge",
            JSONObject().put("issuerConnectionId", issuerConnectionId)
        ).optString("threadId").takeIf { it.isNotBlank() }
    }

    suspend fun sendHolderMessage(holderConnectionId: String, content: String) {
        postJson(
            "/api/wallet-lab/holder-message",
            JSONObject()
                .put("holderConnectionId", holderConnectionId)
                .put("content", content)
        )
    }

    suspend fun fetchOidcWalletChallenges(issuerConnectionId: String): List<OidcWalletChallenge> {
        val encoded = URLEncoder.encode(issuerConnectionId, Charsets.UTF_8.name())
        val response = getJson("/api/oidc-wallet/challenges?connectionId=$encoded")
        val challenges = response.optJSONArray("challenges") ?: return emptyList()
        return (0 until challenges.length()).mapNotNull { index ->
            challenges.optJSONObject(index)?.let(OidcWalletChallenge::fromJson)
        }
    }

    suspend fun acceptOidcWalletChallenge(sessionId: String) {
        val encoded = URLEncoder.encode(sessionId, Charsets.UTF_8.name())
        postJson("/api/oidc-wallet/challenges/$encoded/accept", JSONObject())
    }

    suspend fun acceptWalletChallenge(acceptPath: String) {
        postJson(resolvePathOrUrl(acceptPath), JSONObject().put("source", "android-wallet"))
    }

    suspend fun registerIssuerOrganizationConnection(
        organizationId: String,
        holderConnectionId: String,
        issuerConnectionId: String?,
        invitationId: String?
    ) {
        val encoded = URLEncoder.encode(organizationId, Charsets.UTF_8.name())
        postJson(
            "/api/issuer-organizations/$encoded/connections",
            JSONObject()
                .put("holderConnectionId", holderConnectionId)
                .put("issuerConnectionId", issuerConnectionId)
                .put("invitationId", invitationId)
        )
    }

    suspend fun fetchOrganizationProfile(organizationId: String): OrganizationProfile {
        val encoded = URLEncoder.encode(organizationId, Charsets.UTF_8.name())
        return OrganizationProfile.fromJson(getJson("/api/organizations/$encoded/profile"))
    }

    private fun resolvePathOrUrl(value: String): String {
        val trimmed = value.trim()
        return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            trimmed
        } else {
            "/${trimmed.trimStart('/')}"
        }
    }

    private suspend fun getJson(pathOrUrl: String): JSONObject = requestJson("GET", pathOrUrl, null)

    private suspend fun postJson(pathOrUrl: String, payload: JSONObject): JSONObject =
        requestJson("POST", pathOrUrl, payload)

    private suspend fun requestJson(method: String, pathOrUrl: String, payload: JSONObject?): JSONObject =
        withContext(Dispatchers.IO) {
            val url = URL(if (pathOrUrl.startsWith("http")) pathOrUrl else "$baseUrl$pathOrUrl")
            val connection = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 12_000
                readTimeout = 20_000
                setRequestProperty("Accept", "application/json")
                if (payload != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    outputStream.use { stream ->
                        stream.write(payload.toString().toByteArray(Charsets.UTF_8))
                    }
                }
            }

            val status = connection.responseCode
            val body = try {
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            } finally {
                connection.disconnect()
            }

            if (status !in 200..299) {
                throw IOException(parseErrorMessage(body, status))
            }

            if (body.isBlank()) JSONObject() else JSONObject(body)
        }

    private fun parseErrorMessage(body: String, status: Int): String {
        if (body.isBlank()) return "Aegis ID returned HTTP $status."
        return try {
            val json = JSONObject(body)
            json.optJSONObject("error")?.optString("message")?.takeIf { it.isNotBlank() }
                ?: json.optString("message").takeIf { it.isNotBlank() }
                ?: "Aegis ID returned HTTP $status."
        } catch (_: Exception) {
            body.take(500)
        }
    }
}
