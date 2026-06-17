package ca.vanguardcs.aegisid.wallet.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.ListAlt
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.Button
import androidx.compose.material3.ElevatedButton
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ca.vanguardcs.aegisid.wallet.BuildConfig
import ca.vanguardcs.aegisid.wallet.data.WalletStore
import ca.vanguardcs.aegisid.wallet.model.CredentialOrganization
import ca.vanguardcs.aegisid.wallet.model.OrganizationCredential
import ca.vanguardcs.aegisid.wallet.model.OrganizationProfile
import ca.vanguardcs.aegisid.wallet.model.WalletConnection
import ca.vanguardcs.aegisid.wallet.model.WalletConnectionState
import ca.vanguardcs.aegisid.wallet.model.WalletTransaction
import ca.vanguardcs.aegisid.wallet.model.WalletTransactionStatus
import ca.vanguardcs.aegisid.wallet.model.WalletTransactionType
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletApp(store: WalletStore) {
    var selectedTab by rememberSaveable { mutableStateOf(WalletTab.Home) }

    LaunchedEffect(Unit) {
        store.autoRefreshOidcWalletChallenges()
    }

    VanguardAegisTheme {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text(selectedTab.title, fontWeight = FontWeight.Bold) },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = VanguardColors.Mist,
                        titleContentColor = VanguardColors.Ink
                    )
                )
            },
            bottomBar = {
                NavigationBar(containerColor = Color.White) {
                    WalletTab.entries.forEach { tab ->
                        NavigationBarItem(
                            selected = selectedTab == tab,
                            onClick = { selectedTab = tab },
                            icon = {
                                Box {
                                    Icon(tab.icon, contentDescription = null)
                                    if (tab == WalletTab.Ledger && store.pendingChallengeCount > 0) {
                                        Text(
                                            text = store.pendingChallengeCount.toString(),
                                            color = Color.White,
                                            style = MaterialTheme.typography.labelSmall,
                                            modifier = Modifier
                                                .align(Alignment.TopEnd)
                                                .background(VanguardColors.Green, RoundedCornerShape(100.dp))
                                                .padding(horizontal = 5.dp)
                                        )
                                    }
                                }
                            },
                            label = { Text(tab.navLabel) }
                        )
                    }
                }
            }
        ) { padding ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(VanguardColors.Mist)
                    .padding(padding)
            ) {
                when (selectedTab) {
                    WalletTab.Home -> HomeScreen(store)
                    WalletTab.Scan -> ScanScreen(store)
                    WalletTab.Organizations -> OrganizationsScreen(store)
                    WalletTab.Ledger -> LedgerScreen(store)
                    WalletTab.Connections -> ConnectionsScreen(store)
                    WalletTab.Settings -> SettingsScreen()
                }

                store.challengeBanner?.let { banner ->
                    AegisCard(
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .padding(12.dp)
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.Shield, contentDescription = null, tint = VanguardColors.Blue)
                            Column(Modifier.weight(1f)) {
                                Text(banner.title, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(banner.detail, color = Color.Gray, style = MaterialTheme.typography.bodySmall, maxLines = 2)
                            }
                            Button(onClick = {
                                selectedTab = WalletTab.Ledger
                                store.dismissChallengeBanner()
                            }) {
                                Text("Open")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HomeScreen(store: WalletStore) {
    var pastedInvitation by rememberSaveable { mutableStateOf("") }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            HeroPanel(
                connections = store.connections.size,
                organizations = store.credentialOrganizations.size,
                events = store.transactions.size
            )
        }

        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                MetricCard("Credential orgs", store.credentialOrganizations.size.toString(), Modifier.weight(1f))
                MetricCard("Pending actions", store.pendingTransactionCount.toString(), Modifier.weight(1f))
            }
        }

        item {
            val pending = store.latestPendingInvitation
            if (pending != null) {
                AegisCard {
                    StatusBadge("Ready to accept")
                    Text(pending.invitation.label, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(
                        "This invitation is saved locally. Accept it through the hosted lab bridge before issuing credentials or fetching web app wallet challenges.",
                        color = Color.Gray
                    )
                    Button(
                        onClick = { store.acceptLatestInvitationInLab() },
                        enabled = !store.isWorking,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Accept invitation in lab")
                    }
                    FeedbackMessages(
                        isWorking = store.isWorking,
                        importMessage = store.lastImportMessage,
                        importError = store.lastImportError,
                        labMessage = store.lastLabMessage,
                        labError = store.lastLabError
                    )
                }
            } else {
                AegisCard {
                    StatusBadge("Ready for QR import", VanguardColors.Green)
                    Text("Start with an issuer invitation", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(
                        "Scan a QR deep link or paste an Aegis ID issuer invitation from the web dashboard. Accepted organizations appear in the Organizations tab.",
                        color = Color.Gray
                    )
                }
            }
        }

        item {
            AegisCard {
                Text("Paste invitation", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                OutlinedTextField(
                    value = pastedInvitation,
                    onValueChange = { pastedInvitation = it },
                    minLines = 4,
                    placeholder = { Text("aegisid://invite?oob=...") },
                    modifier = Modifier.fillMaxWidth()
                )
                Button(
                    onClick = {
                        store.importInvitation(pastedInvitation)
                        pastedInvitation = ""
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Import invitation")
                }
            }
        }
    }
}

@Composable
private fun ScanScreen(store: WalletStore) {
    var value by rememberSaveable { mutableStateOf("") }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            AegisCard {
                StatusBadge("Android pilot", VanguardColors.Cyan)
                Text("Scan or paste invitation", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(
                    "For this Android pilot, use the phone camera to open the QR deep link, or paste the invitation URL below. Native camera scanning can be added with ML Kit once the testing flow is settled.",
                    color = Color.Gray
                )
                OutlinedTextField(
                    value = value,
                    onValueChange = { value = it },
                    minLines = 5,
                    placeholder = { Text("Paste raw or aegisid:// invitation") },
                    modifier = Modifier.fillMaxWidth()
                )
                Button(
                    onClick = {
                        store.importInvitation(value)
                        value = ""
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Import invitation")
                }
                FeedbackMessages(
                    isWorking = store.isWorking,
                    importMessage = store.lastImportMessage,
                    importError = store.lastImportError,
                    labMessage = store.lastLabMessage,
                    labError = store.lastLabError
                )
            }
        }
    }
}

@Composable
private fun OrganizationsScreen(store: WalletStore) {
    LaunchedEffect(Unit) {
        store.refreshOrganizationProfiles()
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Credential organizations", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                IconButton(onClick = { store.refreshOrganizationProfiles() }) {
                    Icon(Icons.Outlined.Refresh, contentDescription = "Refresh organization profiles")
                }
            }
        }

        if (store.credentialOrganizations.isEmpty()) {
            item {
                EmptyState(
                    "No credential organizations",
                    "Accept a Vanguard Aegis ID issuer invitation to see the organizations you hold credentials or wallet challenge history for."
                )
            }
        } else {
            items(store.credentialOrganizations, key = { it.id }) { organization ->
                OrganizationCard(
                    organization = organization,
                    profile = store.organizationProfile(organization.id),
                    transactions = store.transactionsForOrganization(organization.id)
                )
            }
        }
    }
}

@Composable
private fun LedgerScreen(store: WalletStore) {
    val challengeTransactions = store.transactions
        .filter { it.type == WalletTransactionType.Challenge }
        .sortedByDescending { it.createdAt }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        if (challengeTransactions.isEmpty()) {
            item {
                EmptyState(
                    "No wallet ledger entries",
                    "Fetch connected app challenges after Verified ID or YubiKey web sign-in, then accept them to build a local high-assurance action ledger."
                )
            }
        } else {
            items(challengeTransactions, key = { it.id }) { transaction ->
                TransactionCard(transaction = transaction, onAccept = { store.acceptTransaction(transaction) })
            }
        }
    }
}

