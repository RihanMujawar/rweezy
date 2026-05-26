package com.example.rweezy.data

import android.content.Context

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
            prefs.edit().putString(KEY_SERVER_URL, normalizedUrl).apply()
        }
    }

    companion object {
        private const val PREFS_NAME = "server_config_prefs"
        private const val KEY_SERVER_URL = "server_url"
        private const val DEFAULT_URL = "http://10.0.2.2:3000" // Default to emulator loopback for local Vite server
    }
}
