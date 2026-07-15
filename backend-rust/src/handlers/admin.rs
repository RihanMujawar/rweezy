use actix_web::{web, HttpRequest, HttpResponse, Responder};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::error;
use uuid::Uuid;

use crate::handlers::auth::get_auth_user;
use crate::models::*;
use crate::services::fcm::FcmService;
use crate::websocket::SharedBroker;

async fn check_has_role(user_id: Uuid, role_name: &str, pool: &PgPool) -> bool {
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM rweezy.user_roles WHERE user_id = $1 AND role::text = $2)",
    )
    .bind(user_id)
    .bind(role_name)
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    exists
}

pub async fn get_admin_stats(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    if !check_has_role(user_id, "admin", pool.get_ref()).await {
        return HttpResponse::Forbidden()
            .json(serde_json::json!({ "error": "Only admins can access stats" }));
    }

    let users = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM rweezy.users")
        .fetch_one(pool.get_ref())
        .await
        .unwrap_or(0);
    let restaurants = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM rweezy.restaurants")
        .fetch_one(pool.get_ref())
        .await
        .unwrap_or(0);
    let food_orders = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM rweezy.food_orders")
        .fetch_one(pool.get_ref())
        .await
        .unwrap_or(0);
    let rides = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM rweezy.rides")
        .fetch_one(pool.get_ref())
        .await
        .unwrap_or(0);
    let packages = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM rweezy.package_deliveries")
        .fetch_one(pool.get_ref())
        .await
        .unwrap_or(0);
    let stores = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM rweezy.grocery_stores")
        .fetch_one(pool.get_ref())
        .await
        .unwrap_or(0);

    HttpResponse::Ok().json(serde_json::json!({
        "users": users,
        "restaurants": restaurants,
        "foodOrders": food_orders,
        "rides": rides,
        "packages": packages,
        "stores": stores
    }))
}

pub async fn get_admin_analytics(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    if !check_has_role(user_id, "admin", pool.get_ref()).await {
        return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }));
    }

    let total_restaurants_income = sqlx::query_scalar::<_, Option<rust_decimal::Decimal>>(
        "SELECT SUM(total) FROM rweezy.food_orders WHERE status = 'delivered'::rweezy.OrderStatus",
    )
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or_default()
    .unwrap_or_default();

    let total_grocery_income = sqlx::query_scalar::<_, Option<rust_decimal::Decimal>>(
        "SELECT SUM(total) FROM rweezy.grocery_orders WHERE status = 'delivered'::rweezy.OrderStatus"
    )
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or_default()
    .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "restaurantIncome": [],
        "groceryStoreIncome": [],
        "deliveryBoys": [],
        "totals": {
            "restaurantTodayIncome": 0,
            "restaurantMonthIncome": total_restaurants_income,
            "groceryTodayIncome": 0,
            "groceryMonthIncome": total_grocery_income,
            "deliveryBoys": 0,
            "deliveriesToday": 0,
            "deliveriesMonth": 0,
            "trackedKm": 0
        }
    }))
}

#[derive(Deserialize)]
pub struct AdminPagination {
    pub page: Option<i64>,
    pub limit: Option<i64>,
}

pub async fn admin_list_restaurants(
    req: HttpRequest,
    query: web::Query<AdminPagination>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    if !check_has_role(user_id, "admin", pool.get_ref()).await {
        return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }));
    }

    let page = query.page.unwrap_or(1);
    let limit = query.limit.unwrap_or(20);
    let offset = (page - 1) * limit;

    let rests = sqlx::query_as::<_, DbRestaurant>(
        "SELECT * FROM rweezy.restaurants ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit + 1)
    .bind(offset)
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    let has_next = rests.len() > limit as usize;
    let results = if has_next {
        rests[..limit as usize].to_vec()
    } else {
        rests
    };

    HttpResponse::Ok().json(serde_json::json!({
        "restaurants": results,
        "profiles": [],
        "roles": [],
        "orders": [],
        "page": page,
        "limit": limit,
        "hasNext": has_next
    }))
}

