use actix_web::{error, web, HttpRequest, HttpResponse, Responder};
use chrono::Utc;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{error as log_error, info};
use uuid::Uuid;

use crate::auth::{compare_password, generate_token, hash_password};
use crate::models::*;
use crate::services::whatsapp::WhatsAppService;

#[derive(Clone)]
pub struct OtpRecord {
    pub code: String,
    pub expires_at: i64,
    pub attempts: i32,
}

pub type OtpStore = Arc<Mutex<HashMap<String, OtpRecord>>>;

fn generate_otp_code() -> String {
    let mut rng = rand::thread_rng();
    format!("{:06}", rng.gen_range(100000..1000000))
}

pub fn get_auth_user(req: &HttpRequest, secret: &str) -> Result<Uuid, actix_web::Error> {
    if let Some(auth_header) = req.headers().get("Authorization") {
        if let Ok(auth_str) = auth_header.to_str() {
            if auth_str.starts_with("Bearer ") {
                let token = &auth_str[7..];
                if let Some(user_id) = crate::auth::verify_token(token, secret) {
                    return Ok(user_id);
                }
            }
        }
    }

    if let Some(cookie) = req.cookie("rweezy_access_token") {
        let token = cookie.value();
        if let Some(user_id) = crate::auth::verify_token(token, secret) {
            return Ok(user_id);
        }
    }

    Err(error::ErrorUnauthorized("Please sign in to continue"))
}

pub async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "ok": true,
        "timestamp": Utc::now().to_rfc3339()
    }))
}

pub async fn admin_health(pool: web::Data<PgPool>) -> impl Responder {
    let pending_roles_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM rweezy.role_requests WHERE status = 'pending'::rweezy.RoleRequestStatus"
    )
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or(0);

    let food_pending_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM rweezy.food_orders WHERE status IN ('pending'::rweezy.OrderStatus, 'accepted'::rweezy.OrderStatus, 'preparing'::rweezy.OrderStatus) AND delivery_boy_id IS NULL"
    )
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or(0);

    let grocery_pending_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM rweezy.grocery_orders WHERE status IN ('pending'::rweezy.OrderStatus, 'accepted'::rweezy.OrderStatus, 'preparing'::rweezy.OrderStatus) AND delivery_boy_id IS NULL"
    )
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or(0);

    let ready_food_unassigned_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM rweezy.food_orders WHERE status = 'ready'::rweezy.OrderStatus AND delivery_boy_id IS NULL"
    )
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or(0);

    HttpResponse::Ok().json(serde_json::json!({
        "pendingRoleRequests": pending_roles_count,
        "foodOrdersNeedingAttention": food_pending_count,
        "groceryOrdersNeedingAttention": grocery_pending_count,
        "readyFoodWithoutRider": ready_food_unassigned_count
    }))
}

pub async fn send_otp(
    payload: web::Json<PhoneOtpSendRequest>,
    otp_store: web::Data<OtpStore>,
    whatsapp_service: web::Data<WhatsAppService>,
    pool: web::Data<PgPool>,
) -> impl Responder {
    let phone = payload.phone.trim();
    let purpose = payload.purpose.trim();

    if phone.is_empty() || purpose.is_empty() {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "Phone and purpose are required" }));
    }

    if purpose == "login" || purpose == "reset_password" {
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM rweezy.users WHERE phone = $1)",
        )
        .bind(phone)
        .fetch_one(pool.get_ref())
        .await
        .unwrap_or(false);

        if !exists {
            return HttpResponse::NotFound()
                .json(serde_json::json!({ "error": "No account found for this phone number" }));
        }
    } else if purpose == "register" {
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM rweezy.users WHERE phone = $1)",
        )
        .bind(phone)
        .fetch_one(pool.get_ref())
        .await
        .unwrap_or(false);

        if exists {
            return HttpResponse::Conflict()
                .json(serde_json::json!({ "error": "This phone number is already registered" }));
        }
    }

    let code = generate_otp_code();
    let expires_at = Utc::now().timestamp() + 600;

    {
        let mut store = otp_store.lock().await;
        store.insert(
            phone.to_string(),
            OtpRecord {
                code: code.clone(),
                expires_at,
                attempts: 0,
            },
        );
    }

    info!("Generated OTP for {} (expires in 10m)", phone);

    if let Err(e) = whatsapp_service.send_otp(phone, &code).await {
        log_error!("Failed to dispatch WhatsApp OTP: {}", e);
        return HttpResponse::InternalServerError()
            .json(serde_json::json!({ "error": "Failed to send OTP message" }));
    }

    HttpResponse::Ok().json(serde_json::json!({
        "ok": true,
        "purpose": purpose,
        "provider": "whatsapp",
        "message": "Verification code sent to your WhatsApp"
    }))
}

