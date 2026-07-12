use actix_web::{web, HttpRequest, HttpResponse, Responder};
use chrono::{DateTime, Datelike, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::error;
use uuid::Uuid;

use crate::handlers::auth::get_auth_user;
use crate::models::*;
use crate::websocket::SharedBroker;

fn generate_delivery_pin() -> String {
    let mut rng = rand::thread_rng();
    format!("{:04}", rng.gen_range(0..10000))
}

fn verify_ride_transition(current: &str, next: &str) -> bool {
    let states = vec!["requested", "accepted", "started", "completed", "cancelled"];
    let i_curr = match states.iter().position(|&x| x == current) {
        Some(i) => i,
        None => return false,
    };
    let i_next = match states.iter().position(|&x| x == next) {
        Some(i) => i,
        None => return false,
    };

    if next == "cancelled" {
        return current == "requested" || current == "accepted" || current == "started";
    }

    i_next == i_curr + 1
}

async fn broadcast_job_update(broker: &SharedBroker, id: &Uuid) {
    let msg = serde_json::json!({
        "type": "order_updated",
        "payload": {
            "orderId": id.to_string()
        }
    })
    .to_string();

    let b = broker.lock().await;
    b.broadcast(&format!("order_{}", id), &msg);
}

pub async fn book_ride(
    req: HttpRequest,
    payload: web::Json<RideBookingRequest>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
    broker: web::Data<SharedBroker>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let ride_id = Uuid::new_v4();
    let pin = generate_delivery_pin();
    let eta = Utc::now() + chrono::Duration::minutes(15);

    match sqlx::query(
        "INSERT INTO rweezy.rides (id, customer_id, pickup_address, pickup_lat, pickup_lng, drop_address, drop_lat, drop_lng, status, fare_estimate, notes, vehicle_type, payment_method, payment_status, delivery_pin, estimated_arrival_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'requested'::rweezy.RideStatus, $9, $10, $11, $12, 'pending', $13, $14, now(), now())
         RETURNING id"
    )
    .bind(ride_id)
    .bind(user_id)
    .bind(&payload.pickup_address)
    .bind(payload.pickup_lat)
    .bind(payload.pickup_lng)
    .bind(&payload.drop_address)
    .bind(payload.drop_lat)
    .bind(payload.drop_lng)
    .bind(rust_decimal::Decimal::from_f64_retain(payload.fare_estimate).unwrap_or_default())
    .bind(payload.notes.as_deref())
    .bind(payload.vehicle_type.as_deref().unwrap_or("bike"))
    .bind(payload.payment_method.as_deref().unwrap_or("cash"))
    .bind(&pin)
    .bind(eta)
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(_) => {
            broadcast_job_update(&broker, &ride_id).await;
            HttpResponse::Ok().json(serde_json::json!({
                "ride": {
                    "id": ride_id,
                    "delivery_pin": pin
                }
            }))
        }
        Err(e) => {
            error!("Failed to book ride: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Failed to book ride" }))
        }
    }
}

pub async fn book_package(
    req: HttpRequest,
    payload: web::Json<PackageBookingRequest>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
    broker: web::Data<SharedBroker>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let pkg_id = Uuid::new_v4();
    let pin = generate_delivery_pin();
    let etd = Utc::now() + chrono::Duration::minutes(20);

    match sqlx::query(
        "INSERT INTO rweezy.package_deliveries (id, customer_id, pickup_address, pickup_lat, pickup_lng, drop_address, drop_lat, drop_lng, package_size, receiver_name, receiver_phone, notes, status, fare_estimate, payment_method, payment_status, delivery_pin, estimated_delivery_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'requested'::rweezy.RideStatus, $13, $14, 'pending', $15, $16, now(), now())
         RETURNING id"
    )
    .bind(pkg_id)
    .bind(user_id)
    .bind(&payload.pickup_address)
    .bind(payload.pickup_lat)
    .bind(payload.pickup_lng)
    .bind(&payload.drop_address)
    .bind(payload.drop_lat)
    .bind(payload.drop_lng)
    .bind(payload.package_size.as_deref().unwrap_or("small"))
    .bind(&payload.receiver_name)
    .bind(&payload.receiver_phone)
    .bind(payload.notes.as_deref())
    .bind(rust_decimal::Decimal::from_f64_retain(payload.fare_estimate).unwrap_or_default())
    .bind(payload.payment_method.as_deref().unwrap_or("cash"))
    .bind(&pin)
    .bind(etd)
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(_) => {
            broadcast_job_update(&broker, &pkg_id).await;
            HttpResponse::Ok().json(serde_json::json!({
                "packageDelivery": {
                    "id": pkg_id,
                    "delivery_pin": pin
                }
            }))
        }
        Err(e) => {
            error!("Failed to book package: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Failed to book package" }))
        }
    }
}

