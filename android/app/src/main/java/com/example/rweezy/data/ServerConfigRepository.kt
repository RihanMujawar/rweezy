package com.example.rweezy.data

import android.content.Context
import com.example.rweezy.BuildConfig

interface ServerConfigRepository {
    fun getServerUrl(): String
    fun saveServerUrl(url: String)
}

class SharedPreferencesServerConfigRepository(private val context: Context) : ServerConfigRepository {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    override fun getServerUrl(): String {
        return prefs.getString(KEY_SERVER_URL, DEFAULT_URL) ?: DEFAULT_URL
    }

    override fun saveServerUrl(url: String) {
        var normalizedUrl = url.trim()
        if (normalizedUrl.isNotEmpty()) {
            if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
                normalizedUrl = "http://$normalizedUrl"
            }
            normalizedUrl = normalizedUrl.trimEnd('/')
            prefs.edit().putString(KEY_SERVER_URL, normalizedUrl).apply()
        }
    }

    companion object {
        private const val PREFS_NAME = "server_config_prefs"
        private const val KEY_SERVER_URL = "server_url"
        // Default comes from BuildConfig and can be overridden with BACKEND_URL Gradle property.
        private val DEFAULT_URL =
            BuildConfig.BACKEND_URL.trim().ifEmpty { "http://10.0.2.2:4000" }.trimEnd('/')
    }
}
