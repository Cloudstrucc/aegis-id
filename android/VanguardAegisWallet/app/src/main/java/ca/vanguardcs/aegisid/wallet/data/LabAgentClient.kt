package ca.vanguardcs.aegisid.wallet.data

import ca.vanguardcs.aegisid.wallet.BuildConfig
import ca.vanguardcs.aegisid.wallet.model.LabAcceptance
import ca.vanguardcs.aegisid.wallet.model.OidcWalletChallenge
import ca.vanguardcs.aegisid.wallet.model.OrganizationProfile
import ca.vanguardcs.aegisid.wallet.model.WalletPasskeyStatus
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
    suspend fun acceptInvitation(rawUrl: String, sourceWebAppUrl: String? = null): LabAcceptance {
        val payload = JSONObject().put("rawInvitationUrl", rawUrl)
        return LabAcceptance.fromJson(postJson("/api/wallet-lab/accept-invitation", payload, sourceWebAppUrl))
    }

    suspend fun issueMockCredential(issuerConnectionId: String, subjectEmail: String, sourceWebAppUrl: String? = null) {
        postJson(
            "/api/wallet-lab/issuer-mock-credential",
            JSONObject()
                .put("issuerConnectionId", issuerConnectionId)
                .put("subjectEmail", subjectEmail),
            sourceWebAppUrl
        )
    }

    suspend fun sendChallenge(issuerConnectionId: String, sourceWebAppUrl: String? = null): String? {
        return postJson(
            "/api/wallet-lab/issuer-challenge",
            JSONObject().put("issuerConnectionId", issuerConnectionId),
            sourceWebAppUrl
        ).optString("threadId").takeIf { it.isNotBlank() }
    }

    suspend fun sendHolderMessage(holderConnectionId: String, content: String, sourceWebAppUrl: String? = null) {
        postJson(
            "/api/wallet-lab/holder-message",
            JSONObject()
                .put("holderConnectionId", holderConnectionId)
                .put("content", content),
            sourceWebAppUrl
        )
    }

    suspend fun fetchOidcWalletChallenges(issuerConnectionId: String, sourceWebAppUrl: String? = null): List<OidcWalletChallenge> {
        val encoded = URLEncoder.encode(issuerConnectionId, Charsets.UTF_8.name())
        val response = getJson("/api/oidc-wallet/challenges?connectionId=$encoded", sourceWebAppUrl)
        val challenges = response.optJSONArray("challenges") ?: return emptyList()
        return (0 until challenges.length()).mapNotNull { index ->
            challenges.optJSONObject(index)?.let(OidcWalletChallenge::fromJson)
        }
    }

    suspend fun acceptOidcWalletChallenge(sessionId: String, sourceWebAppUrl: String? = null) {
        val encoded = URLEncoder.encode(sessionId, Charsets.UTF_8.name())
        postJson("/api/oidc-wallet/challenges/$encoded/accept", JSONObject(), sourceWebAppUrl)
    }

    suspend fun acceptWalletChallenge(acceptPath: String, sourceWebAppUrl: String? = null) {
        postJson(resolvePathOrUrl(acceptPath, sourceWebAppUrl), JSONObject().put("source", "android-wallet"), sourceWebAppUrl)
    }

    suspend fun acceptWalletChallengeWithPasskey(
        acceptPath: String,
        subject: String,
        challengeId: String,
        passkeyResponse: JSONObject,
        sourceWebAppUrl: String? = null
    ) {
        postJson(
            resolvePathOrUrl(acceptPath, sourceWebAppUrl),
            JSONObject()
                .put("source", "android-wallet")
                .put("subject", subject)
                .put("challengeId", challengeId)
                .put("passkeyResponse", passkeyResponse),
            sourceWebAppUrl
        )
    }

    suspend fun fetchWalletPasskeyStatus(subject: String): WalletPasskeyStatus {
        val encoded = URLEncoder.encode(subject, Charsets.UTF_8.name())
        return WalletPasskeyStatus.fromJson(getJson("/api/wallet/passkeys/status?subject=$encoded"))
    }

    suspend fun startWalletPasskeyRegistration(subject: String, displayName: String): JSONObject {
        return postJson(
            "/api/wallet/passkeys/register/options",
            JSONObject()
                .put("subject", subject)
                .put("displayName", displayName)
        ).getJSONObject("options")
    }

    suspend fun finishWalletPasskeyRegistration(subject: String, response: JSONObject): WalletPasskeyStatus {
        return WalletPasskeyStatus.fromJson(
            postJson(
                "/api/wallet/passkeys/register/verify",
                JSONObject()
                    .put("subject", subject)
                    .put("response", response)
            ).getJSONObject("status")
        )
    }

    suspend fun startWalletPasskeyAuthentication(subject: String, challengeId: String, sourceWebAppUrl: String? = null): JSONObject {
        return postJson(
            "/api/wallet/passkeys/authenticate/options",
            JSONObject()
                .put("subject", subject)
                .put("challengeId", challengeId),
            sourceWebAppUrl
        ).getJSONObject("options")
    }

    suspend fun finishWalletPasskeyAuthentication(subject: String, challengeId: String, response: JSONObject, sourceWebAppUrl: String? = null): JSONObject {
        return postJson(
            "/api/wallet/passkeys/authenticate/verify",
            JSONObject()
                .put("subject", subject)
                .put("challengeId", challengeId)
                .put("response", response),
            sourceWebAppUrl
        )
    }

    suspend fun registerIssuerOrganizationConnection(
        organizationId: String,
        holderConnectionId: String,
        issuerConnectionId: String?,
        invitationId: String?,
        sourceWebAppUrl: String? = null
    ) {
        val encoded = URLEncoder.encode(organizationId, Charsets.UTF_8.name())
        postJson(
            "/api/issuer-organizations/$encoded/connections",
            JSONObject()
                .put("holderConnectionId", holderConnectionId)
                .put("issuerConnectionId", issuerConnectionId)
                .put("invitationId", invitationId),
            sourceWebAppUrl
        )
    }

    suspend fun fetchOrganizationProfile(organizationId: String, sourceWebAppUrl: String? = null): OrganizationProfile {
        val encoded = URLEncoder.encode(organizationId, Charsets.UTF_8.name())
        return OrganizationProfile.fromJson(getJson("/api/organizations/$encoded/profile", sourceWebAppUrl))
    }

    suspend fun acceptCredentialInvitation(credentialId: String, organizationId: String, holderEmail: String?, sourceWebAppUrl: String? = null) {
        val encoded = URLEncoder.encode(credentialId, Charsets.UTF_8.name())
        postJson(
            "/api/wallet/credential-invitations/$encoded/accept",
            JSONObject()
                .put("organizationId", organizationId)
                .put("holderEmail", holderEmail)
                .put("source", "android-wallet"),
            sourceWebAppUrl
        )
    }

    private fun resolvePathOrUrl(value: String, sourceWebAppUrl: String? = null): String {
        val trimmed = value.trim()
        return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            trimmed
        } else {
            "${effectiveBaseUrl(sourceWebAppUrl)}/${trimmed.trimStart('/')}"
        }
    }

    private suspend fun getJson(pathOrUrl: String, sourceWebAppUrl: String? = null): JSONObject =
        requestJson("GET", pathOrUrl, null, sourceWebAppUrl)

    private suspend fun postJson(pathOrUrl: String, payload: JSONObject, sourceWebAppUrl: String? = null): JSONObject =
        requestJson("POST", pathOrUrl, payload, sourceWebAppUrl)

    private suspend fun requestJson(method: String, pathOrUrl: String, payload: JSONObject?, sourceWebAppUrl: String? = null): JSONObject =
        withContext(Dispatchers.IO) {
            val url = URL(if (pathOrUrl.startsWith("http")) pathOrUrl else "${effectiveBaseUrl(sourceWebAppUrl)}$pathOrUrl")
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

    private fun effectiveBaseUrl(sourceWebAppUrl: String?): String {
        val candidate = sourceWebAppUrl?.trim()?.trimEnd('/')
        return if (candidate?.startsWith("http://") == true || candidate?.startsWith("https://") == true) {
            candidate
        } else {
            baseUrl
        }
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