pub async fn get_rider_jobs(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let rides_rows_res = sqlx::query(
        "SELECT r.id, r.pickup_address, r.pickup_lat, r.pickup_lng, r.drop_address, r.drop_lat, r.drop_lng, r.status, r.fare_estimate, r.vehicle_type, r.created_at, pc.full_name as customer_name, pc.phone as customer_phone
         FROM rweezy.rides r
         LEFT JOIN rweezy.profiles pc ON r.customer_id = pc.id
         WHERE (r.rider_id IS NULL OR r.rider_id = $1) AND r.status NOT IN ('completed'::rweezy.RideStatus, 'cancelled'::rweezy.RideStatus)"
    )
    .bind(user_id)
    .fetch_all(pool.get_ref())
    .await;

    let mapped_rides: Vec<serde_json::Value> = match rides_rows_res {
        Ok(rows) => rows
            .iter()
            .map(|r| {
                use sqlx::Row;
                let id: Uuid = r.get("id");
                let pickup_address: String = r.get("pickup_address");
                let pickup_lat: f64 = r.get("pickup_lat");
                let pickup_lng: f64 = r.get("pickup_lng");
                let drop_address: String = r.get("drop_address");
                let drop_lat: f64 = r.get("drop_lat");
                let drop_lng: f64 = r.get("drop_lng");
                let status: RideStatus = r.try_get("status").unwrap_or(RideStatus::Requested);
                let fare_estimate: Option<rust_decimal::Decimal> = r.get("fare_estimate");
                let vehicle_type: String = r.get("vehicle_type");
                let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");
                let customer_name: Option<String> = r.get("customer_name");
                let customer_phone: Option<String> = r.get("customer_phone");

                let profiles =
                    serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
                serde_json::json!({
                    "id": id,
                    "pickup_address": pickup_address,
                    "pickup_lat": pickup_lat,
                    "pickup_lng": pickup_lng,
                    "drop_address": drop_address,
                    "drop_lat": drop_lat,
                    "drop_lng": drop_lng,
                    "status": status as RideStatus,
                    "fare_estimate": fare_estimate,
                    "vehicle_type": vehicle_type,
                    "created_at": created_at,
                    "profiles": profiles,
                    "customer": profiles
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    let packages_rows_res = sqlx::query(
        "SELECT p.id, p.pickup_address, p.pickup_lat, p.pickup_lng, p.drop_address, p.drop_lat, p.drop_lng, p.package_size, p.receiver_name, p.receiver_phone, p.status, p.fare_estimate, p.created_at, pc.full_name as customer_name, pc.phone as customer_phone
         FROM rweezy.package_deliveries p
         LEFT JOIN rweezy.profiles pc ON p.customer_id = pc.id
         WHERE (p.rider_id IS NULL OR p.rider_id = $1) AND p.status NOT IN ('completed'::rweezy.RideStatus, 'cancelled'::rweezy.RideStatus)"
    )
    .bind(user_id)
    .fetch_all(pool.get_ref())
    .await;

    let mapped_packages: Vec<serde_json::Value> = match packages_rows_res {
        Ok(rows) => rows
            .iter()
            .map(|p| {
                use sqlx::Row;
                let id: Uuid = p.get("id");
                let pickup_address: String = p.get("pickup_address");
                let pickup_lat: f64 = p.get("pickup_lat");
                let pickup_lng: f64 = p.get("pickup_lng");
                let drop_address: String = p.get("drop_address");
                let drop_lat: f64 = p.get("drop_lat");
                let drop_lng: f64 = p.get("drop_lng");
                let package_size: String = p.get("package_size");
                let receiver_name: Option<String> = p.get("receiver_name");
                let receiver_phone: Option<String> = p.get("receiver_phone");
                let status: RideStatus = p.try_get("status").unwrap_or(RideStatus::Requested);
                let fare_estimate: Option<rust_decimal::Decimal> = p.get("fare_estimate");
                let created_at: chrono::DateTime<chrono::Utc> = p.get("created_at");
                let customer_name: Option<String> = p.get("customer_name");
                let customer_phone: Option<String> = p.get("customer_phone");

                let profiles =
                    serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
                serde_json::json!({
                    "id": id,
                    "pickup_address": pickup_address,
                    "pickup_lat": pickup_lat,
                    "pickup_lng": pickup_lng,
                    "drop_address": drop_address,
                    "drop_lat": drop_lat,
                    "drop_lng": drop_lng,
                    "package_size": package_size,
                    "receiver_name": receiver_name,
                    "receiver_phone": receiver_phone,
                    "status": status as RideStatus,
                    "fare_estimate": fare_estimate,
                    "created_at": created_at,
                    "profiles": profiles,
                    "customer": profiles
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "rides": mapped_rides,
        "packages": mapped_packages
    }))
}

pub async fn get_rider_active(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let ride_row_res = sqlx::query(
        "SELECT r.id, r.pickup_address, r.pickup_lat, r.pickup_lng, r.drop_address, r.drop_lat, r.drop_lng, r.status, r.fare_estimate, r.vehicle_type, r.created_at, pc.full_name as customer_name, pc.phone as customer_phone
         FROM rweezy.rides r
         LEFT JOIN rweezy.profiles pc ON r.customer_id = pc.id
         WHERE r.rider_id = $1 AND r.status NOT IN ('completed'::rweezy.RideStatus, 'cancelled'::rweezy.RideStatus)
         ORDER BY r.created_at DESC LIMIT 1"
    )
    .bind(user_id)
    .fetch_optional(pool.get_ref())
    .await;

    if let Ok(Some(r)) = ride_row_res {
        use sqlx::Row;
        let id: Uuid = r.get("id");
        let pickup_address: String = r.get("pickup_address");
        let pickup_lat: f64 = r.get("pickup_lat");
        let pickup_lng: f64 = r.get("pickup_lng");
        let drop_address: String = r.get("drop_address");
        let drop_lat: f64 = r.get("drop_lat");
        let drop_lng: f64 = r.get("drop_lng");
        let status: RideStatus = r.get("status");
        let fare_estimate: Option<rust_decimal::Decimal> = r.get("fare_estimate");
        let vehicle_type: String = r.get("vehicle_type");
        let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");
        let customer_name: Option<String> = r.get("customer_name");
        let customer_phone: Option<String> = r.get("customer_phone");

        let profiles = serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
        return HttpResponse::Ok().json(serde_json::json!({
            "job": {
                "id": id,
                "pickup_address": pickup_address,
                "pickup_lat": pickup_lat,
                "pickup_lng": pickup_lng,
                "drop_address": drop_address,
                "drop_lat": drop_lat,
                "drop_lng": drop_lng,
                "status": status as RideStatus,
                "fare_estimate": fare_estimate,
                "vehicle_type": vehicle_type,
                "created_at": created_at,
                "profiles": profiles,
                "customer": profiles
            },
            "table": "rides"
        }));
    }

    let pkg_row_res = sqlx::query(
        "SELECT p.id, p.pickup_address, p.pickup_lat, p.pickup_lng, p.drop_address, p.drop_lat, p.drop_lng, p.package_size, p.receiver_name, p.receiver_phone, p.status, p.fare_estimate, p.created_at, pc.full_name as customer_name, pc.phone as customer_phone
         FROM rweezy.package_deliveries p
         LEFT JOIN rweezy.profiles pc ON p.customer_id = pc.id
         WHERE p.rider_id = $1 AND p.status NOT IN ('completed'::rweezy.RideStatus, 'cancelled'::rweezy.RideStatus)
         ORDER BY p.created_at DESC LIMIT 1"
    )
    .bind(user_id)
    .fetch_optional(pool.get_ref())
    .await;

    if let Ok(Some(p)) = pkg_row_res {
        use sqlx::Row;
        let id: Uuid = p.get("id");
        let pickup_address: String = p.get("pickup_address");
        let pickup_lat: f64 = p.get("pickup_lat");
        let pickup_lng: f64 = p.get("pickup_lng");
        let drop_address: String = p.get("drop_address");
        let drop_lat: f64 = p.get("drop_lat");
        let drop_lng: f64 = p.get("drop_lng");
        let package_size: String = p.get("package_size");
        let receiver_name: Option<String> = p.get("receiver_name");
        let receiver_phone: Option<String> = p.get("receiver_phone");
        let status: RideStatus = p.get("status");
        let fare_estimate: Option<rust_decimal::Decimal> = p.get("fare_estimate");
        let created_at: chrono::DateTime<chrono::Utc> = p.get("created_at");
        let customer_name: Option<String> = p.get("customer_name");
        let customer_phone: Option<String> = p.get("customer_phone");

        let profiles = serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
        return HttpResponse::Ok().json(serde_json::json!({
            "job": {
                "id": id,
                "pickup_address": pickup_address,
                "pickup_lat": pickup_lat,
                "pickup_lng": pickup_lng,
                "drop_address": drop_address,
                "drop_lat": drop_lat,
                "drop_lng": drop_lng,
                "package_size": package_size,
                "receiver_name": receiver_name,
                "receiver_phone": receiver_phone,
                "status": status as RideStatus,
                "fare_estimate": fare_estimate,
                "created_at": created_at,
                "profiles": profiles,
                "customer": profiles
            },
            "table": "package_deliveries"
        }));
    }

    HttpResponse::Ok().json(serde_json::json!({ "job": null, "table": "rides" }))
}

pub async fn accept_ride_job(
    req: HttpRequest,
    path: web::Path<Uuid>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
    broker: web::Data<SharedBroker>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let id = path.into_inner();

    match sqlx::query(
        "UPDATE rweezy.rides SET rider_id = $1, status = 'accepted'::rweezy.RideStatus, updated_at = now() WHERE id = $2 AND rider_id IS NULL RETURNING id"
    )
    .bind(user_id)
    .bind(id)
    .fetch_optional(pool.get_ref())
    .await
    {
        Ok(Some(_)) => {
            broadcast_job_update(&broker, &id).await;
            HttpResponse::Ok().json(serde_json::json!({ "ride": { "id": id, "rider_id": user_id, "status": "accepted" } }))
        }
        _ => HttpResponse::BadRequest().json(serde_json::json!({ "error": "Ride job already accepted or unavailable" })),
    }
}

pub async fn accept_package_job(
    req: HttpRequest,
    path: web::Path<Uuid>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
    broker: web::Data<SharedBroker>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let id = path.into_inner();

    match sqlx::query(
        "UPDATE rweezy.package_deliveries SET rider_id = $1, status = 'accepted'::rweezy.RideStatus, updated_at = now() WHERE id = $2 AND rider_id IS NULL RETURNING id"
    )
    .bind(user_id)
    .bind(id)
    .fetch_optional(pool.get_ref())
    .await
    {
        Ok(Some(_)) => {
            broadcast_job_update(&broker, &id).await;
            HttpResponse::Ok().json(serde_json::json!({ "packageDelivery": { "id": id, "rider_id": user_id, "status": "accepted" } }))
        }
        _ => HttpResponse::BadRequest().json(serde_json::json!({ "error": "Package job already accepted or unavailable" })),
    }
}

pub async fn advance_rider_job(
    req: HttpRequest,
    path: web::Path<(String, Uuid)>,
    payload: web::Json<serde_json::Value>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
    broker: web::Data<SharedBroker>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let (table, id) = path.into_inner();
    let target_status = match payload.get("status").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({ "error": "status is required" }))
        }
    };

    let current_status_str: String;
    let expected_pin: Option<String>;
    let current_rider: Option<Uuid>;

    if table == "rides" {
        let row_res =
            sqlx::query("SELECT status, delivery_pin, rider_id FROM rweezy.rides WHERE id = $1")
                .bind(id)
                .fetch_optional(pool.get_ref())
                .await;

        match row_res {
            Ok(Some(r)) => {
                use sqlx::Row;
                let status_val: RideStatus = r.try_get("status").unwrap_or(RideStatus::Requested);
                current_status_str = status_val.as_str().to_string();
                expected_pin = r.get("delivery_pin");
                current_rider = r.get("rider_id");
            }
            _ => {
                return HttpResponse::NotFound()
                    .json(serde_json::json!({ "error": "Job not found" }))
            }
        };
    } else if table == "package_deliveries" {
        let row_res = sqlx::query(
            "SELECT status, delivery_pin, rider_id FROM rweezy.package_deliveries WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(pool.get_ref())
        .await;

        match row_res {
            Ok(Some(r)) => {
                use sqlx::Row;
                let status_val: RideStatus = r.try_get("status").unwrap_or(RideStatus::Requested);
                current_status_str = status_val.as_str().to_string();
                expected_pin = r.get("delivery_pin");
                current_rider = r.get("rider_id");
            }
            _ => {
                return HttpResponse::NotFound()
                    .json(serde_json::json!({ "error": "Job not found" }))
            }
        };
    } else {
        return HttpResponse::BadRequest().json(serde_json::json!({ "error": "Invalid job type" }));
    }

    if current_rider != Some(user_id) {
        return HttpResponse::Forbidden()
            .json(serde_json::json!({ "error": "You are not assigned to this job" }));
    }

    if !verify_ride_transition(&current_status_str, target_status) {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "Invalid status transition" }));
    }

    if target_status == "completed" {
        let provided_pin = payload
            .get("delivery_pin")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if let Some(pin) = expected_pin {
            if pin != provided_pin {
                return HttpResponse::BadRequest()
                    .json(serde_json::json!({ "error": "Invalid delivery PIN" }));
            }
        }
    }

    let parsed_status = match target_status {
        "requested" => RideStatus::Requested,
        "accepted" => RideStatus::Accepted,
        "started" => RideStatus::Started,
        "completed" => RideStatus::Completed,
        "cancelled" => RideStatus::Cancelled,
        _ => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({ "error": "Invalid status value" }))
        }
    };

    let payment_update = if target_status == "completed" {
        ", payment_status = 'paid'"
    } else {
        ""
    };
    let query_str = if table == "rides" {
        format!("UPDATE rweezy.rides SET status = $1::rweezy.RideStatus, updated_at = now(){} WHERE id = $2 RETURNING id", payment_update)
    } else {
        format!("UPDATE rweezy.package_deliveries SET status = $1::rweezy.RideStatus, updated_at = now(){} WHERE id = $2 RETURNING id", payment_update)
    };

    match sqlx::query(&query_str)
        .bind(parsed_status as RideStatus)
        .bind(id)
        .fetch_optional(pool.get_ref())
        .await
    {
        Ok(Some(_)) => {
            broadcast_job_update(&broker, &id).await;
            HttpResponse::Ok()
                .json(serde_json::json!({ "job": { "id": id, "status": target_status } }))
        }
        _ => HttpResponse::InternalServerError()
            .json(serde_json::json!({ "error": "Failed to update status" })),
    }
}

