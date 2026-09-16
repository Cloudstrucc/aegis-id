package ca.vanguardcs.aegisid.wallet.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import ca.vanguardcs.aegisid.wallet.data.WalletLockMethod
import ca.vanguardcs.aegisid.wallet.data.WalletStore
import ca.vanguardcs.aegisid.wallet.data.clearLocalIdentity
import kotlinx.coroutines.launch

/**
 * The gate in front of a registered wallet, shown whenever it is locked — a
 * cold launch or a return from the background. Offers whichever method the
 * holder set up. Biometric prompts itself on appear so the common case is one
 * glance.
 */
@Composable
fun WalletLockScreen(store: WalletStore) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    fun tryBiometric() {
        val activity = context as? FragmentActivity ?: return
        scope.launch {
            if (authenticateWithDevice(activity, "Unlock your wallet", "Confirm it is you")) {
                store.markUnlocked()
                error = null
            } else {
                error = "Not verified."
            }
        }
    }

    LaunchedEffect(Unit) {
        if (store.lockMethod == WalletLockMethod.BIOMETRIC) tryBiometric()
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(28.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(Icons.Outlined.Lock, contentDescription = null, tint = VanguardColors.Blue)
        Text("Aegis ID Wallet", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text("Unlock to continue.", color = Color.Gray)

        if (store.lockMethod == WalletLockMethod.PIN) {
            OutlinedTextField(
                value = pin,
                onValueChange = { pin = it.filter(Char::isDigit).take(12) },
                label = { Text("PIN") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier.width(220.dp)
            )
            Button(
                onClick = {
                    if (store.unlockWithPin(pin)) { pin = ""; error = null }
                    else { pin = ""; error = "That PIN did not match." }
                },
                enabled = pin.length >= 4
            ) { Text("Unlock") }
            if (deviceAuthAvailable(context as FragmentActivity)) {
                TextButton(onClick = { tryBiometric() }) { Text("Use fingerprint / face instead") }
            }
        } else {
            Button(onClick = { tryBiometric() }) { Text("Unlock") }
        }

        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        TextButton(onClick = { store.clearLocalIdentity() }) {
            Text("Recover a different wallet", color = Color.Gray)
        }
    }
}