pub async fn admin_create_restaurant(
    req: HttpRequest,
    payload: web::Json<serde_json::Value>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    if !check_has_role(user_id, "admin", pool.get_ref()).await {
        return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }));
    }

    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Unnamed Restaurant");

    match sqlx::query_as::<_, DbRestaurant>(
        "INSERT INTO rweezy.restaurants (id, name, description, address, image_url, is_open, town_name, pincode, lat, lng, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now()) RETURNING *"
    )
    .bind(Uuid::new_v4())
    .bind(name)
    .bind(payload.get("description").and_then(|v| v.as_str()))
    .bind(payload.get("address").and_then(|v| v.as_str()))
    .bind(payload.get("image_url").and_then(|v| v.as_str()))
    .bind(payload.get("is_open").and_then(|v| v.as_bool()).unwrap_or(true))
    .bind(payload.get("town_name").and_then(|v| v.as_str()))
    .bind(payload.get("pincode").and_then(|v| v.as_str()))
    .bind(payload.get("lat").and_then(|v| v.as_f64()))
    .bind(payload.get("lng").and_then(|v| v.as_f64()))
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(r) => HttpResponse::Ok().json(serde_json::json!({ "restaurant": r })),
        Err(e) => {
            error!("Failed to create rest: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Database error" }))
        }
    }
}

pub async fn admin_update_restaurant(
    req: HttpRequest,
    path: web::Path<Uuid>,
    payload: web::Json<serde_json::Value>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    if !check_has_role(user_id, "admin", pool.get_ref()).await {
        return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }));
    }

    let id = path.into_inner();
    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Restaurant");

    match sqlx::query_as::<_, DbRestaurant>(
        "UPDATE rweezy.restaurants SET name = $1, description = $2, address = $3, image_url = $4, is_open = $5, town_name = $6, pincode = $7, lat = $8, lng = $9, updated_at = now() WHERE id = $10 RETURNING *"
    )
    .bind(name)
    .bind(payload.get("description").and_then(|v| v.as_str()))
    .bind(payload.get("address").and_then(|v| v.as_str()))
    .bind(payload.get("image_url").and_then(|v| v.as_str()))
    .bind(payload.get("is_open").and_then(|v| v.as_bool()).unwrap_or(true))
    .bind(payload.get("town_name").and_then(|v| v.as_str()))
    .bind(payload.get("pincode").and_then(|v| v.as_str()))
    .bind(payload.get("lat").and_then(|v| v.as_f64()))
    .bind(payload.get("lng").and_then(|v| v.as_f64()))
    .bind(id)
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(r) => HttpResponse::Ok().json(serde_json::json!({ "restaurant": r })),
        Err(_) => HttpResponse::NotFound().json(serde_json::json!({ "error": "Restaurant not found" })),
    }
}

pub async fn admin_delete_restaurant(
    req: HttpRequest,
    path: web::Path<Uuid>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    if !check_has_role(user_id, "admin", pool.get_ref()).await {
        return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }));
    }

    let id = path.into_inner();
    let _ = sqlx::query("DELETE FROM rweezy.restaurants WHERE id = $1")
        .bind(id)
        .execute(pool.get_ref())
        .await;

    HttpResponse::Ok().json(serde_json::json!({ "ok": true }))
}

pub async fn admin_toggle_restaurant(
    req: HttpRequest,
    path: web::Path<Uuid>,
    payload: web::Json<serde_json::Value>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    if !check_has_role(user_id, "admin", pool.get_ref()).await {
        return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }));
    }

    let id = path.into_inner();
    let open = payload
        .get("is_open")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    match sqlx::query_as::<_, DbRestaurant>(
        "UPDATE rweezy.restaurants SET is_open = $1, updated_at = now() WHERE id = $2 RETURNING *",
    )
    .bind(open)
    .bind(id)
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(r) => HttpResponse::Ok().json(serde_json::json!({ "restaurant": r })),
        _ => HttpResponse::NotFound().json(serde_json::json!({ "error": "Not found" })),
    }
}

