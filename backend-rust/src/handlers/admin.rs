use actix_web::{web, HttpRequest, HttpResponse, Responder};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::error;
use uuid::Uuid;

use crate::handlers::auth::get_auth_user;
use crate::models::*;
use crate::services::fcm::FcmService;
use crate::services::order_notifications;
use crate::services::whatsapp::WhatsAppService;
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
    pub search: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
struct AdminUserRole {
    user_id: Uuid,
    role: AppRole,
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

pub async fn admin_list_stores(
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

    let stores = sqlx::query_as::<_, DbGroceryStore>(
        "SELECT * FROM rweezy.grocery_stores ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit + 1)
    .bind(offset)
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    let has_next = stores.len() > limit as usize;
    let results = if has_next {
        stores[..limit as usize].to_vec()
    } else {
        stores
    };

    HttpResponse::Ok().json(serde_json::json!({
        "stores": results,
        "page": page,
        "limit": limit,
        "hasNext": has_next
    }))
}

pub async fn admin_create_store(
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
        .unwrap_or("Unnamed Grocery Store");

    match sqlx::query_as::<_, DbGroceryStore>(
        "INSERT INTO rweezy.grocery_stores (id, name, description, address, image_url, is_open, town_name, pincode, lat, lng, created_at, updated_at)
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
        Ok(s) => HttpResponse::Ok().json(serde_json::json!({ "store": s })),
        Err(e) => {
            error!("Failed to create store: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Database error" }))
        }
    }
}

pub async fn admin_update_store(
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
        .unwrap_or("Store");

    match sqlx::query_as::<_, DbGroceryStore>(
        "UPDATE rweezy.grocery_stores SET name = $1, description = $2, address = $3, image_url = $4, is_open = $5, town_name = $6, pincode = $7, lat = $8, lng = $9, updated_at = now() WHERE id = $10 RETURNING *"
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
        Ok(s) => HttpResponse::Ok().json(serde_json::json!({ "store": s })),
        Err(_) => HttpResponse::NotFound().json(serde_json::json!({ "error": "Store not found" })),
    }
}

pub async fn admin_delete_store(
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
    let _ = sqlx::query("DELETE FROM rweezy.grocery_stores WHERE id = $1")
        .bind(id)
        .execute(pool.get_ref())
        .await;

    HttpResponse::Ok().json(serde_json::json!({ "ok": true }))
}

pub async fn admin_grant_restaurant_manager(
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

    let rest_id = path.into_inner();
    let manager_uuid_str = payload
        .get("user_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let manager_id = match Uuid::parse_str(manager_uuid_str) {
        Ok(uid) => uid,
        Err(_) => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({ "error": "Invalid user_id" }))
        }
    };

    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(_) => {
            return HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": "Db error" }))
        }
    };

    let _ = sqlx::query(
        "INSERT INTO rweezy.user_roles (id, user_id, role, created_at) VALUES ($1, $2, 'hotel_manager'::rweezy.AppRole, now())
         ON CONFLICT (user_id, role) DO NOTHING"
    )
    .bind(Uuid::new_v4())
    .bind(manager_id)
    .execute(&mut *tx)
    .await;

    let updated = sqlx::query_as::<_, DbRestaurant>(
        "UPDATE rweezy.restaurants SET manager_id = $1, updated_at = now() WHERE id = $2 RETURNING *"
    )
    .bind(manager_id)
    .bind(rest_id)
    .fetch_one(&mut *tx)
    .await;

    if updated.is_err() {
        let _ = tx.rollback().await;
        return HttpResponse::NotFound()
            .json(serde_json::json!({ "error": "Restaurant not found" }));
    }

    let _ = tx.commit().await;

    HttpResponse::Ok().json(serde_json::json!({ "restaurant": updated.unwrap() }))
}

pub async fn admin_revoke_restaurant_manager(
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

    let rest_id = path.into_inner();

    let updated = sqlx::query_as::<_, DbRestaurant>(
        "UPDATE rweezy.restaurants SET manager_id = NULL, updated_at = now() WHERE id = $1 RETURNING *"
    )
    .bind(rest_id)
    .fetch_one(pool.get_ref())
    .await;

    match updated {
        Ok(r) => HttpResponse::Ok().json(serde_json::json!({ "restaurant": r })),
        _ => HttpResponse::NotFound().json(serde_json::json!({ "error": "Restaurant not found" })),
    }
}

