package ca.vanguardcs.aegisid.wallet.model

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class AriesInvitation(
    val id: String,
    val label: String,
    val rawUrl: String,
    val endpoint: String?,
    val organizationId: String?,
    val organizationName: String?,
    val subscriptionId: String?,
    val sourceWebAppUrl: String?,
    val handshakeProtocols: List<String>,
    val services: List<String>,
    val receivedAt: Long = System.currentTimeMillis()
) {
    fun toJson() = JSONObject()
        .put("id", id)
        .put("label", label)
        .put("rawUrl", rawUrl)
        .putOpt("endpoint", endpoint)
        .putOpt("organizationId", organizationId)
        .putOpt("organizationName", organizationName)
        .putOpt("subscriptionId", subscriptionId)
        .putOpt("sourceWebAppUrl", sourceWebAppUrl)
        .put("handshakeProtocols", handshakeProtocols.toJsonArray())
        .put("services", services.toJsonArray())
        .put("receivedAt", receivedAt)

    companion object {
        fun fromJson(json: JSONObject) = AriesInvitation(
            id = json.optString("id"),
            label = json.optString("label", "Aries Invitation"),
            rawUrl = json.optString("rawUrl"),
            endpoint = json.optStringOrNull("endpoint"),
            organizationId = json.optStringOrNull("organizationId"),
            organizationName = json.optStringOrNull("organizationName"),
            subscriptionId = json.optStringOrNull("subscriptionId"),
            sourceWebAppUrl = json.optStringOrNull("sourceWebAppUrl"),
            handshakeProtocols = json.optJSONArray("handshakeProtocols").toStringList(),
            services = json.optJSONArray("services").toStringList(),
            receivedAt = json.optLong("receivedAt", System.currentTimeMillis())
        )
    }
}

data class WalletConnection(
    val id: String = UUID.randomUUID().toString(),
    val invitation: AriesInvitation,
    val state: WalletConnectionState = WalletConnectionState.InvitationReceived,
    val holderConnectionId: String? = null,
    val issuerConnectionId: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
) {
    fun toJson() = JSONObject()
        .put("id", id)
        .put("invitation", invitation.toJson())
        .put("state", state.name)
        .putOpt("holderConnectionId", holderConnectionId)
        .putOpt("issuerConnectionId", issuerConnectionId)
        .put("createdAt", createdAt)
        .put("updatedAt", updatedAt)

    companion object {
        fun fromJson(json: JSONObject) = WalletConnection(
            id = json.optString("id", UUID.randomUUID().toString()),
            invitation = AriesInvitation.fromJson(json.getJSONObject("invitation")),
            state = enumValueOrDefault(json.optString("state"), WalletConnectionState.InvitationReceived),
            holderConnectionId = json.optStringOrNull("holderConnectionId"),
            issuerConnectionId = json.optStringOrNull("issuerConnectionId"),
            createdAt = json.optLong("createdAt", System.currentTimeMillis()),
            updatedAt = json.optLong("updatedAt", System.currentTimeMillis())
        )
    }
}

enum class WalletConnectionState(val title: String) {
    InvitationReceived("Invitation received"),
    ReadyForDidExchange("Ready for DID exchange"),
    Connected("Connected"),
    CredentialOffered("Credential offered"),
    ChallengeReceived("Challenge received"),
    Disabled("Disabled"),
    Failed("Failed")
}

enum class WalletTransactionType(val title: String) {
    Invitation("Invitation"),
    Credential("Credential"),
    Challenge("Challenge")
}

enum class WalletTransactionStatus(val title: String) {
    Received("Received"),
    PendingAcceptance("Pending acceptance"),
    Accepted("Accepted"),
    Sent("Sent"),
    Failed("Failed")
}

data class WalletChallengePayloadField(
    val id: String = UUID.randomUUID().toString(),
    val key: String,
    val value: String
) {
    fun toJson() = JSONObject()
        .put("id", id)
        .put("key", key)
        .put("value", value)

    companion object {
        fun fromJson(json: JSONObject) = WalletChallengePayloadField(
            id = json.optString("id", UUID.randomUUID().toString()),
            key = json.optString("key"),
            value = json.optString("value")
        )
    }
}

