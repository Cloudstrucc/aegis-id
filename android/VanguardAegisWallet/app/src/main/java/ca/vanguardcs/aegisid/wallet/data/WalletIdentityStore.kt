package ca.vanguardcs.aegisid.wallet.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject

/**
 * The holder's registered wallet identity.
 *
 * Stored in EncryptedSharedPreferences rather than plain preferences because the
 * Wallet ID and device key identify this wallet to every connected organization.
 * The device key itself is rotated (never restored) during recovery, which is why
 * nothing sensitive has to be backed up anywhere.
 */
data class WalletIdentityRecord(
    val walletId: String,
    val email: String,
    val phone: String?,
    val deviceKeyId: String,
    val registeredAt: Long
) {
    fun toJson(): String = JSONObject().apply {
        put("walletId", walletId)
        put("email", email)
        put("phone", phone ?: "")
        put("deviceKeyId", deviceKeyId)
        put("registeredAt", registeredAt)
    }.toString()

    companion object {
        fun fromJson(raw: String?): WalletIdentityRecord? {
            if (raw.isNullOrBlank()) return null
            return runCatching {
                val json = JSONObject(raw)
                WalletIdentityRecord(
                    walletId = json.getString("walletId"),
                    email = json.optString("email"),
                    phone = json.optString("phone").ifBlank { null },
                    deviceKeyId = json.optString("deviceKeyId"),
                    registeredAt = json.optLong("registeredAt")
                )
            }.getOrNull()
        }
    }
}

class WalletIdentityStore(context: Context) {
    private val preferences = runCatching {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "aegis-wallet-identity",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }.getOrElse {
        // Fall back to standard preferences on devices where the keystore is
        // unavailable, so the wallet still functions.
        context.getSharedPreferences("aegis-wallet-identity", Context.MODE_PRIVATE)
    }

    fun load(): WalletIdentityRecord? =
        WalletIdentityRecord.fromJson(preferences.getString(KEY_IDENTITY, null))

    fun save(record: WalletIdentityRecord) {
        preferences.edit().putString(KEY_IDENTITY, record.toJson()).apply()
    }

    fun clear() {
        preferences.edit().remove(KEY_IDENTITY).apply()
    }

    /** Reuse the device key if present, otherwise create one. */
    fun ensureDeviceKey(): String =
        preferences.getString(KEY_DEVICE_KEY, null) ?: rotateDeviceKey()

    /** Generate a fresh device key, replacing any previous one (used on recovery). */
    fun rotateDeviceKey(): String {
        val bytes = ByteArray(32)
        java.security.SecureRandom().nextBytes(bytes)
        val encoded = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        preferences.edit().putString(KEY_DEVICE_KEY, encoded).apply()
        return encoded
    }

    private companion object {
        const val KEY_IDENTITY = "identity"
        const val KEY_DEVICE_KEY = "deviceKey"
    }
}