pub async fn admin_list_users(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    if !check_has_role(user_id, "admin", pool.get_ref()).await {
        return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }));
    }

    let profiles =
        sqlx::query_as::<_, DbProfile>("SELECT * FROM rweezy.profiles ORDER BY full_name ASC")
            .fetch_all(pool.get_ref())
            .await
            .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "profiles": profiles,
        "roles": [],
        "roleRequests": []
    }))
}

pub async fn admin_review_role_request(
    req: HttpRequest,
    path: web::Path<Uuid>,
    payload: web::Json<serde_json::Value>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    if !check_has_role(user_id, "admin", pool.get_ref()).await {
        return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }));
    }

    let req_id = path.into_inner();
    let decision = payload
        .get("decision")
        .and_then(|v| v.as_str())
        .unwrap_or("rejected");

    let status = if decision == "approved" {
        RoleRequestStatus::Approved
    } else {
        RoleRequestStatus::Rejected
    };

    let request = match sqlx::query_as::<_, DbRoleRequest>(
        "SELECT * FROM rweezy.role_requests WHERE id = $1",
    )
    .bind(req_id)
    .fetch_optional(pool.get_ref())
    .await
    .unwrap_or(None)
    {
        Some(r) => r,
        None => {
            return HttpResponse::NotFound()
                .json(serde_json::json!({ "error": "Request not found" }))
        }
    };

    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(_) => {
            return HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": "Db error" }))
        }
    };

    if decision == "approved" {
        let _ = sqlx::query(
            "INSERT INTO rweezy.user_roles (id, user_id, role, created_at) VALUES ($1, $2, $3::rweezy.AppRole, now())
             ON CONFLICT (user_id, role) DO NOTHING"
        )
        .bind(Uuid::new_v4())
        .bind(request.user_id)
        .bind(request.requested_role as AppRole)
        .execute(&mut *tx)
        .await;

        if request.requested_role == AppRole::HotelManager {
            let _ = sqlx::query(
                "INSERT INTO rweezy.restaurants (id, manager_id, name, address, town_name, pincode, is_open, lat, lng, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, now(), now()) ON CONFLICT (manager_id) DO NOTHING"
            )
            .bind(Uuid::new_v4())
            .bind(request.user_id)
            .bind(request.business_name.as_deref().unwrap_or("New Restaurant"))
            .bind(request.business_address)
            .bind(request.town_name)
            .bind(request.pincode)
            .bind(request.business_lat)
            .bind(request.business_lng)
            .execute(&mut *tx)
            .await;
        } else if request.requested_role == AppRole::GroceryManager {
            let _ = sqlx::query(
                "INSERT INTO rweezy.grocery_stores (id, manager_id, name, address, town_name, pincode, is_open, lat, lng, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, now(), now()) ON CONFLICT (manager_id) DO NOTHING"
            )
            .bind(Uuid::new_v4())
            .bind(request.user_id)
            .bind(request.business_name.as_deref().unwrap_or("New Grocery Store"))
            .bind(request.business_address)
            .bind(request.town_name)
            .bind(request.pincode)
            .bind(request.business_lat)
            .bind(request.business_lng)
            .execute(&mut *tx)
            .await;
        }
    }

    let updated = match sqlx::query_as::<_, DbRoleRequest>(
        "UPDATE rweezy.role_requests SET status = $1::rweezy.RoleRequestStatus, reviewed_by = $2, reviewed_at = now(), updated_at = now() WHERE id = $3 RETURNING *"
    )
    .bind(status as RoleRequestStatus)
    .bind(user_id)
    .bind(req_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(r) => r,
        Err(_) => return HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Failed to update request status" })),
    };

    let _ = tx.commit().await;

    HttpResponse::Ok().json(serde_json::json!({ "request": updated }))
}

