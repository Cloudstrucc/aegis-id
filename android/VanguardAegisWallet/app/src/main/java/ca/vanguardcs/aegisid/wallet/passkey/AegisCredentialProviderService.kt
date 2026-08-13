package ca.vanguardcs.aegisid.wallet.passkey

import android.app.PendingIntent
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.os.CancellationSignal
import android.os.OutcomeReceiver
import androidx.annotation.RequiresApi
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.CreateCredentialUnknownException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.provider.BeginCreateCredentialRequest
import androidx.credentials.provider.BeginCreateCredentialResponse
import androidx.credentials.provider.BeginCreatePublicKeyCredentialRequest
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.BeginGetPublicKeyCredentialOption
import androidx.credentials.provider.CreateEntry
import androidx.credentials.provider.CredentialProviderService
import androidx.credentials.provider.ProviderClearCredentialStateRequest
import androidx.credentials.provider.PublicKeyCredentialEntry
import androidx.credentials.webauthn.PublicKeyCredentialCreationOptions
import androidx.credentials.webauthn.PublicKeyCredentialRequestOptions
import ca.vanguardcs.aegisid.wallet.R

/**
 * The wallet answering the system's passkey prompts.
 *
 * Android binds to this service whenever an application or a site asks for a
 * passkey and the holder has turned Aegis ID on under Settings › Passwords &
 * accounts › Passwords, passkeys and data services.
 *
 * The service itself does no cryptography and shows no interface. It answers
 * "here is what I have, and here is how to ask me for it" — every real answer
 * goes through a PendingIntent into [PasskeyConsentActivity], because the
 * holder has to be present and the keys require an unlocked device.
 *
 * Same-device only, by construction. Signing in on a desktop by scanning a QR
 * is the hybrid transport, which belongs to Google Play services and is not
 * offered to third-party providers.
 */
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
class AegisCredentialProviderService : CredentialProviderService() {

    override fun onBeginCreateCredentialRequest(
        request: BeginCreateCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>
    ) {
        if (request !is BeginCreatePublicKeyCredentialRequest) {
            // Passwords are somebody else's job. Saying so is better than
            // offering an entry that fails when tapped.
            callback.onError(CreateCredentialUnknownException("Aegis ID stores passkeys only."))
            return
        }

        val options = runCatching {
            PublicKeyCredentialCreationOptions(request.requestJson)
        }.getOrElse {
            callback.onError(CreateCredentialUnknownException("That passkey request could not be read."))
            return
        }

        val entry = CreateEntry(
            accountName = options.user.name.ifBlank { options.rp.name.ifBlank { "Aegis ID" } },
            pendingIntent = pendingIntent(PasskeyConsentActivity.ACTION_CREATE)
        )

        callback.onResult(
            BeginCreateCredentialResponse(createEntries = listOf(entry))
        )
    }

    override fun onBeginGetCredentialRequest(
        request: BeginGetCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>
    ) {
        val store = PasskeyStore(applicationContext)
        val entries = mutableListOf<PublicKeyCredentialEntry>()

        for (option in request.beginGetCredentialOptions) {
            if (option !is BeginGetPublicKeyCredentialOption) continue

            val rpId = runCatching {
                PublicKeyCredentialRequestOptions(option.requestJson).rpId
            }.getOrNull() ?: continue

            for (passkey in store.forRpId(rpId)) {
                entries += PublicKeyCredentialEntry.Builder(
                    context = applicationContext,
                    username = passkey.accountLabel,
                    pendingIntent = pendingIntent(
                        PasskeyConsentActivity.ACTION_GET,
                        passkey.credentialId
                    ),
                    beginGetPublicKeyCredentialOption = option
                )
                    .setDisplayName(passkey.rpId)
                    .setIcon(Icon.createWithResource(applicationContext, R.drawable.vanguard_icon))
                    .build()
            }
        }

        // An empty response is a valid answer and the right one: it means this
        // wallet is simply not offered for that site, rather than offered and
        // then failing.
        callback.onResult(BeginGetCredentialResponse(credentialEntries = entries))
    }

    override fun onClearCredentialStateRequest(
        request: ProviderClearCredentialStateRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<Void?, ClearCredentialException>
    ) {
        // Nothing to clear. This asks a provider to forget a *session*, not the
        // credentials themselves — deleting passkeys here would silently throw
        // away keys the holder never asked to lose.
        callback.onResult(null)
    }

    private fun pendingIntent(action: String, credentialId: String? = null): PendingIntent {
        val intent = Intent(applicationContext, PasskeyConsentActivity::class.java).apply {
            this.action = action
            credentialId?.let { putExtra(PasskeyConsentActivity.EXTRA_CREDENTIAL_ID, it) }
            setPackage(packageName)
        }
        return PendingIntent.getActivity(
            applicationContext,
            requestCode++,
            intent,
            // MUTABLE because the system adds the request to this intent before
            // it is sent. An immutable one arrives with nothing to act on.
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
    }

    private companion object {
        var requestCode = 1000
    }
}