@Composable
private fun ConnectionsScreen(store: WalletStore) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        if (store.connections.isEmpty()) {
            item {
                EmptyState("No connections", "Import an Aries out-of-band invitation from the web dashboard.")
            }
        } else {
            items(store.connections, key = { it.id }) { connection ->
                ConnectionCard(connection = connection, store = store)
            }
        }
    }
}

@Composable
private fun SettingsScreen() {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            AegisCard {
                VanguardLogo()
                KeyValue("Organization", "Vanguard Cloud Services")
                KeyValue("Wallet", "Aegis ID Wallet")
                KeyValue("Mode", "Aries lab")
                KeyValue("Lab transport", "Hosted bridge")
                KeyValue("Web app", BuildConfig.AEGIS_WEB_APP_BASE_URL)
            }
        }
        item {
            AegisCard {
                Text("Protocol", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                KeyValue("Invitation", "Out-of-Band 1.1")
                KeyValue("Handshake", "DIDExchange 1.0")
                KeyValue("Credential engine", "Lab bridge")
                Text(
                    "This Android pilot sends lab actions to the hosted Aegis ID bridge, which talks to ACA-Py with server-side admin credentials. It is not a production wallet engine and should not be used with real credentials.",
                    color = Color.Gray
                )
            }
        }
    }
}

