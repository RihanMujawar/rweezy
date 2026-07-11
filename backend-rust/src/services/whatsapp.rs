use serde::Serialize;
use std::time::Duration;
use tracing::{error, info};

#[derive(Clone)]
pub struct WhatsAppService {
    sidecar_url: String,
    internal_token: String,
    client: reqwest::Client,
}

#[derive(Serialize)]
struct SendOtpPayload<'a> {
    phone: &'a str,
    code: &'a str,
}

#[derive(Serialize)]
struct SendMessagePayload<'a> {
    phone: &'a str,
    text: &'a str,
}

impl WhatsAppService {
    pub fn new(sidecar_url: String, internal_token: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            sidecar_url,
            internal_token,
            client,
        }
    }

    pub async fn send_otp(&self, phone: &str, code: &str) -> Result<(), String> {
        let url = format!("{}/send-otp", self.sidecar_url);
        info!("Sending OTP via sidecar to phone: {}", phone);

        let mut last_error = "Unknown error".to_string();
        for attempt in 1..=3 {
            match self
                .client
                .post(&url)
                .header("X-Internal-Token", &self.internal_token)
                .json(&SendOtpPayload { phone, code })
                .send()
                .await
            {
                Ok(response) => {
                    if response.status().is_success() {
                        return Ok(());
                    } else {
                        let status = response.status();
                        let body = response.text().await.unwrap_or_default();
                        last_error = format!("Status: {}, Response: {}", status, body);
                        error!(
                            "WhatsApp sidecar rejected send_otp (attempt {}/3): {}",
                            attempt, last_error
                        );
                    }
                }
                Err(e) => {
                    last_error = format!("Request failed: {}", e);
                    error!(
                        "WhatsApp sidecar send_otp connection error (attempt {}/3): {}",
                        attempt, last_error
                    );
                }
            }
            if attempt < 3 {
                tokio::time::sleep(Duration::from_millis(200 * attempt as u64)).await;
            }
        }

        Err(last_error)
    }

    pub async fn send_message(&self, phone: &str, text: &str) -> Result<(), String> {
        let url = format!("{}/send-message", self.sidecar_url);
        info!("Sending generic message via sidecar to phone: {}", phone);

        let mut last_error = "Unknown error".to_string();
        for attempt in 1..=3 {
            match self
                .client
                .post(&url)
                .header("X-Internal-Token", &self.internal_token)
                .json(&SendMessagePayload { phone, text })
                .send()
                .await
            {
                Ok(response) => {
                    if response.status().is_success() {
                        return Ok(());
                    } else {
                        let status = response.status();
                        let body = response.text().await.unwrap_or_default();
                        last_error = format!("Status: {}, Response: {}", status, body);
                        error!(
                            "WhatsApp sidecar rejected send_message (attempt {}/3): {}",
                            attempt, last_error
                        );
                    }
                }
                Err(e) => {
                    last_error = format!("Request failed: {}", e);
                    error!(
                        "WhatsApp sidecar send_message connection error (attempt {}/3): {}",
                        attempt, last_error
                    );
                }
            }
            if attempt < 3 {
                tokio::time::sleep(Duration::from_millis(200 * attempt as u64)).await;
            }
        }

        Err(last_error)
    }
}
