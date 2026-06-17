package ca.vanguardcs.aegisid.wallet.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object VanguardColors {
    val Navy = Color(0xFF061625)
    val Ink = Color(0xFF182334)
    val Blue = Color(0xFF1769E0)
    val Cyan = Color(0xFF00B7C7)
    val Green = Color(0xFF19B97A)
    val Mist = Color(0xFFF5F9FD)
    val Line = Color(0xFFD7E2EE)
}

private val AegisColorScheme = lightColorScheme(
    primary = VanguardColors.Blue,
    secondary = VanguardColors.Green,
    tertiary = VanguardColors.Cyan,
    background = VanguardColors.Mist,
    surface = Color.White,
    onPrimary = Color.White,
    onSecondary = Color.White,
    onBackground = VanguardColors.Ink,
    onSurface = VanguardColors.Ink
)

@Composable
fun VanguardAegisTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = AegisColorScheme,
        content = content
    )
}

fun colorFromHex(value: String?, fallback: Color): Color {
    val raw = value.orEmpty().trim().removePrefix("#")
    if (raw.length != 6) return fallback
    return runCatching {
        Color(
            red = raw.substring(0, 2).toInt(16),
            green = raw.substring(2, 4).toInt(16),
            blue = raw.substring(4, 6).toInt(16)
        )
    }.getOrDefault(fallback)
}