data class WalletTransaction(
    val id: String = UUID.randomUUID().toString(),
    val connectionId: String,
    val type: WalletTransactionType,
    val status: WalletTransactionStatus,
    val title: String,
    val detail: String,
    val remoteId: String? = null,
    val webSessionId: String? = null,
    val webAcceptPath: String? = null,
    val requiresPasskey: Boolean = false,
    val requiredAssurance: String? = null,
    val passkeyAcceptPath: String? = null,
    val passkeyEvidenceLabel: String? = null,
    val appName: String? = null,
    val action: String? = null,
    val resourceType: String? = null,
    val resourceId: String? = null,
    val payloadFields: List<WalletChallengePayloadField> = emptyList(),
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
) {
    fun toJson() = JSONObject()
        .put("id", id)
        .put("connectionId", connectionId)
        .put("type", type.name)
        .put("status", status.name)
        .put("title", title)
        .put("detail", detail)
        .putOpt("remoteId", remoteId)
        .putOpt("webSessionId", webSessionId)
        .putOpt("webAcceptPath", webAcceptPath)
        .put("requiresPasskey", requiresPasskey)
        .putOpt("requiredAssurance", requiredAssurance)
        .putOpt("passkeyAcceptPath", passkeyAcceptPath)
        .putOpt("passkeyEvidenceLabel", passkeyEvidenceLabel)
        .putOpt("appName", appName)
        .putOpt("action", action)
        .putOpt("resourceType", resourceType)
        .putOpt("resourceId", resourceId)
        .put("payloadFields", payloadFields.toJsonArray { it.toJson() })
        .put("createdAt", createdAt)
        .put("updatedAt", updatedAt)

    companion object {
        fun fromJson(json: JSONObject) = WalletTransaction(
            id = json.optString("id", UUID.randomUUID().toString()),
            connectionId = json.optString("connectionId"),
            type = enumValueOrDefault(json.optString("type"), WalletTransactionType.Challenge),
            status = enumValueOrDefault(json.optString("status"), WalletTransactionStatus.Received),
            title = json.optString("title"),
            detail = json.optString("detail"),
            remoteId = json.optStringOrNull("remoteId"),
            webSessionId = json.optStringOrNull("webSessionId"),
            webAcceptPath = json.optStringOrNull("webAcceptPath"),
            requiresPasskey = json.optBoolean("requiresPasskey", false),
            requiredAssurance = json.optStringOrNull("requiredAssurance"),
            passkeyAcceptPath = json.optStringOrNull("passkeyAcceptPath"),
            passkeyEvidenceLabel = json.optStringOrNull("passkeyEvidenceLabel"),
            appName = json.optStringOrNull("appName"),
            action = json.optStringOrNull("action"),
            resourceType = json.optStringOrNull("resourceType"),
            resourceId = json.optStringOrNull("resourceId"),
            payloadFields = json.optJSONArray("payloadFields").toObjectList(WalletChallengePayloadField::fromJson),
            createdAt = json.optLong("createdAt", System.currentTimeMillis()),
            updatedAt = json.optLong("updatedAt", System.currentTimeMillis())
        )
    }
}

data class CredentialOrganization(
    val id: String,
    val name: String,
    val connectionCount: Int,
    val credentialCount: Int,
    val challengeCount: Int,
    val latestState: WalletConnectionState,
    val latestUpdatedAt: Long
)

data class WalletChallengeBanner(
    val id: String = UUID.randomUUID().toString(),
    val count: Int,
    val title: String,
    val detail: String
)

data class LabAcceptance(
    val holderConnectionId: String,
    val issuerConnectionId: String?,
    val invitationMessageId: String?,
    val holderState: String,
    val issuerState: String?
) {
    companion object {
        fun fromJson(json: JSONObject) = LabAcceptance(
            holderConnectionId = json.optString("holderConnectionId"),
            issuerConnectionId = json.optStringOrNull("issuerConnectionId"),
            invitationMessageId = json.optStringOrNull("invitationMessageId"),
            holderState = json.optString("holderState", "unknown"),
            issuerState = json.optStringOrNull("issuerState")
        )
    }
}

