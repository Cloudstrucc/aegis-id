package ca.vanguardcs.aegisid.wallet.ui

import androidx.compose.foundation.background
import kotlinx.coroutines.launch
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.AlertDialog
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.clickable
import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.ListAlt
import androidx.compose.material.icons.outlined.OpenInBrowser
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
import androidx.compose.material3.TextButton
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
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletApp(
    store: WalletStore,
    onCreatePasskey: suspend (String) -> JSONObject,
    onGetPasskey: suspend (String) -> JSONObject
) {
    var showRecovery by rememberSaveable { mutableStateOf(false) }

    // The theme wraps both branches: the setup gate is a full screen of its own
    // rather than a tab, so it would otherwise render in Material's defaults.
    VanguardAegisTheme {
        // Setup gate: no credential can bind to this wallet until it has a
        // Wallet ID, so the tabs stay unavailable until registration finishes.
        // Existing connections and transactions are untouched by this.
        if (!store.isWalletRegistered) {
            if (showRecovery) {
                WalletRecoveryScreen(store = store, onCancel = { showRecovery = false })
            } else {
                WalletSetupScreen(store = store, onRecoverInstead = { showRecovery = true })
            }
        } else {
            WalletTabs(store, onCreatePasskey, onGetPasskey)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WalletTabs(
    store: WalletStore,
    onCreatePasskey: suspend (String) -> JSONObject,
    onGetPasskey: suspend (String) -> JSONObject
) {
    val router = remember { WalletRouter() }
    var showHelp by rememberSaveable { mutableStateOf(false) }

    // The flash clears itself; the challenge banner never does, because that one
    // is waiting for an answer.
    LaunchedEffect(router.flash) {
        if (router.flash != null) {
            kotlinx.coroutines.delay(3_400)
            router.dismissFlash()
        }
    }

    LaunchedEffect(Unit) {
        store.autoRefreshOidcWalletChallenges()
    }

    run {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Text(
                            if (showHelp) "Getting started" else router.selectedTab.title,
                            fontWeight = FontWeight.Bold
                        )
                    },
                    // Present on every tab, not only during onboarding: the
                    // questions it answers — where the web app is, how to add a
                    // second organization — come up long after the first run.
                    actions = {
                        IconButton(onClick = { showHelp = !showHelp }) {
                            Icon(
                                if (showHelp) Icons.Outlined.Close else Icons.AutoMirrored.Outlined.HelpOutline,
                                contentDescription = if (showHelp) "Close" else "Getting started",
                                tint = VanguardColors.Ink
                            )
                        }
                    },
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
                            selected = router.selectedTab == tab,
                            onClick = { router.show(tab) },
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
                if (showHelp) {
                    WalletHelpScreen()
                } else when (router.selectedTab) {
                    WalletTab.Home -> HomeScreen(store, router)
                    WalletTab.Scan -> ScanScreen(store, router)
                    WalletTab.Organizations -> OrganizationsScreen(store, router)
                    WalletTab.Ledger -> LedgerScreen(store, onGetPasskey)
                    WalletTab.Connections -> ConnectionsScreen(store, router)
                    WalletTab.Settings -> SettingsScreen(store, onCreatePasskey, router)
                }

                router.flash?.let { notice ->
                    Box(modifier = Modifier.align(Alignment.TopCenter).padding(top = 10.dp)) {
                        FlashNoticeBanner(notice) { router.dismissFlash() }
                    }
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
                                router.show(WalletTab.Ledger)
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
private fun HomeScreen(store: WalletStore, router: WalletRouter) {
    var pastedInvitation by rememberSaveable { mutableStateOf("") }
    var isImportFieldShown by rememberSaveable { mutableStateOf(false) }
    var importResult by remember { mutableStateOf<Pair<Boolean, String>?>(null) }
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()

    importResult?.let { (succeeded, message) ->
        AlertDialog(
            onDismissRequest = { importResult = null },
            title = { Text(if (succeeded) "Invitation imported" else "That did not work") },
            text = { Text(message) },
            confirmButton = {
                TextButton(onClick = { importResult = null }) { Text("OK") }
            }
        )
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            HeroPanel(
                connections = store.connections.size,
                organizations = store.credentialOrganizations.size,
                events = store.transactions.size,
                onConnections = { router.openConnections() },
                onOrganizations = { router.show(WalletTab.Organizations) },
                onEvents = { router.show(WalletTab.Ledger) }
            )
        }

        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                MetricCard("Credential orgs", store.credentialOrganizations.size.toString(), Modifier.weight(1f))
                MetricCard("Pending actions", store.pendingTransactionCount.toString(), Modifier.weight(1f))
            }
        }

        // What to do next, and the ways to do it.
        //
        // This replaced a card that showed the pending invitation's own label —
        // which on a lab connection is the ACA-Py agent's name, so the first
        // thing a holder read was "VCS Issuer". It named an implementation
        // detail and told them nothing about what to do.
        item {
            AegisCard {
                StatusBadge(
                    if (store.credentialOrganizations.isEmpty()) "Nothing here yet" else "Ready",
                    VanguardColors.Green
                )
                Text(
                    if (store.credentialOrganizations.isEmpty())
                        "Start with an invitation"
                    else
                        "Scan or paste anything Aegis sends you",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "An invitation to join an organization, a request to approve something, a document to " +
                        "sign, or a sign-in to confirm — they all arrive the same way. Scan the code if it " +
                        "is on another screen, or paste the link if it reached this phone; you cannot scan " +
                        "a code with the device showing it.",
                    color = Color.Gray
                )

                Button(
                    onClick = { router.show(WalletTab.Scan) },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Outlined.QrCodeScanner, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text("  Scan a QR code")
                }

                OutlinedButton(
                    onClick = { isImportFieldShown = !isImportFieldShown },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(if (isImportFieldShown) "Hide the invitation box" else "Import invitation")
                }

                // Revealed by the button above rather than always present, so
                // the screen leads with what to do instead of with an empty box.
                AnimatedVisibility(visible = isImportFieldShown) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedTextField(
                            value = pastedInvitation,
                            onValueChange = { pastedInvitation = it },
                            minLines = 4,
                            placeholder = { Text("Paste the aegisid:// link from the invitation") },
                            // An invitation is a URL, and autocorrect turns
                            // "aegisid-local://" into prose.
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Uri,
                                autoCorrectEnabled = false,
                                capitalization = KeyboardCapitalization.None
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )
                        Button(
                            onClick = {
                                val pasted = pastedInvitation.trim()
                                store.importInvitation(pasted)
                                scope.launch {
                                    // The product path accepts over the network,
                                    // so the outcome is read once it settles.
                                    kotlinx.coroutines.delay(900)
                                    val error = store.lastImportError ?: store.lastLabError
                                    if (error != null) {
                                        importResult = false to error
                                    } else {
                                        importResult = true to (store.lastImportMessage
                                            ?: store.lastLabMessage ?: "Invitation imported.")
                                        pastedInvitation = ""
                                        isImportFieldShown = false
                                    }
                                }
                            },
                            enabled = pastedInvitation.isNotBlank(),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Import")
                        }
                    }
                }

                HorizontalDivider()

                // Somebody who arrived from the Play listing has no idea what
                // the service behind this app is. The brief answers that; the
                // sign-in page would not.
                OutlinedButton(
                    onClick = { openProductBrief(context) },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Outlined.OpenInBrowser, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text("  Open the web app")
                }
                Text(
                    "Read what Aegis ID does and how your organization uses it.",
                    color = Color.Gray,
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }
}

@Composable
private fun ScanScreen(store: WalletStore, router: WalletRouter) {
    var value by rememberSaveable { mutableStateOf("") }
    val scope = rememberCoroutineScope()
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
                    "For this Android pilot, use the phone camera to open the QR deep link, or paste the credential, OpenID VC, or Aries invitation URL below. Native camera scanning can be added with ML Kit once the testing flow is settled.",
                    color = Color.Gray
                )
                OutlinedTextField(
                    value = value,
                    onValueChange = { value = it },
                    minLines = 5,
                    placeholder = { Text("Paste raw, aegisid://, or openid-vc:// invitation") },
                    modifier = Modifier.fillMaxWidth()
                )
                Button(
                    onClick = {
                        store.importInvitation(value)
                        value = ""
                        // A successful import leaves this screen. The ledger is
                        // where the thing that just arrived actually lives.
                        scope.launch {
                            kotlinx.coroutines.delay(900)
                            val error = store.lastImportError ?: store.lastLabError
                            if (error != null) {
                                router.flash(FlashNotice(error, succeeded = false))
                            } else {
                                router.flash(
                                    FlashNotice(
                                        store.lastImportMessage ?: store.lastLabMessage
                                            ?: "Invitation imported."
                                    )
                                )
                                router.show(WalletTab.Ledger)
                            }
                        }
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
private fun OrganizationsScreen(store: WalletStore, router: WalletRouter) {
    var openedOrganizationId by rememberSaveable { mutableStateOf<String?>(null) }
    var ledgerOrganizationId by rememberSaveable { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        store.refreshOrganizationProfiles()
    }

    // Another tab can open one organization directly — picking a connection in
    // Settings lands here rather than on the list.
    LaunchedEffect(router.focusedOrganizationId) {
        router.consumeFocusedOrganization()?.let { openedOrganizationId = it }
    }

    val opened = openedOrganizationId?.let { id ->
        store.credentialOrganizations.firstOrNull { it.id == id }
    }

    ledgerOrganizationId?.let { id ->
        val name = store.credentialOrganizations.firstOrNull { it.id == id }?.name ?: "Organization"
        OrganizationLedgerScreen(store, id, name) { ledgerOrganizationId = null }
        return
    }

    if (opened != null) {
        OrganizationDetailScreen(
            store = store,
            router = router,
            organization = opened,
            onBack = { openedOrganizationId = null },
            onOpenLedger = { ledgerOrganizationId = opened.id }
        )
        return
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
                    "Accept a Vanguard Aegis ID credential invitation or issuer invitation to see organizations you hold credentials or wallet challenge history for."
                )
            }
        } else {
            items(store.credentialOrganizations, key = { it.id }) { organization ->
                Box(modifier = Modifier.clickable { openedOrganizationId = organization.id }) {
                    OrganizationCard(
                        organization = organization,
                        profile = store.organizationProfile(organization.id),
                        transactions = store.transactionsForOrganization(organization.id)
                    )
                }
            }
        }
    }
}

/**
 * One organization, with the two things the iOS wallet gained: its own ledger,
 * and a way to raise a challenge without a relying party.
 */
@Composable
private fun OrganizationDetailScreen(
    store: WalletStore,
    router: WalletRouter,
    organization: CredentialOrganization,
    onBack: () -> Unit,
    onOpenLedger: () -> Unit
) {
    val transactions = store.transactionsForOrganization(organization.id)

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            TextButton(onClick = onBack) { Text("< Organizations") }
        }

        item {
            OrganizationCard(
                organization = organization,
                profile = store.organizationProfile(organization.id),
                transactions = transactions
            )
        }

        item {
            AegisCard {
                Text("Wallet dashboard", color = Color.Gray, style = MaterialTheme.typography.labelLarge)
                KeyValue("Connections", organization.connectionCount.toString())
                KeyValue("Issued credentials", organization.credentialCount.toString())
                KeyValue(
                    "Pending actions",
                    transactions.count { it.status == WalletTransactionStatus.PendingAcceptance }.toString()
                )
                // This organization's own history. The Ledger tab answers "what
                // have I ever approved"; here the question is "what has this
                // organization asked me for".
                Button(onClick = onOpenLedger, modifier = Modifier.fillMaxWidth()) {
                    Text("Ledger (${transactions.size})")
                }
            }
        }

        item {
            AegisCard {
                OutlinedButton(
                    onClick = {
                        if (store.createMockWalletChallenge(organization.id)) {
                            router.flash(FlashNotice("Test challenge added to your ledger."))
                            router.show(WalletTab.Ledger)
                        } else {
                            router.flash(
                                FlashNotice(
                                    store.lastLabError ?: "That challenge could not be raised.",
                                    succeeded = false
                                )
                            )
                        }
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Raise a test challenge")
                }
                Text(
                    "Adds a pending approval to this organization's ledger so the wallet can be " +
                        "exercised without a connected application. It is recorded exactly as a real " +
                        "decision is.",
                    color = Color.Gray,
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }
}

@Composable
private fun LedgerScreen(store: WalletStore, onGetPasskey: suspend (String) -> JSONObject) {
    val ledgerTransactions = store.transactions
        .filter { it.type == WalletTransactionType.Challenge || it.type == WalletTransactionType.Credential }
        .sortedByDescending { it.createdAt }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        if (ledgerTransactions.isEmpty()) {
            item {
                EmptyState(
                    "No wallet ledger entries",
                    "Scan credential invitations or fetch connected app challenges, then accept them to build a local high-assurance action ledger."
                )
            }
        } else {
            items(ledgerTransactions, key = { it.id }) { transaction ->
                TransactionCard(
                    transaction = transaction,
                    onAccept = { store.acceptTransaction(transaction) },
                    onAcceptWithPasskey = { store.acceptTransactionWithPasskey(transaction, onGetPasskey) },
                    onDecline = { store.declineTransaction(transaction) }
                )
            }
        }
    }
}

@Composable
private fun ConnectionsScreen(store: WalletStore, router: WalletRouter) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        if (store.connections.isEmpty()) {
            item {
                EmptyState("No connections", "Import an Aegis credential invitation, OpenID VC presentation request, or Aries lab out-of-band invitation from the web dashboard.")
            }
        } else {
            // Choosing a connection means "show me this organization", and the
            // organization lives on its own tab with its credentials, roles and
            // ledger.
            items(store.connections, key = { it.id }) { connection ->
                Box(
                    modifier = Modifier.clickable {
                        router.openOrganization(store.organizationIdFor(connection))
                    }
                ) {
                    ConnectionCard(connection = connection, store = store)
                }
            }
        }
    }
}

@Composable
private fun SettingsScreen(store: WalletStore, onCreatePasskey: suspend (String) -> JSONObject, router: WalletRouter) {
    var passkeySubject by rememberSaveable { mutableStateOf(store.walletPasskeySubject) }
    var showProfile by rememberSaveable { mutableStateOf(false) }
    var showPasskeys by rememberSaveable { mutableStateOf(false) }
    val settingsContext = androidx.compose.ui.platform.LocalContext.current

    LaunchedEffect(Unit) {
        store.refreshWalletPasskeyStatus()
    }

    if (showProfile) {
        Column(Modifier.fillMaxSize()) {
            TextButton(onClick = { showProfile = false }) { Text("< Settings") }
            WalletProfileScreen(store)
        }
        return
    }

    if (showPasskeys) {
        Column(Modifier.fillMaxSize()) {
            TextButton(onClick = { showPasskeys = false }) { Text("< Settings") }
            PasskeysScreen()
        }
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // First, above the wallet itself. Everything below assumes the holder
        // already knows what this app is for; this is where they find out, or
        // come back when a second organization invites them.
        item {
            AegisCard {
                Text("Getting started", color = Color.Gray, style = MaterialTheme.typography.labelLarge)
                Text(
                    "How to set up this wallet, redeem an invitation, and hold credentials from " +
                        "more than one organization.",
                    color = Color.Gray,
                    style = MaterialTheme.typography.bodySmall
                )
                Text(
                    BuildConfig.AEGIS_WEB_APP_BASE_URL,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                    fontWeight = FontWeight.Bold
                )
                Button(
                    onClick = { openWebApp(settingsContext) },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("Open the web app") }
            }
        }

        item {
            AegisCard {
                Text("My wallet", color = Color.Gray, style = MaterialTheme.typography.labelLarge)
                Text(
                    store.identity?.walletId ?: "Not registered",
                    style = MaterialTheme.typography.titleMedium,
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                    fontWeight = FontWeight.Bold
                )
                Text(store.identity?.email ?: "", color = Color.Gray)
                Button(
                    onClick = { showProfile = true },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("Wallet ID, contact and recovery") }
            }
        }

        // Passkeys this wallet holds for other people's sites, as opposed to
        // the wallet passkey settings further down, which are about approving
        // Aegis challenges.
        //
        // Hidden while the provider is disabled. This screen does not merely
        // list passkeys — it offers to open Android's settings and turn Aegis ID
        // on as a provider, so leaving it in would recruit holders into a flow
        // the build cannot complete.
        if (BuildConfig.PASSKEY_PROVIDER_ENABLED) item {
            AegisCard {
                Text("Passkeys for other services", color = Color.Gray, style = MaterialTheme.typography.labelLarge)
                Text(
                    "FIDO2 credentials this wallet stores for any site that supports them.",
                    color = Color.Gray,
                    style = MaterialTheme.typography.bodySmall
                )
                Button(
                    onClick = { showPasskeys = true },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("Manage passkeys") }
            }
        }

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
        item {
            AegisCard {
                StatusBadge("Optional assurance", VanguardColors.Green)
                Text("Wallet passkey assurance", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(
                    "Register a device passkey when an organization requires phishing-resistant proof before approving wallet challenges.",
                    color = Color.Gray
                )
                OutlinedTextField(
                    value = passkeySubject,
                    onValueChange = {
                        passkeySubject = it
                        store.updateWalletPasskeySubject(it)
                    },
                    label = { Text("Wallet subject") },
                    modifier = Modifier.fillMaxWidth()
                )
                KeyValue(
                    "Status",
                    if (store.walletPasskeyStatus?.registered == true) {
                        "${store.walletPasskeyStatus?.credentialCount ?: 0} passkey credential(s) registered"
                    } else {
                        "No wallet passkey registered"
                    }
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = { store.registerWalletPasskey(onCreatePasskey) },
                        enabled = !store.isWorking,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Register passkey")
                    }
                    OutlinedButton(
                        onClick = { store.refreshWalletPasskeyStatus() },
                        enabled = !store.isWorking,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Refresh")
                    }
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
        if (connection.invitation.isLabInvitation) {
            KeyValue("Issuer connection", connection.issuerConnectionId)
        }

        // Works for every connection: a product-path wallet polls by
        // organization, a lab wallet by its DIDComm connection. Gating this on
        // issuerConnectionId disabled it permanently for product-path
        // organizations, which never have one.
        OutlinedButton(
            onClick = { store.refreshOidcWalletChallenges(connection) },
            enabled = !store.isWorking,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Check for challenges")
        }

        // ACA-Py only. Hidden entirely for product-path connections rather than
        // shown greyed out with no explanation.
        if (connection.invitation.isLabInvitation) {
            Text(
                "Lab actions",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
                color = Color.Gray
            )
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
            Text(
                "These drive the ACA-Py interoperability lab and need a DIDComm connection.",
                style = MaterialTheme.typography.bodySmall,
                color = Color.Gray
            )
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
private fun TransactionCard(
    transaction: WalletTransaction,
    onAccept: () -> Unit,
    onAcceptWithPasskey: () -> Unit,
    onDecline: () -> Unit
) {
    AegisCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(transaction.appName ?: "Aegis ID", style = MaterialTheme.typography.labelMedium, color = Color.Gray, fontWeight = FontWeight.Bold)
                Text(transaction.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
            StatusBadge(transaction.status.title, transactionStatusTint(transaction.status))
        }

        Text(transaction.detail, color = Color.Gray)
        if (transaction.requiresPasskey) {
            StatusBadge("Passkey required", VanguardColors.Green)
        }
        transaction.requiredAssurance?.let { KeyValue("Required assurance", it) }
        transaction.passkeyEvidenceLabel?.let { KeyValue("Passkey evidence", it) }
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
            ElevatedButton(
                onClick = if (transaction.requiresPasskey) onAcceptWithPasskey else onAccept,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Outlined.CheckCircle, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.size(8.dp))
                Text(if (transaction.requiresPasskey) "Verify passkey and ${actionButtonTitle(transaction).replaceFirstChar { it.lowercase() }}" else actionButtonTitle(transaction))
            }
            if (transaction.type == WalletTransactionType.Challenge) {
                OutlinedButton(
                    onClick = onDecline,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Decline challenge", color = Color(0xFFC23B32), fontWeight = FontWeight.Bold)
                }
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
    WalletTransactionStatus.Declined -> Color(0xFFC23B32)
    WalletTransactionStatus.Failed -> Color(0xFFC23B32)
}

private fun actionButtonTitle(transaction: WalletTransaction): String {
    if (transaction.type == WalletTransactionType.Credential) {
        return "Accept credential"
    }

    val action = transaction.action
        ?.replace("-", " ")
        ?.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
        ?: "Accept challenge"
    val resourceType = transaction.resourceType?.takeIf { it.isNotBlank() }
    return if (resourceType == null) action else "$action ${resourceType.lowercase()}"
}

private fun formatDate(timestamp: Long): String =
    DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(timestamp))

enum class WalletTab(
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