pub async fn admin_toggle_user_role(
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

    let target_user_id = path.into_inner();
    let role_str = payload.get("role").and_then(|v| v.as_str()).unwrap_or("");
    let has_role = payload
        .get("has_role")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let parsed_role = match role_str {
        "customer" => AppRole::Customer,
        "admin" => AppRole::Admin,
        "hotel_manager" => AppRole::HotelManager,
        "grocery_manager" => AppRole::GroceryManager,
        "delivery_boy" => AppRole::DeliveryBoy,
        "rider" => AppRole::Rider,
        "all_in_one_partner" => AppRole::AllInOnePartner,
        _ => {
            return HttpResponse::BadRequest().json(serde_json::json!({ "error": "Invalid role" }))
        }
    };

    if has_role {
        let _ = sqlx::query(
            "INSERT INTO rweezy.user_roles (id, user_id, role, created_at) VALUES ($1, $2, $3::rweezy.AppRole, now())
             ON CONFLICT (user_id, role) DO NOTHING"
        )
        .bind(Uuid::new_v4())
        .bind(target_user_id)
        .bind(parsed_role as AppRole)
        .execute(pool.get_ref())
        .await;
    } else {
        let _ = sqlx::query(
            "DELETE FROM rweezy.user_roles WHERE user_id = $1 AND role = $2::rweezy.AppRole",
        )
        .bind(target_user_id)
        .bind(parsed_role as AppRole)
        .execute(pool.get_ref())
        .await;
    }

    HttpResponse::Ok().json(serde_json::json!({ "ok": true }))
}

pub async fn get_grocery_items(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let store_id_opt =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM rweezy.grocery_stores WHERE manager_id = $1")
            .bind(user_id)
            .fetch_optional(pool.get_ref())
            .await
            .unwrap_or(None);

    let store_id = match store_id_opt {
        Some(id) => id,
        None => {
            return HttpResponse::Ok().json(serde_json::json!({ "storeId": null, "items": [] }))
        }
    };

    let items = sqlx::query_as::<_, DbGroceryItem>(
        "SELECT * FROM rweezy.grocery_items WHERE store_id = $1 ORDER BY category ASC",
    )
    .bind(store_id)
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "storeId": store_id,
        "items": items
    }))
}