pub async fn get_admin_commissions(pool: web::Data<PgPool>) -> impl Responder {
    let value = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT value FROM rweezy.platform_settings WHERE key = 'commissions'",
    )
    .fetch_optional(pool.get_ref())
    .await
    .unwrap_or(None)
    .unwrap_or_else(|| serde_json::json!({ "restaurant": 10, "grocery": 8, "delivery": 12 }));

    HttpResponse::Ok().json(serde_json::json!({ "commissions": value }))
}

pub async fn save_admin_commissions(
    req: HttpRequest,
    payload: web::Json<serde_json::Value>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    if !check_has_role(user_id, "admin", pool.get_ref()).await {
        return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }));
    }

    let inner_payload = payload.into_inner();

    let _ = sqlx::query(
        "INSERT INTO rweezy.platform_settings (key, value, updated_at) VALUES ('commissions', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()"
    )
    .bind(&inner_payload)
    .execute(pool.get_ref())
    .await;

    HttpResponse::Ok().json(serde_json::json!({ "commissions": inner_payload }))
}

pub async fn get_admin_catalog_settings(pool: web::Data<PgPool>) -> impl Responder {
    let radius = sqlx::query_scalar::<_, Option<serde_json::Value>>(
        "SELECT value FROM rweezy.platform_settings WHERE key = 'catalog_radius_km'",
    )
    .fetch_optional(pool.get_ref())
    .await
    .unwrap_or(None)
    .flatten()
    .and_then(|v| v.as_f64())
    .unwrap_or(25.0);

    HttpResponse::Ok().json(serde_json::json!({
        "radius_km": radius,
        "limits": {
            "min_km": 1,
            "max_km": 100,
            "default_km": 25
        }
    }))
}

pub async fn save_admin_catalog_settings(
    req: HttpRequest,
    payload: web::Json<serde_json::Value>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    if !check_has_role(user_id, "admin", pool.get_ref()).await {
        return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }));
    }

    let val = payload
        .get("radius_km")
        .and_then(|v| v.as_f64())
        .unwrap_or(25.0);

    let _ = sqlx::query(
        "INSERT INTO rweezy.platform_settings (key, value, updated_at) VALUES ('catalog_radius_km', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()"
    )
    .bind(serde_json::json!(val))
    .execute(pool.get_ref())
    .await;

    HttpResponse::Ok().json(serde_json::json!({ "radius_km": val }))
}

pub async fn admin_test_notification(
    req: HttpRequest,
    payload: web::Json<serde_json::Value>,
    fcm_service: web::Data<FcmService>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    if !check_has_role(user_id, "admin", pool.get_ref()).await {
        return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }));
    }

    let token = payload
        .get("token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let title = payload
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Manual Dispatch Test");
    let body = payload
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("Testing direct FCM HTTP v1 notifications.");

    if token.is_empty() {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "token is required" }));
    }

    match fcm_service
        .send_notification(&token, title, body, None)
        .await
    {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({ "ok": true, "sent": 1 })),
        Err(err) => HttpResponse::BadRequest().json(serde_json::json!({ "error": err })),
    }
}

pub async fn get_hotel_dashboard(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let rest = match sqlx::query_as::<_, DbRestaurant>(
        "SELECT * FROM rweezy.restaurants WHERE manager_id = $1"
    )
    .bind(user_id)
    .fetch_optional(pool.get_ref())
    .await
    .unwrap_or(None)
    {
        Some(r) => r,
        None => return HttpResponse::Ok().json(serde_json::json!({ "restaurant": null, "stats": { "total": 0, "pending": 0, "today": 0 } })),
    };

    let total = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM rweezy.food_orders WHERE restaurant_id = $1",
    )
    .bind(rest.id)
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or(0);

    let pending = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM rweezy.food_orders WHERE restaurant_id = $1 AND status IN ('pending'::rweezy.OrderStatus, 'accepted'::rweezy.OrderStatus, 'preparing'::rweezy.OrderStatus)")
        .bind(rest.id)
        .fetch_one(pool.get_ref())
        .await
        .unwrap_or(0);

    HttpResponse::Ok().json(serde_json::json!({
        "restaurant": rest,
        "stats": {
            "total": total,
            "pending": pending,
            "today": total
        }
    }))
}