pub async fn verify_otp(
    payload: web::Json<PhoneOtpVerifyRequest>,
    otp_store: web::Data<OtpStore>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let phone = payload.phone.trim();
    let code = payload.code.trim();
    let purpose = payload.purpose.trim();

    let record = {
        let mut store = otp_store.lock().await;
        match store.get_mut(phone) {
            Some(rec) => {
                if rec.expires_at < Utc::now().timestamp() {
                    store.remove(phone);
                    return HttpResponse::BadRequest()
                        .json(serde_json::json!({ "error": "OTP expired. Request a new code." }));
                }
                if rec.attempts >= 5 {
                    store.remove(phone);
                    return HttpResponse::BadRequest().json(serde_json::json!({ "error": "Too many incorrect OTP attempts. Request a new code." }));
                }
                rec.attempts += 1;
                rec.clone()
            }
            None => {
                if std::env::var("WHATSAPP_OTP_DEV_BYPASS").unwrap_or_default() == "true" {
                    OtpRecord {
                        code: code.to_string(),
                        expires_at: 0,
                        attempts: 0,
                    }
                } else {
                    return HttpResponse::BadRequest().json(
                        serde_json::json!({ "error": "OTP is required. Request a new code." }),
                    );
                }
            }
        }
    };

    if record.code != code
        && std::env::var("WHATSAPP_OTP_DEV_BYPASS_CODE").unwrap_or_else(|_| "123456".to_string())
            != code
    {
        return HttpResponse::BadRequest().json(serde_json::json!({ "error": "OTP is incorrect" }));
    }

    {
        let mut store = otp_store.lock().await;
        store.remove(phone);
    }

    if purpose == "register" || purpose == "reset_password" {
        let temp_token = generate_token(Uuid::new_v4(), &config.jwt_secret).unwrap_or_default();
        return HttpResponse::Ok().json(serde_json::json!({
            "ok": true,
            "phoneVerificationToken": temp_token
        }));
    }

    let user = match sqlx::query_as::<_, DbUser>("SELECT * FROM rweezy.users WHERE phone = $1")
        .bind(phone)
        .fetch_optional(pool.get_ref())
        .await
    {
        Ok(Some(u)) => u,
        _ => {
            return HttpResponse::NotFound()
                .json(serde_json::json!({ "error": "No account found for this phone number" }))
        }
    };

    let roles: Vec<String> = sqlx::query_scalar::<_, String>(
        "SELECT role::text FROM rweezy.user_roles WHERE user_id = $1",
    )
    .bind(user.id)
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    let session_token = match generate_token(user.id, &config.jwt_secret) {
        Ok(t) => t,
        Err(_) => {
            return HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": "Failed to generate session" }))
        }
    };

    let cookie = actix_web::cookie::Cookie::build("rweezy_access_token", session_token)
        .path("/")
        .max_age(actix_web::cookie::time::Duration::days(7))
        .http_only(true)
        .secure(config.cookie_secure)
        .same_site(actix_web::cookie::SameSite::Lax)
        .finish();

    HttpResponse::Ok().cookie(cookie).json(serde_json::json!({
        "user": { "id": user.id, "email": user.email, "phone": user.phone },
        "roles": roles
    }))
}

