package ca.vanguardcs.aegisid.wallet.passkey

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.ByteArrayOutputStream
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

/**
 * The wallet acting as a FIDO2 authenticator.
 *
 * Everything a relying party needs to create and use a passkey is built here: a
 * P-256 key pair per credential, the CBOR attestation object returned at
 * registration, and the signed authenticator data returned at assertion.
 *
 * **This is a platform authenticator, not a roaming one.** It answers requests
 * on the device it is installed on, through the system credential provider.
 * Signing in on a desktop by scanning a QR code is the hybrid (caBLE)
 * transport, which is implemented by the operating system and has no
 * third-party API — no application can offer it, and implying otherwise in the
 * interface would be a promise the wallet cannot keep.
 *
 * Keys are generated in the Android keystore and marked as requiring user
 * authentication, so the private half is not extractable and cannot be used
 * without the holder unlocking the device.
 */
object PasskeyAuthenticator {
    /**
     * AAGUID. Zeroes is the correct value for a credential with no attestation:
     * it says "this authenticator declines to identify its make and model"
     * rather than impersonating one that does.
     */
    private val AAGUID = ByteArray(16)

    private const val KEYSTORE = "AndroidKeyStore"
    private const val KEY_PREFIX = "aegis.passkey."

    data class Registration(
        val credentialId: ByteArray,
        val attestationObject: ByteArray,
        val publicKey: ByteArray,
        /**
         * The same authenticator data that is inside the attestation object.
         *
         * Chrome's CredMan bridge reads it from the response JSON as its own
         * field rather than unpacking the CBOR, and rejects the whole
         * registration if it is absent.
         */
        val authenticatorData: ByteArray,
        /** X.509 SubjectPublicKeyInfo DER, which is what the JSON `publicKey` field is. */
        val publicKeySpki: ByteArray
    )

    data class Assertion(
        val authenticatorData: ByteArray,
        val signature: ByteArray,
        val signCount: Int
    )

    // --- registration --------------------------------------------------------

    fun createCredential(rpId: String, userVerified: Boolean): Registration {
        val credentialId = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val alias = aliasFor(credentialId)

        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE)
        generator.initialize(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                // The key cannot be used at all until the device is unlocked.
                // A passkey is possession plus inherence; a key usable on a
                // locked phone would be neither.
                .setUserAuthenticationRequired(true)
                .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
                .build()
        )
        val pair = generator.generateKeyPair()
        val publicKey = rawPublicKey(pair.public as ECPublicKey)

        val authData = authenticatorData(
            rpId = rpId,
            userPresent = true,
            userVerified = userVerified,
            signCount = 0,
            attestedCredentialId = credentialId,
            attestedPublicKey = publicKey
        )

        // "none" attestation. The wallet is not vouching for its own hardware to
        // a relying party it has never met, and every major browser accepts it.
        val attestationObject = Cbor.map(
            listOf(
                Cbor.text("fmt") to Cbor.text("none"),
                Cbor.text("attStmt") to Cbor.mapValue(emptyList()),
                Cbor.text("authData") to Cbor.bytes(authData)
            )
        )