pub async fn create_grocery_item(
    req: HttpRequest,
    payload: web::Json<serde_json::Value>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let store_id_opt =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM rweezy.grocery_stores WHERE manager_id = $1")
            .bind(user_id)
            .fetch_optional(pool.get_ref())
            .await
            .unwrap_or(None);

    let store_id = match store_id_opt {
        Some(id) => id,
        None => {
            return HttpResponse::Forbidden()
                .json(serde_json::json!({ "error": "No assigned grocery store" }))
        }
    };

    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("New Item")
        .to_string();
    let description = payload
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let price_val = payload.get("price").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let price = rust_decimal::Decimal::from_f64_retain(price_val).unwrap_or_default();
    let category = payload
        .get("category")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let image_url = payload
        .get("image_url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let is_available = payload
        .get("is_available")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let stock_quantity = payload
        .get("stock_quantity")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;
    let low_stock_threshold = payload
        .get("low_stock_threshold")
        .and_then(|v| v.as_i64())
        .unwrap_or(5) as i32;
    let expiry_date = payload
        .get("expiry_date")
        .and_then(|v| v.as_str())
        .and_then(|s| {
            chrono::DateTime::parse_from_rfc3339(s)
                .ok()
                .map(|dt| dt.with_timezone(&chrono::Utc))
                .or_else(|| {
                    let naive_date = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()?;
                    let naive_datetime = naive_date.and_hms_opt(0, 0, 0)?;
                    Some(chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(
                        naive_datetime,
                        chrono::Utc,
                    ))
                })
        });
    let aisle_location = payload
        .get("aisle_location")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let unit = payload
        .get("unit")
        .and_then(|v| v.as_str())
        .unwrap_or("pcs")
        .to_string();

    let created = sqlx::query_as::<_, DbGroceryItem>(
        "INSERT INTO rweezy.grocery_items (id, store_id, name, description, price, image_url, category, is_available, stock_quantity, low_stock_threshold, expiry_date, aisle_location, unit, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now()) RETURNING *"
    )
    .bind(Uuid::new_v4())
    .bind(store_id)
    .bind(name)
    .bind(description)
    .bind(price)
    .bind(image_url)
    .bind(category)
    .bind(is_available)
    .bind(stock_quantity)
    .bind(low_stock_threshold)
    .bind(expiry_date)
    .bind(aisle_location)
    .bind(unit)
    .fetch_one(pool.get_ref())
    .await;

    match created {
        Ok(item) => HttpResponse::Ok().json(serde_json::json!({ "item": item })),
        Err(e) => {
            tracing::error!("Failed to create grocery item: {}", e);
            HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": "Database error" }))
        }
    }
}

pub async fn update_grocery_item(
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

    let item_id = path.into_inner();

    let store_id_opt =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM rweezy.grocery_stores WHERE manager_id = $1")
            .bind(user_id)
            .fetch_optional(pool.get_ref())
            .await
            .unwrap_or(None);

    let store_id = match store_id_opt {
        Some(id) => id,
        None => {
            return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }))
        }
    };

    let belongs = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM rweezy.grocery_items WHERE id = $1 AND store_id = $2)",
    )
    .bind(item_id)
    .bind(store_id)
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or(false);

    if !belongs {
        return HttpResponse::NotFound().json(serde_json::json!({ "error": "Item not found" }));
    }

    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let description = payload
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let price = payload
        .get("price")
        .and_then(|v| v.as_f64())
        .map(|f| rust_decimal::Decimal::from_f64_retain(f).unwrap_or_default());
    let category = payload
        .get("category")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let image_url = payload
        .get("image_url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let is_available = payload.get("is_available").and_then(|v| v.as_bool());
    let stock_quantity = payload
        .get("stock_quantity")
        .and_then(|v| v.as_i64())
        .map(|i| i as i32);
    let low_stock_threshold = payload
        .get("low_stock_threshold")
        .and_then(|v| v.as_i64())
        .map(|i| i as i32);
    let expiry_date = payload
        .get("expiry_date")
        .and_then(|v| v.as_str())
        .and_then(|s| {
            chrono::DateTime::parse_from_rfc3339(s)
                .ok()
                .map(|dt| dt.with_timezone(&chrono::Utc))
                .or_else(|| {
                    let naive_date = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()?;
                    let naive_datetime = naive_date.and_hms_opt(0, 0, 0)?;
                    Some(chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(
                        naive_datetime,
                        chrono::Utc,
                    ))
                })
        });
    let aisle_location = payload
        .get("aisle_location")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let unit = payload
        .get("unit")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let current_item =
        sqlx::query_as::<_, DbGroceryItem>("SELECT * FROM rweezy.grocery_items WHERE id = $1")
            .bind(item_id)
            .fetch_one(pool.get_ref())
            .await
            .unwrap();

    let name = name.unwrap_or(current_item.name);
    let description = description.or(current_item.description);
    let price = price.unwrap_or(current_item.price);
    let category = category.or(current_item.category);
    let image_url = image_url.or(current_item.image_url);
    let is_available = is_available.unwrap_or(current_item.is_available);
    let stock_quantity = stock_quantity.unwrap_or(current_item.stock_quantity);
    let low_stock_threshold = low_stock_threshold.unwrap_or(current_item.low_stock_threshold);
    let expiry_date = if payload.get("expiry_date").is_some() {
        expiry_date
    } else {
        current_item.expiry_date
    };
    let aisle_location = aisle_location.or(current_item.aisle_location);
    let unit = unit.unwrap_or(current_item.unit);

    let updated = sqlx::query_as::<_, DbGroceryItem>(
        "UPDATE rweezy.grocery_items SET name = $1, description = $2, price = $3, category = $4, image_url = $5, is_available = $6, stock_quantity = $7, low_stock_threshold = $8, expiry_date = $9, aisle_location = $10, unit = $11, updated_at = now() WHERE id = $12 RETURNING *"
    )
    .bind(name)
    .bind(description)
    .bind(price)
    .bind(category)
    .bind(image_url)
    .bind(is_available)
    .bind(stock_quantity)
    .bind(low_stock_threshold)
    .bind(expiry_date)
    .bind(aisle_location)
    .bind(unit)
    .bind(item_id)
    .fetch_one(pool.get_ref())
    .await;

    match updated {
        Ok(item) => HttpResponse::Ok().json(serde_json::json!({ "item": item })),
        _ => HttpResponse::InternalServerError()
            .json(serde_json::json!({ "error": "Database error" })),
    }
}

pub async fn delete_grocery_item(
    req: HttpRequest,
    path: web::Path<Uuid>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let item_id = path.into_inner();

    let store_id_opt =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM rweezy.grocery_stores WHERE manager_id = $1")
            .bind(user_id)
            .fetch_optional(pool.get_ref())
            .await
            .unwrap_or(None);

    let store_id = match store_id_opt {
        Some(id) => id,
        None => {
            return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }))
        }
    };

    let belongs = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM rweezy.grocery_items WHERE id = $1 AND store_id = $2)",
    )
    .bind(item_id)
    .bind(store_id)
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or(false);

    if !belongs {
        return HttpResponse::NotFound().json(serde_json::json!({ "error": "Item not found" }));
    }

    let _ = sqlx::query("DELETE FROM rweezy.grocery_items WHERE id = $1")
        .bind(item_id)
        .execute(pool.get_ref())
        .await;

    HttpResponse::Ok().json(serde_json::json!({ "ok": true }))
}