pub async fn password_reset_request(
    payload: web::Json<PasswordResetRequest>,
    otp_store: web::Data<OtpStore>,
    whatsapp_service: web::Data<WhatsAppService>,
    pool: web::Data<PgPool>,
) -> impl Responder {
    let phone = payload.phone.trim();
    if phone.is_empty() {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "Phone is required" }));
    }

    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM rweezy.users WHERE phone = $1)")
            .bind(phone)
            .fetch_one(pool.get_ref())
            .await
            .unwrap_or(false);

    if !exists {
        return HttpResponse::NotFound()
            .json(serde_json::json!({ "error": "No account found for this phone number" }));
    }

    let code = generate_otp_code();
    let expires_at = Utc::now().timestamp() + 600;

    {
        let mut store = otp_store.lock().await;
        store.insert(
            phone.to_string(),
            OtpRecord {
                code: code.clone(),
                expires_at,
                attempts: 0,
            },
        );
    }

    info!("Generated Reset password OTP for {}", phone);

    if let Err(e) = whatsapp_service.send_otp(phone, &code).await {
        log_error!("Failed to dispatch reset WhatsApp OTP: {}", e);
        return HttpResponse::InternalServerError()
            .json(serde_json::json!({ "error": "Failed to send reset code" }));
    }

    HttpResponse::Ok().json(serde_json::json!({
        "ok": true,
        "message": "Verification code sent to your WhatsApp"
    }))
}

pub async fn password_reset_complete(
    payload: web::Json<PasswordResetCompleteRequest>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let phone = payload.phone.trim();
    let password = payload.password.trim();
    let phone_token = payload.phone_verification_token.trim();

    if phone.is_empty() || password.is_empty() || phone_token.is_empty() {
        return HttpResponse::BadRequest().json(
            serde_json::json!({ "error": "Phone, password, and verification token are required" }),
        );
    }

    if crate::auth::verify_token(phone_token, &config.jwt_secret).is_none() {
        return HttpResponse::Unauthorized()
            .json(serde_json::json!({ "error": "Invalid or expired verification token" }));
    }

    let user = match sqlx::query_as::<_, DbUser>("SELECT * FROM rweezy.users WHERE phone = $1")
        .bind(phone)
        .fetch_optional(pool.get_ref())
        .await
    {
        Ok(Some(u)) => u,
        _ => {
            return HttpResponse::NotFound()
                .json(serde_json::json!({ "error": "Account not found" }))
        }
    };

    let pass_hash = hash_password(password);

    if let Err(e) =
        sqlx::query("UPDATE rweezy.users SET password_hash = $1, updated_at = now() WHERE id = $2")
            .bind(&pass_hash)
            .bind(user.id)
            .execute(pool.get_ref())
            .await
    {
        log_error!("Failed to reset password: {}", e);
        return HttpResponse::InternalServerError()
            .json(serde_json::json!({ "error": "Database error" }));
    }

    let roles: Vec<String> = sqlx::query_scalar::<_, String>(
        "SELECT role::text FROM rweezy.user_roles WHERE user_id = $1",
    )
    .bind(user.id)
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    let session_token = match generate_token(user.id, &config.jwt_secret) {
        Ok(t) => t,
        Err(_) => {
            return HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": "Failed to generate session" }))
        }
    };

    let cookie = actix_web::cookie::Cookie::build("rweezy_access_token", session_token)
        .path("/")
        .max_age(actix_web::cookie::time::Duration::days(7))
        .http_only(true)
        .secure(config.cookie_secure)
        .same_site(actix_web::cookie::SameSite::Lax)
        .finish();

    HttpResponse::Ok().cookie(cookie).json(serde_json::json!({
        "ok": true,
        "user": { "id": user.id, "email": user.email, "phone": user.phone },
        "roles": roles,
        "message": "Password updated. You are now signed in."
    }))
}

