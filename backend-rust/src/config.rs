use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub port: u16,
    pub host: String,
    pub whatsapp_sidecar_url: String,
    pub internal_token: String,
    pub fcm_project_id: Option<String>,
    pub google_application_credentials: Option<String>,
    pub cookie_secure: bool,
    pub database_max_connections: u32,
}

impl Config {
    pub fn from_env() -> Self {
        dotenvy::dotenv().ok();

        let database_url = env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://postgres:postgres@localhost:5432/rweezy".to_string());
        let jwt_secret = env::var("JWT_SECRET")
            .unwrap_or_else(|_| "your-random-jwt-secret-key-123456789".to_string());
        let port = env::var("BACKEND_PORT")
            .unwrap_or_else(|_| "4000".to_string())
            .parse::<u16>()
            .unwrap_or(4000);
        let host = env::var("BACKEND_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());

        let sidecar_port = env::var("WHATSAPP_SIDECAR_PORT").unwrap_or_else(|_| "4001".to_string());
        let whatsapp_sidecar_url = format!("http://127.0.0.1:{}", sidecar_port);
        let internal_token = env::var("INTERNAL_TOKEN")
            .unwrap_or_else(|_| "rweezy-internal-bypass-secret-12345!".to_string());

        let fcm_project_id = env::var("FCM_PROJECT_ID").ok();
        let google_application_credentials = env::var("GOOGLE_APPLICATION_CREDENTIALS").ok();
        let cookie_secure = env::var("COOKIE_SECURE").unwrap_or_default() == "true";
        let database_max_connections = env::var("DATABASE_MAX_CONNECTIONS")
            .unwrap_or_else(|_| "10".to_string())
            .parse::<u32>()
            .unwrap_or(10);

        Self {
            database_url,
            jwt_secret,
            port,
            host,
            whatsapp_sidecar_url,
            internal_token,
            fcm_project_id,
            google_application_credentials,
            cookie_secure,
            database_max_connections,
        }
    }
}
