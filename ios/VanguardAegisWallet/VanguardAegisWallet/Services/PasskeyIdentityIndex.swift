import AuthenticationServices
import Foundation

/// Telling iOS which passkeys this wallet holds.
///
/// Without this the extension still works, but only after the holder digs
/// through the AutoFill menu: the system builds its suggestions from the
/// credential identity store, and an empty store means Aegis ID is never
/// offered on the sign-in screen where it would actually be useful.
///
/// Kept in step from both processes — the extension after it creates one, the
/// app after it deletes one — because either can change the set.
enum PasskeyIdentityIndex {
    static func refresh() async {
        let store = ASCredentialIdentityStore.shared
        let state = await store.state()
        guard state.isEnabled else {
            // The holder has not turned the provider on. Nothing to sync, and
            // writing anyway throws rather than failing quietly.
            return
        }

        let identities: [ASCredentialIdentity] = PasskeyStore.shared.all().map { passkey in
            ASPasskeyCredentialIdentity(
                relyingPartyIdentifier: passkey.rpId,
                userName: passkey.accountLabel,
                credentialID: passkey.credentialIdData,
                userHandle: passkey.userHandleData,
                recordIdentifier: passkey.credentialId
            )
        }

        try? await store.replaceCredentialIdentities(identities)
    }

    /// Whether the holder has switched Aegis ID on in Settings. Shown in the
    /// app, because a passkey list that works only after an OS toggle needs to
    /// say so rather than looking broken.
    static func isProviderEnabled() async -> Bool {
        await ASCredentialIdentityStore.shared.state().isEnabled
    }
}