pub async fn toggle_grocery_item(
    req: HttpRequest,
    path: web::Path<Uuid>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let item_id = path.into_inner();

    let store_id_opt =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM rweezy.grocery_stores WHERE manager_id = $1")
            .bind(user_id)
            .fetch_optional(pool.get_ref())
            .await
            .unwrap_or(None);

    let store_id = match store_id_opt {
        Some(id) => id,
        None => {
            return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }))
        }
    };

    let belongs = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM rweezy.grocery_items WHERE id = $1 AND store_id = $2)",
    )
    .bind(item_id)
    .bind(store_id)
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or(false);

    if !belongs {
        return HttpResponse::NotFound().json(serde_json::json!({ "error": "Item not found" }));
    }

    let updated = sqlx::query_as::<_, DbGroceryItem>(
        "UPDATE rweezy.grocery_items SET is_available = NOT is_available, updated_at = now() WHERE id = $1 RETURNING *"
    )
    .bind(item_id)
    .fetch_one(pool.get_ref())
    .await;

    match updated {
        Ok(item) => HttpResponse::Ok().json(serde_json::json!({ "item": item })),
        _ => HttpResponse::InternalServerError()
            .json(serde_json::json!({ "error": "Database error" })),
    }
}

#[derive(sqlx::FromRow, serde::Serialize, Clone)]
pub struct DbGroceryOrderItem {
    pub id: Uuid,
    pub order_id: Uuid,
    pub grocery_item_id: Uuid,
    pub name: String,
    pub price: rust_decimal::Decimal,
    pub quantity: i32,
}

pub async fn get_grocery_orders(
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
            return HttpResponse::Ok().json(serde_json::json!({ "storeId": null, "orders": [] }))
        }
    };

    let orders_res = sqlx::query(
        "SELECT o.id, o.customer_id, o.store_id, o.status, o.total, o.delivery_address, o.notes, o.payment_method, o.created_at, pc.full_name as customer_name, pc.phone as customer_phone FROM rweezy.grocery_orders o
         LEFT JOIN rweezy.profiles pc ON o.customer_id = pc.id
         WHERE o.store_id = $1 ORDER BY o.created_at DESC"
    )
    .bind(store_id)
    .fetch_all(pool.get_ref())
    .await;

    let orders_rows = match orders_res {
        Ok(rows) => rows,
        Err(_) => Vec::new(),
    };

    let order_ids: Vec<Uuid> = orders_rows
        .iter()
        .map(|row| {
            use sqlx::Row;
            row.get::<Uuid, _>("id")
        })
        .collect();

    let items_res = sqlx::query_as::<_, DbGroceryOrderItem>(
        "SELECT id, order_id, grocery_item_id, name, price, quantity FROM rweezy.grocery_order_items WHERE order_id = ANY($1)"
    )
    .bind(&order_ids)
    .fetch_all(pool.get_ref())
    .await;

    let all_items = items_res.unwrap_or_default();

    let mapped_orders: Vec<serde_json::Value> = orders_rows
        .iter()
        .map(|row| {
            use sqlx::Row;
            let id: Uuid = row.get("id");
            let customer_id: Uuid = row.get("customer_id");
            let store_id_val: Uuid = row.get("store_id");
            let status: OrderStatus = row.get("status");
            let total: rust_decimal::Decimal = row.get("total");
            let delivery_address: String = row.get("delivery_address");
            let notes: Option<String> = row.get("notes");
            let payment_method: String = row.get("payment_method");
            let created_at: chrono::DateTime<chrono::Utc> = row.get("created_at");
            let customer_name: Option<String> = row.get("customer_name");
            let customer_phone: Option<String> = row.get("customer_phone");

            let grocery_order_items: Vec<serde_json::Value> = all_items
                .iter()
                .filter(|item| item.order_id == id)
                .map(|item| {
                    serde_json::json!({
                        "id": item.id,
                        "grocery_item_id": item.grocery_item_id,
                        "name": item.name,
                        "price": item.price,
                        "quantity": item.quantity
                    })
                })
                .collect();

            let profiles =
                serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
            serde_json::json!({
                "id": id,
                "customer_id": customer_id,
                "store_id": store_id_val,
                "status": status as OrderStatus,
                "total": total,
                "delivery_address": delivery_address,
                "notes": notes,
                "payment_method": payment_method,
                "created_at": created_at,
                "grocery_order_items": grocery_order_items,
                "profiles": profiles,
                "customer": profiles
            })
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "storeId": store_id,
        "orders": mapped_orders
    }))
}