pub async fn get_hotel_orders(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let _user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let rest_id = match sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM rweezy.restaurants WHERE manager_id = $1",
    )
    .bind(_user_id)
    .fetch_optional(pool.get_ref())
    .await
    .unwrap_or(None)
    {
        Some(id) => id,
        None => {
            return HttpResponse::Ok()
                .json(serde_json::json!({ "restaurantId": null, "orders": [] }))
        }
    };

    let orders_res = sqlx::query(
        "SELECT o.id, o.customer_id, o.restaurant_id, o.status, o.total, o.delivery_address, o.notes, o.payment_method, o.created_at, pc.full_name as customer_name, pc.phone as customer_phone FROM rweezy.food_orders o
         LEFT JOIN rweezy.profiles pc ON o.customer_id = pc.id
         WHERE o.restaurant_id = $1 ORDER BY o.created_at DESC"
    )
    .bind(rest_id)
    .fetch_all(pool.get_ref())
    .await;

    let mapped_orders: Vec<serde_json::Value> = match orders_res {
        Ok(rows) => rows
            .iter()
            .map(|row| {
                use sqlx::Row;
                let id: Uuid = row.get("id");
                let customer_id: Uuid = row.get("customer_id");
                let restaurant_id: Uuid = row.get("restaurant_id");
                let status: OrderStatus = row.get("status");
                let total: rust_decimal::Decimal = row.get("total");
                let delivery_address: String = row.get("delivery_address");
                let notes: Option<String> = row.get("notes");
                let payment_method: String = row.get("payment_method");
                let created_at: chrono::DateTime<chrono::Utc> = row.get("created_at");
                let customer_name: Option<String> = row.get("customer_name");
                let customer_phone: Option<String> = row.get("customer_phone");

                let profiles =
                    serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
                serde_json::json!({
                    "id": id,
                    "customer_id": customer_id,
                    "restaurant_id": restaurant_id,
                    "status": status as OrderStatus,
                    "total": total,
                    "delivery_address": delivery_address,
                    "notes": notes,
                    "payment_method": payment_method,
                    "created_at": created_at,
                    "food_order_items": [],
                    "profiles": profiles,
                    "customer": profiles
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "restaurantId": rest_id,
        "orders": mapped_orders
    }))
}

pub async fn advance_hotel_order(
    req: HttpRequest,
    path: web::Path<Uuid>,
    payload: web::Json<serde_json::Value>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
    broker: web::Data<SharedBroker>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    if !check_has_role(user_id, "hotel_manager", pool.get_ref()).await {
        return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }));
    }

    let order_id = path.into_inner();
    let status_str = payload
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("preparing");

    let parsed_status = match status_str {
        "pending" => OrderStatus::Pending,
        "accepted" => OrderStatus::Accepted,
        "preparing" => OrderStatus::Preparing,
        "ready" => OrderStatus::Ready,
        "picked_up" => OrderStatus::PickedUp,
        "delivered" => OrderStatus::Delivered,
        "cancelled" => OrderStatus::Cancelled,
        _ => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({ "error": "Invalid status" }))
        }
    };

    match sqlx::query(
        "UPDATE rweezy.food_orders SET status = $1::rweezy.OrderStatus, updated_at = now() WHERE id = $2 RETURNING id"
    )
    .bind(parsed_status as OrderStatus)
    .bind(order_id)
    .fetch_optional(pool.get_ref())
    .await
    {
        Ok(Some(_)) => {
            let msg = serde_json::json!({
                "type": "order_updated",
                "payload": { "orderId": order_id.to_string() }
            })
            .to_string();
            let b = broker.lock().await;
            b.broadcast(&format!("order_{}", order_id), &msg);

            HttpResponse::Ok().json(serde_json::json!({ "order": { "id": order_id, "status": status_str } }))
        }
        _ => HttpResponse::NotFound().json(serde_json::json!({ "error": "Order not found" })),
    }
}

