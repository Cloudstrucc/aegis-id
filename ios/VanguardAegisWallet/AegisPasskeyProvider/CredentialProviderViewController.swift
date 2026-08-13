import AuthenticationServices
import LocalAuthentication
import SwiftUI
import UIKit

// The wallet answering the system's passkey prompts.
//
// iOS launches this extension — a separate process from the app — whenever a
// site asks for a passkey and the holder has turned Aegis ID on under
// Settings › General › AutoFill & Passwords. Everything it needs comes from the
// App Group container and the shared keychain group, because nothing in the
// app's own sandbox is visible from here.
//
// Same-device only, by construction. Signing in on a desktop by scanning a QR
// is the hybrid transport, which belongs to the operating system and is not
// offered to third-party providers on any platform.
final class CredentialProviderViewController: ASCredentialProviderViewController {
    private let store = PasskeyStore.shared

    // MARK: - Registration

    /// A site is creating a passkey and iOS has already asked the holder to
    /// pick this provider. The interface here only confirms; the choice of
    /// provider was made in the system sheet.
    override func prepareInterface(forPasskeyRegistration registrationRequest: ASCredentialRequest) {
        guard let request = registrationRequest as? ASPasskeyCredentialRequest,
              let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity
        else {
            PasskeyDiagnostics.record("registration rejected", detail: "not a passkey request")
            cancel(.failed)
            return
        }

        PasskeyDiagnostics.record("registration asked", detail: identity.relyingPartyIdentifier)

        present(
            PasskeyPromptView(
                title: "Create a passkey",
                relyingParty: identity.relyingPartyIdentifier,
                account: identity.userName,
                actionTitle: "Create passkey",
                explanation:
                    "A new key is generated on this device. The private half never leaves it and is not in any backup.",
                onConfirm: { [weak self] in self?.completeRegistration(request: request, identity: identity) },
                onCancel: { [weak self] in self?.cancel(.userCanceled) }
            )
        )
    }

    private func completeRegistration(request: ASPasskeyCredentialRequest, identity: ASPasskeyCredentialIdentity) {
        // ES256 only. Saying so by refusing anything else is better than
        // creating a key the relying party will reject after the fact.
        guard request.supportedAlgorithms.contains(.ES256) else {
            PasskeyDiagnostics.record(
                "registration rejected",
                detail: "site did not offer ES256: \(request.supportedAlgorithms.map(\.rawValue))"
            )
            cancel(.failed)
            return
        }

        Task { @MainActor in
            let verified = await verifyHolder(reason: "Create a passkey for \(identity.relyingPartyIdentifier)")
            guard verified else {
                PasskeyDiagnostics.record("registration cancelled", detail: "holder not verified")
                cancel(.userCanceled)
                return
            }

            do {
                let result = try PasskeyAuthenticator.createCredential(
                    rpId: identity.relyingPartyIdentifier,
                    userHandle: identity.userHandle,
                    userVerified: true
                )

                store.save(
                    StoredPasskey(
                        credentialId: result.credentialId.base64URLEncodedString(),
                        rpId: identity.relyingPartyIdentifier,
                        rpName: identity.relyingPartyIdentifier,
                        userHandle: identity.userHandle.base64URLEncodedString(),
                        userName: identity.userName,
                        userDisplayName: identity.userName,
                        signCount: 0,
                        createdAt: Date(),
                        lastUsedAt: nil
                    )
                )
                let credential = ASPasskeyRegistrationCredential(
                    relyingParty: identity.relyingPartyIdentifier,
                    clientDataHash: request.clientDataHash,
                    credentialID: result.credentialId,
                    attestationObject: result.attestationObject
                )

                PasskeyDiagnostics.record(
                    "registered",
                    detail: "\(identity.relyingPartyIdentifier) · attestation \(result.attestationObject.count)B"
                )

                // Answer the system first. Republishing the identity store is
                // housekeeping, and doing it before this held an in-flight
                // request open long enough for iOS to time the extension out —
                // which the site then reports as a flat "not allowed".
                await extensionContext.completeRegistrationRequest(using: credential)
                await PasskeyIdentityIndex.refresh()
            } catch {
                PasskeyDiagnostics.record("registration failed", detail: String(describing: error))
                cancel(.failed)
            }
        }
    }

    // MARK: - Assertion

    /// The system has a matching credential and wants it without showing our
    /// interface. Answering here is what makes a passkey sign-in one tap.
    override func provideCredentialWithoutUserInteraction(for credentialRequest: ASCredentialRequest) {
        guard let request = credentialRequest as? ASPasskeyCredentialRequest,
              let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity,
              let record = store.passkey(credentialId: identity.credentialID.base64URLEncodedString())
        else {
            cancel(.credentialIdentityNotFound)
            return
        }

        // The holder still has to be verified, and a biometric check needs an
        // interface. Telling the system so is what makes it show ours rather
        // than failing the request.
        guard canVerifyWithoutPrompting() else {
            cancel(.userInteractionRequired)
            return
        }

        Task { @MainActor in
            await sign(request: request, record: record, userVerified: true)
        }
    }

