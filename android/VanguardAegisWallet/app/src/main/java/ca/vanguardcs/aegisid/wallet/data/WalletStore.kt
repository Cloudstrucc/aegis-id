package ca.vanguardcs.aegisid.wallet.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import ca.vanguardcs.aegisid.wallet.BuildConfig
import ca.vanguardcs.aegisid.wallet.model.AriesInvitation
import ca.vanguardcs.aegisid.wallet.model.CredentialOrganization
import ca.vanguardcs.aegisid.wallet.model.LabAcceptance
import ca.vanguardcs.aegisid.wallet.model.OrganizationProfile
import ca.vanguardcs.aegisid.wallet.model.WalletChallengeBanner
import ca.vanguardcs.aegisid.wallet.model.WalletChallengePayloadField
import ca.vanguardcs.aegisid.wallet.model.WalletConnection
import ca.vanguardcs.aegisid.wallet.model.WalletConnectionState
import ca.vanguardcs.aegisid.wallet.model.WalletPasskeyStatus
import ca.vanguardcs.aegisid.wallet.model.WalletTransaction
import ca.vanguardcs.aegisid.wallet.model.WalletTransactionStatus
import ca.vanguardcs.aegisid.wallet.model.WalletTransactionType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

class WalletStore(
    context: Context,
    private val labClient: LabAgentClient = LabAgentClient()
) : ViewModel() {
    private val preferences = context.applicationContext.getSharedPreferences("vanguard-aegis-wallet", Context.MODE_PRIVATE)

    var connections by mutableStateOf<List<WalletConnection>>(emptyList())
        private set
    var transactions by mutableStateOf<List<WalletTransaction>>(emptyList())
        private set
    var organizationProfiles by mutableStateOf<Map<String, OrganizationProfile>>(emptyMap())
        private set
    var lastImportMessage by mutableStateOf<String?>(null)
        private set
    var lastImportError by mutableStateOf<String?>(null)
        private set
    var lastLabMessage by mutableStateOf<String?>(null)
        private set
    var lastLabError by mutableStateOf<String?>(null)
        private set
    var challengeBanner by mutableStateOf<WalletChallengeBanner?>(null)
        private set
    var walletPasskeySubject by mutableStateOf(preferences.getString("walletPasskeySubject", "identity@vanguardcs.ca") ?: "identity@vanguardcs.ca")
        private set
    var walletPasskeyStatus by mutableStateOf<WalletPasskeyStatus?>(null)
        private set
    var isWorking by mutableStateOf(false)
        private set

    init {
        load()
    }

    val latestPendingInvitation: WalletConnection?
        get() = connections.firstOrNull { it.holderConnectionId == null }

    val pendingTransactionCount: Int
        get() = transactions.count {
            it.status == WalletTransactionStatus.PendingAcceptance || it.status == WalletTransactionStatus.Received
        }

    val pendingChallengeCount: Int
        get() = transactions.count {
            it.type == WalletTransactionType.Challenge && it.status == WalletTransactionStatus.PendingAcceptance
        }

    val credentialOrganizations: List<CredentialOrganization>
        get() = connections
            .groupBy(::organizationKey)
            .map { (key, items) ->
                val itemIds = items.map { it.id }.toSet()
                val orgTransactions = transactions.filter { it.connectionId in itemIds }
                val latestConnection = items.maxByOrNull { it.updatedAt }
                val profile = organizationProfiles[key]
                val profileCredentialCount = profile?.credentials?.size ?: 0
                val profileDisabled = profileCredentialCount > 0 && profile?.credentials?.all { it.status == "revoked" } == true
                CredentialOrganization(
                    id = key,
                    name = profile?.organizationName ?: organizationName(items.firstOrNull()),
                    connectionCount = items.size,
                    credentialCount = if (profileCredentialCount > 0) profileCredentialCount else orgTransactions.count { it.type == WalletTransactionType.Credential },
                    challengeCount = orgTransactions.count { it.type == WalletTransactionType.Challenge },
                    latestState = if (profileDisabled) WalletConnectionState.Disabled else latestConnection?.state ?: WalletConnectionState.InvitationReceived,
                    latestUpdatedAt = latestConnection?.updatedAt ?: 0L
                )
            }
            .sortedByDescending { it.latestUpdatedAt }

    fun connection(id: String): WalletConnection? = connections.firstOrNull { it.id == id }

    fun transaction(id: String): WalletTransaction? = transactions.firstOrNull { it.id == id }

    fun transactionsFor(connection: WalletConnection): List<WalletTransaction> =
        transactions.filter { it.connectionId == connection.id }

    fun transactionsForOrganization(organizationId: String): List<WalletTransaction> {
        val connectionIds = connections.filter { organizationKey(it) == organizationId }.map { it.id }.toSet()
        return transactions.filter { it.connectionId in connectionIds }
    }

    fun organizationProfile(organizationId: String): OrganizationProfile? = organizationProfiles[organizationId]

    fun dismissChallengeBanner() {
        challengeBanner = null
    }

    fun importInvitation(rawText: String) {
        lastImportMessage = null
        lastImportError = null
        lastLabMessage = null
        lastLabError = null

        try {
            if (AegisCredentialInviteParser.canParse(rawText)) {
                importCredentialInvite(AegisCredentialInviteParser.parse(rawText))
                return
            }

            val invitation = OobInvitationParser.parse(rawText)
            if (connections.any { it.invitation.id == invitation.id }) {
                lastImportMessage = "Invitation already saved."
                return
            }

            val connection = WalletConnection(invitation = invitation)
            connections = listOf(connection) + connections
            transactions = listOf(
                WalletTransaction(
                    connectionId = connection.id,
                    type = WalletTransactionType.Invitation,
                    status = WalletTransactionStatus.Received,
                    title = "Invitation imported",
                    detail = invitation.label
                )
            ) + transactions
            saveConnections()
            saveTransactions()
            lastImportMessage = "Invitation saved. Accept it in the lab to enable wallet challenges."
        } catch (error: Exception) {
            lastImportError = error.message ?: "Invitation could not be imported."
        }
    }

    private fun importCredentialInvite(invite: AegisCredentialInvite) {
        if (transactions.any { it.type == WalletTransactionType.Credential && it.remoteId == invite.credentialId }) {
            lastImportMessage = "Credential invite already saved."
            return
        }

        val existing = connections.firstOrNull { organizationKey(it) == invite.organizationId }
        val connection = existing ?: WalletConnection(
            invitation = AriesInvitation(
                id = "credential-${invite.credentialId}",
                label = invite.organizationName,
                rawUrl = invite.rawUrl,
                endpoint = BuildConfig.AEGIS_WEB_APP_BASE_URL,
                organizationId = invite.organizationId,
                organizationName = invite.organizationName,
                subscriptionId = null,
                handshakeProtocols = emptyList(),
                services = emptyList()
            ),
            state = WalletConnectionState.CredentialOffered,
            holderConnectionId = "aegis-credential-invite:${invite.credentialId}"
        )

        if (existing == null) {
            connections = listOf(connection) + connections
            saveConnections()
        } else {
            updateConnection(existing.id) { it.copy(state = WalletConnectionState.CredentialOffered) }
        }

        transactions = listOf(
            WalletTransaction(
                connectionId = connection.id,
                type = WalletTransactionType.Credential,
                status = WalletTransactionStatus.PendingAcceptance,
                title = "Credential invite received",
                detail = "${invite.organizationName} invited ${invite.holderEmail.ifBlank { "this wallet" }} to accept an organization credential.",
                remoteId = invite.credentialId,
                appName = "Vanguard Aegis ID",
                action = "accept-credential",
                resourceType = "credential-invitation",
                resourceId = invite.credentialId,
                payloadFields = listOf(
                    WalletChallengePayloadField(key = "organizationId", value = invite.organizationId),
                    WalletChallengePayloadField(key = "organizationName", value = invite.organizationName),
                    WalletChallengePayloadField(key = "credentialId", value = invite.credentialId),
                    WalletChallengePayloadField(key = "holderEmail", value = invite.holderEmail),
                    WalletChallengePayloadField(key = "expiresAt", value = invite.expiresAt ?: "Not provided")
                )
            )
        ) + transactions
        saveTransactions()
        refreshOrganizationProfile(invite.organizationId)
        lastImportMessage = "Credential invite saved. Open Ledger to accept it."
    }

    fun acceptLatestInvitationInLab() {
        latestPendingInvitation?.let(::acceptInLab) ?: run {
            clearLabMessages()
            lastLabMessage = "No pending invitations to accept."
        }
    }

    fun acceptInLab(connection: WalletConnection) {
        runLabOperation {
            val acceptance = labClient.acceptInvitation(connection.invitation.rawUrl)
            updateConnection(connection.id) {
                it.copy(
                    holderConnectionId = acceptance.holderConnectionId,
                    issuerConnectionId = acceptance.issuerConnectionId,
                    state = WalletConnectionState.Connected
                )
            }
            addTransaction(
                connectionId = connection.id,
                type = WalletTransactionType.Invitation,
                status = WalletTransactionStatus.Accepted,
                title = "Invitation accepted",
                detail = acceptedInvitationDetail(connection.invitation, acceptance),
                remoteId = acceptance.invitationMessageId
            )
            val registeredOrganization = registerIssuerOrganizationIfNeeded(connection.invitation, acceptance)
            if (connection.invitation.organizationId != null) {
                refreshOrganizationProfilesInternal()
            }
            lastLabMessage = registeredOrganization?.let {
                "Invitation accepted and registered for $it."
            } ?: "Invitation accepted through the hosted Aegis lab bridge."
        }
    }

    fun issueMockCredential(connection: WalletConnection) {
        val issuerConnectionId = current(connection)?.issuerConnectionId
        if (issuerConnectionId == null) {
            lastLabError = "Accept the invitation before issuing a mock credential."
            return
        }

        runLabOperation {
            labClient.issueMockCredential(issuerConnectionId, "identity@vanguardcs.ca")
            updateConnection(connection.id) { it.copy(state = WalletConnectionState.CredentialOffered) }
            addTransaction(
                connectionId = connection.id,
                type = WalletTransactionType.Credential,
                status = WalletTransactionStatus.PendingAcceptance,
                title = "Mock credential offered",
                detail = "VanguardEmployeeCredential for identity@vanguardcs.ca"
            )
            lastLabMessage = "Mock credential offer delivered to the wallet."
        }
    }

    fun sendWalletChallenge(connection: WalletConnection) {
        val issuerConnectionId = current(connection)?.issuerConnectionId
        if (issuerConnectionId == null) {
            lastLabError = "Accept the invitation before sending a challenge."
            return
        }

        runLabOperation {
            val threadId = labClient.sendChallenge(issuerConnectionId)
            updateConnection(connection.id) { it.copy(state = WalletConnectionState.ChallengeReceived) }
            addTransaction(
                connectionId = connection.id,
                type = WalletTransactionType.Challenge,
                status = WalletTransactionStatus.PendingAcceptance,
                title = "Wallet challenge received",
                detail = "Vanguard Aegis ID DIDComm trust ping and basic message challenge.",
                remoteId = threadId
            )
            lastLabMessage = "Wallet challenge received."
        }
    }

    fun refreshOidcWalletChallenges(connection: WalletConnection) {
        if (current(connection)?.issuerConnectionId == null) {
            lastLabError = "Accept the invitation before checking web app challenges."
            return
        }

        runLabOperation {
            val added = importOidcWalletChallenges(connection)
            if (added.isNotEmpty()) {
                showChallengeBanner(added)
                lastLabMessage = "${added.size} web app challenge${if (added.size == 1) "" else "s"} received."
            } else {
                lastLabMessage = "No pending web app challenges."
            }
        }
    }

    fun autoRefreshOidcWalletChallenges() {
        viewModelScope.launch {
            while (true) {
                val refreshable = connections.filter { it.issuerConnectionId != null }
                val added = mutableListOf<WalletTransaction>()
                for (connection in refreshable) {
                    try {
                        added += importOidcWalletChallenges(connection)
                    } catch (_: Exception) {
                    }
                }
                if (added.isNotEmpty()) {
                    showChallengeBanner(added)
                    lastLabMessage = "${added.size} new wallet challenge${if (added.size == 1) "" else "s"} received."
                }
                delay(12_000)
            }
        }
    }

    fun refreshOrganizationProfiles() {
        viewModelScope.launch {
            refreshOrganizationProfilesInternal()
        }
    }

    fun refreshOrganizationProfile(organizationId: String) {
        viewModelScope.launch {
            try {
                val profile = labClient.fetchOrganizationProfile(organizationId)
                organizationProfiles = organizationProfiles + (organizationId to profile)
                saveOrganizationProfiles()
            } catch (error: Exception) {
                lastLabError = "Organization profile refresh failed: ${error.message}"
            }
        }
    }

    fun updateWalletPasskeySubject(subject: String) {
        val normalized = subject.trim().ifBlank { "identity@vanguardcs.ca" }
        walletPasskeySubject = normalized
        preferences.edit().putString("walletPasskeySubject", normalized).apply()
    }

    fun refreshWalletPasskeyStatus() {
        viewModelScope.launch {
            try {
                walletPasskeyStatus = labClient.fetchWalletPasskeyStatus(walletPasskeySubject)
            } catch (error: Exception) {
                lastLabError = "Passkey status refresh failed: ${error.message}"
            }
        }
    }

    fun registerWalletPasskey(createPasskey: suspend (String) -> JSONObject) {
        runLabOperation {
            val options = labClient.startWalletPasskeyRegistration(walletPasskeySubject, walletPasskeySubject)
            val response = createPasskey(options.toString())
            walletPasskeyStatus = labClient.finishWalletPasskeyRegistration(walletPasskeySubject, response)
            lastLabMessage = "Wallet passkey registered for $walletPasskeySubject."
        }
    }

    fun acceptTransaction(transaction: WalletTransaction) {
        if (transaction.requiresPasskey) {
            lastLabError = "This wallet challenge requires passkey assurance."
            return
        }

        val connection = connection(transaction.connectionId)
        if (connection == null) {
            lastLabError = "Connection unavailable for this wallet transaction."
            return
        }

        runLabOperation {
            val currentConnection = current(connection) ?: connection
            if (transaction.type == WalletTransactionType.Challenge && currentConnection.holderConnectionId != null) {
                labClient.sendHolderMessage(
                    currentConnection.holderConnectionId,
                    "Vanguard Aegis ID Android wallet accepted challenge ${transaction.remoteId ?: transaction.id}."
                )
            }
            if (transaction.type == WalletTransactionType.Credential &&
                transaction.resourceType == "credential-invitation" &&
                (transaction.remoteId != null || transaction.resourceId != null)
            ) {
                labClient.acceptCredentialInvitation(
                    credentialId = transaction.remoteId ?: transaction.resourceId.orEmpty(),
                    organizationId = currentConnection.invitation.organizationId ?: transaction.payloadValue("organizationId").orEmpty(),
                    holderEmail = transaction.payloadValue("holderEmail")
                )
            } else when {
                transaction.webAcceptPath != null -> labClient.acceptWalletChallenge(transaction.webAcceptPath)
                transaction.webSessionId != null -> labClient.acceptOidcWalletChallenge(transaction.webSessionId)
            }

            updateTransaction(transaction.id) { it.copy(status = WalletTransactionStatus.Accepted) }
            if (transaction.type == WalletTransactionType.Challenge || transaction.type == WalletTransactionType.Credential) {
                updateConnection(connection.id) { it.copy(state = WalletConnectionState.Connected) }
            }
            lastLabMessage = if (transaction.type == WalletTransactionType.Credential) {
                "Credential accepted."
            } else {
                "Challenge accepted and response sent."
            }
        }
    }

    fun acceptTransactionWithPasskey(transaction: WalletTransaction, getPasskey: suspend (String) -> JSONObject) {
        val connection = connection(transaction.connectionId)
        if (connection == null) {
            lastLabError = "Connection unavailable for this wallet transaction."
            return
        }

        runLabOperation {
            val challengeId = transaction.webSessionId ?: transaction.remoteId ?: transaction.id
            val options = labClient.startWalletPasskeyAuthentication(walletPasskeySubject, challengeId)
            val passkeyResponse = getPasskey(options.toString())
            val currentConnection = current(connection) ?: connection
            if (transaction.type == WalletTransactionType.Challenge && currentConnection.holderConnectionId != null) {
                labClient.sendHolderMessage(
                    currentConnection.holderConnectionId,
                    "Vanguard Aegis ID Android wallet accepted challenge ${transaction.remoteId ?: transaction.id} with passkey assurance."
                )
            }
            val evidence = if (transaction.webAcceptPath != null) {
                null
            } else {
                labClient.finishWalletPasskeyAuthentication(walletPasskeySubject, challengeId, passkeyResponse)
                    .optJSONObject("evidence")
            }
            when {
                transaction.webAcceptPath != null -> labClient.acceptWalletChallengeWithPasskey(
                    acceptPath = transaction.passkeyAcceptPath ?: transaction.webAcceptPath,
                    subject = walletPasskeySubject,
                    challengeId = challengeId,
                    passkeyResponse = passkeyResponse
                )
                transaction.webSessionId != null -> labClient.acceptOidcWalletChallenge(transaction.webSessionId)
            }

            updateTransaction(transaction.id) {
                it.copy(
                    status = WalletTransactionStatus.Accepted,
                    passkeyEvidenceLabel = "Passkey verified for ${evidence?.optString("subject") ?: walletPasskeySubject}"
                )
            }
            if (transaction.type == WalletTransactionType.Challenge || transaction.type == WalletTransactionType.Credential) {
                updateConnection(connection.id) { it.copy(state = WalletConnectionState.Connected) }
            }
            walletPasskeyStatus = labClient.fetchWalletPasskeyStatus(walletPasskeySubject)
            lastLabMessage = "Challenge accepted with wallet passkey assurance."
        }
    }

    fun deleteConnection(connection: WalletConnection) {
        connections = connections.filterNot { it.id == connection.id }
        transactions = transactions.filterNot { it.connectionId == connection.id }
        saveConnections()
        saveTransactions()
    }

    private fun runLabOperation(operation: suspend () -> Unit) {
        if (isWorking) return
        clearLabMessages()
        isWorking = true
        viewModelScope.launch {
            try {
                operation()
            } catch (error: Exception) {
                lastLabError = error.message ?: "Lab request failed."
                connections = connections.map {
                    if (it.holderConnectionId == null && it.issuerConnectionId == null) {
                        it.copy(state = WalletConnectionState.Failed, updatedAt = System.currentTimeMillis())
                    } else {
                        it
                    }
                }
                saveConnections()
            } finally {
                isWorking = false
            }
        }
    }

    private suspend fun importOidcWalletChallenges(connection: WalletConnection): List<WalletTransaction> {
        val issuerConnectionId = current(connection)?.issuerConnectionId ?: return emptyList()
        val challenges = labClient.fetchOidcWalletChallenges(issuerConnectionId)
        val added = challenges
            .filterNot { challenge -> transactions.any { it.webSessionId == challenge.sessionId } }
            .map { challenge ->
                WalletTransaction(
                    connectionId = connection.id,
                    type = WalletTransactionType.Challenge,
                    status = WalletTransactionStatus.PendingAcceptance,
                    title = challenge.title ?: "${challenge.appName ?: "Connected app"} wallet challenge",
                    detail = challenge.detail ?: "${challenge.organizationName} ${challenge.action ?: "sign-in"} challenge for ${challenge.subject}",
                    remoteId = challenge.nonce,
                    webSessionId = challenge.sessionId,
                    webAcceptPath = challenge.acceptPath,
                    requiresPasskey = challenge.requiresPasskey,
                    requiredAssurance = challenge.requiredAssurance,
                    passkeyAcceptPath = challenge.passkeyAcceptPath,
                    appName = challenge.appName,
                    action = challenge.action,
                    resourceType = challenge.resourceType,
                    resourceId = challenge.resourceId,
                    payloadFields = challenge.payloadFields
                )
            }

        if (added.isNotEmpty()) {
            transactions = added + transactions
            saveTransactions()
            updateConnection(connection.id) { it.copy(state = WalletConnectionState.ChallengeReceived) }
        }
        return added
    }

    private suspend fun refreshOrganizationProfilesInternal() {
        for (organization in credentialOrganizations) {
            try {
                val profile = labClient.fetchOrganizationProfile(organization.id)
                organizationProfiles = organizationProfiles + (organization.id to profile)
                saveOrganizationProfiles()
            } catch (_: Exception) {
            }
        }
    }

    private suspend fun registerIssuerOrganizationIfNeeded(invitation: AriesInvitation, acceptance: LabAcceptance): String? {
        val organizationId = invitation.organizationId ?: return null
        val organizationName = invitation.organizationName ?: return null
        return try {
            labClient.registerIssuerOrganizationConnection(
                organizationId = organizationId,
                holderConnectionId = acceptance.holderConnectionId,
                issuerConnectionId = acceptance.issuerConnectionId,
                invitationId = acceptance.invitationMessageId
            )
            organizationName
        } catch (error: Exception) {
            lastLabError = "Invitation accepted, but org registration failed: ${error.message}"
            null
        }
    }

    private fun showChallengeBanner(items: List<WalletTransaction>) {
        val latest = items.firstOrNull() ?: return
        challengeBanner = WalletChallengeBanner(
            count = items.size,
            title = if (items.size == 1) latest.title else "${items.size} wallet challenges received",
            detail = latest.detail
        )
    }

    private fun acceptedInvitationDetail(invitation: AriesInvitation, acceptance: LabAcceptance): String {
        var detail = "Holder ${acceptance.holderState}, issuer ${acceptance.issuerState ?: "pending"}"
        if (invitation.organizationName != null) {
            detail += " for ${invitation.organizationName}"
        }
        return detail
    }

    private fun current(connection: WalletConnection): WalletConnection? = connections.firstOrNull { it.id == connection.id }

    private fun updateConnection(id: String, mutate: (WalletConnection) -> WalletConnection) {
        connections = connections.map {
            if (it.id == id) mutate(it).copy(updatedAt = System.currentTimeMillis()) else it
        }
        saveConnections()
    }

    private fun updateTransaction(id: String, mutate: (WalletTransaction) -> WalletTransaction) {
        transactions = transactions.map {
            if (it.id == id) mutate(it).copy(updatedAt = System.currentTimeMillis()) else it
        }
        saveTransactions()
    }

    private fun addTransaction(
        connectionId: String,
        type: WalletTransactionType,
        status: WalletTransactionStatus,
        title: String,
        detail: String,
        remoteId: String? = null
    ) {
        transactions = listOf(
            WalletTransaction(
                connectionId = connectionId,
                type = type,
                status = status,
                title = title,
                detail = detail,
                remoteId = remoteId
            )
        ) + transactions
        saveTransactions()
    }

    private fun organizationKey(connection: WalletConnection): String =
        connection.invitation.organizationId
            ?: connection.invitation.organizationName
            ?: connection.invitation.label

    private fun organizationName(connection: WalletConnection?): String =
        connection?.invitation?.organizationName ?: connection?.invitation?.label ?: "Unassigned organization"

    private fun clearLabMessages() {
        lastLabMessage = null
        lastLabError = null
    }

    private fun load() {
        connections = parseArray(preferences.getString("connections", "[]"), WalletConnection::fromJson)
        transactions = parseArray(preferences.getString("transactions", "[]"), WalletTransaction::fromJson)
        organizationProfiles = parseProfiles(preferences.getString("organizationProfiles", "{}"))
    }

    private fun saveConnections() {
        preferences.edit().putString("connections", JSONArray().also { array ->
            connections.forEach { array.put(it.toJson()) }
        }.toString()).apply()
    }

    private fun saveTransactions() {
        preferences.edit().putString("transactions", JSONArray().also { array ->
            transactions.forEach { array.put(it.toJson()) }
        }.toString()).apply()
    }

    private fun saveOrganizationProfiles() {
        preferences.edit().putString("organizationProfiles", JSONObject().also { json ->
            organizationProfiles.forEach { (key, value) -> json.put(key, value.toJson()) }
        }.toString()).apply()
    }

    private fun <T> parseArray(value: String?, transform: (JSONObject) -> T): List<T> {
        val array = JSONArray(value ?: "[]")
        return (0 until array.length()).mapNotNull { index ->
            array.optJSONObject(index)?.let(transform)
        }
    }

    private fun parseProfiles(value: String?): Map<String, OrganizationProfile> {
        val json = JSONObject(value ?: "{}")
        return buildMap {
            val keys = json.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                json.optJSONObject(key)?.let { put(key, OrganizationProfile.fromJson(it)) }
            }
        }
    }

    class Factory(private val context: Context) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return WalletStore(context.applicationContext) as T
        }
    }
}

private fun WalletTransaction.payloadValue(key: String): String? =
    payloadFields.firstOrNull { it.key == key }?.value