data class OidcWalletChallenge(
    val sessionId: String,
    val challengeId: String,
    val nonce: String,
    val status: String,
    val connectionId: String,
    val threadId: String?,
    val subject: String,
    val organizationName: String,
    val appName: String?,
    val action: String?,
    val resourceType: String?,
    val resourceId: String?,
    val title: String?,
    val detail: String?,
    val acceptPath: String?,
    val passkeyAcceptPath: String?,
    val requiresPasskey: Boolean,
    val requiredAssurance: String?,
    val payloadFields: List<WalletChallengePayloadField>
) {
    companion object {
        fun fromJson(json: JSONObject) = OidcWalletChallenge(
            sessionId = json.optString("sessionId"),
            challengeId = json.optString("challengeId"),
            nonce = json.optString("nonce"),
            status = json.optString("status"),
            connectionId = json.optString("connectionId"),
            threadId = json.optStringOrNull("threadId"),
            subject = json.optString("subject"),
            organizationName = json.optString("organizationName", "Vanguard Aegis ID"),
            appName = json.optStringOrNull("appName"),
            action = json.optStringOrNull("action"),
            resourceType = json.optStringOrNull("resourceType"),
            resourceId = json.optStringOrNull("resourceId"),
            title = json.optStringOrNull("title"),
            detail = json.optStringOrNull("detail"),
            acceptPath = json.optStringOrNull("acceptPath"),
            passkeyAcceptPath = json.optStringOrNull("passkeyAcceptPath"),
            requiresPasskey = json.optBoolean("requiresPasskey", false),
            requiredAssurance = json.optStringOrNull("requiredAssurance"),
            payloadFields = json.optJSONArray("payloadFields").toObjectList(WalletChallengePayloadField::fromJson)
        )
    }
}

data class WalletPasskeyStatus(
    val subject: String,
    val registered: Boolean,
    val credentialCount: Int
) {
    companion object {
        fun fromJson(json: JSONObject) = WalletPasskeyStatus(
            subject = json.optString("subject"),
            registered = json.optBoolean("registered", false),
            credentialCount = json.optInt("credentialCount", 0)
        )
    }
}

data class OrganizationProfile(
    val organizationId: String,
    val organizationName: String,
    val branding: OrganizationBranding,
    val roles: List<OrganizationRole>,
    val claimDefinitions: List<OrganizationClaimDefinition>,
    val orgUnits: List<OrganizationUnit>,
    val credentials: List<OrganizationCredential>
) {
    fun toJson() = JSONObject()
        .put("organizationId", organizationId)
        .put("organizationName", organizationName)
        .put("branding", branding.toJson())
        .put("roles", roles.toJsonArray { it.toJson() })
        .put("claimDefinitions", claimDefinitions.toJsonArray { it.toJson() })
        .put("orgUnits", orgUnits.toJsonArray { it.toJson() })
        .put("credentials", credentials.toJsonArray { it.toJson() })

    companion object {
        fun fromJson(json: JSONObject) = OrganizationProfile(
            organizationId = json.optString("organizationId"),
            organizationName = json.optString("organizationName", "Organization"),
            branding = OrganizationBranding.fromJson(json.optJSONObject("branding") ?: JSONObject()),
            roles = json.optJSONArray("roles").toObjectList(OrganizationRole::fromJson),
            claimDefinitions = json.optJSONArray("claimDefinitions").toObjectList(OrganizationClaimDefinition::fromJson),
            orgUnits = json.optJSONArray("orgUnits").toObjectList(OrganizationUnit::fromJson),
            credentials = json.optJSONArray("credentials").toObjectList(OrganizationCredential::fromJson)
        )
    }
}

data class OrganizationBranding(
    val paletteId: String,
    val primaryColor: String,
    val accentColor: String,
    val backgroundColor: String,
    val textColor: String,
    val logoDataUrl: String?
) {
    fun toJson() = JSONObject()
        .put("paletteId", paletteId)
        .put("primaryColor", primaryColor)
        .put("accentColor", accentColor)
        .put("backgroundColor", backgroundColor)
        .put("textColor", textColor)
        .putOpt("logoDataUrl", logoDataUrl)

    companion object {
        fun fromJson(json: JSONObject) = OrganizationBranding(
            paletteId = json.optString("paletteId", "default"),
            primaryColor = json.optString("primaryColor", "#1769E0"),
            accentColor = json.optString("accentColor", "#19B97A"),
            backgroundColor = json.optString("backgroundColor", "#F5F9FD"),
            textColor = json.optString("textColor", "#182334"),
            logoDataUrl = json.optStringOrNull("logoDataUrl")
        )
    }
}