pub async fn advance_grocery_order(
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

    if !check_has_role(user_id, "grocery_manager", pool.get_ref()).await {
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
        "UPDATE rweezy.grocery_orders SET status = $1::rweezy.OrderStatus, updated_at = now() WHERE id = $2 RETURNING id"
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

pub async fn get_grocery_history(
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
            return HttpResponse::Ok().json(serde_json::json!({ "storeId": null, "orders": [] }))
        }
    };

    let orders_res = sqlx::query(
        "SELECT o.id, o.customer_id, o.store_id, o.status, o.total, o.delivery_address, o.notes, o.payment_method, o.created_at, pc.full_name as customer_name, pc.phone as customer_phone FROM rweezy.grocery_orders o
         LEFT JOIN rweezy.profiles pc ON o.customer_id = pc.id
         WHERE o.store_id = $1 AND o.status IN ('completed'::rweezy.OrderStatus, 'delivered'::rweezy.OrderStatus, 'cancelled'::rweezy.OrderStatus) ORDER BY o.created_at DESC"
    )
    .bind(store_id)
    .fetch_all(pool.get_ref())
    .await;

    let orders_rows = match orders_res {
        Ok(rows) => rows,
        Err(_) => Vec::new(),
    };

    let order_ids: Vec<Uuid> = orders_rows
        .iter()
        .map(|row| {
            use sqlx::Row;
            row.get::<Uuid, _>("id")
        })
        .collect();

    let items_res = sqlx::query_as::<_, DbGroceryOrderItem>(
        "SELECT id, order_id, grocery_item_id, name, price, quantity FROM rweezy.grocery_order_items WHERE order_id = ANY($1)"
    )
    .bind(&order_ids)
    .fetch_all(pool.get_ref())
    .await;

    let all_items = items_res.unwrap_or_default();

    let mapped_orders: Vec<serde_json::Value> = orders_rows
        .iter()
        .map(|row| {
            use sqlx::Row;
            let id: Uuid = row.get("id");
            let customer_id: Uuid = row.get("customer_id");
            let store_id_val: Uuid = row.get("store_id");
            let status: OrderStatus = row.get("status");
            let total: rust_decimal::Decimal = row.get("total");
            let delivery_address: String = row.get("delivery_address");
            let notes: Option<String> = row.get("notes");
            let payment_method: String = row.get("payment_method");
            let created_at: chrono::DateTime<chrono::Utc> = row.get("created_at");
            let customer_name: Option<String> = row.get("customer_name");
            let customer_phone: Option<String> = row.get("customer_phone");

            let grocery_order_items: Vec<serde_json::Value> = all_items
                .iter()
                .filter(|item| item.order_id == id)
                .map(|item| {
                    serde_json::json!({
                        "id": item.id,
                        "grocery_item_id": item.grocery_item_id,
                        "name": item.name,
                        "price": item.price,
                        "quantity": item.quantity
                    })
                })
                .collect();

            let profiles =
                serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
            serde_json::json!({
                "id": id,
                "customer_id": customer_id,
                "store_id": store_id_val,
                "status": status as OrderStatus,
                "total": total,
                "delivery_address": delivery_address,
                "notes": notes,
                "payment_method": payment_method,
                "created_at": created_at,
                "grocery_order_items": grocery_order_items,
                "profiles": profiles,
                "customer": profiles
            })
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "storeId": store_id,
        "orders": mapped_orders
    }))
}

pub async fn get_hotel_menu(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let rest_id_opt =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM rweezy.restaurants WHERE manager_id = $1")
            .bind(user_id)
            .fetch_optional(pool.get_ref())
            .await
            .unwrap_or(None);

    let rest_id = match rest_id_opt {
        Some(id) => id,
        None => {
            return HttpResponse::Ok()
                .json(serde_json::json!({ "restaurantId": null, "items": [] }))
        }
    };

    let items = sqlx::query_as::<_, DbMenuItem>(
        "SELECT * FROM rweezy.menu_items WHERE restaurant_id = $1 ORDER BY category ASC",
    )
    .bind(rest_id)
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "restaurantId": rest_id,
        "items": items
    }))
}

