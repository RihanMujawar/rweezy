package com.example.rweezy.messaging

import android.content.Context
import android.webkit.JavascriptInterface
import com.google.firebase.messaging.FirebaseMessaging

class RweezyAndroidBridge(
    private val context: Context,
    private val onTokenRefreshed: () -> Unit,
) {
    @JavascriptInterface
    fun getFcmToken(): String {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_FCM_TOKEN, "")
            .orEmpty()
    }

    @JavascriptInterface
    fun refreshFcmToken() {
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_FCM_TOKEN, token)
                .apply()
            onTokenRefreshed()
        }
    }

    companion object {
        const val PREFS_NAME = "rweezy_app"
        const val KEY_FCM_TOKEN = "fcm_token"
    }
}