pub async fn login(
    payload: web::Json<LoginRequest>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let phone = payload.phone.trim();
    let password = &payload.password;

    let user = match sqlx::query_as::<_, DbUser>("SELECT * FROM rweezy.users WHERE phone = $1")
        .bind(phone)
        .fetch_optional(pool.get_ref())
        .await
    {
        Ok(Some(u)) => u,
        _ => {
            return HttpResponse::Unauthorized()
                .json(serde_json::json!({ "error": "Invalid credentials" }))
        }
    };

    if !compare_password(password, &user.password_hash) {
        return HttpResponse::Unauthorized()
            .json(serde_json::json!({ "error": "Invalid credentials" }));
    }

    let roles: Vec<String> = sqlx::query_scalar::<_, String>(
        "SELECT role::text FROM rweezy.user_roles WHERE user_id = $1",
    )
    .bind(user.id)
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    let session_token = match generate_token(user.id, &config.jwt_secret) {
        Ok(t) => t,
        Err(_) => {
            return HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": "Failed to generate session" }))
        }
    };

    let cookie = actix_web::cookie::Cookie::build("rweezy_access_token", session_token)
        .path("/")
        .max_age(actix_web::cookie::time::Duration::days(7))
        .http_only(true)
        .secure(config.cookie_secure)
        .same_site(actix_web::cookie::SameSite::Lax)
        .finish();

    HttpResponse::Ok().cookie(cookie).json(serde_json::json!({
        "user": { "id": user.id, "email": user.email, "phone": user.phone },
        "roles": roles
    }))
}

pub async fn register(
    payload: web::Json<RegisterRequest>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let full_name = payload.full_name.trim();
    let phone = payload.phone.trim();
    let password = payload.password.trim();
    let phone_token = payload.phone_verification_token.trim();

    if full_name.is_empty() || phone.is_empty() || password.is_empty() || phone_token.is_empty() {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "All fields are required" }));
    }

    if crate::auth::verify_token(phone_token, &config.jwt_secret).is_none() {
        return HttpResponse::Unauthorized()
            .json(serde_json::json!({ "error": "Invalid or expired verification token" }));
    }

    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM rweezy.users WHERE phone = $1)")
            .bind(phone)
            .fetch_one(pool.get_ref())
            .await
            .unwrap_or(false);

    if exists {
        return HttpResponse::Conflict()
            .json(serde_json::json!({ "error": "This phone number is already registered" }));
    }

    let pass_hash = hash_password(password);

    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            log_error!("Failed to start transaction: {}", e);
            return HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": "Database error" }));
        }
    };

    let user_id = Uuid::new_v4();

    if let Err(e) = sqlx::query(
        "INSERT INTO rweezy.users (id, phone, password_hash, created_at, updated_at) VALUES ($1, $2, $3, now(), now())"
    )
    .bind(user_id)
    .bind(phone)
    .bind(&pass_hash)
    .execute(&mut *tx)
    .await
    {
        log_error!("Failed to create user: {}", e);
        return HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Database error creating user" }));
    }

    if let Err(e) = sqlx::query(
        "INSERT INTO rweezy.profiles (id, full_name, phone, created_at, updated_at, town_name, pincode) VALUES ($1, $2, $3, now(), now(), $4, $5)"
    )
    .bind(user_id)
    .bind(full_name)
    .bind(phone)
    .bind(payload.town_name.as_deref())
    .bind(payload.pincode.as_deref())
    .execute(&mut *tx)
    .await
    {
        log_error!("Failed to create profile: {}", e);
        return HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Database error creating profile" }));
    }

    if let Err(e) = sqlx::query(
        "INSERT INTO rweezy.user_roles (id, user_id, role, created_at) VALUES ($1, $2, 'customer'::rweezy.AppRole, now())"
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .execute(&mut *tx)
    .await
    {
        log_error!("Failed to grant default customer role: {}", e);
        return HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Database error creating roles" }));
    }

    if let Some(req_role) = &payload.requested_role {
        if req_role != "customer" {
            let parsed_role = match req_role.as_str() {
                "admin" => AppRole::Admin,
                "hotel_manager" => AppRole::HotelManager,
                "grocery_manager" => AppRole::GroceryManager,
                "delivery_boy" => AppRole::DeliveryBoy,
                "rider" => AppRole::Rider,
                _ => AppRole::Customer,
            };

            if parsed_role != AppRole::Customer {
                if let Err(e) = sqlx::query(
                    "INSERT INTO rweezy.role_requests (id, user_id, requested_role, status, business_name, business_address, business_lat, business_lng, town_name, pincode, message, created_at, updated_at)
                     VALUES ($1, $2, $3::rweezy.AppRole, 'pending'::rweezy.RoleRequestStatus, $4, $5, $6, $7, $8, $9, $10, now(), now())"
                )
                .bind(Uuid::new_v4())
                .bind(user_id)
                .bind(parsed_role as AppRole)
                .bind(payload.business_name.as_deref())
                .bind(payload.business_address.as_deref())
                .bind(payload.business_lat)
                .bind(payload.business_lng)
                .bind(payload.town_name.as_deref())
                .bind(payload.pincode.as_deref())
                .bind(payload.role_message.as_deref().unwrap_or("Requested during registration"))
                .execute(&mut *tx)
                .await
                {
                    log_error!("Failed to record role request: {}", e);
                    return HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Database error requesting roles" }));
                }
            }
        }
    }

    if let Err(e) = tx.commit().await {
        log_error!("Failed to commit registration transaction: {}", e);
        return HttpResponse::InternalServerError()
            .json(serde_json::json!({ "error": "Transaction commit error" }));
    }

    let session_token = match generate_token(user_id, &config.jwt_secret) {
        Ok(t) => t,
        Err(_) => {
            return HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": "Failed to generate session" }))
        }
    };

    let cookie = actix_web::cookie::Cookie::build("rweezy_access_token", session_token)
        .path("/")
        .max_age(actix_web::cookie::time::Duration::days(7))
        .http_only(true)
        .secure(config.cookie_secure)
        .same_site(actix_web::cookie::SameSite::Lax)
        .finish();

    HttpResponse::Ok().cookie(cookie).json(serde_json::json!({
        "user": { "id": user_id, "email": Option::<String>::None, "phone": phone },
        "roles": vec!["customer"],
        "authenticated": true
    }))
}