pub async fn create_hotel_menu_item(
    req: HttpRequest,
    payload: web::Json<serde_json::Value>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let rest_id_opt =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM rweezy.restaurants WHERE manager_id = $1")
            .bind(user_id)
            .fetch_optional(pool.get_ref())
            .await
            .unwrap_or(None);

    let rest_id = match rest_id_opt {
        Some(id) => id,
        None => {
            return HttpResponse::Forbidden()
                .json(serde_json::json!({ "error": "No assigned restaurant" }))
        }
    };

    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("New Item")
        .to_string();
    let description = payload
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let price_val = payload.get("price").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let price = rust_decimal::Decimal::from_f64_retain(price_val).unwrap_or_default();
    let category = payload
        .get("category")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let image_url = payload
        .get("image_url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let is_available = payload
        .get("is_available")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let is_veg = payload
        .get("is_veg")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let prep_time_minutes = payload
        .get("prep_time_minutes")
        .and_then(|v| v.as_i64())
        .unwrap_or(15) as i32;
    let is_special = payload
        .get("is_special")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let modifiers = payload
        .get("modifiers")
        .cloned()
        .unwrap_or(serde_json::json!([]));

    let created = sqlx::query_as::<_, DbMenuItem>(
        "INSERT INTO rweezy.menu_items (id, restaurant_id, name, description, price, image_url, category, is_available, is_veg, prep_time_minutes, is_special, modifiers, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now()) RETURNING *"
    )
    .bind(Uuid::new_v4())
    .bind(rest_id)
    .bind(name)
    .bind(description)
    .bind(price)
    .bind(image_url)
    .bind(category)
    .bind(is_available)
    .bind(is_veg)
    .bind(prep_time_minutes)
    .bind(is_special)
    .bind(modifiers)
    .fetch_one(pool.get_ref())
    .await;

    match created {
        Ok(item) => HttpResponse::Ok().json(serde_json::json!({ "item": item })),
        Err(e) => {
            tracing::error!("Failed to create menu item: {}", e);
            HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": "Database error" }))
        }
    }
}

pub async fn update_hotel_menu_item(
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

    let item_id = path.into_inner();

    let rest_id_opt =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM rweezy.restaurants WHERE manager_id = $1")
            .bind(user_id)
            .fetch_optional(pool.get_ref())
            .await
            .unwrap_or(None);

    let rest_id = match rest_id_opt {
        Some(id) => id,
        None => {
            return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }))
        }
    };

    let belongs = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM rweezy.menu_items WHERE id = $1 AND restaurant_id = $2)",
    )
    .bind(item_id)
    .bind(rest_id)
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or(false);

    if !belongs {
        return HttpResponse::NotFound().json(serde_json::json!({ "error": "Item not found" }));
    }

    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let description = payload
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let price = payload
        .get("price")
        .and_then(|v| v.as_f64())
        .map(|f| rust_decimal::Decimal::from_f64_retain(f).unwrap_or_default());
    let category = payload
        .get("category")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let image_url = payload
        .get("image_url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let is_available = payload.get("is_available").and_then(|v| v.as_bool());
    let is_veg = payload.get("is_veg").and_then(|v| v.as_bool());
    let prep_time_minutes = payload
        .get("prep_time_minutes")
        .and_then(|v| v.as_i64())
        .map(|i| i as i32);
    let is_special = payload.get("is_special").and_then(|v| v.as_bool());
    let modifiers = payload.get("modifiers").cloned();

    let current_item =
        sqlx::query_as::<_, DbMenuItem>("SELECT * FROM rweezy.menu_items WHERE id = $1")
            .bind(item_id)
            .fetch_one(pool.get_ref())
            .await
            .unwrap();

    let name = name.unwrap_or(current_item.name);
    let description = description.or(current_item.description);
    let price = price.unwrap_or(current_item.price);
    let category = category.or(current_item.category);
    let image_url = image_url.or(current_item.image_url);
    let is_available = is_available.unwrap_or(current_item.is_available);
    let is_veg = is_veg.unwrap_or(current_item.is_veg);
    let prep_time_minutes = prep_time_minutes.unwrap_or(current_item.prep_time_minutes);
    let is_special = is_special.unwrap_or(current_item.is_special);
    let modifiers = modifiers.unwrap_or(current_item.modifiers);

    let updated = sqlx::query_as::<_, DbMenuItem>(
        "UPDATE rweezy.menu_items SET name = $1, description = $2, price = $3, category = $4, image_url = $5, is_available = $6, is_veg = $7, prep_time_minutes = $8, is_special = $9, modifiers = $10, updated_at = now() WHERE id = $11 RETURNING *"
    )
    .bind(name)
    .bind(description)
    .bind(price)
    .bind(category)
    .bind(image_url)
    .bind(is_available)
    .bind(is_veg)
    .bind(prep_time_minutes)
    .bind(is_special)
    .bind(modifiers)
    .bind(item_id)
    .fetch_one(pool.get_ref())
    .await;

    match updated {
        Ok(item) => HttpResponse::Ok().json(serde_json::json!({ "item": item })),
        _ => HttpResponse::InternalServerError()
            .json(serde_json::json!({ "error": "Database error" })),
    }
}