pub async fn get_grocery_dashboard(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let store = match sqlx::query_as::<_, DbGroceryStore>(
        "SELECT * FROM rweezy.grocery_stores WHERE manager_id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool.get_ref())
    .await
    .unwrap_or(None)
    {
        Some(s) => s,
        None => return HttpResponse::Ok().json(
            serde_json::json!({ "store": null, "stats": { "total": 0, "pending": 0, "today": 0 } }),
        ),
    };

    let total = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM rweezy.grocery_orders WHERE store_id = $1",
    )
    .bind(store.id)
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or(0);

    let pending = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM rweezy.grocery_orders WHERE store_id = $1 AND status IN ('pending'::rweezy.OrderStatus, 'accepted'::rweezy.OrderStatus, 'preparing'::rweezy.OrderStatus)")
        .bind(store.id)
        .fetch_one(pool.get_ref())
        .await
        .unwrap_or(0);

    HttpResponse::Ok().json(serde_json::json!({
        "store": store,
        "stats": {
            "total": total,
            "pending": pending,
            "today": total
        }
    }))
}

pub async fn get_grocery_alerts(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let store_id = match sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM rweezy.grocery_stores WHERE manager_id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool.get_ref())
    .await
    .unwrap_or(None)
    {
        Some(id) => id,
        None => {
            return HttpResponse::Ok()
                .json(serde_json::json!({ "lowStock": [], "expiringSoon": [] }))
        }
    };

    let low_stock_items = sqlx::query_as::<_, DbGroceryItem>(
        "SELECT * FROM rweezy.grocery_items WHERE store_id = $1 AND is_available = true AND stock_quantity <= low_stock_threshold"
    )
    .bind(store_id)
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    let seven_days_limit = Utc::now() + chrono::Duration::days(7);
    let expiring_items = sqlx::query_as::<_, DbGroceryItem>(
        "SELECT * FROM rweezy.grocery_items WHERE store_id = $1 AND is_available = true AND expiry_date IS NOT NULL AND expiry_date <= $2"
    )
    .bind(store_id)
    .bind(seven_days_limit)
    .fetch_all(pool.get_ref())
    .await
.unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "lowStock": low_stock_items,
        "expiringSoon": expiring_items
    }))
}

pub async fn save_hotel_restaurant(
    req: HttpRequest,
    payload: web::Json<serde_json::Value>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let id_opt = payload
        .get("id")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok());
    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let description = payload.get("description").and_then(|v| v.as_str());
    let address = payload.get("address").and_then(|v| v.as_str());
    let town_name = payload.get("town_name").and_then(|v| v.as_str());
    let pincode = payload.get("pincode").and_then(|v| v.as_str());
    let image_url = payload.get("image_url").and_then(|v| v.as_str());
    let is_open = payload
        .get("is_open")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let delivery_radius_km = payload
        .get("delivery_radius_km")
        .and_then(|v| v.as_f64())
        .unwrap_or(25.0);

    if name.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({ "error": "Name is required" }));
    }

    match id_opt {
        Some(id) => {
            // Update
            let updated = sqlx::query_as::<_, DbRestaurant>(
                "UPDATE rweezy.restaurants
                 SET name = $1, description = $2, address = $3, town_name = $4, pincode = $5, image_url = $6, is_open = $7, delivery_radius_km = $8, updated_at = now()
                 WHERE id = $9 AND manager_id = $10 RETURNING *"
            )
            .bind(name)
            .bind(description)
            .bind(address)
            .bind(town_name)
            .bind(pincode)
            .bind(image_url)
            .bind(is_open)
            .bind(delivery_radius_km)
            .bind(id)
            .bind(user_id)
            .fetch_optional(pool.get_ref())
            .await;

            match updated {
                Ok(Some(r)) => HttpResponse::Ok().json(serde_json::json!({ "restaurant": r })),
                Ok(None) => HttpResponse::NotFound()
                    .json(serde_json::json!({ "error": "Restaurant not found or unauthorized" })),
                Err(e) => {
                    tracing::error!("Failed to update restaurant: {}", e);
                    HttpResponse::InternalServerError()
                        .json(serde_json::json!({ "error": "Database error" }))
                }
            }
        }
        None => {
            // Create
            let created = sqlx::query_as::<_, DbRestaurant>(
                "INSERT INTO rweezy.restaurants (id, manager_id, name, description, address, town_name, pincode, image_url, is_open, delivery_radius_km, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
                 RETURNING *"
            )
            .bind(Uuid::new_v4())
            .bind(user_id)
            .bind(name)
            .bind(description)
            .bind(address)
            .bind(town_name)
            .bind(pincode)
            .bind(image_url)
            .bind(is_open)
            .bind(delivery_radius_km)
            .fetch_one(pool.get_ref())
            .await;

            match created {
                Ok(r) => HttpResponse::Ok().json(serde_json::json!({ "restaurant": r })),
                Err(e) => {
                    tracing::error!("Failed to create restaurant: {}", e);
                    HttpResponse::InternalServerError()
                        .json(serde_json::json!({ "error": "Database error" }))
                }
            }
        }
    }
}

