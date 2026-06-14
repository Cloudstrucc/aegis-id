import SwiftUI

struct ConnectionsView: View {
    @EnvironmentObject private var store: WalletStore

    var body: some View {
        List {
            if store.connections.isEmpty {
                ContentUnavailableView(
                    "No connections",
                    systemImage: "link.badge.plus",
                    description: Text("Import an Aries out-of-band invitation.")
                )
            } else {
                ForEach(store.connections) { connection in
                    NavigationLink(value: connection) {
                        ConnectionRow(connection: connection)
                    }
                }
                .onDelete(perform: store.deleteConnections)
            }
        }
        .navigationTitle("Connections")
        .navigationDestination(for: WalletConnection.self) { connection in
            ConnectionDetailView(connection: connection)
        }
    }
}

private struct ConnectionRow: View {
    var connection: WalletConnection

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(connection.invitation.label)
                    .font(.headline)
                Spacer()
                Image(systemName: connection.state.symbolName)
                    .foregroundStyle(CloudstruccTheme.blue)
            }

            Text(connection.invitation.endpoint ?? "Endpoint pending")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            StatusBadge(text: connection.state.title, systemImage: connection.state.symbolName)
        }
        .padding(.vertical, 4)
    }
}

private struct ConnectionDetailView: View {
    @EnvironmentObject private var store: WalletStore
    var connection: WalletConnection

    var body: some View {
        List {
            Section("Connection") {
                LabeledContent("Label", value: connection.invitation.label)
                LabeledContent("State", value: connection.state.title)
                LabeledContent("Endpoint", value: connection.invitation.endpoint ?? "Unknown")
            }

            Section("Handshake") {
                if connection.invitation.handshakeProtocols.isEmpty {
                    Text("No handshake protocols advertised.")
                } else {
                    ForEach(connection.invitation.handshakeProtocols, id: \.self) { item in
                        Text(item)
                    }
                }
            }

            Section("Services") {
                if connection.invitation.services.isEmpty {
                    Text("No services advertised.")
                } else {
                    ForEach(connection.invitation.services, id: \.self) { item in
                        Text(item)
                            .textSelection(.enabled)
                    }
                }
            }

            Section {
                Button {
                    store.markReadyForDidExchange(connection)
                } label: {
                    Label("Ready for DID exchange", systemImage: "arrow.triangle.2.circlepath")
                }

                Button {
                    store.markConnected(connection)
                } label: {
                    Label("Mark connected", systemImage: "checkmark.seal")
                }
            }
        }
        .navigationTitle(connection.invitation.label)
    }
}

#Preview {
    NavigationStack {
        ConnectionsView()
            .environmentObject(WalletStore())
    }
}
