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
import ca.vanguardcs.aegisid.wallet.data.WalletStore
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

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "aegisid" && data.host == "invite") {
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
