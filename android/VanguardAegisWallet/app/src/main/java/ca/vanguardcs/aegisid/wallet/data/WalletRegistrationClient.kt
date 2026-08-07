package ca.vanguardcs.aegisid.wallet.data

import ca.vanguardcs.aegisid.wallet.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Product-path client for wallet identity, contact changes, recovery, and
 * organization/credential acceptance.
 *
 * Everything here talks to the Aegis web app directly. Unlike LabAgentClient it
 * never depends on ACA-Py, so these flows work against any deployment where the
 * Aries lab is not running.
 */
class WalletRegistrationClient(
    private val baseUrl: String = BuildConfig.AEGIS_WEB_APP_BASE_URL.trimEnd('/'),
    /** Requests time out so a screen can never hang indefinitely. */
    private val timeoutMs: Int = 20_000
) {
    data class RegistrationResult(val walletId: String, val email: String, val phone: String?)

    data class RecoveryOptions(
        val walletId: String,
        val canUseCodes: Boolean,
        val remainingCodes: Int,
        val canUseOrgAttestation: Boolean,
        val connectedOrgIds: List<String>,
        val hardStop: Boolean
    )

    data class RecoveryRequest(
        val id: String,
        val walletId: String,
        val tier: String?,
        val status: String,
        val otpVerified: Boolean
    )

    data class RecoveryCompletion(
        val walletId: String,
        val restoreScope: String,
        val suspendsHighAssurance: Boolean
    )

    // --- Registration --------------------------------------------------------

    suspend fun register(
        email: String,
        phone: String?,
        devicePublicKey: String,
        displayName: String? = null
    ): RegistrationResult = post(
        "/api/wallet/register",
        JSONObject()
            .put("email", email)
            .put("phone", phone.orEmpty())
            .put("devicePublicKey", devicePublicKey)
            .put("displayName", displayName.orEmpty())
    ).toRegistration()

    /**
     * Fetch the wallet profile. Throws [WalletNotFoundException] when the server
     * has no such wallet, which the app uses to detect a stale local identity.
     */
    suspend fun fetchProfile(walletId: String): RegistrationResult =
        get("/api/wallet/$walletId/profile").toRegistration()

    suspend fun generateRecoveryCodes(walletId: String): List<String> {
        val response = post("/api/wallet/$walletId/recovery-codes/regenerate", JSONObject())
        val codes = response.optJSONArray("codes") ?: return emptyList()
        return (0 until codes.length()).mapNotNull { codes.optString(it).ifBlank { null } }
    }

    // --- Organization and credential acceptance ------------------------------

    suspend fun acceptOrganizationInvitation(
        invitationId: String,
        walletId: String,
        sourceWebAppUrl: String? = null
    ) {
        post(
            "/api/wallet/organization-invitations/$invitationId/accept",
            JSONObject().put("walletId", walletId).put("source", "android-wallet"),
            sourceWebAppUrl
        )
    }

    suspend fun acceptCredentialInvitation(
        credentialId: String,
        organizationId: String,
        walletId: String,
        sourceWebAppUrl: String? = null
    ) {
        post(
            "/api/wallet/credential-invitations/$credentialId/accept",
            JSONObject()
                .put("organizationId", organizationId)
                .put("walletId", walletId)
                .put("source", "android-wallet"),
            sourceWebAppUrl
        )
    }

    // --- Root wallets and break glass ----------------------------------------

    /**
     * Confirm this device's nomination as a root wallet.
     *
     * Both values come from the link: the organization nominated a specific
     * Wallet ID, and the token bound to it is the whole authorization — which
     * is why nominating alone grants nothing.
     */
    suspend fun confirmRootWallet(
        walletId: String,
        token: String,
        sourceWebAppUrl: String? = null
    ): String {
        val response = get(
            "/api/root-wallets/confirm",
            mapOf("wallet_id" to walletId, "token" to token),
            sourceWebAppUrl
        )
        return response.optString("message").ifBlank {
            "This wallet can now recover control of the organization."
        }
    }

    /**
     * Authorise a break-glass code as a root wallet of the organization.
     *
     * [walletId] is **this device's own**, never one carried in the link. Any of
     * the organization's confirmed root wallets may authorise, so the link
     * cannot name one; supplying our own is what makes the authorisation
     * evidence that a root wallet agreed rather than that somebody had a URL.
     */
    suspend fun authoriseBreakGlass(
        walletId: String,
        token: String,
        sourceWebAppUrl: String? = null
    ): String {
        val response = get(
            "/api/break-glass/authorise",
            mapOf("wallet_id" to walletId, "token" to token),
            sourceWebAppUrl
        )
        return response.optString("message").ifBlank {
            "The organization can now be recovered with this code if every root wallet is lost."
        }
    }

    /**
     * Approve an administrator's recovery as a root wallet.
     *
     * Same shape as break-glass: the token says which request, and [walletId] —
     * **this device's own** — says who approved. The token was minted for this
     * wallet alone, so two approvals genuinely mean two devices.
     */
    suspend fun approveAccountRecovery(
        walletId: String,
        requestId: String,
        token: String,
        sourceWebAppUrl: String? = null
    ): String {
        val response = get(
            "/api/account-recovery/approve",
            mapOf("wallet_id" to walletId, "request_id" to requestId, "token" to token),
            sourceWebAppUrl
        )
        return response.optString("message").ifBlank {
            "Approved. ${response.optInt("approvalCount")} of ${response.optInt("approvalsRequired")} approvals."
        }
    }

    // --- Contact changes (challenge gated) -----------------------------------

    suspend fun startContactChange(walletId: String, field: String, value: String): String =
        post(
            "/api/wallet/$walletId/contact/challenge",
            JSONObject().put("field", field).put("value", value)
        ).optString("id")

    suspend fun resolveContactChange(challengeId: String, approve: Boolean) {
        post(
            "/api/wallet/contact/challenges/$challengeId/resolve",
            JSONObject().put("decision", if (approve) "approve" else "decline")
        )
    }

    // --- Recovery ------------------------------------------------------------

    suspend fun recoveryOptions(walletId: String): RecoveryOptions {
        val json = get("/api/wallet/$walletId/recovery-options")
        val orgIds = json.optJSONArray("connectedOrgIds")
        return RecoveryOptions(
            walletId = json.optString("walletId"),
            canUseCodes = json.optBoolean("canUseCodes"),
            remainingCodes = json.optInt("remainingCodes"),
            canUseOrgAttestation = json.optBoolean("canUseOrgAttestation"),
            connectedOrgIds = (0 until (orgIds?.length() ?: 0)).mapNotNull { orgIds?.optString(it) },
            hardStop = json.optBoolean("hardStop")
        )
    }

    suspend fun startRecovery(walletId: String?, email: String?): RecoveryRequest {
        val response = post(
            "/api/wallet/recovery/start",
            JSONObject().put("walletId", walletId.orEmpty()).put("email", email.orEmpty())
        )
        return response.optJSONObject("request").toRecoveryRequest()
    }

    suspend fun verifyRecoveryOtp(requestId: String, otp: String): RecoveryRequest =
        post("/api/wallet/recovery/$requestId/verify-otp", JSONObject().put("otp", otp))
            .toRecoveryRequest()

    suspend fun redeemRecoveryCode(requestId: String, code: String): RecoveryRequest =
        post("/api/wallet/recovery/$requestId/redeem-code", JSONObject().put("code", code))
            .toRecoveryRequest()

    suspend fun requestOrgAttestation(requestId: String, organizationId: String): RecoveryRequest =
        post(
            "/api/wallet/recovery/$requestId/request-attestation",
            JSONObject().put("organizationId", organizationId)
        ).toRecoveryRequest()

    suspend fun recoveryStatus(requestId: String): RecoveryRequest =
        get("/api/wallet/recovery/$requestId/status").toRecoveryRequest()

    suspend fun completeRecovery(requestId: String, devicePublicKey: String): RecoveryCompletion {
        val json = post(
            "/api/wallet/recovery/$requestId/complete",
            JSONObject().put("devicePublicKey", devicePublicKey)
        )
        return RecoveryCompletion(
            walletId = json.optString("walletId"),
            restoreScope = json.optString("restoreScope"),
            suspendsHighAssurance = json.optBoolean("suspendsHighAssurance")
        )
    }

    suspend fun cancelRecovery(requestId: String) {
        post("/api/wallet/recovery/$requestId/cancel", JSONObject())
    }

    // --- Transport -----------------------------------------------------------

    private fun JSONObject.toRegistration() = RegistrationResult(
        walletId = optString("walletId"),
        email = optString("email"),
        phone = optString("phone").ifBlank { null }
    )

    private fun JSONObject?.toRecoveryRequest(): RecoveryRequest {
        val json = this ?: JSONObject()
        return RecoveryRequest(
            id = json.optString("id"),
            walletId = json.optString("walletId"),
            tier = json.optString("tier").ifBlank { null },
            status = json.optString("status"),
            otpVerified = json.optBoolean("otpVerified")
        )
    }

    private suspend fun get(path: String, sourceWebAppUrl: String? = null): JSONObject =
        request("GET", path, null, sourceWebAppUrl)

    private suspend fun get(
        path: String,
        query: Map<String, String>,
        sourceWebAppUrl: String? = null
    ): JSONObject {
        val encoded = query.entries.joinToString("&") { (name, value) ->
            "${URLEncoder.encode(name, "UTF-8")}=${URLEncoder.encode(value, "UTF-8")}"
        }
        return request("GET", if (encoded.isEmpty()) path else "$path?$encoded", null, sourceWebAppUrl)
    }

    private suspend fun post(path: String, body: JSONObject, sourceWebAppUrl: String? = null): JSONObject =
        request("POST", path, body, sourceWebAppUrl)

    private suspend fun request(
        method: String,
        path: String,
        body: JSONObject?,
        sourceWebAppUrl: String?
    ): JSONObject = withContext(Dispatchers.IO) {
        val connection = (URL(portalUrl(sourceWebAppUrl) + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = timeoutMs
            readTimeout = timeoutMs
            setRequestProperty("Accept", "application/json")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }

        try {
            if (body != null) {
                connection.outputStream.use { it.write(body.toString().toByteArray()) }
            }

            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()

            if (status !in 200..299) {
                val message = runCatching {
                    JSONObject(text).optJSONObject("error")?.optString("message")
                }.getOrNull().orEmpty().ifBlank { "Request failed ($status)." }

                // 404 means the server genuinely does not know this resource,
                // which callers treat differently from a transport failure.
                if (status == 404) throw WalletNotFoundException(message)
                throw WalletRegistrationException(message)
            }

            if (text.isBlank()) JSONObject() else runCatching { JSONObject(text) }.getOrElse { JSONObject() }
        } finally {
            connection.disconnect()
        }
    }

    private fun portalUrl(sourceWebAppUrl: String?): String {
        val candidate = sourceWebAppUrl?.trim().orEmpty()
        if (candidate.isEmpty()) return baseUrl
        val host = runCatching { URL(candidate).host }.getOrNull()
        return if (host.isNullOrBlank()) baseUrl else candidate.trimEnd('/')
    }
}

open class WalletRegistrationException(message: String) : Exception(message)

/** The server does not know this wallet — distinct from being offline. */
class WalletNotFoundException(message: String) : WalletRegistrationException(message)

/** An invitation addressed to a wallet other than this one. */
class WalletMismatchException :
    WalletRegistrationException("This invitation is for a different wallet.")
