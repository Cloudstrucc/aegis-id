package ca.vanguardcs.aegisid.wallet.ui

import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ca.vanguardcs.aegisid.wallet.passkey.PasskeyStore
import ca.vanguardcs.aegisid.wallet.passkey.StoredPasskey
import java.text.DateFormat
import java.util.Date

/**
 * The passkeys this wallet holds for other people's services.
 *
 * Deliberately separate from the wallet's own passkey settings, which are about
 * approving Aegis challenges. These are FIDO2 credentials for any site that
 * supports them, and the wallet is only their storage — it cannot tell a site
 * anything about them, including that one has been deleted here.
 */
@Composable
fun PasskeysScreen() {
    val context = LocalContext.current
    val store = remember { PasskeyStore(context) }
    var passkeys by remember { mutableStateOf(store.all()) }
    var pendingDeletion by remember { mutableStateOf<StoredPasskey?>(null) }

    LaunchedEffect(Unit) { passkeys = store.all() }

    val supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        if (!supported) {
            item {
                AegisCard {
                    Text("Not available on this Android version", fontWeight = FontWeight.Bold)
                    Text(
                        "Acting as a passkey provider needs Android 14 or later. Everything else in the wallet works as normal.",
                        color = Color.Gray,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
        } else {
            item {
                AegisCard {
                    Text("Turn Aegis ID on as a passkey provider", fontWeight = FontWeight.Bold)
                    Text(
                        "Settings › Passwords & accounts › Passwords, passkeys and data services. Until Aegis ID is switched on there, Android will not offer this wallet when a site asks for a passkey.",
                        color = Color.Gray,
                        style = MaterialTheme.typography.bodySmall
                    )
                    OutlinedButton(
                        onClick = {
                            runCatching {
                                context.startActivity(
                                    Intent(Settings.ACTION_SYNC_SETTINGS).apply {
                                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                    }
                                )
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("Open Android settings") }
                }
            }
        }

        if (passkeys.isEmpty()) {
            item {
                AegisCard {
                    Text("No passkeys yet", fontWeight = FontWeight.Bold)
                    Text(
                        "Create one from the site itself — on this device — and choose Aegis ID when asked where to save it.",
                        color = Color.Gray,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
        } else {
            items(passkeys.sortedBy { it.rpId }) { passkey ->
                AegisCard {
                    Text(passkey.rpId, color = Color.Gray, style = MaterialTheme.typography.labelLarge)
                    Text(passkey.accountLabel, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(
                        "Created ${formatDate(passkey.createdAt)}" +
                            (passkey.lastUsedAt?.let { " · last used ${formatDate(it)}" } ?: " · never used"),
                        color = Color.Gray,
                        style = MaterialTheme.typography.bodySmall
                    )
                    TextButton(onClick = { pendingDeletion = passkey }) { Text("Delete") }
                }
            }
        }

        item {
            AegisCard {
                Text("Same device only", fontWeight = FontWeight.Bold)
                Text(
                    "These passkeys answer sign-in requests on this phone. Signing in on a computer by scanning a code uses a transport the operating system reserves for itself, so no third-party wallet can offer it.",
                    color = Color.Gray,
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }

    pendingDeletion?.let { passkey ->
        AlertDialog(
            onDismissRequest = { pendingDeletion = null },
            title = { Text("Delete this passkey?") },
            text = {
                Text(
                    "The key is erased from this device and cannot be recovered. ${passkey.rpId} will still list it until you remove it there too, and signing in with it will simply stop working."
                )
            },
            confirmButton = {
                Button(onClick = {
                    store.delete(passkey.credentialId)
                    passkeys = store.all()
                    pendingDeletion = null
                }) { Text("Delete") }
            },
            dismissButton = {
                TextButton(onClick = { pendingDeletion = null }) { Text("Keep") }
            }
        )
    }
}

private fun formatDate(millis: Long): String =
    DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(millis))
