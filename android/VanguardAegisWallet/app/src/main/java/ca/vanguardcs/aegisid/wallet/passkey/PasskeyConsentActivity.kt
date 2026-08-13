package ca.vanguardcs.aegisid.wallet.passkey

import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.security.keystore.UserNotAuthenticatedException
import androidx.activity.ComponentActivity
import androidx.annotation.RequiresApi
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.GetCredentialResponse
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialUnknownException
import androidx.credentials.exceptions.GetCredentialUnknownException
import androidx.credentials.provider.PendingIntentHandler
import androidx.credentials.provider.ProviderCreateCredentialRequest
import androidx.credentials.provider.ProviderGetCredentialRequest
import androidx.credentials.webauthn.AuthenticatorAttestationResponse
import androidx.credentials.webauthn.PublicKeyCredentialCreationOptions
import androidx.credentials.webauthn.PublicKeyCredentialRequestOptions
import androidx.fragment.app.FragmentActivity
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Where the holder actually agrees.
 *
 * The credential provider service cannot show anything, so every real answer
 * comes through here: the system sends the request in, this asks for a
 * biometric or the device credential, does the cryptography, and hands the
 * result back.
 *
 * A FragmentActivity because BiometricPrompt needs one.
 */
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
class PasskeyConsentActivity : FragmentActivity() {

    private val store by lazy { PasskeyStore(applicationContext) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        when (intent.action) {
            ACTION_CREATE -> handleCreate()
            ACTION_GET -> handleGet()
            else -> finishCancelled()
        }
    }

    // --- registration --------------------------------------------------------

    private fun handleCreate() {
        val request = PendingIntentHandler.retrieveProviderCreateCredentialRequest(intent)
        if (request == null) {
            finishCancelled()
            return
        }

        val callingRequest = request.callingRequest
        if (callingRequest !is androidx.credentials.CreatePublicKeyCredentialRequest) {
            finishCancelled()
            return
        }

        val options = runCatching {
            PublicKeyCredentialCreationOptions(callingRequest.requestJson)
        }.getOrElse {
            finishCancelled()
            return
        }

        // ES256 only. Refusing up front is better than creating a key the
        // relying party rejects afterwards.
        val supportsEs256 = options.pubKeyCredParams.any { it.alg == -7L }
        if (!supportsEs256) {
            finishCancelled()
            return
        }

        verifyHolder("Create a passkey for ${options.rp.id}") { verified ->
            if (!verified) {
                finishCancelled()
                return@verifyHolder
            }

            runCatching {
                val registration = PasskeyAuthenticator.createCredential(
                    rpId = options.rp.id,
                    userVerified = true
                )

                val origin = callingAppOrigin(request, options.rp.id)
                val clientDataJson = clientData("webauthn.create", options.challenge, origin)

                store.save(
                    StoredPasskey(
                        credentialId = Base64Url.encode(registration.credentialId),
                        rpId = options.rp.id,
                        rpName = options.rp.name,
                        userHandle = Base64Url.encode(options.user.id),
                        userName = options.user.name,
                        userDisplayName = options.user.displayName,
                        signCount = 0,
                        createdAt = System.currentTimeMillis(),
                        lastUsedAt = null
                    )
                )

                val response = AuthenticatorAttestationResponse(
                    requestOptions = options,
                    credentialId = registration.credentialId,
                    credentialPublicKey = registration.publicKey,
                    origin = origin,
                    up = true,
                    uv = true,
                    be = false,
                    bs = false,
                    packageName = request.callingAppInfo.packageName
                )

                val json = JSONObject().apply {
                    put("id", Base64Url.encode(registration.credentialId))
                    put("rawId", Base64Url.encode(registration.credentialId))
                    put("type", "public-key")
                    put("authenticatorAttachment", "platform")
                    put(
                        "response",
                        JSONObject().apply {
                            put("clientDataJSON", Base64Url.encode(clientDataJson))
                            put("attestationObject", Base64Url.encode(registration.attestationObject))
                            put("transports", org.json.JSONArray(listOf("internal")))
                        }
                    )
                    put("clientExtensionResults", JSONObject())
                }

                val result = android.content.Intent()
                PendingIntentHandler.setCreateCredentialResponse(
                    result,
                    CreatePublicKeyCredentialResponse(json.toString())
                )
                setResult(Activity.RESULT_OK, result)
                finish()
            }.onFailure {
                finishCancelled()
            }
        }
    }

    // --- assertion -----------------------------------------------------------

