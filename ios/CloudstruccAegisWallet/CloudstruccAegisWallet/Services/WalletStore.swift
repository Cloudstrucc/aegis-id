import Foundation

@MainActor
final class WalletStore: ObservableObject {
    @Published private(set) var connections: [WalletConnection] = []
    @Published var lastImportMessage: String?
    @Published var lastImportError: String?

    private let storageKey = "cloudstrucc.aegis.wallet.connections"

    init() {
        load()
    }

    func importInvitation(from rawText: String) {
        lastImportMessage = nil
        lastImportError = nil

        do {
            let invitation = try OOBInvitationParser.parse(rawText)
            if connections.contains(where: { $0.invitation.id == invitation.id }) {
                lastImportMessage = "Invitation already saved."
                return
            }

            connections.insert(WalletConnection(invitation: invitation), at: 0)
            save()
            lastImportMessage = "Invitation saved."
        } catch {
            lastImportError = error.localizedDescription
        }
    }

    func markReadyForDidExchange(_ connection: WalletConnection) {
        update(connection) { item in
            item.state = .readyForDidExchange
        }
    }

    func markConnected(_ connection: WalletConnection) {
        update(connection) { item in
            item.state = .connected
        }
    }

    func deleteConnections(at offsets: IndexSet) {
        connections.remove(atOffsets: offsets)
        save()
    }

    private func update(_ connection: WalletConnection, mutate: (inout WalletConnection) -> Void) {
        guard let index = connections.firstIndex(where: { $0.id == connection.id }) else {
            return
        }

        mutate(&connections[index])
        connections[index].updatedAt = Date()
        save()
    }

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: storageKey) else {
            return
        }

        do {
            connections = try JSONDecoder.walletDecoder.decode([WalletConnection].self, from: data)
        } catch {
            connections = []
            lastImportError = "Stored wallet state could not be loaded."
        }
    }

    private func save() {
        do {
            let data = try JSONEncoder.walletEncoder.encode(connections)
            UserDefaults.standard.set(data, forKey: storageKey)
        } catch {
            lastImportError = "Wallet state could not be saved."
        }
    }
}

extension JSONDecoder {
    static var walletDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

extension JSONEncoder {
    static var walletEncoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