pub async fn delete_hotel_menu_item(
    req: HttpRequest,
    path: web::Path<Uuid>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let item_id = path.into_inner();

    let rest_id_opt =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM rweezy.restaurants WHERE manager_id = $1")
            .bind(user_id)
            .fetch_optional(pool.get_ref())
            .await
            .unwrap_or(None);

    let rest_id = match rest_id_opt {
        Some(id) => id,
        None => {
            return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }))
        }
    };

    let belongs = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM rweezy.menu_items WHERE id = $1 AND restaurant_id = $2)",
    )
    .bind(item_id)
    .bind(rest_id)
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or(false);

    if !belongs {
        return HttpResponse::NotFound().json(serde_json::json!({ "error": "Item not found" }));
    }

    let _ = sqlx::query("DELETE FROM rweezy.menu_items WHERE id = $1")
        .bind(item_id)
        .execute(pool.get_ref())
        .await;

    HttpResponse::Ok().json(serde_json::json!({ "ok": true }))
}

pub async fn toggle_hotel_menu_item(
    req: HttpRequest,
    path: web::Path<Uuid>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let item_id = path.into_inner();

    let rest_id_opt =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM rweezy.restaurants WHERE manager_id = $1")
            .bind(user_id)
            .fetch_optional(pool.get_ref())
            .await
            .unwrap_or(None);

    let rest_id = match rest_id_opt {
        Some(id) => id,
        None => {
            return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }))
        }
    };

    let belongs = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM rweezy.menu_items WHERE id = $1 AND restaurant_id = $2)",
    )
    .bind(item_id)
    .bind(rest_id)
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or(false);

    if !belongs {
        return HttpResponse::NotFound().json(serde_json::json!({ "error": "Item not found" }));
    }

    let updated = sqlx::query_as::<_, DbMenuItem>(
        "UPDATE rweezy.menu_items SET is_available = NOT is_available, updated_at = now() WHERE id = $1 RETURNING *"
    )
    .bind(item_id)
    .fetch_one(pool.get_ref())
    .await;

    match updated {
        Ok(item) => HttpResponse::Ok().json(serde_json::json!({ "item": item })),
        _ => HttpResponse::InternalServerError()
            .json(serde_json::json!({ "error": "Database error" })),
    }
}

pub async fn reject_hotel_order(
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

    let order_id = path.into_inner();
    let reason = payload
        .get("reason")
        .and_then(|v| v.as_str())
        .unwrap_or("Rejected by manager");

    let rest_id_opt =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM rweezy.restaurants WHERE manager_id = $1")
            .bind(user_id)
            .fetch_optional(pool.get_ref())
            .await
            .unwrap_or(None);

    let rest_id = match rest_id_opt {
        Some(id) => id,
        None => {
            return HttpResponse::Forbidden().json(serde_json::json!({ "error": "Unauthorized" }))
        }
    };

    let belongs = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM rweezy.food_orders WHERE id = $1 AND restaurant_id = $2)",
    )
    .bind(order_id)
    .bind(rest_id)
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or(false);

    if !belongs {
        return HttpResponse::NotFound().json(serde_json::json!({ "error": "Order not found" }));
    }

    let notes_to_append = format!(" [Rejected: {}]", reason);

    let updated = sqlx::query(
        "UPDATE rweezy.food_orders SET status = 'cancelled'::rweezy.OrderStatus, notes = COALESCE(notes, '') || $1, updated_at = now() WHERE id = $2 RETURNING id"
    )
    .bind(&notes_to_append)
    .bind(order_id)
    .fetch_optional(pool.get_ref())
    .await;

    match updated {
        Ok(Some(_)) => {
            let msg = serde_json::json!({
                "type": "order_updated",
                "payload": { "orderId": order_id.to_string() }
            })
            .to_string();
            let b = broker.lock().await;
            b.broadcast(&format!("order_{}", order_id), &msg);

            HttpResponse::Ok()
                .json(serde_json::json!({ "order": { "id": order_id, "status": "cancelled" } }))
        }
        _ => HttpResponse::InternalServerError()
            .json(serde_json::json!({ "error": "Database error" })),
    }
}

