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
            trace("create refused: not a public key request (${callingRequest.type})")
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
            trace("create refused: site did not offer ES256")
            finishCancelled()
            return
        }
        trace("create asked for ${options.rp.id}")

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
                            // The rest of AuthenticatorAttestationResponseJSON.
                            // Chrome's CredMan-to-Mojo converter reads these
                            // three directly and fails the whole registration
                            // with "field missing or invalid: publicKeyAlgorithm"
                            // rather than unpacking them from the attestation
                            // object, which is where they also live.
                            put("authenticatorData", Base64Url.encode(registration.authenticatorData))
                            put("publicKeyAlgorithm", -7)
                            put("publicKey", Base64Url.encode(registration.publicKeySpki))
                        }
                    )
                    put("clientExtensionResults", JSONObject())
                }

                val result = android.content.Intent()
                PendingIntentHandler.setCreateCredentialResponse(
                    result,
                    CreatePublicKeyCredentialResponse(json.toString())
                )
                trace("create completed for ${options.rp.id}")
                setResult(Activity.RESULT_OK, result)
                finish()
            }.onFailure {
                trace("create failed: $it")
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
                trace("assertion completed for ${passkey.rpId}")
                setResult(Activity.RESULT_OK, result)
                finish()
            }.onFailure {
                trace("assertion failed: $it")
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
        authenticate(reason, null) { verified, _ -> onResult(verified) }
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
        authenticate(reason, operation) { verified, signature ->
            onResult(if (verified) signature else null)
        }
    }

    /**
     * Reports whether the holder verified *and*, separately, the Signature they
     * authorised.
     *
     * The two have to be separate. Registration authorises no operation, so it
     * passes no Signature and gets none back — collapsing the two into "did a
     * Signature come back" read every successful registration as a refusal, and
     * the holder saw the prompt accept their PIN and the request cancel anyway.
     */
    private fun authenticate(
        reason: String,
        operation: java.security.Signature?,
        onResult: (Boolean, java.security.Signature?) -> Unit
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

        val canAuthenticate = manager.canAuthenticate(allowed)
        if (canAuthenticate != BiometricManager.BIOMETRIC_SUCCESS) {
            trace("cannot verify the holder: canAuthenticate=$canAuthenticate, allowed=$allowed")
            onResult(false, null)
            return
        }
        trace("asking the holder to verify (allowed=$allowed, operation=${operation != null})")

        val prompt = BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    trace("holder verified (type ${result.authenticationType})")
                    onResult(true, result.cryptoObject?.signature ?: operation)
                }

                override fun onAuthenticationError(code: Int, message: CharSequence) {
                    // The one line that separates "the holder said no" from
                    // "the platform refused", which reach the relying party as
                    // the same flat failure.
                    trace("holder verification failed: code $code, $message")
                    onResult(false, null)
                }

                override fun onAuthenticationFailed() {
                    trace("holder not recognised, prompt still open")
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
        trace("cancelled")
        setResult(Activity.RESULT_CANCELED)
        finish()
    }

    /**
     * The provider's own trail through a flow the system otherwise reports as a
     * single yes or no.
     *
     * WebAuthn gives a relying party one failure and no reason, and the platform
     * logs stop at its own boundary — so without this there is no way to tell a
     * declined prompt from a rejected request from a signature the keystore
     * would not produce. iOS has PasskeyDiagnostics for the same reason.
     *
     *   adb logcat -s AegisPasskey
     */
    private fun trace(message: String) {
        android.util.Log.i(TRACE_TAG, message)
    }

    companion object {
        const val TRACE_TAG = "AegisPasskey"
        const val ACTION_CREATE = "ca.vanguardcs.aegisid.wallet.PASSKEY_CREATE"
        const val ACTION_GET = "ca.vanguardcs.aegisid.wallet.PASSKEY_GET"
        const val EXTRA_CREDENTIAL_ID = "credentialId"
    }
}
