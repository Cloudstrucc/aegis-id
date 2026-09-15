package ca.vanguardcs.aegisid.wallet.ui

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import ca.vanguardcs.aegisid.wallet.data.PendingSignIn
import ca.vanguardcs.aegisid.wallet.data.WalletStore
import ca.vanguardcs.aegisid.wallet.data.answerSignIn
import ca.vanguardcs.aegisid.wallet.data.dismissSignIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * "Business Expenses wants to sign you in."
 *
 * One decision, two buttons. Approving asks for the device's biometric or
 * credential before anything is sent — the wallet is standing in as the second
 * factor, so the phone being unlocked is not enough on its own. Mirrors
 * SignInApprovalSheet on iOS.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignInApprovalSheet(
    store: WalletStore,
    pending: PendingSignIn,
    onAnswered: (approved: Boolean) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var isAnswering by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    val organizationName = pending.requestedOrganizationId?.let { id ->
        store.organizationProfiles[id]?.organizationName
            ?: store.connections.firstOrNull { store.organizationIdFor(it) == id }?.invitation?.organizationName
    }

    fun answer(approve: Boolean) {
        isAnswering = true
        errorMessage = null
        scope.launch {
            if (approve) {
                val activity = context as? FragmentActivity
                val confirmed = activity != null && authenticateHolder(activity, "Approve signing in to ${pending.appName}")
                if (!confirmed) {
                    isAnswering = false
                    errorMessage = "Sign-in was not approved: confirm with your fingerprint, face or screen lock."
                    return@launch
                }
            }
            val entry = store.answerSignIn(pending, approve)
            isAnswering = false
            if (entry != null) {
                onAnswered(approve)
            } else {
                errorMessage = store.lastImportError
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = { if (!isAnswering) store.dismissSignIn() },
        containerColor = Color.White
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 22.dp, vertical = 8.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Icon(Icons.Outlined.Key, contentDescription = null, tint = VanguardColors.Blue, modifier = Modifier.size(38.dp))
            Text(
                "${pending.appName} wants to sign you in",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = VanguardColors.Ink
            )
            Text(
                "Approve only if you started this sign-in yourself, on a screen you can see. Nobody else can complete it without this wallet.",
                style = MaterialTheme.typography.bodyMedium,
                color = Color.Gray
            )

            AegisCard {
                DetailRow("Application", pending.appName)
                if (organizationName != null) DetailRow("Organization", organizationName)
                DetailRow("Answering as", store.walletId ?: "This wallet")
                pending.expiresAt?.let { DetailRow("Expires", it.replace('T', ' ').take(16)) }
            }

            errorMessage?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }

            Button(
                onClick = { answer(true) },
                enabled = !isAnswering,
                colors = ButtonDefaults.buttonColors(containerColor = VanguardColors.Green),
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Outlined.Fingerprint, contentDescription = null, modifier = Modifier.size(18.dp))
                Text(if (isAnswering) "  Approving…" else "  Approve with biometric", fontWeight = FontWeight.Bold)
            }
            OutlinedButton(
                onClick = { answer(false) },
                enabled = !isAnswering,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Decline", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold)
            }
            TextButton(onClick = { if (!isAnswering) store.dismissSignIn() }, modifier = Modifier.fillMaxWidth()) {
                Text("Not now", color = Color.Gray)
            }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            color = Color.Gray,
            modifier = Modifier.width(104.dp)
        )
        Text(value, style = MaterialTheme.typography.bodyMedium, color = VanguardColors.Ink)
    }
}

/**
 * Fingerprint, face, or the screen lock — whichever the device offers. A device
 * with none set up cannot approve, deliberately.
 */
private suspend fun authenticateHolder(activity: FragmentActivity, reason: String): Boolean {
    val authenticators = BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL
    if (BiometricManager.from(activity).canAuthenticate(authenticators) != BiometricManager.BIOMETRIC_SUCCESS) {
        return false
    }
    return suspendCancellableCoroutine { continuation ->
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    if (continuation.isActive) continuation.resume(true)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    if (continuation.isActive) continuation.resume(false)
                }
            }
        )
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle("Confirm it is you")
                .setSubtitle(reason)
                .setAllowedAuthenticators(authenticators)
                .build()
        )
        continuation.invokeOnCancellation { runCatching { prompt.cancelAuthentication() } }
    }
}