pub async fn get_hotel_history(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let rest_id = match sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM rweezy.restaurants WHERE manager_id = $1",
    )
    .bind(user_id)
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
         WHERE o.restaurant_id = $1 AND o.status IN ('completed'::rweezy.OrderStatus, 'delivered'::rweezy.OrderStatus, 'cancelled'::rweezy.OrderStatus) ORDER BY o.created_at DESC"
    )
    .bind(rest_id)
    .fetch_all(pool.get_ref())
    .await;

    let orders_rows = match orders_res {
        Ok(rows) => rows,
        Err(_) => Vec::new(),
    };

    let order_ids: Vec<Uuid> = orders_rows
        .iter()
        .map(|row| {
            use sqlx::Row;
            row.get::<Uuid, _>("id")
        })
        .collect();

    let items_res = sqlx::query_as::<_, DbFoodOrderItem>(
        "SELECT id, order_id, menu_item_id, name, price, quantity FROM rweezy.food_order_items WHERE order_id = ANY($1)"
    )
    .bind(&order_ids)
    .fetch_all(pool.get_ref())
    .await;

    let all_items = items_res.unwrap_or_default();

    let mapped_orders: Vec<serde_json::Value> = orders_rows
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

            let food_order_items: Vec<serde_json::Value> = all_items
                .iter()
                .filter(|item| item.order_id == id)
                .map(|item| {
                    serde_json::json!({
                        "id": item.id,
                        "menu_item_id": item.menu_item_id,
                        "name": item.name,
                        "price": item.price,
                        "quantity": item.quantity
                    })
                })
                .collect();

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
                "food_order_items": food_order_items,
                "profiles": profiles,
                "customer": profiles
            })
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "restaurantId": rest_id,
        "orders": mapped_orders
    }))
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

    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * limit;
    let search = query.search.as_deref().filter(|value| !value.is_empty());

    let total = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM rweezy.profiles
         WHERE $1::text IS NULL
            OR full_name ILIKE '%' || $1 || '%'
            OR id::text ILIKE '%' || $1 || '%'",
    )
    .bind(search)
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or(0);

    let profiles = sqlx::query_as::<_, DbProfile>(
        "SELECT * FROM rweezy.profiles
         WHERE $1::text IS NULL
            OR full_name ILIKE '%' || $1 || '%'
            OR id::text ILIKE '%' || $1 || '%'
         ORDER BY full_name ASC NULLS LAST
         LIMIT $2 OFFSET $3",
    )
    .bind(search)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    let profile_ids: Vec<Uuid> = profiles.iter().map(|profile| profile.id).collect();
    let roles = if profile_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as::<_, AdminUserRole>(
            "SELECT user_id, role FROM rweezy.user_roles WHERE user_id = ANY($1)",
        )
        .bind(&profile_ids)
        .fetch_all(pool.get_ref())
        .await
        .unwrap_or_default()
    };

    let role_requests = sqlx::query_as::<_, DbRoleRequest>(
        "SELECT * FROM rweezy.role_requests WHERE status = 'pending'::rweezy.RoleRequestStatus ORDER BY created_at DESC",
    )
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "profiles": profiles,
        "roles": roles,
        "roleRequests": role_requests,
        "page": page,
        "limit": limit,
        "total": total
    }))
}

pub async fn admin_review_role_request(
    req: HttpRequest,
    path: web::Path<Uuid>,
    payload: web::Json<serde_json::Value>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
    whatsapp: web::Data<WhatsAppService>,
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

    order_notifications::spawn_role_request_reviewed(
        pool.get_ref().clone(),
        whatsapp.get_ref().clone(),
        request.user_id,
        decision == "approved",
        request.requested_role.as_str(),
    );

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

#[derive(sqlx::FromRow, serde::Serialize, Clone)]
pub struct DbFoodOrderItem {
    pub id: Uuid,
    pub order_id: Uuid,
    pub menu_item_id: Uuid,
    pub name: String,
    pub price: rust_decimal::Decimal,
    pub quantity: i32,
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

    let orders_rows = match orders_res {
        Ok(rows) => rows,
        Err(_) => Vec::new(),
    };

    let order_ids: Vec<Uuid> = orders_rows
        .iter()
        .map(|row| {
            use sqlx::Row;
            row.get::<Uuid, _>("id")
        })
        .collect();

    let items_res = sqlx::query_as::<_, DbFoodOrderItem>(
        "SELECT id, order_id, menu_item_id, name, price, quantity FROM rweezy.food_order_items WHERE order_id = ANY($1)"
    )
    .bind(&order_ids)
    .fetch_all(pool.get_ref())
    .await;

    let all_items = items_res.unwrap_or_default();

    let mapped_orders: Vec<serde_json::Value> = orders_rows
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

            let food_order_items: Vec<serde_json::Value> = all_items
                .iter()
                .filter(|item| item.order_id == id)
                .map(|item| {
                    serde_json::json!({
                        "id": item.id,
                        "menu_item_id": item.menu_item_id,
                        "name": item.name,
                        "price": item.price,
                        "quantity": item.quantity
                    })
                })
                .collect();

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
                "food_order_items": food_order_items,
                "profiles": profiles,
                "customer": profiles
            })
        })
        .collect();

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