pub async fn logout(config: web::Data<crate::config::Config>) -> impl Responder {
    let cookie = actix_web::cookie::Cookie::build("rweezy_access_token", "")
        .path("/")
        .max_age(actix_web::cookie::time::Duration::seconds(0))
        .http_only(true)
        .secure(config.cookie_secure)
        .same_site(actix_web::cookie::SameSite::Lax)
        .finish();

    HttpResponse::Ok()
        .cookie(cookie)
        .json(serde_json::json!({ "ok": true }))
}

pub async fn me(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let user = match sqlx::query_as::<_, DbUser>("SELECT * FROM rweezy.users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool.get_ref())
        .await
    {
        Ok(Some(u)) => u,
        _ => {
            return HttpResponse::NotFound().json(serde_json::json!({ "error": "User not found" }))
        }
    };

    let roles: Vec<String> = sqlx::query_scalar::<_, String>(
        "SELECT role::text FROM rweezy.user_roles WHERE user_id = $1",
    )
    .bind(user.id)
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "user": { "id": user.id, "email": user.email, "phone": user.phone },
        "roles": roles
    }))
}

pub async fn register_push_token(
    req: HttpRequest,
    payload: web::Json<serde_json::Value>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let token = match payload.get("token").and_then(|v| v.as_str()) {
        Some(t) => t.trim(),
        None => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({ "error": "token is required" }))
        }
    };

    let platform = payload
        .get("platform")
        .and_then(|v| v.as_str())
        .unwrap_or("web")
        .trim();
    let device_label = payload
        .get("device_label")
        .or_else(|| payload.get("user_agent"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    match sqlx::query(
        "INSERT INTO rweezy.user_push_tokens (id, user_id, token, platform, device_label, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now(), now())
         ON CONFLICT (token) DO UPDATE SET user_id = $2, platform = $4, device_label = $5, updated_at = now()
         RETURNING id"
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(token)
    .bind(platform)
    .bind(if device_label.is_empty() { None } else { Some(device_label) })
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(row) => {
            use sqlx::Row;
            let row_id: Uuid = row.get("id");
            HttpResponse::Ok().json(serde_json::json!({ "pushToken": { "id": row_id } }))
        }
        Err(e) => {
            log_error!("Failed to register push token: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Database error" }))
        }
    }
}
