package ca.vanguardcs.aegisid.wallet.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.PaddingValues
import ca.vanguardcs.aegisid.wallet.BuildConfig
import ca.vanguardcs.aegisid.wallet.data.WalletStore
import ca.vanguardcs.aegisid.wallet.data.clearLocalIdentity
import ca.vanguardcs.aegisid.wallet.data.regenerateRecoveryCodes
import ca.vanguardcs.aegisid.wallet.data.resolveContactChange
import ca.vanguardcs.aegisid.wallet.data.startContactChange
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.launch

/**
 * The holder's own wallet: the Wallet ID to hand to an administrator, the
 * contact an organization can address an invitation to, and recovery codes.
 *
 * Contact changes are challenge gated — the server issues a challenge that has
 * to be approved here, so an intercepted session cannot quietly repoint someone
 * else's invitations at a new address.
 */
@Composable
fun WalletProfileScreen(store: WalletStore) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var editingField by remember { mutableStateOf<String?>(null) }
    var fieldValue by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var isWorking by remember { mutableStateOf(false) }
    var showResetConfirm by remember { mutableStateOf(false) }

    val identity = store.identity
    val walletId = identity?.walletId.orEmpty()

    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            AegisCard {
                Text("Wallet ID", color = Color.Gray, style = MaterialTheme.typography.labelLarge)
                Text(
                    walletId.ifBlank { "Not registered" },
                    style = MaterialTheme.typography.titleLarge,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "Give this to an organization administrator so they can issue credentials to " +
                        "this wallet. It is an identifier, not a secret.",
                    color = Color.Gray,
                    style = MaterialTheme.typography.bodySmall
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(
                        onClick = { copyToClipboard(context, "Wallet ID", walletId); message = "Wallet ID copied." },
                        enabled = walletId.isNotBlank()
                    ) { Text("Copy") }
                    Button(
                        onClick = { shareWalletId(context, walletId) },
                        enabled = walletId.isNotBlank()
                    ) { Text("Share") }
                }
            }
        }

        if (walletId.isNotBlank()) {
            item {
                AegisCard {
                    Text("Scan to share", color = Color.Gray, style = MaterialTheme.typography.labelLarge)
                    Text(
                        "An administrator can scan this instead of typing your Wallet ID.",
                        color = Color.Gray,
                        style = MaterialTheme.typography.bodySmall
                    )
                    val qr = remember(walletId) { walletIdQrBitmap(walletId) }
                    if (qr != null) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.Center
                        ) {
                            Image(
                                bitmap = qr.asImageBitmap(),
                                contentDescription = "QR code containing this wallet's ID",
                                modifier = Modifier
                                    .size(220.dp)
                                    .background(Color.White, RoundedCornerShape(8.dp))
                                    .padding(8.dp)
                            )
                        }
                    }
                }
            }
        }

        item {
            AegisCard {
                Text("Contact", color = Color.Gray, style = MaterialTheme.typography.labelLarge)
                KeyValue("Email", identity?.email)
                KeyValue("Mobile", identity?.phone ?: "Not set")
                Text(
                    "Organizations can address an invitation to this email or number when they do " +
                        "not have your Wallet ID. Changing either needs your approval in this wallet.",
                    color = Color.Gray,
                    style = MaterialTheme.typography.bodySmall
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = { editingField = "email"; fieldValue = identity?.email.orEmpty() }) {
                        Text("Change email")
                    }
                    OutlinedButton(onClick = { editingField = "phone"; fieldValue = identity?.phone.orEmpty() }) {
                        Text(if (identity?.phone.isNullOrBlank()) "Add mobile" else "Change mobile")
                    }
                }
            }
        }

        item {
            AegisCard {
                Text("Recovery", color = Color.Gray, style = MaterialTheme.typography.labelLarge)
                Text(
                    "Generating a new set immediately invalidates the old one. Codes are shown " +
                        "once and are never stored on this device.",
                    color = Color.Gray,
                    style = MaterialTheme.typography.bodySmall
                )
                OutlinedButton(
                    onClick = {
                        isWorking = true
                        errorMessage = null
                        scope.launch {
                            try {
                                store.regenerateRecoveryCodes()
                                message = "New recovery codes generated."
                            } catch (error: Exception) {
                                errorMessage = error.message ?: "Codes could not be generated."
                            } finally {
                                isWorking = false
                            }
                        }
                    },
                    enabled = !isWorking && walletId.isNotBlank(),
                    modifier = Modifier.fillMaxWidth()
                ) { Text("Generate new recovery codes") }

                if (store.pendingRecoveryCodes.isNotEmpty()) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(VanguardColors.Mist, RoundedCornerShape(8.dp))
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        store.pendingRecoveryCodes.forEach { Text(it, fontFamily = FontFamily.Monospace) }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(onClick = {
                            copyToClipboard(context, "Recovery codes", store.pendingRecoveryCodes.joinToString("\n"))
                            message = "Codes copied."
                        }) { Text("Copy all") }
                        Button(onClick = { store.setPendingRecoveryCodes(emptyList()) }) { Text("Done") }
                    }
                }
            }
        }

        item {
            AegisCard {
                Text("This device", color = Color.Gray, style = MaterialTheme.typography.labelLarge)
                Text(
                    "Removing the wallet from this device does not delete it. You can recover it " +
                        "here or on another device with a recovery code.",
                    color = Color.Gray,
                    style = MaterialTheme.typography.bodySmall
                )
                KeyValue("Environment", BuildConfig.AEGIS_WEB_APP_BASE_URL)
                OutlinedButton(
                    onClick = { showResetConfirm = true },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("Remove wallet from this device") }
            }
        }

        item {
            message?.let { Text(it, color = VanguardColors.Green) }
            errorMessage?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }

    if (editingField != null) {
        val field = editingField!!
        AlertDialog(
            onDismissRequest = { editingField = null },
            title = { Text(if (field == "email") "Change email" else "Change mobile number") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "We will raise a challenge that you approve here. Until it is approved, " +
                            "invitations keep going to your current contact.",
                        color = Color.Gray,
                        style = MaterialTheme.typography.bodySmall
                    )
                    OutlinedTextField(
                        value = fieldValue,
                        onValueChange = { fieldValue = it },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = if (field == "email") KeyboardType.Email else KeyboardType.Phone,
                            capitalization = KeyboardCapitalization.None
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val value = fieldValue.trim()
                        editingField = null
                        errorMessage = null
                        scope.launch {
                            try {
                                store.startContactChange(field, value)
                                // Approving here is the second half of the gate.
                                store.resolveContactChange(approve = true)
                                message = "Contact updated."
                            } catch (error: Exception) {
                                errorMessage = error.message ?: "The change could not be applied."
                            }
                        }
                    },
                    enabled = fieldValue.isNotBlank()
                ) { Text("Request and approve") }
            },
            dismissButton = { TextButton(onClick = { editingField = null }) { Text("Cancel") } }
        )
    }

    if (showResetConfirm) {
        AlertDialog(
            onDismissRequest = { showResetConfirm = false },
            title = { Text("Remove this wallet?") },
            text = {
                Text(
                    "This device will return to first-run setup. Your wallet and its credentials " +
                        "stay on the server, and you will need a recovery code to get back in."
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showResetConfirm = false
                    store.clearLocalIdentity()
                }) { Text("Remove") }
            },
            dismissButton = { TextButton(onClick = { showResetConfirm = false }) { Text("Cancel") } }
        )
    }
}

private fun copyToClipboard(context: Context, label: String, value: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText(label, value))
}

private fun shareWalletId(context: Context, walletId: String) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, "My Aegis ID Wallet ID is $walletId")
    }
    context.startActivity(Intent.createChooser(intent, "Share Wallet ID"))
}

/** Encodes the share payload the platform's extractWalletId understands. */
private fun walletIdQrBitmap(walletId: String, size: Int = 512): Bitmap? = runCatching {
    val payload = "${BuildConfig.AEGIS_URL_SCHEME}://wallet?wallet_id=$walletId"
    val matrix = QRCodeWriter().encode(payload, BarcodeFormat.QR_CODE, size, size)
    Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888).apply {
        for (x in 0 until size) {
            for (y in 0 until size) {
                setPixel(x, y, if (matrix.get(x, y)) AndroidColor.BLACK else AndroidColor.WHITE)
            }
        }
    }
}.getOrNull()