    private fun handleGet() {
        val request = PendingIntentHandler.retrieveProviderGetCredentialRequest(intent)
        val credentialId = intent.getStringExtra(EXTRA_CREDENTIAL_ID)
        if (request == null || credentialId == null) {
            finishCancelled()
            return
        }

        val passkey = store.byCredentialId(credentialId)
        if (passkey == null) {
            finishCancelled()
            return
        }

        val option = request.credentialOptions
            .filterIsInstance<androidx.credentials.GetPublicKeyCredentialOption>()
            .firstOrNull()
        if (option == null) {
            finishCancelled()
            return
        }

        val options = runCatching {
            PublicKeyCredentialRequestOptions(option.requestJson)
        }.getOrElse {
            finishCancelled()
            return
        }

        val operation = runCatching {
            PasskeyAuthenticator.prepareAssertion(passkey.credentialIdBytes)
        }.getOrElse {
            finishCancelled()
            return
        }

        // The prompt authorises this exact operation. Signing with anything
        // else throws, because the key is generated auth-per-use.
        verifyHolder("Sign in to ${passkey.rpId}", operation) { authorised ->
            if (authorised == null) {
                finishCancelled()
                return@verifyHolder
            }

            runCatching {
                val origin = callingAppOrigin(request, passkey.rpId)
                val clientDataJson = clientData("webauthn.get", options.challenge, origin)
                val clientDataHash = MessageDigest.getInstance("SHA-256").digest(clientDataJson)

                val signCount = store.recordUse(passkey.credentialId)
                val assertion = PasskeyAuthenticator.completeAssertion(
                    rpId = passkey.rpId,
                    signature = authorised,
                    clientDataHash = clientDataHash,
                    signCount = signCount,
                    userVerified = true
                )

                val json = JSONObject().apply {
                    put("id", passkey.credentialId)
                    put("rawId", passkey.credentialId)
                    put("type", "public-key")
                    put("authenticatorAttachment", "platform")
                    put(
                        "response",
                        JSONObject().apply {
                            put("clientDataJSON", Base64Url.encode(clientDataJson))
                            put("authenticatorData", Base64Url.encode(assertion.authenticatorData))
                            put("signature", Base64Url.encode(assertion.signature))
                            put("userHandle", passkey.userHandle)
                        }
                    )
                    put("clientExtensionResults", JSONObject())
                }

                val result = android.content.Intent()
                PendingIntentHandler.setGetCredentialResponse(
                    result,
                    GetCredentialResponse(PublicKeyCredential(json.toString()))
                )
                setResult(Activity.RESULT_OK, result)
                finish()
            }.onFailure {
                finishCancelled()
            }
        }
    }

    // --- holder verification -------------------------------------------------

    /**
     * A biometric or the device credential.
     *
     * A passkey is possession plus inherence, and the keystore entries are
     * generated requiring authentication — so this is not only policy, it is
     * what makes the key usable at all.
     */
    private fun verifyHolder(reason: String, onResult: (Boolean) -> Unit) {
        authenticate(reason, null) { onResult(it != null) }
    }

    /**
     * Authorise a specific signing operation.
     *
     * Passes the Signature through a CryptoObject and hands back the same
     * object, now usable. A device-credential fallback cannot carry a
     * CryptoObject, so this asks for a biometric when one is being authorised.
     */
    private fun verifyHolder(
        reason: String,
        operation: java.security.Signature,
        onResult: (java.security.Signature?) -> Unit
    ) {
        authenticate(reason, operation) { onResult(it) }
    }

    private fun authenticate(
        reason: String,
        operation: java.security.Signature?,
        onResult: (java.security.Signature?) -> Unit
    ) {
        val manager = BiometricManager.from(this)
        // A CryptoObject cannot travel with DEVICE_CREDENTIAL, so an operation
        // being authorised needs a biometric. Without one, nothing here can
        // proceed and saying so beats a prompt that cannot succeed.
        val allowed = if (operation != null) {
            BiometricManager.Authenticators.BIOMETRIC_STRONG
        } else {
            BiometricManager.Authenticators.BIOMETRIC_STRONG or
                BiometricManager.Authenticators.DEVICE_CREDENTIAL
        }

        if (manager.canAuthenticate(allowed) != BiometricManager.BIOMETRIC_SUCCESS) {
            onResult(null)
            return
        }

        val prompt = BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    onResult(result.cryptoObject?.signature ?: operation)
                }

                override fun onAuthenticationError(code: Int, message: CharSequence) {
                    onResult(null)
                }
            }
        )

        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Aegis ID")
            .setSubtitle(reason)
            .setAllowedAuthenticators(allowed)
            .apply { if (operation != null) setNegativeButtonText("Cancel") }
            .build()

        if (operation != null) {
            prompt.authenticate(info, BiometricPrompt.CryptoObject(operation))
        } else {
            prompt.authenticate(info)
        }
    }

    // --- WebAuthn plumbing ---------------------------------------------------

    /**
     * The origin that goes into clientDataJSON.
     *
     * A browser passes its own origin through; a native application does not
     * have one, and the convention is the `android:apk-key-hash:` form built
     * from the calling package's signature. Getting this wrong is not a crash —
     * it is a signature the relying party rejects with no useful message.
     */
    private fun callingAppOrigin(request: ProviderCreateCredentialRequest, rpId: String): String =
        request.callingAppInfo.origin ?: "https://$rpId"

    private fun callingAppOrigin(request: ProviderGetCredentialRequest, rpId: String): String =
        request.callingAppInfo.origin ?: "https://$rpId"

    private fun clientData(type: String, challenge: ByteArray, origin: String): ByteArray =
        JSONObject().apply {
            put("type", type)
            put("challenge", Base64Url.encode(challenge))
            put("origin", origin)
            put("crossOrigin", false)
        }.toString().toByteArray()

    private fun finishCancelled() {
        setResult(Activity.RESULT_CANCELED)
        finish()
    }

    companion object {
        const val ACTION_CREATE = "ca.vanguardcs.aegisid.wallet.PASSKEY_CREATE"
        const val ACTION_GET = "ca.vanguardcs.aegisid.wallet.PASSKEY_GET"
        const val EXTRA_CREDENTIAL_ID = "credentialId"
    }
}
