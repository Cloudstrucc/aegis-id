package ca.vanguardcs.aegisid.wallet.passkey

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject

/**
 * One passkey this wallet holds for one relying party.
 *
 * The private key is not here — it is in the Android keystore, keyed by
 * credentialId. This is the part the holder can be shown: which site, which
 * account, when it was made and when it was last used.
 */
data class StoredPasskey(
    val credentialId: String,
    val rpId: String,
    val rpName: String,
    val userHandle: String,
    val userName: String,
    val userDisplayName: String,
    val signCount: Int,
    val createdAt: Long,
    val lastUsedAt: Long?
) {
    val credentialIdBytes: ByteArray get() = Base64Url.decode(credentialId)
    val userHandleBytes: ByteArray get() = Base64Url.decode(userHandle)

    /** What to show when a site sent no display name, which many do not. */
    val accountLabel: String
        get() = when {
            userDisplayName.isNotBlank() -> userDisplayName
            userName.isNotBlank() -> userName
            else -> rpId
        }

    fun toJson(): JSONObject = JSONObject().apply {
        put("credentialId", credentialId)
        put("rpId", rpId)
        put("rpName", rpName)
        put("userHandle", userHandle)
        put("userName", userName)
        put("userDisplayName", userDisplayName)
        put("signCount", signCount)
        put("createdAt", createdAt)
        put("lastUsedAt", lastUsedAt ?: JSONObject.NULL)
    }

    companion object {
        fun fromJson(json: JSONObject) = StoredPasskey(
            credentialId = json.optString("credentialId"),
            rpId = json.optString("rpId"),
            rpName = json.optString("rpName"),
            userHandle = json.optString("userHandle"),
            userName = json.optString("userName"),
            userDisplayName = json.optString("userDisplayName"),
            signCount = json.optInt("signCount"),
            createdAt = json.optLong("createdAt"),
            lastUsedAt = if (json.isNull("lastUsedAt")) null else json.optLong("lastUsedAt")
        )
    }
}

/**
 * The passkeys, in encrypted preferences.
 *
 * Two entry points read this: the app, to list them, and the credential
 * provider service, which the system binds to on its own whenever a site asks
 * for a passkey. Both are the same process here, unlike iOS, but the store is
 * still kept apart from wallet identity because the two have nothing to do with
 * each other — these are credentials for other people's services.
 */
class PasskeyStore(context: Context) {
    private val preferences = runCatching {
        EncryptedSharedPreferences.create(
            context,
            "aegis-passkeys",
            MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }.getOrElse {
        // Same fallback the identity store uses: on a device where the keystore
        // is unavailable the wallet still functions rather than refusing to run.
        context.getSharedPreferences("aegis-passkeys", Context.MODE_PRIVATE)
    }

    fun all(): List<StoredPasskey> {
        val raw = preferences.getString(KEY, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            (0 until array.length()).map { StoredPasskey.fromJson(array.getJSONObject(it)) }
        }.getOrElse { emptyList() }
    }

    /** Every passkey for a relying party, most recently used first. */
    fun forRpId(rpId: String): List<StoredPasskey> =
        all()
            .filter { it.rpId.equals(rpId, ignoreCase = true) }
            .sortedByDescending { it.lastUsedAt ?: it.createdAt }

    fun byCredentialId(credentialId: String): StoredPasskey? =
        all().firstOrNull { it.credentialId == credentialId }

    fun save(passkey: StoredPasskey) = mutate { records ->
        records.removeAll { it.credentialId == passkey.credentialId }
        records.add(passkey)
    }

    /**
     * Record a use and move the counter on.
     *
     * The signature counter is how a relying party spots a cloned
     * authenticator: it must never go backwards for a given credential, so it
     * is incremented here on every assertion rather than derived from anything
     * that could be replayed.
     */
    fun recordUse(credentialId: String): Int {
        var next = 0
        mutate { records ->
            val index = records.indexOfFirst { it.credentialId == credentialId }
            if (index >= 0) {
                val current = records[index]
                next = current.signCount + 1
                records[index] = current.copy(signCount = next, lastUsedAt = System.currentTimeMillis())
            }
        }
        return next
    }

    /**
     * Forget a passkey, key included.
     *
     * The relying party still believes it exists — deleting here cannot tell
     * them — so the interface has to say that plainly rather than implying the
     * account has been cleaned up.
     */
    fun delete(credentialId: String) {
        PasskeyAuthenticator.deleteKey(Base64Url.decode(credentialId))
        mutate { records -> records.removeAll { it.credentialId == credentialId } }
    }

    private fun mutate(change: (MutableList<StoredPasskey>) -> Unit) {
        val records = all().toMutableList()
        change(records)
        val array = JSONArray()
        records.forEach { array.put(it.toJson()) }
        preferences.edit().putString(KEY, array.toString()).apply()
    }

    private companion object {
        const val KEY = "passkeys"
    }
}
