plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

/**
 * Release signing, supplied through the environment so no credential is ever
 * committed. scripts/release-android.sh loads them from an untracked
 * .env.android; Android Studio picks them up if they are exported in the shell.
 *
 * Absent, release builds stay unsigned rather than silently falling back to the
 * debug key, which would produce an artifact that looks releasable and is not.
 */
fun aegisSigning(): Map<String, String>? {
    val keystore = System.getenv("AEGIS_KEYSTORE_PATH")?.trim().orEmpty()
    val storePassword = System.getenv("AEGIS_KEYSTORE_PASSWORD")?.trim().orEmpty()
    val keyAlias = System.getenv("AEGIS_KEY_ALIAS")?.trim().orEmpty()
    val keyPassword = System.getenv("AEGIS_KEY_PASSWORD")?.trim().orEmpty().ifEmpty { storePassword }

    if (keystore.isEmpty() || storePassword.isEmpty() || keyAlias.isEmpty()) {
        return null
    }
    return mapOf(
        "path" to keystore,
        "storePassword" to storePassword,
        "keyAlias" to keyAlias,
        "keyPassword" to keyPassword
    )
}

/** Android caps this; a friendly failure beats "For input string". */
fun Project.resolveVersionCode(): Int {
    val raw = findProperty("aegisVersionCode") as String? ?: return 1
    val parsed = raw.toLongOrNull()
        ?: throw GradleException("aegisVersionCode must be a number, got '$raw'")
    if (parsed !in 1..2_100_000_000L) {
        throw GradleException(
            "aegisVersionCode must be between 1 and 2100000000 (Play's limit), got $parsed. " +
                "A YYYYMMDDHHMM timestamp does not fit — use minutes since an epoch instead."
        )
    }
    return parsed.toInt()
}

/**
 * The three things that differ per environment. Kept in one place so a new
 * environment cannot be added with, say, a base URL but no URL scheme — which
 * would build fine and then silently fail to receive deep links.
 */
fun com.android.build.api.dsl.ApplicationProductFlavor.aegisEnvironment(
    baseUrl: String,
    urlScheme: String,
    appLinkHost: String
) {
    buildConfigField("String", "AEGIS_WEB_APP_BASE_URL", "\"$baseUrl\"")
    buildConfigField("String", "AEGIS_URL_SCHEME", "\"$urlScheme\"")
    manifestPlaceholders["aegisUrlScheme"] = urlScheme
    manifestPlaceholders["aegisAppLinkHost"] = appLinkHost
}

android {
    namespace = "ca.vanguardcs.aegisid.wallet"
    compileSdk = 35

    defaultConfig {
        applicationId = "ca.vanguardcs.aegisid.wallet"
        minSdk = 26
        targetSdk = 35
        // Overridable so the release script can stamp a shared, increasing
        // number across every flavour in one run.
        //
        // Play caps versionCode at 2100000000, so the YYYYMMDDHHMM stamp iOS
        // uses for CFBundleVersion does not fit here. The release script passes
        // minutes elapsed since 2020-01-01, which is monotonic, ~3.4 million
        // today, and good until the year 5000.
        versionCode = resolveVersionCode()
        versionName = (project.findProperty("aegisVersionName") as String?) ?: "0.1.1"
    }

    // One flavour per environment, mirroring the iOS build configurations, so
    // dev, qa and prod can be installed side by side on one device and each
    // talks to its own web app.
    flavorDimensions += "environment"

    productFlavors {
        create("local") {
            dimension = "environment"
            applicationIdSuffix = ".local"
            versionNameSuffix = "-local"
            resValue("string", "app_name", "Aegis ID Local")
            // 10.0.2.2 is how an emulator reaches the host machine; localhost
            // would be the emulator itself.
            aegisEnvironment(
                baseUrl = "http://10.0.2.2:3000",
                urlScheme = "aegisid-local",
                appLinkHost = "10.0.2.2"
            )
        }
        create("dev") {
            dimension = "environment"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            resValue("string", "app_name", "Aegis ID Dev")
            aegisEnvironment(
                baseUrl = "https://vanguard-aegis-id-dev-0e75d1.azurewebsites.net",
                urlScheme = "aegisid-dev",
                appLinkHost = "vanguard-aegis-id-dev-0e75d1.azurewebsites.net"
            )
        }
        create("qa") {
            dimension = "environment"
            applicationIdSuffix = ".qa"
            versionNameSuffix = "-qa"
            resValue("string", "app_name", "Aegis ID QA")
            aegisEnvironment(
                baseUrl = "https://vanguard-aegis-id-qa-0e75d1.azurewebsites.net",
                urlScheme = "aegisid-qa",
                appLinkHost = "vanguard-aegis-id-qa-0e75d1.azurewebsites.net"
            )
        }
        create("prod") {
            dimension = "environment"
            resValue("string", "app_name", "Aegis ID")
            aegisEnvironment(
                baseUrl = "https://vanguard-aegis-id-0e75d1.azurewebsites.net",
                urlScheme = "aegisid",
                appLinkHost = "vanguard-aegis-id-0e75d1.azurewebsites.net"
            )
        }
    }

    val releaseSigning = aegisSigning()

    signingConfigs {
        if (releaseSigning != null) {
            create("release") {
                storeFile = file(releaseSigning.getValue("path"))
                storePassword = releaseSigning.getValue("storePassword")
                keyAlias = releaseSigning.getValue("keyAlias")
                keyPassword = releaseSigning.getValue("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (releaseSigning != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.navigation:navigation-compose:2.8.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    // Wallet ID and device key are stored encrypted at rest.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    // QR rendering only — pure Java, no camera. An administrator scans the
    // holder's Wallet ID from their screen.
    implementation("com.google.zxing:core:3.5.3")

    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
}
