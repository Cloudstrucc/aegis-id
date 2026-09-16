package ca.vanguardcs.aegisid.wallet.data

import android.content.Context
import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * How the wallet is locked between uses.
 *
 * A wallet holds credentials and can approve sign-ins with a tap, so the app
 * itself needs a lock — the phone being unlocked is not the same as *this
 * person* being at the wallet. Two choices, set during setup: a numeric PIN
 * this app checks (a salted, iterated hash, never the PIN), or the device's
 * own biometric / screen lock via BiometricPrompt.
 */
enum class WalletLockMethod { NONE, PIN, BIOMETRIC }

class WalletLock(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("vanguard-aegis-wallet-lock", Context.MODE_PRIVATE)

    val method: WalletLockMethod
        get() = when (prefs.getString(KEY_METHOD, null)) {
            "pin" -> WalletLockMethod.PIN
            "biometric" -> WalletLockMethod.BIOMETRIC
            else -> WalletLockMethod.NONE
        }

    val isConfigured: Boolean get() = method != WalletLockMethod.NONE

    fun setPin(pin: String) {
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        prefs.edit()
            .putString(KEY_METHOD, "pin")
            .putString(KEY_SALT, Base64.encodeToString(salt, Base64.NO_WRAP))
            .putString(KEY_HASH, Base64.encodeToString(derive(pin, salt), Base64.NO_WRAP))
            .apply()
    }

    fun setBiometric() {
        prefs.edit()
            .putString(KEY_METHOD, "biometric")
            .remove(KEY_SALT)
            .remove(KEY_HASH)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    fun verifyPin(pin: String): Boolean {
        val salt = prefs.getString(KEY_SALT, null)?.let { Base64.decode(it, Base64.NO_WRAP) } ?: return false
        val expected = prefs.getString(KEY_HASH, null)?.let { Base64.decode(it, Base64.NO_WRAP) } ?: return false
        return constantTimeEquals(derive(pin, salt), expected)
    }

    private fun derive(pin: String, salt: ByteArray): ByteArray {
        // Iterated SHA-256 over salt||pin. A PIN's strength comes mostly from the
        // app container's protection and the attempt limit; this makes an
        // offline guess of a leaked blob costly rather than instant.
        val digest = MessageDigest.getInstance("SHA-256")
        var value = salt + pin.toByteArray(Charsets.UTF_8)
        repeat(ITERATIONS) { value = digest.digest(value) }
        return value
    }

    private fun constantTimeEquals(a: ByteArray, b: ByteArray): Boolean {
        if (a.size != b.size) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].toInt() xor b[i].toInt())
        return diff == 0
    }

    companion object {
        private const val KEY_METHOD = "method"
        private const val KEY_SALT = "salt"
        private const val KEY_HASH = "hash"
        private const val ITERATIONS = 120_000
    }
}