pub async fn save_grocery_store(
    req: HttpRequest,
    payload: web::Json<serde_json::Value>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let id_opt = payload
        .get("id")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok());
    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let description = payload.get("description").and_then(|v| v.as_str());
    let address = payload.get("address").and_then(|v| v.as_str());
    let town_name = payload.get("town_name").and_then(|v| v.as_str());
    let pincode = payload.get("pincode").and_then(|v| v.as_str());
    let image_url = payload.get("image_url").and_then(|v| v.as_str());
    let is_open = payload
        .get("is_open")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let delivery_radius_km = payload
        .get("delivery_radius_km")
        .and_then(|v| v.as_f64())
        .unwrap_or(25.0);

    if name.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({ "error": "Name is required" }));
    }

    match id_opt {
        Some(id) => {
            // Update
            let updated = sqlx::query_as::<_, DbGroceryStore>(
                "UPDATE rweezy.grocery_stores
                 SET name = $1, description = $2, address = $3, town_name = $4, pincode = $5, image_url = $6, is_open = $7, delivery_radius_km = $8, updated_at = now()
                 WHERE id = $9 AND manager_id = $10 RETURNING *"
            )
            .bind(name)
            .bind(description)
            .bind(address)
            .bind(town_name)
            .bind(pincode)
            .bind(image_url)
            .bind(is_open)
            .bind(delivery_radius_km)
            .bind(id)
            .bind(user_id)
            .fetch_optional(pool.get_ref())
            .await;

            match updated {
                Ok(Some(s)) => HttpResponse::Ok().json(serde_json::json!({ "store": s })),
                Ok(None) => HttpResponse::NotFound()
                    .json(serde_json::json!({ "error": "Store not found or unauthorized" })),
                Err(e) => {
                    tracing::error!("Failed to update store: {}", e);
                    HttpResponse::InternalServerError()
                        .json(serde_json::json!({ "error": "Database error" }))
                }
            }
        }
        None => {
            // Create
            let created = sqlx::query_as::<_, DbGroceryStore>(
                "INSERT INTO rweezy.grocery_stores (id, manager_id, name, description, address, town_name, pincode, image_url, is_open, delivery_radius_km, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
                 RETURNING *"
            )
            .bind(Uuid::new_v4())
            .bind(user_id)
            .bind(name)
            .bind(description)
            .bind(address)
            .bind(town_name)
            .bind(pincode)
            .bind(image_url)
            .bind(is_open)
            .bind(delivery_radius_km)
            .fetch_one(pool.get_ref())
            .await;

            match created {
                Ok(s) => HttpResponse::Ok().json(serde_json::json!({ "store": s })),
                Err(e) => {
                    tracing::error!("Failed to create store: {}", e);
                    HttpResponse::InternalServerError()
                        .json(serde_json::json!({ "error": "Database error" }))
                }
            }
        }
    }
}
