use actix_web::{web, HttpRequest, HttpResponse, Responder};
use sqlx::PgPool;
use tracing::error;
use uuid::Uuid;

use crate::handlers::auth::get_auth_user;
use crate::models::*;
use crate::services::order_notifications;
use crate::services::whatsapp::WhatsAppService;

pub async fn get_profile(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let profile =
        match sqlx::query_as::<_, DbProfile>("SELECT * FROM rweezy.profiles WHERE id = $1")
            .bind(user_id)
            .fetch_optional(pool.get_ref())
            .await
        {
            Ok(Some(p)) => p,
            _ => {
                return HttpResponse::NotFound()
                    .json(serde_json::json!({ "error": "Profile not found" }))
            }
        };

    HttpResponse::Ok().json(serde_json::json!({ "profile": profile }))
}

pub async fn update_profile(
    req: HttpRequest,
    payload: web::Json<ProfileUpdateRequest>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let full_name = payload.full_name.trim();
    let phone = payload.phone.trim();

    if full_name.is_empty() || phone.is_empty() {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "Full name and phone are required" }));
    }

    match sqlx::query_as::<_, DbProfile>(
        "UPDATE rweezy.profiles SET full_name = $1, phone = $2, updated_at = now() WHERE id = $3 RETURNING *"
    )
    .bind(full_name)
    .bind(phone)
    .bind(user_id)
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(p) => HttpResponse::Ok().json(serde_json::json!({ "profile": p })),
        Err(e) => {
            error!("Failed to update profile: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Database error" }))
        }
    }
}

pub async fn get_addresses(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let addresses = sqlx::query_as::<_, DbSavedAddress>(
        "SELECT * FROM rweezy.saved_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC"
    )
    .bind(user_id)
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({ "addresses": addresses }))
}

pub async fn create_address(
    req: HttpRequest,
    payload: web::Json<AddressRequest>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let address_text = payload.address.trim();
    if address_text.is_empty() {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "Address is required" }));
    }

    let label = payload.label.as_deref().unwrap_or("Saved address").trim();
    let is_default = payload.is_default.unwrap_or(false);

    if is_default {
        let _ =
            sqlx::query("UPDATE rweezy.saved_addresses SET is_default = false WHERE user_id = $1")
                .bind(user_id)
                .execute(pool.get_ref())
                .await;
    }

    match sqlx::query_as::<_, DbSavedAddress>(
        "INSERT INTO rweezy.saved_addresses (id, user_id, label, address, lat, lng, is_default, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
         RETURNING *"
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(label)
    .bind(address_text)
    .bind(payload.lat)
    .bind(payload.lng)
    .bind(is_default)
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(addr) => HttpResponse::Ok().json(serde_json::json!({ "address": addr })),
        Err(e) => {
            error!("Failed to create address: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Database error" }))
        }
    }
}

pub async fn delete_address(
    req: HttpRequest,
    path: web::Path<Uuid>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let id = path.into_inner();

    match sqlx::query("DELETE FROM rweezy.saved_addresses WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(pool.get_ref())
        .await
    {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({ "ok": true })),
        Err(e) => {
            error!("Failed to delete address: {}", e);
            HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": "Database error" }))
        }
    }
}

pub async fn get_role_requests(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let requests = sqlx::query_as::<_, DbRoleRequest>(
        "SELECT * FROM rweezy.role_requests WHERE user_id = $1 ORDER BY created_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({ "requests": requests }))
}

pub async fn create_role_request(
    req: HttpRequest,
    payload: web::Json<RoleRequestPayload>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
    whatsapp: web::Data<WhatsAppService>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let role_str = payload.requested_role.trim().to_lowercase();
    let requested_role = match role_str.as_str() {
        "hotel_manager" => AppRole::HotelManager,
        "grocery_manager" => AppRole::GroceryManager,
        "delivery_boy" => AppRole::DeliveryBoy,
        "rider" => AppRole::Rider,
        "all_in_one_partner" => AppRole::AllInOnePartner,
        _ => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({ "error": "Choose a valid role to request" }))
        }
    };

    let business_name = payload.business_name.as_deref().unwrap_or("").trim();
    let message = payload.message.as_deref().unwrap_or("").trim();

    match sqlx::query_as::<_, DbRoleRequest>(
        "INSERT INTO rweezy.role_requests (id, user_id, requested_role, status, business_name, message, created_at, updated_at)
         VALUES ($1, $2, $3::rweezy.AppRole, 'pending'::rweezy.RoleRequestStatus, $4, $5, now(), now())
         RETURNING *"
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(requested_role as AppRole)
    .bind(if business_name.is_empty() { None } else { Some(business_name) })
    .bind(if message.is_empty() { None } else { Some(message) })
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(request) => {
            order_notifications::spawn_role_request_created(
                pool.get_ref().clone(),
                whatsapp.get_ref().clone(),
                user_id,
                &role_str,
            );
            HttpResponse::Ok().json(serde_json::json!({ "request": request }))
        }
        Err(e) => {
            error!("Failed to create role request: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Database error" }))
        }
    }
}

pub async fn update_live_location(
    payload: web::Json<LiveLocationPayload>,
    pool: web::Data<PgPool>,
) -> impl Responder {
    let table = payload.table.trim();
    let row_id = match Uuid::parse_str(payload.row_id.trim()) {
        Ok(id) => id,
        Err(_) => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({ "error": "Invalid row_id" }))
        }
    };

    let (query_str, _rider_field_id) = match table {
        "rides" => ("UPDATE rweezy.rides SET rider_lat = $1, rider_lng = $2, rider_location_updated_at = now() WHERE id = $3 RETURNING id", "id"),
        "package_deliveries" => ("UPDATE rweezy.package_deliveries SET rider_lat = $1, rider_lng = $2, rider_location_updated_at = now() WHERE id = $3 RETURNING id", "id"),
        "food_orders" => ("UPDATE rweezy.food_orders SET rider_lat = $1, rider_lng = $2, rider_location_updated_at = now() WHERE id = $3 RETURNING id", "id"),
        "grocery_orders" => ("UPDATE rweezy.grocery_orders SET rider_lat = $1, rider_lng = $2, rider_location_updated_at = now() WHERE id = $3 RETURNING id", "id"),
        _ => return HttpResponse::BadRequest().json(serde_json::json!({ "error": "Invalid live location target" })),
    };

    match sqlx::query(query_str)
        .bind(payload.rider_lat)
        .bind(payload.rider_lng)
        .bind(row_id)
        .fetch_optional(pool.get_ref())
        .await
    {
        Ok(Some(_)) => HttpResponse::Ok().json(serde_json::json!({ "row": { "id": row_id } })),
        Ok(None) => {
            HttpResponse::NotFound().json(serde_json::json!({ "error": "Order/job not found" }))
        }
        Err(e) => {
            error!("Failed to update live location: {}", e);
            HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": "Database error" }))
        }
    }
}