@Composable
private fun MetricCard(title: String, value: String, modifier: Modifier = Modifier) {
    AegisCard(modifier) {
        Text(value, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(title, color = Color.Gray, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun ConnectionCard(connection: WalletConnection, store: WalletStore) {
    AegisCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(connection.invitation.label, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(connection.invitation.endpoint ?: "Endpoint pending", color = Color.Gray, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            StatusBadge(connection.state.title, statusTint(connection.state))
        }

        if (connection.invitation.organizationName != null) {
            KeyValue("Organization", connection.invitation.organizationName)
        }
        KeyValue("Holder connection", connection.holderConnectionId)
        KeyValue("Issuer connection", connection.issuerConnectionId)

        Button(
            onClick = { store.acceptInLab(connection) },
            enabled = !store.isWorking && connection.holderConnectionId == null,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Accept invitation in lab")
        }
        OutlinedButton(
            onClick = { store.issueMockCredential(connection) },
            enabled = !store.isWorking && connection.issuerConnectionId != null,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Issue mock credential")
        }
        OutlinedButton(
            onClick = { store.sendWalletChallenge(connection) },
            enabled = !store.isWorking && connection.issuerConnectionId != null,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Send wallet challenge")
        }
        OutlinedButton(
            onClick = { store.refreshOidcWalletChallenges(connection) },
            enabled = !store.isWorking && connection.issuerConnectionId != null,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Fetch OIDC challenges")
        }
        OutlinedButton(
            onClick = { store.deleteConnection(connection) },
            enabled = !store.isWorking,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Delete local connection")
        }

        FeedbackMessages(
            isWorking = store.isWorking,
            importMessage = null,
            importError = null,
            labMessage = store.lastLabMessage,
            labError = store.lastLabError
        )
    }
}

@Composable
private fun TransactionCard(transaction: WalletTransaction, onAccept: () -> Unit) {
    AegisCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(transaction.appName ?: "Aegis ID", style = MaterialTheme.typography.labelMedium, color = Color.Gray, fontWeight = FontWeight.Bold)
                Text(transaction.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
            StatusBadge(transaction.status.title, transactionStatusTint(transaction.status))
        }

        Text(transaction.detail, color = Color.Gray)
        if (transaction.resourceType != null && transaction.resourceId != null) {
            KeyValue("Resource", "${transaction.resourceType}: ${transaction.resourceId}")
        }
        if (transaction.remoteId != null) {
            KeyValue("Nonce", transaction.remoteId)
        }
        if (transaction.payloadFields.isNotEmpty()) {
            transaction.payloadFields.forEach { field ->
                KeyValue(field.key, field.value)
            }
        }
        KeyValue("Created", formatDate(transaction.createdAt))
        if (transaction.status == WalletTransactionStatus.PendingAcceptance || transaction.status == WalletTransactionStatus.Received || transaction.status == WalletTransactionStatus.Failed) {
            ElevatedButton(onClick = onAccept, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Outlined.CheckCircle, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.size(8.dp))
                Text(actionButtonTitle(transaction))
            }
        }
    }
}

@Composable
private fun OrganizationCard(
    organization: CredentialOrganization,
    profile: OrganizationProfile?,
    transactions: List<WalletTransaction>
) {
    val branding = profile?.branding
    val primary = colorFromHex(branding?.primaryColor, VanguardColors.Blue)
    val accent = colorFromHex(branding?.accentColor, VanguardColors.Green)
    val background = colorFromHex(branding?.backgroundColor, Color.White)

    AegisCard {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(background, RoundedCornerShape(8.dp))
                .padding(16.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(
                        modifier = Modifier
                            .size(54.dp)
                            .background(primary, RoundedCornerShape(8.dp)),
                        contentAlignment = Alignment.Center
                    ) {
                        Text((profile?.organizationName ?: organization.name).take(1).uppercase(), color = Color.White, fontWeight = FontWeight.Bold)
                    }
                    Column {
                        Text(profile?.organizationName ?: organization.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text("Aegis ID credential context", color = Color.Gray)
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatusBadge(organization.latestState.title, primary)
                    StatusBadge("Holder view", accent)
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            MetricCard("Connections", organization.connectionCount.toString(), Modifier.weight(1f))
            MetricCard("Pending", transactions.count { it.status == WalletTransactionStatus.PendingAcceptance }.toString(), Modifier.weight(1f))
        }

        if (profile == null) {
            Text("Profile not synced yet. Use refresh from the Organizations tab.", color = Color.Gray)
        } else {
            if (organization.latestState == WalletConnectionState.Disabled) {
                Text(
                    "This organization is disabled in your wallet because credential access has been revoked. It remains visible for audit history.",
                    color = Color(0xFFC23B32),
                    fontWeight = FontWeight.SemiBold
                )
            }
            if (profile.orgUnits.isNotEmpty()) {
                Text("Organization structure", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                profile.orgUnits.take(6).forEach { unit ->
                    KeyValue("  ".repeat(unit.depth) + unit.name, unit.description ?: "Division")
                }
            }
            Text("Credentials and claims", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            profile.credentials.take(4).forEach { credential ->
                CredentialCard(credential)
            }
        }
    }
}

@Composable
private fun CredentialCard(credential: OrganizationCredential) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(VanguardColors.Mist, RoundedCornerShape(8.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row {
            Column(Modifier.weight(1f)) {
                Text(credential.displayName, fontWeight = FontWeight.Bold)
                Text(credential.holderEmail, color = Color.Gray, style = MaterialTheme.typography.bodySmall)
            }
            StatusBadge(credential.status, if (credential.status == "revoked") Color.Gray else VanguardColors.Green)
        }
        if (credential.roles.isNotEmpty()) {
            Text("Roles: ${credential.roles.joinToString { it.name }}", color = VanguardColors.Blue, fontWeight = FontWeight.SemiBold)
        }
        credential.claims.entries.take(6).forEach { (key, value) ->
            KeyValue(key, value)
        }
    }
}

private fun statusTint(state: WalletConnectionState): Color = when (state) {
    WalletConnectionState.Connected, WalletConnectionState.CredentialOffered -> VanguardColors.Green
    WalletConnectionState.ChallengeReceived, WalletConnectionState.ReadyForDidExchange -> VanguardColors.Blue
    WalletConnectionState.Disabled -> Color.Gray
    WalletConnectionState.Failed -> Color(0xFFC23B32)
    WalletConnectionState.InvitationReceived -> VanguardColors.Cyan
}

private fun transactionStatusTint(status: WalletTransactionStatus): Color = when (status) {
    WalletTransactionStatus.Accepted, WalletTransactionStatus.Sent -> VanguardColors.Green
    WalletTransactionStatus.PendingAcceptance, WalletTransactionStatus.Received -> VanguardColors.Blue
    WalletTransactionStatus.Failed -> Color(0xFFC23B32)
}

private fun actionButtonTitle(transaction: WalletTransaction): String {
    val action = transaction.action
        ?.replace("-", " ")
        ?.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
        ?: if (transaction.type == WalletTransactionType.Credential) "Accept credential" else "Accept challenge"
    val resourceType = transaction.resourceType?.takeIf { it.isNotBlank() }
    return if (resourceType == null) action else "$action ${resourceType.lowercase()}"
}

private fun formatDate(timestamp: Long): String =
    DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(timestamp))

private enum class WalletTab(
    val title: String,
    val navLabel: String,
    val icon: ImageVector
) {
    Home("Aegis ID", "Home", Icons.Outlined.Home),
    Scan("Scan", "Scan", Icons.Outlined.QrCodeScanner),
    Organizations("Organizations", "Orgs", Icons.Outlined.Business),
    Ledger("Ledger", "Ledger", Icons.Outlined.ListAlt),
    Connections("Connections", "Links", Icons.Outlined.Link),
    Settings("Settings", "Settings", Icons.Outlined.Settings)
}
