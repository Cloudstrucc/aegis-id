import Foundation

struct AriesInvitation: Codable, Equatable, Hashable, Identifiable {
    var id: String
    var label: String
    var rawURL: String
    var endpoint: String?
    var handshakeProtocols: [String]
    var services: [String]
    var receivedAt: Date
}

struct WalletConnection: Codable, Equatable, Hashable, Identifiable {
    var id: UUID
    var invitation: AriesInvitation
    var state: WalletConnectionState
    var createdAt: Date
    var updatedAt: Date

    init(invitation: AriesInvitation) {
        self.id = UUID()
        self.invitation = invitation
        self.state = .invitationReceived
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}

enum WalletConnectionState: String, Codable, Hashable, CaseIterable {
    case invitationReceived
    case readyForDidExchange
    case connected
    case failed

    var title: String {
        switch self {
        case .invitationReceived:
            return "Invitation received"
        case .readyForDidExchange:
            return "Ready for DID exchange"
        case .connected:
            return "Connected"
        case .failed:
            return "Needs attention"
        }
    }

    var symbolName: String {
        switch self {
        case .invitationReceived:
            return "tray.and.arrow.down"
        case .readyForDidExchange:
            return "arrow.triangle.2.circlepath"
        case .connected:
            return "checkmark.seal"
        case .failed:
            return "exclamationmark.triangle"
        }
    }
}