        return Registration(
            credentialId = credentialId,
            attestationObject = attestationObject,
            publicKey = publicKey,
            authenticatorData = authData,
            publicKeySpki = pair.public.encoded
        )
    }

    // --- assertion -----------------------------------------------------------

    /**
     * Prepare the signing operation, ready to be authorised.
     *
     * Keys are generated auth-per-use, so the operation has to be wrapped in a
     * BiometricPrompt.CryptoObject and only becomes usable once the holder has
     * authenticated. Calling `sign()` on an unauthorised operation throws
     * UserNotAuthenticatedException — which reaches the relying party as a flat
     * "not allowed", saying nothing about what was actually refused.
     */
    fun prepareAssertion(credentialId: ByteArray): Signature {
        val privateKey = loadKey(credentialId) ?: throw PasskeyMissingException()
        return Signature.getInstance("SHA256withECDSA").apply { initSign(privateKey) }
    }

    /**
     * Finish with the Signature the biometric prompt handed back. It is the
     * same object, now authorised — a fresh one would not be.
     */
    fun completeAssertion(
        rpId: String,
        signature: Signature,
        clientDataHash: ByteArray,
        signCount: Int,
        userVerified: Boolean
    ): Assertion {
        val authData = authenticatorData(
            rpId = rpId,
            userPresent = true,
            userVerified = userVerified,
            signCount = signCount,
            attestedCredentialId = null,
            attestedPublicKey = null
        )

        // The signature covers authenticatorData ‖ clientDataHash, in that
        // order. Reversing them produces a signature that verifies against
        // nothing and an error the relying party cannot explain.
        signature.update(authData)
        signature.update(clientDataHash)

        return Assertion(authData, signature.sign(), signCount)
    }

    // --- authenticator data --------------------------------------------------

    /**
     * https://w3c.github.io/webauthn/#authenticator-data
     *
     * rpIdHash (32) ‖ flags (1) ‖ signCount (4) ‖ [attestedCredentialData]
     */
    fun authenticatorData(
        rpId: String,
        userPresent: Boolean,
        userVerified: Boolean,
        signCount: Int,
        attestedCredentialId: ByteArray?,
        attestedPublicKey: ByteArray?
    ): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(MessageDigest.getInstance("SHA-256").digest(rpId.toByteArray()))

        var flags = 0
        if (userPresent) flags = flags or 0x01
        if (userVerified) flags = flags or 0x04
        if (attestedCredentialId != null) flags = flags or 0x40
        out.write(flags)

        out.write(
            byteArrayOf(
                (signCount ushr 24).toByte(),
                (signCount ushr 16).toByte(),
                (signCount ushr 8).toByte(),
                signCount.toByte()
            )
        )

        if (attestedCredentialId != null && attestedPublicKey != null) {
            out.write(AAGUID)
            out.write(attestedCredentialId.size ushr 8)
            out.write(attestedCredentialId.size and 0xFF)
            out.write(attestedCredentialId)
            out.write(coseKey(attestedPublicKey))
        }

        return out.toByteArray()
    }

    /** A COSE_Key for an uncompressed P-256 public key: 0x04 ‖ X(32) ‖ Y(32). */
    fun coseKey(rawPublicKey: ByteArray): ByteArray {
        val body = if (rawPublicKey.size == 65) rawPublicKey.copyOfRange(1, 65) else rawPublicKey
        val x = body.copyOfRange(0, 32)
        val y = body.copyOfRange(32, 64)

        return Cbor.map(
            listOf(
                Cbor.int(1) to Cbor.int(2),      // kty: EC2
                Cbor.int(3) to Cbor.int(-7),     // alg: ES256
                Cbor.int(-1) to Cbor.int(1),     // crv: P-256
                Cbor.int(-2) to Cbor.bytes(x),
                Cbor.int(-3) to Cbor.bytes(y)
            )
        )
    }

    // --- keys ----------------------------------------------------------------

    fun deleteKey(credentialId: ByteArray) {
        runCatching {
            KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(aliasFor(credentialId))
        }
    }

    private fun loadKey(credentialId: ByteArray): PrivateKey? =
        runCatching {
            val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
            store.getKey(aliasFor(credentialId), null) as? PrivateKey
        }.getOrNull()

    private fun aliasFor(credentialId: ByteArray) = KEY_PREFIX + Base64Url.encode(credentialId)

    private fun rawPublicKey(key: ECPublicKey): ByteArray {
        val x = key.w.affineX.toByteArray().let { unsigned32(it) }
        val y = key.w.affineY.toByteArray().let { unsigned32(it) }
        return byteArrayOf(0x04) + x + y
    }

    /**
     * BigInteger.toByteArray() gives a signed, variable-length value — a leading
     * zero when the high bit is set, or fewer than 32 bytes for a small
     * coordinate. WebAuthn wants exactly 32, and getting this wrong produces a
     * key that verifies for most credentials and fails for a few.
     */
    private fun unsigned32(value: ByteArray): ByteArray = when {
        value.size == 32 -> value
        value.size > 32 -> value.copyOfRange(value.size - 32, value.size)
        else -> ByteArray(32 - value.size) + value
    }
}

class PasskeyMissingException : Exception("This wallet has no passkey for that request.")

/**
 * Just enough CBOR to write an attestation object and a COSE key.
 *
 * Written out rather than pulled in: the encoder needs five major types and
 * deterministic ordering, and a dependency here would ship inside the
 * credential provider the system launches on every passkey prompt.
 */
object Cbor {
    sealed interface Value
    private data class IntValue(val number: Long) : Value
    private data class BytesValue(val bytes: ByteArray) : Value
    private data class TextValue(val text: String) : Value
    private data class MapValue(val pairs: List<Pair<Value, Value>>) : Value

    fun int(value: Long): Value = IntValue(value)
    fun int(value: Int): Value = IntValue(value.toLong())
    fun bytes(value: ByteArray): Value = BytesValue(value)
    fun text(value: String): Value = TextValue(value)
    fun mapValue(pairs: List<Pair<Value, Value>>): Value = MapValue(pairs)
    fun map(pairs: List<Pair<Value, Value>>): ByteArray = encode(MapValue(pairs))

    private fun encode(value: Value): ByteArray = when (value) {
        is IntValue ->
            if (value.number >= 0) header(0, value.number)
            else header(1, -1 - value.number)
        is BytesValue -> header(2, value.bytes.size.toLong()) + value.bytes
        is TextValue -> {
            val utf8 = value.text.toByteArray()
            header(3, utf8.size.toLong()) + utf8
        }
        is MapValue -> {
            val out = ByteArrayOutputStream()
            out.write(header(5, value.pairs.size.toLong()))
            value.pairs.forEach { (key, item) ->
                out.write(encode(key))
                out.write(encode(item))
            }
            out.toByteArray()
        }
    }

    private fun header(major: Int, value: Long): ByteArray {
        val prefix = (major shl 5)
        return when {
            value <= 23 -> byteArrayOf((prefix or value.toInt()).toByte())
            value <= 0xFF -> byteArrayOf((prefix or 24).toByte(), value.toByte())
            value <= 0xFFFF -> byteArrayOf(
                (prefix or 25).toByte(),
                (value ushr 8).toByte(),
                value.toByte()
            )
            else -> byteArrayOf(
                (prefix or 26).toByte(),
                (value ushr 24).toByte(),
                (value ushr 16).toByte(),
                (value ushr 8).toByte(),
                value.toByte()
            )
        }
    }
}

/** base64url, which is what WebAuthn uses wherever a binary value travels as text. */
object Base64Url {
    private const val FLAGS = android.util.Base64.URL_SAFE or
        android.util.Base64.NO_PADDING or
        android.util.Base64.NO_WRAP

    fun encode(value: ByteArray): String = android.util.Base64.encodeToString(value, FLAGS)

    fun decode(value: String): ByteArray =
        runCatching { android.util.Base64.decode(value, FLAGS) }.getOrElse { ByteArray(0) }
}
