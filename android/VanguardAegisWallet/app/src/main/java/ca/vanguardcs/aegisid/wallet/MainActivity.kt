package ca.vanguardcs.aegisid.wallet

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import ca.vanguardcs.aegisid.wallet.data.WalletStore
import ca.vanguardcs.aegisid.wallet.ui.WalletApp

class MainActivity : ComponentActivity() {
    private val store: WalletStore by viewModels {
        WalletStore.Factory(applicationContext)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)
        setContent {
            WalletApp(store = store)
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
}
