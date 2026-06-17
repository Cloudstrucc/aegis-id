package ca.vanguardcs.aegisid.wallet.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ca.vanguardcs.aegisid.wallet.R

@Composable
fun AegisCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit
) {
    ElevatedCard(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.elevatedCardColors(containerColor = Color.White),
        elevation = CardDefaults.elevatedCardElevation(defaultElevation = 1.dp)
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content
        )
    }
}

@Composable
fun StatusBadge(
    text: String,
    tint: Color = VanguardColors.Blue,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        color = tint.copy(alpha = 0.12f),
        contentColor = tint,
        shape = RoundedCornerShape(100.dp)
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
fun VanguardLogo(
    modifier: Modifier = Modifier,
    darkBackground: Boolean = false
) {
    Image(
        painter = painterResource(R.drawable.vanguard_cloud_services_logo),
        contentDescription = "Vanguard Cloud Services",
        modifier = modifier.height(54.dp),
        contentScale = ContentScale.Fit
    )
    if (!darkBackground) {
        Spacer(Modifier.height(2.dp))
    }
}

@Composable
fun HeroPanel(
    connections: Int,
    organizations: Int,
    events: Int
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(
                Brush.linearGradient(
                    listOf(VanguardColors.Navy, VanguardColors.Blue, VanguardColors.Green)
                )
            )
            .padding(22.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
            VanguardLogo(darkBackground = true)
            Text(
                text = "Aegis ID Wallet",
                color = Color.White,
                fontWeight = FontWeight.Bold,
                fontSize = 34.sp,
                lineHeight = 36.sp
            )
            Text(
                text = "Hold lab credentials, accept issuer invitations, and sign Aegis wallet challenges after Verified ID or YubiKey web assurance.",
                color = Color.White.copy(alpha = 0.84f),
                style = MaterialTheme.typography.bodyMedium
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                HeroMetric("$connections", "Connections", Modifier.weight(1f))
                HeroMetric("$organizations", "Orgs", Modifier.weight(1f))
                HeroMetric("$events", "Events", Modifier.weight(1f))
            }
        }
    }
}

@Composable
fun HeroMetric(value: String, label: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(Color.White.copy(alpha = 0.1f))
            .padding(12.dp)
    ) {
        Text(value, color = Color.White, fontWeight = FontWeight.Bold)
        Text(label, color = Color.White.copy(alpha = 0.72f), style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
fun FeedbackMessages(
    isWorking: Boolean,
    importMessage: String?,
    importError: String?,
    labMessage: String?,
    labError: String?
) {
    if (isWorking) {
        FeedbackRow("Working with the hosted Aegis lab bridge...", VanguardColors.Blue, isProgress = true)
    }
    importMessage?.let { FeedbackRow(it, VanguardColors.Green) }
    labMessage?.let { FeedbackRow(it, VanguardColors.Green) }
    importError?.let { FeedbackRow(it, Color(0xFFC23B32), isError = true) }
    labError?.let { FeedbackRow(it, Color(0xFFC23B32), isError = true) }
}

@Composable
private fun FeedbackRow(
    text: String,
    color: Color,
    isError: Boolean = false,
    isProgress: Boolean = false
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Icon(
            imageVector = when {
                isProgress -> Icons.Outlined.HourglassEmpty
                isError -> Icons.Outlined.ErrorOutline
                else -> Icons.Outlined.CheckCircle
            },
            contentDescription = null,
            tint = color,
            modifier = Modifier.size(18.dp)
        )
        Text(
            text = text,
            color = color,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold
        )
    }
}

@Composable
fun EmptyState(title: String, detail: String, modifier: Modifier = Modifier) {
    AegisCard(modifier) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(detail, color = Color.Gray, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
fun KeyValue(label: String, value: String?) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, VanguardColors.Line, RoundedCornerShape(8.dp))
            .padding(12.dp)
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = Color.Gray, fontWeight = FontWeight.Bold)
        Text(
            value.orEmpty().ifBlank { "Unknown" },
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis
        )
    }
}
