// Thin WebView shell around the published map. The map itself is loaded from
// GitHub Pages, so a new APK is only needed when this shell changes.
// CI passes the version and the release key through the environment; without
// the key the release build is left unsigned.
plugins {
    id("com.android.application")
}

val env: (String) -> String? = { System.getenv(it)?.takeIf(String::isNotBlank) }

android {
    namespace = "io.github.pr0head.nitc"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.pr0head.nitc"
        minSdk = 26
        targetSdk = 36
        versionCode = env("VERSION_CODE")?.toInt() ?: 1
        versionName = env("VERSION_NAME") ?: "dev"
    }

    val keystore = env("KEYSTORE_FILE")
    if (keystore != null) {
        signingConfigs {
            create("release") {
                storeFile = file(keystore)
                storePassword = env("KEYSTORE_PASSWORD")
                keyAlias = env("KEY_ALIAS")
                keyPassword = env("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystore != null) signingConfig = signingConfigs.getByName("release")
        }
    }
}