pub async fn cancel_rider_job(
    req: HttpRequest,
    path: web::Path<(String, Uuid)>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
    broker: web::Data<SharedBroker>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let (table, id) = path.into_inner();

    let query_str = if table == "rides" {
        "UPDATE rweezy.rides SET status = 'cancelled'::rweezy.RideStatus, updated_at = now() WHERE id = $1 AND rider_id = $2 RETURNING id"
    } else {
        "UPDATE rweezy.package_deliveries SET status = 'cancelled'::rweezy.RideStatus, updated_at = now() WHERE id = $1 AND rider_id = $2 RETURNING id"
    };

    match sqlx::query(query_str)
        .bind(id)
        .bind(user_id)
        .fetch_optional(pool.get_ref())
        .await
    {
        Ok(Some(_)) => {
            broadcast_job_update(&broker, &id).await;
            HttpResponse::Ok()
                .json(serde_json::json!({ "job": { "id": id, "status": "cancelled" } }))
        }
        _ => HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "Job cannot be cancelled" })),
    }
}

pub async fn get_rider_history(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let rides_rows_res = sqlx::query(
        "SELECT r.id, r.pickup_address, r.drop_address, r.status, r.fare_estimate, r.created_at, pc.full_name as customer_name, pc.phone as customer_phone
         FROM rweezy.rides r
         LEFT JOIN rweezy.profiles pc ON r.customer_id = pc.id
         WHERE r.rider_id = $1 AND r.status IN ('completed'::rweezy.RideStatus, 'cancelled'::rweezy.RideStatus)
         ORDER BY r.created_at DESC LIMIT 100"
    )
    .bind(user_id)
    .fetch_all(pool.get_ref())
    .await;

    let mapped_rides: Vec<serde_json::Value> = match rides_rows_res {
        Ok(rows) => rows
            .iter()
            .map(|r| {
                use sqlx::Row;
                let id: Uuid = r.get("id");
                let pickup_address: String = r.get("pickup_address");
                let drop_address: String = r.get("drop_address");
                let status: RideStatus = r.try_get("status").unwrap_or(RideStatus::Requested);
                let fare_estimate: Option<rust_decimal::Decimal> = r.get("fare_estimate");
                let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");
                let customer_name: Option<String> = r.get("customer_name");
                let customer_phone: Option<String> = r.get("customer_phone");

                let profiles =
                    serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
                serde_json::json!({
                    "id": id,
                    "pickup_address": pickup_address,
                    "drop_address": drop_address,
                    "status": status as RideStatus,
                    "fare_estimate": fare_estimate,
                    "created_at": created_at,
                    "profiles": profiles,
                    "customer": profiles
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    let packages_rows_res = sqlx::query(
        "SELECT p.id, p.pickup_address, p.drop_address, p.status, p.fare_estimate, p.created_at, pc.full_name as customer_name, pc.phone as customer_phone
         FROM rweezy.package_deliveries p
         LEFT JOIN rweezy.profiles pc ON p.customer_id = p.id
         WHERE p.rider_id = $1 AND p.status IN ('completed'::rweezy.RideStatus, 'cancelled'::rweezy.RideStatus)
         ORDER BY p.created_at DESC LIMIT 100"
    )
    .bind(user_id)
    .fetch_all(pool.get_ref())
    .await;

    let mapped_packages: Vec<serde_json::Value> = match packages_rows_res {
        Ok(rows) => rows
            .iter()
            .map(|p| {
                use sqlx::Row;
                let id: Uuid = p.get("id");
                let pickup_address: String = p.get("pickup_address");
                let drop_address: String = p.get("drop_address");
                let status: RideStatus = p.try_get("status").unwrap_or(RideStatus::Requested);
                let fare_estimate: Option<rust_decimal::Decimal> = p.get("fare_estimate");
                let created_at: chrono::DateTime<chrono::Utc> = p.get("created_at");
                let customer_name: Option<String> = p.get("customer_name");
                let customer_phone: Option<String> = p.get("customer_phone");

                let profiles =
                    serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
                serde_json::json!({
                    "id": id,
                    "pickup_address": pickup_address,
                    "drop_address": drop_address,
                    "status": status as RideStatus,
                    "fare_estimate": fare_estimate,
                    "created_at": created_at,
                    "profiles": profiles,
                    "customer": profiles
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "rides": mapped_rides,
        "packages": mapped_packages
    }))
}

pub async fn get_rider_earnings(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let today_start = Utc::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(Utc)
        .unwrap();
    let month_start = Utc::now()
        .date_naive()
        .with_day(1)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(Utc)
        .unwrap();

    let rides_res = sqlx::query(
        "SELECT fare_estimate, created_at FROM rweezy.rides WHERE rider_id = $1 AND status = 'completed'::rweezy.RideStatus"
    )
    .bind(user_id)
    .fetch_all(pool.get_ref())
    .await;

    let rides_all = match rides_res {
        Ok(rows) => rows,
        _ => Vec::new(),
    };

    let packages_res = sqlx::query(
        "SELECT fare_estimate, created_at FROM rweezy.package_deliveries WHERE rider_id = $1 AND status = 'completed'::rweezy.RideStatus"
    )
    .bind(user_id)
    .fetch_all(pool.get_ref())
    .await;

    let packages_all = match packages_res {
        Ok(rows) => rows,
        _ => Vec::new(),
    };

    let mut total_today = rust_decimal::Decimal::from(0);
    let mut total_month = rust_decimal::Decimal::from(0);
    let total_count = rides_all.len() + packages_all.len();

    for r in rides_all {
        use sqlx::Row;
        let fare_estimate: Option<rust_decimal::Decimal> = r.get("fare_estimate");
        let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");
        if let Some(fare) = fare_estimate {
            if created_at >= today_start {
                total_today += fare;
            }
            if created_at >= month_start {
                total_month += fare;
            }
        }
    }

    for p in packages_all {
        use sqlx::Row;
        let fare_estimate: Option<rust_decimal::Decimal> = p.get("fare_estimate");
        let created_at: chrono::DateTime<chrono::Utc> = p.get("created_at");
        if let Some(fare) = fare_estimate {
            if created_at >= today_start {
                total_today += fare;
            }
            if created_at >= month_start {
                total_month += fare;
            }
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "todayEarnings": total_today,
        "monthEarnings": total_month,
        "totalJobs": total_count
    }))
}
