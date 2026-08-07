package ca.vanguardcs.aegisid.wallet

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.lifecycle.lifecycleScope
import ca.vanguardcs.aegisid.wallet.data.WalletStore
import ca.vanguardcs.aegisid.wallet.data.verifyWalletStillRegistered
import kotlinx.coroutines.launch
import ca.vanguardcs.aegisid.wallet.ui.WalletApp
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private val store: WalletStore by viewModels {
        WalletStore.Factory(applicationContext)
    }
    private lateinit var credentialManager: CredentialManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        credentialManager = CredentialManager.create(this)
        handleIntent(intent)
        setContent {
            WalletApp(
                store = store,
                onCreatePasskey = ::createPasskey,
                onGetPasskey = ::getPasskey
            )
        }
    }

    override fun onResume() {
        super.onResume()
        // A wallet can disappear server-side (a reset environment, a restore
        // from an older backup). Without this the app would keep showing a
        // registered wallet whose every request fails.
        lifecycleScope.launch { store.verifyWalletStillRegistered() }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val data = intent?.data ?: return
        val scheme = data.scheme?.lowercase()

        // Each flavour registers its own scheme, so matching the literal
        // "aegisid" would drop every deep link outside the prod build. The
        // hosts must stay in step with the intent filters in the manifest.
        val isAegisScheme = scheme == BuildConfig.AEGIS_URL_SCHEME.lowercase() ||
            scheme?.startsWith("aegisid") == true
        val isKnownHost = data.host?.lowercase() in setOf(
            "invite",
            "credential-invite",
            "org-invite",
            "wallet",
            "root-wallet-confirm",
            "break-glass-authorise",
            "recovery-approve"
        )

        if ((isAegisScheme && isKnownHost) || scheme == "openid-vc") {
            store.importInvitation(data.toString())
        }
    }

    private suspend fun createPasskey(requestJson: String): JSONObject {
        val result = credentialManager.createCredential(
            context = this,
            request = CreatePublicKeyCredentialRequest(requestJson)
        )
        val credential = result as? CreatePublicKeyCredentialResponse
            ?: error("Passkey registration did not return a public key credential.")
        return JSONObject(credential.registrationResponseJson)
    }

    private suspend fun getPasskey(requestJson: String): JSONObject {
        val result = credentialManager.getCredential(
            context = this,
            request = GetCredentialRequest(
                listOf(GetPublicKeyCredentialOption(requestJson))
            )
        )
        val credential = result.credential as? PublicKeyCredential
            ?: error("Passkey authentication did not return a public key credential.")
        return JSONObject(credential.authenticationResponseJson)
    }
}
