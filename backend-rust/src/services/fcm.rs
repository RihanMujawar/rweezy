use jsonwebtoken::{Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use tracing::{error, info, warn};

#[derive(Clone, Deserialize, Debug)]
struct ServiceAccount {
    project_id: String,
    private_key: String,
    client_email: String,
}

#[derive(Serialize)]
struct GoogleTokenClaims {
    iss: String,
    scope: String,
    aud: String,
    exp: u64,
    iat: u64,
}

#[derive(Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    expires_in: u64,
}

#[derive(Serialize)]
struct FcmMessageBody {
    message: FcmMessage,
}

#[derive(Serialize)]
struct FcmMessage {
    token: String,
    notification: FcmNotification,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<std::collections::HashMap<String, String>>,
}

#[derive(Serialize)]
struct FcmNotification {
    title: String,
    body: String,
}

struct TokenCache {
    access_token: String,
    expires_at: u64,
}

#[derive(Clone)]
pub struct FcmService {
    client: reqwest::Client,
    service_account: Option<ServiceAccount>,
    token_cache: Arc<Mutex<Option<TokenCache>>>,
    project_id: String,
}

impl FcmService {
    pub fn new(credentials_path: Option<String>, default_project_id: Option<String>) -> Self {
        let mut service_account = None;
        let mut project_id = default_project_id.unwrap_or_default();

        if let Some(path) = credentials_path {
            info!(
                "Attempting to load Google service account credentials from {}",
                path
            );
            match fs::read_to_string(&path) {
                Ok(content) => match serde_json::from_str::<ServiceAccount>(&content) {
                    Ok(sa) => {
                        project_id = sa.project_id.clone();
                        service_account = Some(sa);
                        info!(
                            "Successfully loaded credentials for Google Project: {}",
                            project_id
                        );
                    }
                    Err(e) => {
                        error!(
                            "Failed to parse Google service account file from {}: {}",
                            path, e
                        );
                    }
                },
                Err(e) => {
                    warn!(
                        "Could not read Google service account file from {}: {}",
                        path, e
                    );
                }
            }
        }

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(6))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            client,
            service_account,
            token_cache: Arc::new(Mutex::new(None)),
            project_id,
        }
    }

    async fn get_access_token(&self) -> Result<String, String> {
        let sa =
            match &self.service_account {
                Some(sa) => sa,
                None => return Err(
                    "Firebase service account credentials not loaded. Push notifications disabled."
                        .to_string(),
                ),
            };

        let now_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        {
            let cache = self.token_cache.lock().await;
            if let Some(c) = &*cache {
                if c.expires_at > now_secs + 30 {
                    return Ok(c.access_token.clone());
                }
            }
        }

        info!("FCM access token expired or not loaded. Requesting new Google OAuth2 token...");

        let claims = GoogleTokenClaims {
            iss: sa.client_email.clone(),
            scope: "https://www.googleapis.com/auth/firebase.messaging".to_string(),
            aud: "https://oauth2.googleapis.com/token".to_string(),
            iat: now_secs,
            exp: now_secs + 3600,
        };

        let encoding_key = EncodingKey::from_rsa_pem(sa.private_key.as_bytes())
            .map_err(|e| format!("Invalid private key format: {}", e))?;

        let mut header = Header::new(Algorithm::RS256);
        header.typ = Some("JWT".to_string());

        let signed_jwt = jsonwebtoken::encode(&header, &claims, &encoding_key)
            .map_err(|e| format!("Failed to sign Google token claims: {}", e))?;

        let res = self
            .client
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                ("assertion", &signed_jwt),
            ])
            .send()
            .await
            .map_err(|e| format!("Google OAuth2 token request failed: {}", e))?;

        if !res.status().is_success() {
            let err_body = res.text().await.unwrap_or_default();
            return Err(format!("Google rejected token request: {}", err_body));
        }

        let token_resp: GoogleTokenResponse = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse Google token response: {}", e))?;

        let token = token_resp.access_token;
        let expires_at = now_secs + token_resp.expires_in;

        let mut cache = self.token_cache.lock().await;
        *cache = Some(TokenCache {
            access_token: token.clone(),
            expires_at,
        });

        info!(
            "Successfully cached new Google OAuth2 token valid for {} seconds",
            token_resp.expires_in
        );
        Ok(token)
    }

    pub async fn send_notification(
        &self,
        token: &str,
        title: &str,
        body: &str,
        data: Option<std::collections::HashMap<String, String>>,
    ) -> Result<(), String> {
        if self.service_account.is_none() {
            warn!(
                "FCM push requested but credentials are not configured. Title: {}",
                title
            );
            return Ok(());
        }

        let access_token = self.get_access_token().await?;
        let url = format!(
            "https://fcm.googleapis.com/v1/projects/{}/messages:send",
            self.project_id
        );

        let payload = FcmMessageBody {
            message: FcmMessage {
                token: token.to_string(),
                notification: FcmNotification {
                    title: title.to_string(),
                    body: body.to_string(),
                },
                data,
            },
        };

        info!(
            "Sending FCM notification to token {}...",
            &token[..std::cmp::min(10, token.len())]
        );

        let mut last_error = "Unknown error".to_string();
        for attempt in 1..=3 {
            let response = self
                .client
                .post(&url)
                .bearer_auth(&access_token)
                .json(&payload)
                .send()
                .await;

            match response {
                Ok(resp) => {
                    if resp.status().is_success() {
                        info!("FCM v1 successfully sent notification");
                        return Ok(());
                    } else {
                        let status = resp.status();
                        let error_details = resp.text().await.unwrap_or_default();
                        last_error = format!("Status: {}, Details: {}", status, error_details);
                        error!(
                            "FCM v1 returned error (attempt {}/3): {}",
                            attempt, last_error
                        );
                    }
                }
                Err(e) => {
                    last_error = format!("FCM HTTP request failed: {}", e);
                    error!(
                        "FCM connection error (attempt {}/3): {}",
                        attempt, last_error
                    );
                }
            }

            if attempt < 3 {
                tokio::time::sleep(Duration::from_millis(300 * attempt as u64)).await;
            }
        }

        Err(last_error)
    }
}
