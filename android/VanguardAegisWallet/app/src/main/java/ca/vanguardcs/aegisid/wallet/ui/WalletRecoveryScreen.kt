package ca.vanguardcs.aegisid.wallet.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import ca.vanguardcs.aegisid.wallet.data.WalletStore
import ca.vanguardcs.aegisid.wallet.data.completeRecovery
import ca.vanguardcs.aegisid.wallet.data.loadRecoveryOptions
import ca.vanguardcs.aegisid.wallet.data.redeemRecoveryCode
import ca.vanguardcs.aegisid.wallet.data.startRecovery
import ca.vanguardcs.aegisid.wallet.data.verifyRecoveryOtp
import kotlinx.coroutines.launch

/**
 * Recovering a wallet onto a new device.
 *
 * Recovery re-binds the Wallet ID to a freshly generated device key rather than
 * restoring a backup, so nothing sensitive ever has to leave the old device. A
 * recovery code alone is not enough — the code is paired with a one-time code
 * sent to the registered contact.
 */
@Composable
fun WalletRecoveryScreen(store: WalletStore, onCancel: () -> Unit) {
    var step by remember { mutableStateOf(RecoveryStep.Identify) }
    var identifier by remember { mutableStateOf("") }
    var otp by remember { mutableStateOf("") }
    var recoveryCode by remember { mutableStateOf("") }
    var isWorking by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var successMessage by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun run(block: suspend () -> Unit) {
        errorMessage = null
        isWorking = true
        scope.launch {
            try {
                block()
            } catch (error: Exception) {
                errorMessage = error.message ?: "That did not work. Try again."
            } finally {
                isWorking = false
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(VanguardColors.Mist)
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            "Recover your wallet",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold
        )

        when (step) {
            RecoveryStep.Identify -> {
                Text(
                    "Enter your Wallet ID or the email address on the wallet. We will send a " +
                        "one-time code to your registered contact.",
                    color = Color.Gray
                )
                OutlinedTextField(
                    value = identifier,
                    onValueChange = { identifier = it },
                    label = { Text("Wallet ID or email") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None),
                    modifier = Modifier.fillMaxWidth()
                )
                Button(
                    onClick = {
                        run {
                            store.startRecovery(identifier)
                            store.loadRecoveryOptions()
                            step = RecoveryStep.Otp
                        }
                    },
                    enabled = !isWorking && identifier.isNotBlank(),
                    modifier = Modifier.fillMaxWidth()
                ) { Text(if (isWorking) "Working…" else "Continue") }
            }

            RecoveryStep.Otp -> {
                Text("Enter the code we sent to your registered contact.", color = Color.Gray)
                OutlinedTextField(
                    value = otp,
                    onValueChange = { otp = it },
                    label = { Text("Verification code") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Button(
                    onClick = {
                        run {
                            store.verifyRecoveryOtp(otp.trim())
                            step = RecoveryStep.Code
                        }
                    },
                    enabled = !isWorking && otp.isNotBlank(),
                    modifier = Modifier.fillMaxWidth()
                ) { Text(if (isWorking) "Checking…" else "Verify") }
            }

            RecoveryStep.Code -> {
                val options = store.recoveryOptions
                if (options?.hardStop == true) {
                    // No codes and no connected organization: there is deliberately
                    // no third fallback, because it would be weaker than the two
                    // it replaces.
                    Text(
                        "This wallet cannot be recovered on its own. You have no recovery codes " +
                            "left and no organization that can vouch for you — ask an administrator for help.",
                        color = MaterialTheme.colorScheme.error
                    )
                } else {
                    Text(
                        "Enter one of the recovery codes you saved when you set up this wallet. " +
                            "Each code works once.",
                        color = Color.Gray
                    )
                    options?.let {
                        Text("${it.remainingCodes} code(s) remaining.", color = Color.Gray)
                    }
                    OutlinedTextField(
                        value = recoveryCode,
                        onValueChange = { recoveryCode = it },
                        label = { Text("Recovery code") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Button(
                        onClick = {
                            run {
                                store.redeemRecoveryCode(recoveryCode.trim())
                                successMessage = store.completeRecovery()
                                step = RecoveryStep.Done
                            }
                        },
                        enabled = !isWorking && recoveryCode.isNotBlank(),
                        modifier = Modifier.fillMaxWidth()
                    ) { Text(if (isWorking) "Recovering…" else "Recover my wallet") }
                }
            }

            RecoveryStep.Done -> {
                Text(
                    successMessage ?: "Your wallet is back on this device.",
                    color = VanguardColors.Green
                )
                Button(onClick = onCancel, modifier = Modifier.fillMaxWidth()) {
                    Text("Open my wallet")
                }
            }
        }

        errorMessage?.let {
            Text(it, color = MaterialTheme.colorScheme.error)
        }

        if (step != RecoveryStep.Done) {
            OutlinedButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) {
                Text("Cancel")
            }
        }
    }
}

private enum class RecoveryStep { Identify, Otp, Code, Done }