    /// The system needs the holder to confirm before we answer.
    override func prepareInterfaceToProvideCredential(for credentialRequest: ASCredentialRequest) {
        guard let request = credentialRequest as? ASPasskeyCredentialRequest,
              let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity,
              let record = store.passkey(credentialId: identity.credentialID.base64URLEncodedString())
        else {
            cancel(.credentialIdentityNotFound)
            return
        }

        present(
            PasskeyPromptView(
                title: "Sign in",
                relyingParty: record.rpId,
                account: record.accountLabel,
                actionTitle: "Use passkey",
                explanation: "This proves the key on this device without sending anything reusable.",
                onConfirm: { [weak self] in
                    Task { @MainActor in
                        let verified = await self?.verifyHolder(reason: "Sign in to \(record.rpId)") ?? false
                        guard verified else {
                            self?.cancel(.userCanceled)
                            return
                        }
                        await self?.sign(request: request, record: record, userVerified: true)
                    }
                },
                onCancel: { [weak self] in self?.cancel(.userCanceled) }
            )
        )
    }

    /// A site asked for a passkey without naming one, so the holder picks.
    override func prepareCredentialList(
        for serviceIdentifiers: [ASCredentialServiceIdentifier],
        requestParameters: ASPasskeyCredentialRequestParameters
    ) {
        let matches = store.passkeys(forRpId: requestParameters.relyingPartyIdentifier)

        guard !matches.isEmpty else {
            present(
                PasskeyEmptyView(
                    relyingParty: requestParameters.relyingPartyIdentifier,
                    onCancel: { [weak self] in self?.cancel(.credentialIdentityNotFound) }
                )
            )
            return
        }

        present(
            PasskeyChooserView(
                relyingParty: requestParameters.relyingPartyIdentifier,
                passkeys: matches,
                onSelect: { [weak self] record in
                    Task { @MainActor in
                        let verified = await self?.verifyHolder(reason: "Sign in to \(record.rpId)") ?? false
                        guard verified else { return }
                        await self?.sign(
                            clientDataHash: requestParameters.clientDataHash,
                            record: record,
                            userVerified: true
                        )
                    }
                },
                onCancel: { [weak self] in self?.cancel(.userCanceled) }
            )
        )
    }

    // MARK: - Signing

    private func sign(request: ASPasskeyCredentialRequest, record: StoredPasskey, userVerified: Bool) async {
        await sign(clientDataHash: request.clientDataHash, record: record, userVerified: userVerified)
    }

    private func sign(clientDataHash: Data, record: StoredPasskey, userVerified: Bool) async {
        do {
            PasskeyDiagnostics.record("assertion asked", detail: record.rpId)
            let signCount = store.recordUse(credentialId: record.credentialId)
            let result = try PasskeyAuthenticator.assert(
                rpId: record.rpId,
                credentialId: record.credentialIdData,
                clientDataHash: clientDataHash,
                signCount: signCount,
                userVerified: userVerified
            )

            let credential = ASPasskeyAssertionCredential(
                userHandle: record.userHandleData,
                relyingParty: record.rpId,
                signature: result.signature,
                clientDataHash: clientDataHash,
                authenticatorData: result.authenticatorData,
                credentialID: record.credentialIdData
            )
            await extensionContext.completeAssertionRequest(using: credential)
            PasskeyDiagnostics.record("assertion completed", detail: record.rpId)
        } catch {
            PasskeyDiagnostics.record("assertion failed", detail: String(describing: error))
            cancel(.failed)
        }
    }

    // MARK: - Holder verification

    /// Face ID, Touch ID, or the passcode.
    ///
    /// A passkey is possession plus inherence, and skipping this would leave
    /// only possession — the same assurance as an unlocked phone in someone
    /// else's hand.
    private func verifyHolder(reason: String) async -> Bool {
        let context = LAContext()
        context.localizedCancelTitle = "Cancel"
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else {
            return false
        }
        return await withCheckedContinuation { continuation in
            context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
                continuation.resume(returning: success)
            }
        }
    }

    private func canVerifyWithoutPrompting() -> Bool {
        // There is no such thing: every verification shows something. Reporting
        // that interaction is required is the honest answer, and the system
        // then calls prepareInterfaceToProvideCredential.
        false
    }

    // MARK: - Presentation

    private func present<Content: View>(_ view: Content) {
        let host = UIHostingController(rootView: view)
        addChild(host)
        host.view.frame = self.view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        self.view.addSubview(host.view)
        host.didMove(toParent: self)
    }

    private func cancel(_ code: ASExtensionError.Code) {
        extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: code.rawValue))
    }
}
