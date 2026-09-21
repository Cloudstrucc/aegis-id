import SwiftUI

/// The gate in front of a registered wallet.
///
/// Shown whenever the wallet is locked — a cold launch, or a return from the
/// background. It offers whichever method the holder set up: their PIN, or the
/// device's Face ID / Touch ID. Biometric prompts itself on appear so the
/// common case is a single glance.
struct WalletLockView: View {
    @EnvironmentObject private var store: WalletStore
    @State private var pin = ""
    @State private var errorMessage: String?
    @State private var attempts = 0

    var body: some View {
        VStack(spacing: 22) {
            Spacer()

            VanguardLogoMark()
            Text("Aegis ID Wallet").font(.title2.bold())
            Text("Unlock to continue.").foregroundStyle(.secondary)

            if store.lockMethod == .pin {
                VStack(spacing: 12) {
                    SecureField("PIN", text: $pin)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.center)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 220)
                        .onChange(of: pin) { _, value in
                            pin = String(value.filter(\.isNumber).prefix(12))
                        }
                    Button("Unlock") { submitPin() }
                        .buttonStyle(.borderedProminent)
                        .disabled(pin.count < 4)
                    // A PIN holder can still fall back to the device biometric
                    // if the device has one — convenient, and a way in if the
                    // PIN is forgotten momentarily.
                    if WalletLock.biometricsAvailable() {
                        Button("Use Face ID / Touch ID instead") { Task { await tryBiometric() } }
                            .font(.footnote)
                    }
                }
            } else {
                Button {
                    Task { await tryBiometric() }
                } label: {
                    Label("Unlock with Face ID / Touch ID", systemImage: "faceid")
                }
                .buttonStyle(.borderedProminent)
            }

            if let errorMessage {
                Text(errorMessage).font(.footnote).foregroundStyle(.red)
            }

            Spacer()

            Button("Recover a different wallet") { store.clearLocalIdentity() }
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(24)
        .task {
            if store.lockMethod == .biometric {
                await tryBiometric()
            }
        }
    }

    private func submitPin() {
        if store.unlockWithPin(pin) {
            pin = ""
            errorMessage = nil
        } else {
            attempts += 1
            pin = ""
            errorMessage = "That PIN did not match. Try again\(attempts >= 3 ? ", or recover your wallet below." : ".")"
        }
    }

    private func tryBiometric() async {
        let ok = await store.unlockWithBiometric()
        if !ok {
            errorMessage = "Face ID / Touch ID did not verify."
        } else {
            errorMessage = nil
        }
    }
}

/// The shield mark, small, for the lock screen. Falls back to text if the asset
/// is missing.
private struct VanguardLogoMark: View {
    var body: some View {
        // Adaptive: the colour mark on a light ground, the white mark on dark.
        Image("AegisMark").resizable().scaledToFit().frame(height: 48)
            .accessibilityLabel("Aegis ID")
    }
}
