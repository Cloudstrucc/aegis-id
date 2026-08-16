package ca.vanguardcs.aegisid.wallet.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import ca.vanguardcs.aegisid.wallet.BuildConfig
import ca.vanguardcs.aegisid.wallet.data.WalletStore
import ca.vanguardcs.aegisid.wallet.data.completeSetup
import ca.vanguardcs.aegisid.wallet.data.registerWallet
import kotlinx.coroutines.launch

/**
 * First-run setup. No credential can bind to this wallet until it has a Wallet
 * ID, so the tabs stay unavailable until registration finishes.
 */
@Composable
fun WalletSetupScreen(store: WalletStore, onRecoverInstead: () -> Unit) {
    var step by remember { mutableStateOf(SetupStep.Intro) }
    var showHelp by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var savedCodes by remember { mutableStateOf(false) }
    var isWorking by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    if (showHelp) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(VanguardColors.Mist)
                .statusBarsPadding()
        ) {
            TextButton(onClick = { showHelp = false }) { Text("< Set up your wallet") }
            WalletHelpScreen(tabsAvailable = false)
        }
        return
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
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                "Set up your wallet",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            TextButton(onClick = { showHelp = true }) { Text("How this works") }
        }

        when (step) {
            SetupStep.Intro -> {
                Text(
                    "Vanguard Aegis ID",
                    style = MaterialTheme.typography.headlineLarge,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "Your wallet holds the credentials your organizations issue to you. " +
                        "Set it up once and you will receive a Wallet ID to share with your administrators.",
                    color = Color.Gray
                )

                SetupServicePanel()

                SetupHint("1", "Register below and save your recovery codes.")
                SetupHint("2", "Redeem an invitation — scan its QR on the Scan tab, or paste the link on the Home tab.")
                SetupHint("3", "Redeem another whenever a second organization invites you. One wallet holds them all.")

                Spacer(Modifier.padding(8.dp))
                Button(
                    onClick = { step = SetupStep.Contact },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("Get started") }
                TextButton(
                    onClick = onRecoverInstead,
                    modifier = Modifier.fillMaxWidth()
                ) { Text("Recover an existing wallet") }
            }

            SetupStep.Contact -> {
                Text(
                    "How can organizations reach you?",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "Your email is required. A mobile number is optional, but an organization " +
                        "can only send you an SMS invitation if it is on file.",
                    color = Color.Gray
                )

                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Email address") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Email,
                        capitalization = KeyboardCapitalization.None
                    ),
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = phone,
                    onValueChange = { phone = it },
                    label = { Text("Mobile number (optional)") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    modifier = Modifier.fillMaxWidth()
                )

                errorMessage?.let {
                    Text(it, color = MaterialTheme.colorScheme.error)
                }

                Button(
                    onClick = {
                        errorMessage = null
                        isWorking = true
                        scope.launch {
                            try {
                                store.registerWallet(email.trim(), phone.trim().ifBlank { null })
                                step = SetupStep.WalletId
                            } catch (error: Exception) {
                                errorMessage = error.message ?: "Your wallet could not be created."
                            } finally {
                                isWorking = false
                            }
                        }
                    },
                    enabled = !isWorking && email.contains("@"),
                    modifier = Modifier.fillMaxWidth()
                ) { Text(if (isWorking) "Creating…" else "Create my wallet") }
            }

            SetupStep.WalletId -> {
                Text(
                    "Your Wallet ID",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "Share this with an organization administrator so they can issue credentials to this wallet.",
                    color = Color.Gray
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color.White, RoundedCornerShape(12.dp))
                        .padding(20.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        store.identity?.walletId ?: "",
                        style = MaterialTheme.typography.titleLarge,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold
                    )
                }
                Button(
                    onClick = { step = SetupStep.RecoveryCodes },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("Continue") }
            }

            SetupStep.RecoveryCodes -> {
                Text(
                    "Save your recovery codes",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "If you lose this device these codes let you recover your wallet. Each one " +
                        "works once. Store them somewhere safe — they are shown only now.",
                    color = Color.Gray
                )

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color.White, RoundedCornerShape(12.dp))
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    store.pendingRecoveryCodes.forEach { code ->
                        Text(code, fontFamily = FontFamily.Monospace)
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("I have saved these codes")
                    Switch(checked = savedCodes, onCheckedChange = { savedCodes = it })
                }

                Button(
                    onClick = {
                        store.completeSetup()
                    },
                    enabled = savedCodes,
                    modifier = Modifier.fillMaxWidth()
                ) { Text("Finish setup") }
            }
        }
    }
}

/**
 * Where the other half of the product lives.
 *
 * The Play listing is the one way in that does not begin with an invitation, so
 * this is the first screen a holder can arrive at knowing nothing — including
 * the address of the service they are registering against.
 */
@Composable
private fun SetupServicePanel() {
    val context = LocalContext.current

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Brush.linearGradient(listOf(VanguardColors.Navy, VanguardColors.Blue)),
                RoundedCornerShape(8.dp)
            )
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            "AEGIS ID SERVICE",
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            color = Color.White.copy(alpha = 0.7f)
        )
        Text(
            BuildConfig.AEGIS_WEB_APP_BASE_URL,
            style = MaterialTheme.typography.bodyMedium,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold,
            color = Color.White
        )
        TextButton(onClick = { openWebApp(context) }) {
            Text("Open the web app", color = Color.White, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun SetupHint(number: String, text: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(9.dp)
    ) {
        Box(
            modifier = Modifier
                .size(18.dp)
                .background(VanguardColors.Blue, CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Text(
                number,
                color = Color.White,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold
            )
        }
        Text(text, style = MaterialTheme.typography.bodySmall, color = Color.Gray)
    }
}

private enum class SetupStep { Intro, Contact, WalletId, RecoveryCodes }