data class OrganizationRole(val id: String, val name: String, val description: String?) {
    fun toJson() = JSONObject().put("id", id).put("name", name).putOpt("description", description)

    companion object {
        fun fromJson(json: JSONObject) = OrganizationRole(
            id = json.optString("id", UUID.randomUUID().toString()),
            name = json.optString("name", "Role"),
            description = json.optStringOrNull("description")
        )
    }
}

data class OrganizationClaimDefinition(
    val id: String,
    val key: String,
    val label: String,
    val type: String,
    val required: Boolean,
    val defaultValue: String?
) {
    fun toJson() = JSONObject()
        .put("id", id)
        .put("key", key)
        .put("label", label)
        .put("type", type)
        .put("required", required)
        .putOpt("defaultValue", defaultValue)

    companion object {
        fun fromJson(json: JSONObject) = OrganizationClaimDefinition(
            id = json.optString("id", UUID.randomUUID().toString()),
            key = json.optString("key"),
            label = json.optString("label", json.optString("key")),
            type = json.optString("type", "string"),
            required = json.optBoolean("required", false),
            defaultValue = json.optStringOrNull("defaultValue")
        )
    }
}

data class OrganizationUnit(
    val id: String,
    val name: String,
    val parentId: String?,
    val description: String?,
    val depth: Int
) {
    fun toJson() = JSONObject()
        .put("id", id)
        .put("name", name)
        .putOpt("parentId", parentId)
        .putOpt("description", description)
        .put("depth", depth)

    companion object {
        fun fromJson(json: JSONObject) = OrganizationUnit(
            id = json.optString("id", UUID.randomUUID().toString()),
            name = json.optString("name", "Unit"),
            parentId = json.optStringOrNull("parentId"),
            description = json.optStringOrNull("description"),
            depth = json.optInt("depth", 0)
        )
    }
}

data class OrganizationCredential(
    val id: String,
    val holderEmail: String,
    val displayName: String,
    val status: String,
    val roles: List<OrganizationRole>,
    val claims: Map<String, String>
) {
    fun toJson(): JSONObject {
        val claimsJson = JSONObject()
        claims.forEach { (key, value) -> claimsJson.put(key, value) }
        return JSONObject()
            .put("id", id)
            .put("holderEmail", holderEmail)
            .put("displayName", displayName)
            .put("status", status)
            .put("roles", roles.toJsonArray { it.toJson() })
            .put("claims", claimsJson)
    }

    companion object {
        fun fromJson(json: JSONObject): OrganizationCredential {
            val claimsJson = json.optJSONObject("claims") ?: JSONObject()
            val claims = buildMap {
                val names = claimsJson.keys()
                while (names.hasNext()) {
                    val key = names.next()
                    put(key, claimsJson.optString(key))
                }
            }
            return OrganizationCredential(
                id = json.optString("id", UUID.randomUUID().toString()),
                holderEmail = json.optString("holderEmail"),
                displayName = json.optString("displayName", json.optString("holderEmail")),
                status = json.optString("status", "active"),
                roles = json.optJSONArray("roles").toObjectList(OrganizationRole::fromJson),
                claims = claims
            )
        }
    }
}

fun JSONObject.optStringOrNull(name: String): String? {
    if (!has(name) || isNull(name)) return null
    val value = optString(name).trim()
    return value.ifEmpty { null }
}

fun List<String>.toJsonArray(): JSONArray = JSONArray().also { array ->
    forEach { array.put(it) }
}

fun <T> List<T>.toJsonArray(transform: (T) -> JSONObject): JSONArray = JSONArray().also { array ->
    forEach { array.put(transform(it)) }
}

fun JSONArray?.toStringList(): List<String> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { index -> optString(index).takeIf { it.isNotBlank() } }
}

fun <T> JSONArray?.toObjectList(transform: (JSONObject) -> T): List<T> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { index ->
        optJSONObject(index)?.let(transform)
    }
}

inline fun <reified T : Enum<T>> enumValueOrDefault(value: String?, fallback: T): T {
    return enumValues<T>().firstOrNull { it.name == value } ?: fallback
}
