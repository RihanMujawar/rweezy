use actix_web::{web, HttpRequest, HttpResponse, Responder};
use chrono::{DateTime, Datelike, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use tracing::{error, info};
use uuid::Uuid;

use crate::handlers::auth::get_auth_user;
use crate::models::*;
use crate::websocket::SharedBroker;

fn generate_delivery_pin() -> String {
    let mut rng = rand::thread_rng();
    format!("{:04}", rng.gen_range(0..10000))
}

fn verify_status_transition(current: &str, next: &str) -> bool {
    let states = vec![
        "pending",
        "accepted",
        "preparing",
        "ready",
        "picked_up",
        "delivered",
        "cancelled",
    ];
    let i_curr = match states.iter().position(|&x| x == current) {
        Some(i) => i,
        None => return false,
    };
    let i_next = match states.iter().position(|&x| x == next) {
        Some(i) => i,
        None => return false,
    };

    if next == "cancelled" {
        return current == "pending" || current == "accepted" || current == "preparing";
    }

    i_next == i_curr + 1
}

async fn broadcast_order_update(broker: &SharedBroker, order_id: &Uuid) {
    let msg = serde_json::json!({
        "type": "order_updated",
        "payload": {
            "orderId": order_id.to_string()
        }
    })
    .to_string();

    let b = broker.lock().await;
    b.broadcast(&format!("order_{}", order_id), &msg);
}

pub async fn checkout_food(
    req: HttpRequest,
    payload: web::Json<FoodOrderRequest>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
    broker: web::Data<SharedBroker>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let rest_id = match Uuid::parse_str(&payload.restaurant_id) {
        Ok(id) => id,
        Err(_) => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({ "error": "Invalid restaurant_id" }))
        }
    };

    if payload.items.is_empty() {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "Add at least one item before checkout" }));
    }

    let rest_res = sqlx::query(
        "SELECT name, address, town_name, pincode, lat, lng, is_open, delivery_radius_km FROM rweezy.restaurants WHERE id = $1"
    )
    .bind(rest_id)
    .fetch_optional(pool.get_ref())
    .await;

    let rest = match rest_res {
        Ok(Some(row)) => {
            use sqlx::Row;
            let is_open: bool = row.get("is_open");
            if !is_open {
                return HttpResponse::BadRequest().json(serde_json::json!({ "error": "This restaurant is not accepting orders right now" }));
            }
            row
        }
        _ => {
            return HttpResponse::NotFound()
                .json(serde_json::json!({ "error": "Restaurant not found" }))
        }
    };

    // Check delivery limit
    {
        use sqlx::Row;
        let rest_lat: Option<f64> = rest.get("lat");
        let rest_lng: Option<f64> = rest.get("lng");
        let delivery_radius_km: f64 = rest.try_get("delivery_radius_km").unwrap_or(25.0);

        if let (Some(r_lat), Some(r_lng)) = (rest_lat, rest_lng) {
            let dist = distance_km(r_lat, r_lng, payload.delivery_lat, payload.delivery_lng);
            if dist > delivery_radius_km {
                return HttpResponse::BadRequest().json(serde_json::json!({
                    "error": format!("Your delivery location is {:.1} km away, which is outside the restaurant's maximum delivery limit of {:.1} km.", dist, delivery_radius_km)
                }));
            }
        }
    }

    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            error!("Failed to begin transaction: {}", e);
            return HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": "Database error" }));
        }
    };

    let order_id = Uuid::new_v4();
    let delivery_pin = generate_delivery_pin();
    let estimated_delivery_at = Utc::now() + chrono::Duration::minutes(35);

    let mut total_price = rust_decimal::Decimal::from(0);

    for item in &payload.items {
        let item_id = match Uuid::parse_str(&item.id) {
            Ok(id) => id,
            Err(_) => {
                return HttpResponse::BadRequest()
                    .json(serde_json::json!({ "error": "Invalid item id" }))
            }
        };

        let menu_item_res = sqlx::query(
            "SELECT price, is_available FROM rweezy.menu_items WHERE id = $1 AND restaurant_id = $2"
        )
        .bind(item_id)
        .bind(rest_id)
        .fetch_one(&mut *tx)
        .await;

        let menu_item = match menu_item_res {
            Ok(m) => {
                use sqlx::Row;
                let is_available: bool = m.get("is_available");
                if !is_available {
                    return HttpResponse::BadRequest().json(serde_json::json!({ "error": format!("{} is no longer available", item.name) }));
                }
                m
            }
            Err(_) => {
                return HttpResponse::BadRequest()
                    .json(serde_json::json!({ "error": "Invalid menu item selected" }))
            }
        };

        use sqlx::Row;
        let price_dec: rust_decimal::Decimal = menu_item.get("price");
        let qty_dec = rust_decimal::Decimal::from(item.quantity);
        total_price += price_dec * qty_dec;

        if let Err(e) = sqlx::query(
            "INSERT INTO rweezy.food_order_items (id, order_id, menu_item_id, name, price, quantity, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())"
        )
        .bind(Uuid::new_v4())
        .bind(order_id)
        .bind(item_id)
        .bind(&item.name)
        .bind(price_dec)
        .bind(item.quantity)
        .execute(&mut *tx)
        .await
        {
            error!("Failed to create order item: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Database error creating order items" }));
        }
    }

    use sqlx::Row;
    let rest_address: Option<String> = rest.get("address");
    let rest_town_name: Option<String> = rest.get("town_name");
    let rest_pincode: Option<String> = rest.get("pincode");
    let rest_lat: Option<f64> = rest.get("lat");
    let rest_lng: Option<f64> = rest.get("lng");

    let pickup_address = format!(
        "{}, {}, {}",
        rest_address.unwrap_or_default(),
        rest_town_name.unwrap_or_default(),
        rest_pincode.unwrap_or_default()
    );

    if let Err(e) = sqlx::query(
        "INSERT INTO rweezy.food_orders (id, customer_id, restaurant_id, status, total, delivery_address, delivery_lat, delivery_lng, pickup_address, pickup_lat, pickup_lng, notes, payment_method, payment_status, delivery_pin, estimated_delivery_at, contactless_delivery, created_at, updated_at)
         VALUES ($1, $2, $3, 'pending'::rweezy.OrderStatus, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', $13, $14, $15, now(), now())"
    )
    .bind(order_id)
    .bind(user_id)
    .bind(rest_id)
    .bind(total_price)
    .bind(&payload.delivery_address)
    .bind(payload.delivery_lat)
    .bind(payload.delivery_lng)
    .bind(pickup_address)
    .bind(rest_lat)
    .bind(rest_lng)
    .bind(payload.notes.as_deref())
    .bind(payload.payment_method.as_deref().unwrap_or("cash"))
    .bind(&delivery_pin)
    .bind(estimated_delivery_at)
    .bind(payload.contactless_delivery.unwrap_or(false))
    .execute(&mut *tx)
    .await
    {
        error!("Failed to create food order: {}", e);
        return HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Database error creating order" }));
    }

    if let Err(e) = tx.commit().await {
        error!("Failed to commit food order transaction: {}", e);
        return HttpResponse::InternalServerError()
            .json(serde_json::json!({ "error": "Transaction commit error" }));
    }

    broadcast_order_update(&broker, &order_id).await;

    HttpResponse::Ok().json(serde_json::json!({
        "order": {
            "id": order_id,
            "total": total_price,
            "delivery_pin": delivery_pin
        }
    }))
}

pub async fn checkout_grocery(
    req: HttpRequest,
    payload: web::Json<GroceryOrderRequest>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
    broker: web::Data<SharedBroker>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let store_id = match Uuid::parse_str(&payload.store_id) {
        Ok(id) => id,
        Err(_) => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({ "error": "Invalid store_id" }))
        }
    };

    if payload.items.is_empty() {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "Add at least one item before checkout" }));
    }

    let store_res = sqlx::query(
        "SELECT name, address, town_name, pincode, lat, lng, is_open, delivery_radius_km FROM rweezy.grocery_stores WHERE id = $1"
    )
    .bind(store_id)
    .fetch_optional(pool.get_ref())
    .await;

    let store = match store_res {
        Ok(Some(row)) => {
            use sqlx::Row;
            let is_open: bool = row.get("is_open");
            if !is_open {
                return HttpResponse::BadRequest().json(
                    serde_json::json!({ "error": "This store is not accepting orders right now" }),
                );
            }
            row
        }
        _ => {
            return HttpResponse::NotFound().json(serde_json::json!({ "error": "Store not found" }))
        }
    };

    // Check delivery limit
    {
        use sqlx::Row;
        let store_lat: Option<f64> = store.get("lat");
        let store_lng: Option<f64> = store.get("lng");
        let delivery_radius_km: f64 = store.try_get("delivery_radius_km").unwrap_or(25.0);

        if let (Some(s_lat), Some(s_lng)) = (store_lat, store_lng) {
            let dist = distance_km(s_lat, s_lng, payload.delivery_lat, payload.delivery_lng);
            if dist > delivery_radius_km {
                return HttpResponse::BadRequest().json(serde_json::json!({
                    "error": format!("Your delivery location is {:.1} km away, which is outside the store's maximum delivery limit of {:.1} km.", dist, delivery_radius_km)
                }));
            }
        }
    }

    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            error!("Failed to begin transaction: {}", e);
            return HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": "Database error" }));
        }
    };

    let order_id = Uuid::new_v4();
    let delivery_pin = generate_delivery_pin();
    let estimated_delivery_at = Utc::now() + chrono::Duration::minutes(45);

    let mut total_price = rust_decimal::Decimal::from(0);

    for item in &payload.items {
        let item_id = match Uuid::parse_str(&item.id) {
            Ok(id) => id,
            Err(_) => {
                return HttpResponse::BadRequest()
                    .json(serde_json::json!({ "error": "Invalid item id" }))
            }
        };

        let grocery_item_res = sqlx::query(
            "SELECT price, stock_quantity, is_available FROM rweezy.grocery_items WHERE id = $1 AND store_id = $2"
        )
        .bind(item_id)
        .bind(store_id)
        .fetch_one(&mut *tx)
        .await;

        let grocery_item = match grocery_item_res {
            Ok(g) => {
                use sqlx::Row;
                let is_available: bool = g.get("is_available");
                let stock_quantity: i32 = g.get("stock_quantity");
                if !is_available {
                    return HttpResponse::BadRequest().json(serde_json::json!({ "error": format!("{} is no longer available", item.name) }));
                }
                if stock_quantity < item.quantity {
                    return HttpResponse::BadRequest().json(serde_json::json!({ "error": format!("{} only has {} left in stock", item.name, stock_quantity) }));
                }
                g
            }
            Err(_) => {
                return HttpResponse::BadRequest()
                    .json(serde_json::json!({ "error": "Invalid grocery item selected" }))
            }
        };

        use sqlx::Row;
        let price_dec: rust_decimal::Decimal = grocery_item.get("price");
        let qty_dec = rust_decimal::Decimal::from(item.quantity);
        total_price += price_dec * qty_dec;

        if let Err(e) = sqlx::query(
            "UPDATE rweezy.grocery_items SET stock_quantity = stock_quantity - $1 WHERE id = $2",
        )
        .bind(item.quantity)
        .bind(item_id)
        .execute(&mut *tx)
        .await
        {
            error!("Failed to update stock quantity: {}", e);
            return HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": "Stock update database error" }));
        }

        if let Err(e) = sqlx::query(
            "INSERT INTO rweezy.grocery_order_items (id, order_id, grocery_item_id, name, price, quantity, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())"
        )
        .bind(Uuid::new_v4())
        .bind(order_id)
        .bind(item_id)
        .bind(&item.name)
        .bind(price_dec)
        .bind(item.quantity)
        .execute(&mut *tx)
        .await
        {
            error!("Failed to insert grocery order item: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Database error creating order items" }));
        }
    }

    use sqlx::Row;
    let store_address: Option<String> = store.get("address");
    let store_town_name: Option<String> = store.get("town_name");
    let store_pincode: Option<String> = store.get("pincode");
    let store_lat: Option<f64> = store.get("lat");
    let store_lng: Option<f64> = store.get("lng");

    let pickup_address = format!(
        "{}, {}, {}",
        store_address.unwrap_or_default(),
        store_town_name.unwrap_or_default(),
        store_pincode.unwrap_or_default()
    );

    if let Err(e) = sqlx::query(
        "INSERT INTO rweezy.grocery_orders (id, customer_id, store_id, status, total, delivery_address, delivery_lat, delivery_lng, pickup_address, pickup_lat, pickup_lng, notes, payment_method, payment_status, delivery_pin, estimated_delivery_at, contactless_delivery, created_at, updated_at)
         VALUES ($1, $2, $3, 'pending'::rweezy.OrderStatus, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', $13, $14, $15, now(), now())"
    )
    .bind(order_id)
    .bind(user_id)
    .bind(store_id)
    .bind(total_price)
    .bind(&payload.delivery_address)
    .bind(payload.delivery_lat)
    .bind(payload.delivery_lng)
    .bind(pickup_address)
    .bind(store_lat)
    .bind(store_lng)
    .bind(payload.notes.as_deref())
    .bind(payload.payment_method.as_deref().unwrap_or("cash"))
    .bind(&delivery_pin)
    .bind(estimated_delivery_at)
    .bind(payload.contactless_delivery.unwrap_or(false))
    .execute(&mut *tx)
    .await
    {
        error!("Failed to create grocery order: {}", e);
        return HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Database error creating order" }));
    }

    if let Err(e) = tx.commit().await {
        error!("Failed to commit grocery order transaction: {}", e);
        return HttpResponse::InternalServerError()
            .json(serde_json::json!({ "error": "Transaction commit error" }));
    }

    broadcast_order_update(&broker, &order_id).await;

    HttpResponse::Ok().json(serde_json::json!({
        "order": {
            "id": order_id,
            "total": total_price,
            "delivery_pin": delivery_pin
        }
    }))
}

pub async fn get_my_orders(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let food_rows_res = sqlx::query(
        "SELECT o.*, r.name as restaurant_name,
                pc.full_name as customer_name, pc.phone as customer_phone,
                pr.full_name as rider_name, pr.phone as rider_phone
         FROM rweezy.food_orders o
         JOIN rweezy.restaurants r ON o.restaurant_id = r.id
         LEFT JOIN rweezy.profiles pc ON o.customer_id = pc.id
         LEFT JOIN rweezy.profiles pr ON o.delivery_boy_id = pr.id
         WHERE o.customer_id = $1 ORDER BY o.created_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool.get_ref())
    .await;

    let mapped_food: Vec<serde_json::Value> = match food_rows_res {
        Ok(rows) => rows
            .iter()
            .map(|row| {
                use sqlx::Row;
                let id: Uuid = row.get("id");
                let customer_id: Uuid = row.get("customer_id");
                let restaurant_id: Uuid = row.get("restaurant_id");
                let delivery_boy_id: Option<Uuid> = row.get("delivery_boy_id");
                let status: OrderStatus = row.get("status");
                let total: rust_decimal::Decimal = row.get("total");
                let delivery_address: String = row.get("delivery_address");
                let delivery_lat: Option<f64> = row.get("delivery_lat");
                let delivery_lng: Option<f64> = row.get("delivery_lng");
                let pickup_address: Option<String> = row.get("pickup_address");
                let pickup_lat: Option<f64> = row.get("pickup_lat");
                let pickup_lng: Option<f64> = row.get("pickup_lng");
                let notes: Option<String> = row.get("notes");
                let payment_method: String = row.get("payment_method");
                let payment_status: String = row.get("payment_status");
                let delivery_pin: Option<String> = row.get("delivery_pin");
                let estimated_delivery_at: Option<chrono::DateTime<chrono::Utc>> =
                    row.get("estimated_delivery_at");
                let contactless_delivery: bool = row.get("contactless_delivery");
                let rider_lat: Option<f64> = row.get("rider_lat");
                let rider_lng: Option<f64> = row.get("rider_lng");
                let created_at: chrono::DateTime<chrono::Utc> = row.get("created_at");
                let updated_at: chrono::DateTime<chrono::Utc> = row.get("updated_at");
                let restaurant_name: String = row.get("restaurant_name");
                let customer_name: Option<String> = row.get("customer_name");
                let customer_phone: Option<String> = row.get("customer_phone");
                let rider_name: Option<String> = row.get("rider_name");
                let rider_phone: Option<String> = row.get("rider_phone");

                let profiles = serde_json::json!({
                    "full_name": customer_name,
                    "phone": customer_phone
                });
                serde_json::json!({
                    "id": id,
                    "customer_id": customer_id,
                    "restaurant_id": restaurant_id,
                    "delivery_boy_id": delivery_boy_id,
                    "rider_id": delivery_boy_id,
                    "status": status as OrderStatus,
                    "total": total,
                    "delivery_address": delivery_address,
                    "delivery_lat": delivery_lat,
                    "delivery_lng": delivery_lng,
                    "pickup_address": pickup_address,
                    "pickup_lat": pickup_lat,
                    "pickup_lng": pickup_lng,
                    "notes": notes,
                    "payment_method": payment_method,
                    "payment_status": payment_status,
                    "delivery_pin": delivery_pin,
                    "estimated_delivery_at": estimated_delivery_at,
                    "contactless_delivery": contactless_delivery,
                    "rider_lat": rider_lat,
                    "rider_lng": rider_lng,
                    "created_at": created_at,
                    "updated_at": updated_at,
                    "restaurants": { "name": restaurant_name },
                    "profiles": profiles,
                    "customer": profiles,
                    "rider": if delivery_boy_id.is_some() {
                        serde_json::json!({
                            "full_name": rider_name,
                            "phone": rider_phone
                        })
                    } else {
                        serde_json::Value::Null
                    }
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    let grocery_rows_res = sqlx::query(
        "SELECT o.*, s.name as store_name,
                pc.full_name as customer_name, pc.phone as customer_phone,
                pr.full_name as rider_name, pr.phone as rider_phone
         FROM rweezy.grocery_orders o
         JOIN rweezy.grocery_stores s ON o.store_id = s.id
         LEFT JOIN rweezy.profiles pc ON o.customer_id = pc.id
         LEFT JOIN rweezy.profiles pr ON o.delivery_boy_id = pr.id
         WHERE o.customer_id = $1 ORDER BY o.created_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool.get_ref())
    .await;

    let mapped_grocery: Vec<serde_json::Value> = match grocery_rows_res {
        Ok(rows) => rows
            .iter()
            .map(|row| {
                use sqlx::Row;
                let id: Uuid = row.get("id");
                let customer_id: Uuid = row.get("customer_id");
                let store_id: Uuid = row.get("store_id");
                let delivery_boy_id: Option<Uuid> = row.get("delivery_boy_id");
                let status: OrderStatus = row.get("status");
                let total: rust_decimal::Decimal = row.get("total");
                let delivery_address: String = row.get("delivery_address");
                let delivery_lat: Option<f64> = row.get("delivery_lat");
                let delivery_lng: Option<f64> = row.get("delivery_lng");
                let pickup_address: Option<String> = row.get("pickup_address");
                let pickup_lat: Option<f64> = row.get("pickup_lat");
                let pickup_lng: Option<f64> = row.get("pickup_lng");
                let notes: Option<String> = row.get("notes");
                let payment_method: String = row.get("payment_method");
                let payment_status: String = row.get("payment_status");
                let delivery_pin: Option<String> = row.get("delivery_pin");
                let estimated_delivery_at: Option<chrono::DateTime<chrono::Utc>> =
                    row.get("estimated_delivery_at");
                let contactless_delivery: bool = row.get("contactless_delivery");
                let rider_lat: Option<f64> = row.get("rider_lat");
                let rider_lng: Option<f64> = row.get("rider_lng");
                let created_at: chrono::DateTime<chrono::Utc> = row.get("created_at");
                let updated_at: chrono::DateTime<chrono::Utc> = row.get("updated_at");
                let store_name: String = row.get("store_name");
                let customer_name: Option<String> = row.get("customer_name");
                let customer_phone: Option<String> = row.get("customer_phone");
                let rider_name: Option<String> = row.get("rider_name");
                let rider_phone: Option<String> = row.get("rider_phone");

                let profiles = serde_json::json!({
                    "full_name": customer_name,
                    "phone": customer_phone
                });
                serde_json::json!({
                    "id": id,
                    "customer_id": customer_id,
                    "store_id": store_id,
                    "delivery_boy_id": delivery_boy_id,
                    "rider_id": delivery_boy_id,
                    "status": status as OrderStatus,
                    "total": total,
                    "delivery_address": delivery_address,
                    "delivery_lat": delivery_lat,
                    "delivery_lng": delivery_lng,
                    "pickup_address": pickup_address,
                    "pickup_lat": pickup_lat,
                    "pickup_lng": pickup_lng,
                    "notes": notes,
                    "payment_method": payment_method,
                    "payment_status": payment_status,
                    "delivery_pin": delivery_pin,
                    "estimated_delivery_at": estimated_delivery_at,
                    "contactless_delivery": contactless_delivery,
                    "rider_lat": rider_lat,
                    "rider_lng": rider_lng,
                    "created_at": created_at,
                    "updated_at": updated_at,
                    "grocery_stores": { "name": store_name },
                    "profiles": profiles,
                    "customer": profiles,
                    "rider": if delivery_boy_id.is_some() {
                        serde_json::json!({
                            "full_name": rider_name,
                            "phone": rider_phone
                        })
                    } else {
                        serde_json::Value::Null
                    }
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    let rides_rows_res = sqlx::query(
        "SELECT r.*, pc.full_name as customer_name, pc.phone as customer_phone,
                    pr.full_name as rider_name, pr.phone as rider_phone
         FROM rweezy.rides r
         LEFT JOIN rweezy.profiles pc ON r.customer_id = pc.id
         LEFT JOIN rweezy.profiles pr ON r.rider_id = pr.id
         WHERE r.customer_id = $1 ORDER BY r.created_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool.get_ref())
    .await;

    let mapped_rides: Vec<serde_json::Value> = match rides_rows_res {
        Ok(rows) => rows
            .iter()
            .map(|row| {
                use sqlx::Row;
                let id: Uuid = row.get("id");
                let customer_id: Uuid = row.get("customer_id");
                let rider_id: Option<Uuid> = row.get("rider_id");
                let pickup_address: String = row.get("pickup_address");
                let pickup_lat: f64 = row.get("pickup_lat");
                let pickup_lng: f64 = row.get("pickup_lng");
                let drop_address: String = row.get("drop_address");
                let drop_lat: f64 = row.get("drop_lat");
                let drop_lng: f64 = row.get("drop_lng");
                let status: RideStatus = row.get("status");
                let fare_estimate: Option<rust_decimal::Decimal> = row.get("fare_estimate");
                let notes: Option<String> = row.get("notes");
                let vehicle_type: String = row.get("vehicle_type");
                let payment_method: String = row.get("payment_method");
                let payment_status: String = row.get("payment_status");
                let delivery_pin: Option<String> = row.get("delivery_pin");
                let estimated_arrival_at: Option<chrono::DateTime<chrono::Utc>> =
                    row.get("estimated_arrival_at");
                let rider_lat: Option<f64> = row.get("rider_lat");
                let rider_lng: Option<f64> = row.get("rider_lng");
                let created_at: chrono::DateTime<chrono::Utc> = row.get("created_at");
                let updated_at: chrono::DateTime<chrono::Utc> = row.get("updated_at");
                let customer_name: Option<String> = row.get("customer_name");
                let customer_phone: Option<String> = row.get("customer_phone");
                let rider_name: Option<String> = row.get("rider_name");
                let rider_phone: Option<String> = row.get("rider_phone");

                let profiles = serde_json::json!({
                    "full_name": customer_name,
                    "phone": customer_phone
                });
                serde_json::json!({
                    "id": id,
                    "customer_id": customer_id,
                    "rider_id": rider_id,
                    "pickup_address": pickup_address,
                    "pickup_lat": pickup_lat,
                    "pickup_lng": pickup_lng,
                    "drop_address": drop_address,
                    "drop_lat": drop_lat,
                    "drop_lng": drop_lng,
                    "status": status as RideStatus,
                    "fare_estimate": fare_estimate,
                    "notes": notes,
                    "vehicle_type": vehicle_type,
                    "payment_method": payment_method,
                    "payment_status": payment_status,
                    "delivery_pin": delivery_pin,
                    "estimated_arrival_at": estimated_arrival_at,
                    "rider_lat": rider_lat,
                    "rider_lng": rider_lng,
                    "created_at": created_at,
                    "updated_at": updated_at,
                    "profiles": profiles,
                    "customer": profiles,
                    "rider": if rider_id.is_some() {
                        serde_json::json!({
                            "full_name": rider_name,
                            "phone": rider_phone
                        })
                    } else {
                        serde_json::Value::Null
                    }
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    let packages_rows_res = sqlx::query(
        "SELECT p.*, pc.full_name as customer_name, pc.phone as customer_phone,
                    pr.full_name as rider_name, pr.phone as rider_phone
         FROM rweezy.package_deliveries p
         LEFT JOIN rweezy.profiles pc ON p.customer_id = pc.id
         LEFT JOIN rweezy.profiles pr ON p.rider_id = pr.id
         WHERE p.customer_id = $1 ORDER BY p.created_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool.get_ref())
    .await;

    let mapped_packages: Vec<serde_json::Value> = match packages_rows_res {
        Ok(rows) => rows
            .iter()
            .map(|row| {
                use sqlx::Row;
                let id: Uuid = row.get("id");
                let customer_id: Uuid = row.get("customer_id");
                let rider_id: Option<Uuid> = row.get("rider_id");
                let pickup_address: String = row.get("pickup_address");
                let pickup_lat: f64 = row.get("pickup_lat");
                let pickup_lng: f64 = row.get("pickup_lng");
                let drop_address: String = row.get("drop_address");
                let drop_lat: f64 = row.get("drop_lat");
                let drop_lng: f64 = row.get("drop_lng");
                let package_size: String = row.get("package_size");
                let receiver_name: Option<String> = row.get("receiver_name");
                let receiver_phone: Option<String> = row.get("receiver_phone");
                let notes: Option<String> = row.get("notes");
                let status: RideStatus = row.get("status");
                let fare_estimate: Option<rust_decimal::Decimal> = row.get("fare_estimate");
                let payment_method: String = row.get("payment_method");
                let payment_status: String = row.get("payment_status");
                let delivery_pin: Option<String> = row.get("delivery_pin");
                let estimated_delivery_at: Option<chrono::DateTime<chrono::Utc>> =
                    row.get("estimated_delivery_at");
                let rider_lat: Option<f64> = row.get("rider_lat");
                let rider_lng: Option<f64> = row.get("rider_lng");
                let created_at: chrono::DateTime<chrono::Utc> = row.get("created_at");
                let updated_at: chrono::DateTime<chrono::Utc> = row.get("updated_at");
                let customer_name: Option<String> = row.get("customer_name");
                let customer_phone: Option<String> = row.get("customer_phone");
                let rider_name: Option<String> = row.get("rider_name");
                let rider_phone: Option<String> = row.get("rider_phone");

                let profiles = serde_json::json!({
                    "full_name": customer_name,
                    "phone": customer_phone
                });
                serde_json::json!({
                    "id": id,
                    "customer_id": customer_id,
                    "rider_id": rider_id,
                    "pickup_address": pickup_address,
                    "pickup_lat": pickup_lat,
                    "pickup_lng": pickup_lng,
                    "drop_address": drop_address,
                    "drop_lat": drop_lat,
                    "drop_lng": drop_lng,
                    "package_size": package_size,
                    "receiver_name": receiver_name,
                    "receiver_phone": receiver_phone,
                    "notes": notes,
                    "status": status as RideStatus,
                    "fare_estimate": fare_estimate,
                    "payment_method": payment_method,
                    "payment_status": payment_status,
                    "delivery_pin": delivery_pin,
                    "estimated_delivery_at": estimated_delivery_at,
                    "rider_lat": rider_lat,
                    "rider_lng": rider_lng,
                    "created_at": created_at,
                    "updated_at": updated_at,
                    "profiles": profiles,
                    "customer": profiles,
                    "rider": if rider_id.is_some() {
                        serde_json::json!({
                            "full_name": rider_name,
                            "phone": rider_phone
                        })
                    } else {
                        serde_json::Value::Null
                    }
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "food": mapped_food,
        "grocery": mapped_grocery,
        "rides": mapped_rides,
        "packages": mapped_packages
    }))
}

pub async fn cancel_order(
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

    let (kind, id) = path.into_inner();
    let query_str = match kind.as_str() {
        "food" => "UPDATE rweezy.food_orders SET status = 'cancelled'::rweezy.OrderStatus, updated_at = now() WHERE id = $1 AND customer_id = $2 AND status IN ('pending'::rweezy.OrderStatus, 'accepted'::rweezy.OrderStatus, 'preparing'::rweezy.OrderStatus) RETURNING id",
        "grocery" => "UPDATE rweezy.grocery_orders SET status = 'cancelled'::rweezy.OrderStatus, updated_at = now() WHERE id = $1 AND customer_id = $2 AND status IN ('pending'::rweezy.OrderStatus, 'accepted'::rweezy.OrderStatus, 'preparing'::rweezy.OrderStatus) RETURNING id",
        "ride" => "UPDATE rweezy.rides SET status = 'cancelled'::rweezy.RideStatus, updated_at = now() WHERE id = $1 AND customer_id = $2 AND status = 'requested'::rweezy.RideStatus RETURNING id",
        "package" => "UPDATE rweezy.package_deliveries SET status = 'cancelled'::rweezy.RideStatus, updated_at = now() WHERE id = $1 AND customer_id = $2 AND status = 'requested'::rweezy.RideStatus RETURNING id",
        _ => return HttpResponse::BadRequest().json(serde_json::json!({ "error": "Invalid order type" })),
    };

    match sqlx::query(query_str)
        .bind(id)
        .bind(user_id)
        .fetch_optional(pool.get_ref())
        .await
    {
        Ok(Some(_)) => {
            broadcast_order_update(&broker, &id).await;
            HttpResponse::Ok()
                .json(serde_json::json!({ "ok": true, "row": { "id": id, "status": "cancelled" } }))
        }
        Ok(None) => HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "Order can no longer be cancelled" })),
        Err(e) => {
            error!("Failed to cancel order: {}", e);
            HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": "Database error" }))
        }
    }
}

pub async fn track_order(
    path: web::Path<(String, Uuid)>,
    pool: web::Data<PgPool>,
) -> impl Responder {
    let (kind, id) = path.into_inner();

    match kind.as_str() {
        "food" => {
            let row_res = sqlx::query(
                "SELECT o.*, r.name as restaurant_name,
                        pc.full_name as customer_name, pc.phone as customer_phone,
                        pr.full_name as rider_name, pr.phone as rider_phone
                 FROM rweezy.food_orders o
                 JOIN rweezy.restaurants r ON o.restaurant_id = r.id
                 LEFT JOIN rweezy.profiles pc ON o.customer_id = pc.id
                 LEFT JOIN rweezy.profiles pr ON o.delivery_boy_id = pr.id
                 WHERE o.id = $1",
            )
            .bind(id)
            .fetch_optional(pool.get_ref())
            .await;

            if let Ok(Some(o)) = row_res {
                use sqlx::Row;
                let status: OrderStatus = o.get("status");
                let total: rust_decimal::Decimal = o.get("total");
                let delivery_address: String = o.get("delivery_address");
                let delivery_lat: Option<f64> = o.get("delivery_lat");
                let delivery_lng: Option<f64> = o.get("delivery_lng");
                let pickup_address: Option<String> = o.get("pickup_address");
                let pickup_lat: Option<f64> = o.get("pickup_lat");
                let pickup_lng: Option<f64> = o.get("pickup_lng");
                let notes: Option<String> = o.get("notes");
                let payment_method: String = o.get("payment_method");
                let payment_status: String = o.get("payment_status");
                let delivery_pin: Option<String> = o.get("delivery_pin");
                let estimated_delivery_at: Option<chrono::DateTime<chrono::Utc>> =
                    o.get("estimated_delivery_at");
                let contactless_delivery: bool = o.get("contactless_delivery");
                let rider_lat: Option<f64> = o.get("rider_lat");
                let rider_lng: Option<f64> = o.get("rider_lng");
                let created_at: chrono::DateTime<chrono::Utc> = o.get("created_at");
                let updated_at: chrono::DateTime<chrono::Utc> = o.get("updated_at");
                let restaurant_name: String = o.get("restaurant_name");
                let customer_name: Option<String> = o.get("customer_name");
                let customer_phone: Option<String> = o.get("customer_phone");
                let rider_name: Option<String> = o.get("rider_name");
                let rider_phone: Option<String> = o.get("rider_phone");
                let delivery_boy_id: Option<Uuid> = o.get("delivery_boy_id");

                let customer =
                    serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
                let partner = if delivery_boy_id.is_some() {
                    serde_json::json!({ "full_name": rider_name, "phone": rider_phone })
                } else {
                    serde_json::Value::Null
                };

                let food_items_res = sqlx::query(
                    "SELECT id, menu_item_id, name, price, quantity FROM rweezy.food_order_items WHERE order_id = $1"
                )
                .bind(id)
                .fetch_all(pool.get_ref())
                .await;

                let food_order_items: Vec<serde_json::Value> = match food_items_res {
                    Ok(rows) => rows
                        .iter()
                        .map(|item| {
                            use sqlx::Row;
                            serde_json::json!({
                                "id": item.get::<Uuid, _>("id"),
                                "menu_item_id": item.get::<Uuid, _>("menu_item_id"),
                                "name": item.get::<String, _>("name"),
                                "price": item.get::<rust_decimal::Decimal, _>("price"),
                                "quantity": item.get::<i32, _>("quantity"),
                            })
                        })
                        .collect(),
                    _ => Vec::new(),
                };

                return HttpResponse::Ok().json(serde_json::json!({
                    "row": {
                        "id": id,
                        "customer_id": o.get::<Uuid, _>("customer_id"),
                        "restaurant_id": o.get::<Uuid, _>("restaurant_id"),
                        "delivery_boy_id": delivery_boy_id,
                        "rider_id": delivery_boy_id,
                        "status": status as OrderStatus,
                        "total": total,
                        "delivery_address": delivery_address,
                        "delivery_lat": delivery_lat,
                        "delivery_lng": delivery_lng,
                        "pickup_address": pickup_address,
                        "pickup_lat": pickup_lat,
                        "pickup_lng": pickup_lng,
                        "notes": notes,
                        "payment_method": payment_method,
                        "payment_status": payment_status,
                        "delivery_pin": delivery_pin,
                        "estimated_delivery_at": estimated_delivery_at,
                        "contactless_delivery": contactless_delivery,
                        "rider_lat": rider_lat,
                        "rider_lng": rider_lng,
                        "created_at": created_at,
                        "updated_at": updated_at,
                        "restaurants": { "name": restaurant_name },
                        "profiles": customer,
                        "customer": customer,
                        "rider": partner,
                        "partner": partner,
                        "food_order_items": food_order_items
                    }
                }));
            }
        }
        "grocery" => {
            let row_res = sqlx::query(
                "SELECT o.*, s.name as store_name,
                        pc.full_name as customer_name, pc.phone as customer_phone,
                        pr.full_name as rider_name, pr.phone as rider_phone
                 FROM rweezy.grocery_orders o
                 JOIN rweezy.grocery_stores s ON o.store_id = s.id
                 LEFT JOIN rweezy.profiles pc ON o.customer_id = pc.id
                 LEFT JOIN rweezy.profiles pr ON o.delivery_boy_id = pr.id
                 WHERE o.id = $1",
            )
            .bind(id)
            .fetch_optional(pool.get_ref())
            .await;

            if let Ok(Some(o)) = row_res {
                use sqlx::Row;
                let status: OrderStatus = o.get("status");
                let total: rust_decimal::Decimal = o.get("total");
                let delivery_address: String = o.get("delivery_address");
                let delivery_lat: Option<f64> = o.get("delivery_lat");
                let delivery_lng: Option<f64> = o.get("delivery_lng");
                let pickup_address: Option<String> = o.get("pickup_address");
                let pickup_lat: Option<f64> = o.get("pickup_lat");
                let pickup_lng: Option<f64> = o.get("pickup_lng");
                let notes: Option<String> = o.get("notes");
                let payment_method: String = o.get("payment_method");
                let payment_status: String = o.get("payment_status");
                let delivery_pin: Option<String> = o.get("delivery_pin");
                let estimated_delivery_at: Option<chrono::DateTime<chrono::Utc>> =
                    o.get("estimated_delivery_at");
                let contactless_delivery: bool = o.get("contactless_delivery");
                let rider_lat: Option<f64> = o.get("rider_lat");
                let rider_lng: Option<f64> = o.get("rider_lng");
                let created_at: chrono::DateTime<chrono::Utc> = o.get("created_at");
                let updated_at: chrono::DateTime<chrono::Utc> = o.get("updated_at");
                let store_name: String = o.get("store_name");
                let customer_name: Option<String> = o.get("customer_name");
                let customer_phone: Option<String> = o.get("customer_phone");
                let rider_name: Option<String> = o.get("rider_name");
                let rider_phone: Option<String> = o.get("rider_phone");
                let delivery_boy_id: Option<Uuid> = o.get("delivery_boy_id");

                let customer =
                    serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
                let partner = if delivery_boy_id.is_some() {
                    serde_json::json!({ "full_name": rider_name, "phone": rider_phone })
                } else {
                    serde_json::Value::Null
                };

                let grocery_items_res = sqlx::query(
                    "SELECT id, grocery_item_id, name, price, quantity FROM rweezy.grocery_order_items WHERE order_id = $1"
                )
                .bind(id)
                .fetch_all(pool.get_ref())
                .await;

                let grocery_order_items: Vec<serde_json::Value> = match grocery_items_res {
                    Ok(rows) => rows
                        .iter()
                        .map(|item| {
                            use sqlx::Row;
                            serde_json::json!({
                                "id": item.get::<Uuid, _>("id"),
                                "grocery_item_id": item.get::<Uuid, _>("grocery_item_id"),
                                "name": item.get::<String, _>("name"),
                                "price": item.get::<rust_decimal::Decimal, _>("price"),
                                "quantity": item.get::<i32, _>("quantity"),
                            })
                        })
                        .collect(),
                    _ => Vec::new(),
                };

                return HttpResponse::Ok().json(serde_json::json!({
                    "row": {
                        "id": id,
                        "customer_id": o.get::<Uuid, _>("customer_id"),
                        "store_id": o.get::<Uuid, _>("store_id"),
                        "delivery_boy_id": delivery_boy_id,
                        "rider_id": delivery_boy_id,
                        "status": status as OrderStatus,
                        "total": total,
                        "delivery_address": delivery_address,
                        "delivery_lat": delivery_lat,
                        "delivery_lng": delivery_lng,
                        "pickup_address": pickup_address,
                        "pickup_lat": pickup_lat,
                        "pickup_lng": pickup_lng,
                        "notes": notes,
                        "payment_method": payment_method,
                        "payment_status": payment_status,
                        "delivery_pin": delivery_pin,
                        "estimated_delivery_at": estimated_delivery_at,
                        "contactless_delivery": contactless_delivery,
                        "rider_lat": rider_lat,
                        "rider_lng": rider_lng,
                        "created_at": created_at,
                        "updated_at": updated_at,
                        "grocery_stores": { "name": store_name },
                        "profiles": customer,
                        "customer": customer,
                        "rider": partner,
                        "partner": partner,
                        "grocery_order_items": grocery_order_items
                    }
                }));
            }
        }
        "ride" => {
            let row_res = sqlx::query(
                "SELECT r.*, pc.full_name as customer_name, pc.phone as customer_phone,
                            pr.full_name as rider_name, pr.phone as rider_phone
                 FROM rweezy.rides r
                 LEFT JOIN rweezy.profiles pc ON r.customer_id = pc.id
                 LEFT JOIN rweezy.profiles pr ON r.rider_id = pr.id
                 WHERE r.id = $1",
            )
            .bind(id)
            .fetch_optional(pool.get_ref())
            .await;

            if let Ok(Some(r)) = row_res {
                use sqlx::Row;
                let status: RideStatus = r.get("status");
                let fare_estimate: Option<rust_decimal::Decimal> = r.get("fare_estimate");
                let pickup_address: String = r.get("pickup_address");
                let pickup_lat: f64 = r.get("pickup_lat");
                let pickup_lng: f64 = r.get("pickup_lng");
                let drop_address: String = r.get("drop_address");
                let drop_lat: f64 = r.get("drop_lat");
                let drop_lng: f64 = r.get("drop_lng");
                let notes: Option<String> = r.get("notes");
                let vehicle_type: String = r.get("vehicle_type");
                let payment_method: String = r.get("payment_method");
                let payment_status: String = r.get("payment_status");
                let delivery_pin: Option<String> = r.get("delivery_pin");
                let estimated_arrival_at: Option<chrono::DateTime<chrono::Utc>> =
                    r.get("estimated_arrival_at");
                let rider_lat: Option<f64> = r.get("rider_lat");
                let rider_lng: Option<f64> = r.get("rider_lng");
                let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");
                let updated_at: chrono::DateTime<chrono::Utc> = r.get("updated_at");
                let customer_name: Option<String> = r.get("customer_name");
                let customer_phone: Option<String> = r.get("customer_phone");
                let rider_name: Option<String> = r.get("rider_name");
                let rider_phone: Option<String> = r.get("rider_phone");
                let rider_id: Option<Uuid> = r.get("rider_id");

                let customer =
                    serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
                let partner = if rider_id.is_some() {
                    serde_json::json!({ "full_name": rider_name, "phone": rider_phone })
                } else {
                    serde_json::Value::Null
                };
                return HttpResponse::Ok().json(serde_json::json!({
                    "row": {
                        "id": id,
                        "customer_id": r.get::<Uuid, _>("customer_id"),
                        "rider_id": rider_id,
                        "pickup_address": pickup_address,
                        "pickup_lat": pickup_lat,
                        "pickup_lng": pickup_lng,
                        "drop_address": drop_address,
                        "drop_lat": drop_lat,
                        "drop_lng": drop_lng,
                        "status": status as RideStatus,
                        "fare_estimate": fare_estimate,
                        "notes": notes,
                        "vehicle_type": vehicle_type,
                        "payment_method": payment_method,
                        "payment_status": payment_status,
                        "delivery_pin": delivery_pin,
                        "estimated_arrival_at": estimated_arrival_at,
                        "rider_lat": rider_lat,
                        "rider_lng": rider_lng,
                        "created_at": created_at,
                        "updated_at": updated_at,
                        "profiles": customer,
                        "customer": customer,
                        "rider": partner,
                        "partner": partner
                    }
                }));
            }
        }
        "package" => {
            let row_res = sqlx::query(
                "SELECT p.*, pc.full_name as customer_name, pc.phone as customer_phone,
                            pr.full_name as rider_name, pr.phone as rider_phone
                 FROM rweezy.package_deliveries p
                 LEFT JOIN rweezy.profiles pc ON p.customer_id = pc.id
                 LEFT JOIN rweezy.profiles pr ON p.rider_id = pr.id
                 WHERE p.id = $1",
            )
            .bind(id)
            .fetch_optional(pool.get_ref())
            .await;

            if let Ok(Some(p)) = row_res {
                use sqlx::Row;
                let status: RideStatus = p.get("status");
                let fare_estimate: Option<rust_decimal::Decimal> = p.get("fare_estimate");
                let pickup_address: String = p.get("pickup_address");
                let pickup_lat: f64 = p.get("pickup_lat");
                let pickup_lng: f64 = p.get("pickup_lng");
                let drop_address: String = p.get("drop_address");
                let drop_lat: f64 = p.get("drop_lat");
                let drop_lng: f64 = p.get("drop_lng");
                let package_size: String = p.get("package_size");
                let receiver_name: Option<String> = p.get("receiver_name");
                let receiver_phone: Option<String> = p.get("receiver_phone");
                let notes: Option<String> = p.get("notes");
                let payment_method: String = p.get("payment_method");
                let payment_status: String = p.get("payment_status");
                let delivery_pin: Option<String> = p.get("delivery_pin");
                let estimated_delivery_at: Option<chrono::DateTime<chrono::Utc>> =
                    p.get("estimated_delivery_at");
                let rider_lat: Option<f64> = p.get("rider_lat");
                let rider_lng: Option<f64> = p.get("rider_lng");
                let created_at: chrono::DateTime<chrono::Utc> = p.get("created_at");
                let updated_at: chrono::DateTime<chrono::Utc> = p.get("updated_at");
                let customer_name: Option<String> = p.get("customer_name");
                let customer_phone: Option<String> = p.get("customer_phone");
                let rider_name: Option<String> = p.get("rider_name");
                let rider_phone: Option<String> = p.get("rider_phone");
                let rider_id: Option<Uuid> = p.get("rider_id");

                let customer =
                    serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
                let partner = if rider_id.is_some() {
                    serde_json::json!({ "full_name": rider_name, "phone": rider_phone })
                } else {
                    serde_json::Value::Null
                };
                return HttpResponse::Ok().json(serde_json::json!({
                    "row": {
                        "id": id,
                        "customer_id": p.get::<Uuid, _>("customer_id"),
                        "rider_id": rider_id,
                        "pickup_address": pickup_address,
                        "pickup_lat": pickup_lat,
                        "pickup_lng": pickup_lng,
                        "drop_address": drop_address,
                        "drop_lat": drop_lat,
                        "drop_lng": drop_lng,
                        "package_size": package_size,
                        "receiver_name": receiver_name,
                        "receiver_phone": receiver_phone,
                        "notes": notes,
                        "status": status as RideStatus,
                        "fare_estimate": fare_estimate,
                        "payment_method": payment_method,
                        "payment_status": payment_status,
                        "delivery_pin": delivery_pin,
                        "estimated_delivery_at": estimated_delivery_at,
                        "rider_lat": rider_lat,
                        "rider_lng": rider_lng,
                        "created_at": created_at,
                        "updated_at": updated_at,
                        "profiles": customer,
                        "customer": customer,
                        "rider": partner,
                        "partner": partner
                    }
                }));
            }
        }
        _ => {}
    }

    HttpResponse::NotFound().json(serde_json::json!({ "error": "Order details not found" }))
}

pub async fn get_available_deliveries(pool: web::Data<PgPool>) -> impl Responder {
    let food_rows_res = sqlx::query(
        "SELECT o.id, o.status, o.total, o.delivery_address, o.pickup_address, o.created_at, r.name as restaurant_name, pc.full_name as customer_name, pc.phone as customer_phone
         FROM rweezy.food_orders o
         JOIN rweezy.restaurants r ON o.restaurant_id = r.id
         LEFT JOIN rweezy.profiles pc ON o.customer_id = pc.id
         WHERE o.delivery_boy_id IS NULL AND o.status IN ('ready'::rweezy.OrderStatus, 'preparing'::rweezy.OrderStatus)"
    )
    .fetch_all(pool.get_ref())
    .await;

    let mapped_food: Vec<serde_json::Value> = match food_rows_res {
        Ok(rows) => rows
            .iter()
            .map(|o| {
                use sqlx::Row;
                let id: Uuid = o.get("id");
                let status: OrderStatus = o.get("status");
                let total: rust_decimal::Decimal = o.get("total");
                let delivery_address: String = o.get("delivery_address");
                let pickup_address: Option<String> = o.get("pickup_address");
                let created_at: chrono::DateTime<chrono::Utc> = o.get("created_at");
                let restaurant_name: String = o.get("restaurant_name");
                let customer_name: Option<String> = o.get("customer_name");
                let customer_phone: Option<String> = o.get("customer_phone");

                let profiles =
                    serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
                serde_json::json!({
                    "id": id,
                    "status": status as OrderStatus,
                    "total": total,
                    "delivery_address": delivery_address,
                    "pickup_address": pickup_address,
                    "created_at": created_at,
                    "restaurants": { "name": restaurant_name },
                    "profiles": profiles,
                    "customer": profiles
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    let grocery_rows_res = sqlx::query(
        "SELECT o.id, o.status, o.total, o.delivery_address, o.pickup_address, o.created_at, s.name as store_name, pc.full_name as customer_name, pc.phone as customer_phone
         FROM rweezy.grocery_orders o
         JOIN rweezy.grocery_stores s ON o.store_id = s.id
         LEFT JOIN rweezy.profiles pc ON o.customer_id = pc.id
         WHERE o.delivery_boy_id IS NULL AND o.status IN ('ready'::rweezy.OrderStatus, 'preparing'::rweezy.OrderStatus)"
    )
    .fetch_all(pool.get_ref())
    .await;

    let mapped_grocery: Vec<serde_json::Value> = match grocery_rows_res {
        Ok(rows) => rows
            .iter()
            .map(|o| {
                use sqlx::Row;
                let id: Uuid = o.get("id");
                let status: OrderStatus = o.get("status");
                let total: rust_decimal::Decimal = o.get("total");
                let delivery_address: String = o.get("delivery_address");
                let pickup_address: Option<String> = o.get("pickup_address");
                let created_at: chrono::DateTime<chrono::Utc> = o.get("created_at");
                let store_name: String = o.get("store_name");
                let customer_name: Option<String> = o.get("customer_name");
                let customer_phone: Option<String> = o.get("customer_phone");

                let profiles =
                    serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
                serde_json::json!({
                    "id": id,
                    "status": status as OrderStatus,
                    "total": total,
                    "delivery_address": delivery_address,
                    "pickup_address": pickup_address,
                    "created_at": created_at,
                    "grocery_stores": { "name": store_name },
                    "profiles": profiles,
                    "customer": profiles
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "food": mapped_food,
        "grocery": mapped_grocery
    }))
}

pub async fn get_active_deliveries(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let food_rows_res = sqlx::query(
        "SELECT o.id, o.status, o.total, o.delivery_address, o.pickup_address, o.created_at, o.delivery_boy_id, r.name as restaurant_name, pc.full_name as customer_name, pc.phone as customer_phone
         FROM rweezy.food_orders o
         JOIN rweezy.restaurants r ON o.restaurant_id = r.id
         LEFT JOIN rweezy.profiles pc ON o.customer_id = pc.id
         WHERE o.delivery_boy_id = $1 AND o.status NOT IN ('delivered'::rweezy.OrderStatus, 'cancelled'::rweezy.OrderStatus)"
    )
    .bind(user_id)
    .fetch_all(pool.get_ref())
    .await;

    let mapped_food: Vec<serde_json::Value> = match food_rows_res {
        Ok(rows) => rows
            .iter()
            .map(|o| {
                use sqlx::Row;
                let id: Uuid = o.get("id");
                let status: OrderStatus = o.get("status");
                let total: rust_decimal::Decimal = o.get("total");
                let delivery_address: String = o.get("delivery_address");
                let pickup_address: Option<String> = o.get("pickup_address");
                let created_at: chrono::DateTime<chrono::Utc> = o.get("created_at");
                let delivery_boy_id: Option<Uuid> = o.get("delivery_boy_id");
                let restaurant_name: String = o.get("restaurant_name");
                let customer_name: Option<String> = o.get("customer_name");
                let customer_phone: Option<String> = o.get("customer_phone");

                let profiles =
                    serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
                serde_json::json!({
                    "id": id,
                    "delivery_boy_id": delivery_boy_id,
                    "rider_id": delivery_boy_id,
                    "status": status as OrderStatus,
                    "total": total,
                    "delivery_address": delivery_address,
                    "pickup_address": pickup_address,
                    "created_at": created_at,
                    "restaurants": { "name": restaurant_name },
                    "profiles": profiles,
                    "customer": profiles
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    let grocery_rows_res = sqlx::query(
        "SELECT o.id, o.status, o.total, o.delivery_address, o.pickup_address, o.created_at, o.delivery_boy_id, s.name as store_name, pc.full_name as customer_name, pc.phone as customer_phone
         FROM rweezy.grocery_orders o
         JOIN rweezy.grocery_stores s ON o.store_id = s.id
         LEFT JOIN rweezy.profiles pc ON o.customer_id = pc.id
         WHERE o.delivery_boy_id = $1 AND o.status NOT IN ('delivered'::rweezy.OrderStatus, 'cancelled'::rweezy.OrderStatus)"
    )
    .bind(user_id)
    .fetch_all(pool.get_ref())
    .await;

    let mapped_grocery: Vec<serde_json::Value> = match grocery_rows_res {
        Ok(rows) => rows
            .iter()
            .map(|o| {
                use sqlx::Row;
                let id: Uuid = o.get("id");
                let status: OrderStatus = o.get("status");
                let total: rust_decimal::Decimal = o.get("total");
                let delivery_address: String = o.get("delivery_address");
                let pickup_address: Option<String> = o.get("pickup_address");
                let created_at: chrono::DateTime<chrono::Utc> = o.get("created_at");
                let delivery_boy_id: Option<Uuid> = o.get("delivery_boy_id");
                let store_name: String = o.get("store_name");
                let customer_name: Option<String> = o.get("customer_name");
                let customer_phone: Option<String> = o.get("customer_phone");

                let profiles =
                    serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
                serde_json::json!({
                    "id": id,
                    "delivery_boy_id": delivery_boy_id,
                    "rider_id": delivery_boy_id,
                    "status": status as OrderStatus,
                    "total": total,
                    "delivery_address": delivery_address,
                    "pickup_address": pickup_address,
                    "created_at": created_at,
                    "grocery_stores": { "name": store_name },
                    "profiles": profiles,
                    "customer": profiles
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "food": mapped_food,
        "grocery": mapped_grocery
    }))
}

pub async fn accept_delivery(
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

    let (kind, id) = path.into_inner();
    let query_str = match kind.as_str() {
        "food" => "UPDATE rweezy.food_orders SET delivery_boy_id = $1, status = 'accepted'::rweezy.OrderStatus, updated_at = now() WHERE id = $2 AND delivery_boy_id IS NULL RETURNING id",
        "grocery" => "UPDATE rweezy.grocery_orders SET delivery_boy_id = $1, status = 'accepted'::rweezy.OrderStatus, updated_at = now() WHERE id = $2 AND delivery_boy_id IS NULL RETURNING id",
        _ => return HttpResponse::BadRequest().json(serde_json::json!({ "error": "Invalid order type" })),
    };

    match sqlx::query(query_str)
        .bind(user_id)
        .bind(id)
        .fetch_optional(pool.get_ref())
        .await
    {
        Ok(Some(_)) => {
            broadcast_order_update(&broker, &id).await;
            HttpResponse::Ok()
                .json(serde_json::json!({ "order": { "id": id, "rider_id": user_id } }))
        }
        _ => HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "Order already accepted or unavailable" })),
    }
}

pub async fn advance_delivery(
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

    let (kind, id) = path.into_inner();
    let target_status = match payload.get("status").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({ "error": "status is required" }))
        }
    };

    let current_status_str: String;
    let expected_pin: Option<String>;
    let mut current_boy: Option<Uuid> = None;

    if kind == "food" {
        let row_res = sqlx::query(
            "SELECT status, delivery_pin, delivery_boy_id FROM rweezy.food_orders WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(pool.get_ref())
        .await;

        let _row = match row_res {
            Ok(Some(r)) => {
                use sqlx::Row;
                let status_val: OrderStatus = r.get("status");
                current_status_str = status_val.as_str().to_string();
                expected_pin = r.get("delivery_pin");
                current_boy = r.get("delivery_boy_id");
                r
            }
            _ => {
                return HttpResponse::NotFound()
                    .json(serde_json::json!({ "error": "Order not found" }))
            }
        };
    } else if kind == "grocery" {
        let row_res = sqlx::query(
            "SELECT status, delivery_pin, delivery_boy_id FROM rweezy.grocery_orders WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(pool.get_ref())
        .await;

        let _row = match row_res {
            Ok(Some(r)) => {
                use sqlx::Row;
                let status_val: OrderStatus = r.get("status");
                current_status_str = status_val.as_str().to_string();
                expected_pin = r.get("delivery_pin");
                current_boy = r.get("delivery_boy_id");
                r
            }
            _ => {
                return HttpResponse::NotFound()
                    .json(serde_json::json!({ "error": "Order not found" }))
            }
        };
    } else {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "Invalid order type" }));
    }

    if current_boy != Some(user_id) {
        return HttpResponse::Forbidden()
            .json(serde_json::json!({ "error": "You are not assigned to this delivery" }));
    }

    if !verify_status_transition(&current_status_str, target_status) {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "Invalid status transition" }));
    }

    if target_status == "delivered" {
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
        "pending" => OrderStatus::Pending,
        "accepted" => OrderStatus::Accepted,
        "preparing" => OrderStatus::Preparing,
        "ready" => OrderStatus::Ready,
        "picked_up" => OrderStatus::PickedUp,
        "delivered" => OrderStatus::Delivered,
        "cancelled" => OrderStatus::Cancelled,
        _ => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({ "error": "Invalid status type" }))
        }
    };

    let payment_update = if target_status == "delivered" {
        ", payment_status = 'paid'"
    } else {
        ""
    };
    let query_str = if kind == "food" {
        format!("UPDATE rweezy.food_orders SET status = $1::rweezy.OrderStatus, updated_at = now(){} WHERE id = $2 RETURNING id", payment_update)
    } else {
        format!("UPDATE rweezy.grocery_orders SET status = $1::rweezy.OrderStatus, updated_at = now(){} WHERE id = $2 RETURNING id", payment_update)
    };

    match sqlx::query(&query_str)
        .bind(parsed_status as OrderStatus)
        .bind(id)
        .fetch_optional(pool.get_ref())
        .await
    {
        Ok(Some(_)) => {
            broadcast_order_update(&broker, &id).await;
            HttpResponse::Ok()
                .json(serde_json::json!({ "order": { "id": id, "status": target_status } }))
        }
        _ => HttpResponse::InternalServerError()
            .json(serde_json::json!({ "error": "Failed to update status" })),
    }
}

pub async fn get_delivery_earnings(
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

    let food_earnings_res = sqlx::query(
        "SELECT total, created_at FROM rweezy.food_orders WHERE delivery_boy_id = $1 AND status = 'delivered'::rweezy.OrderStatus"
    )
    .bind(user_id)
    .fetch_all(pool.get_ref())
    .await;

    let food_earnings_all = match food_earnings_res {
        Ok(rows) => rows,
        _ => Vec::new(),
    };

    let grocery_earnings_res = sqlx::query(
        "SELECT total, created_at FROM rweezy.grocery_orders WHERE delivery_boy_id = $1 AND status = 'delivered'::rweezy.OrderStatus"
    )
    .bind(user_id)
    .fetch_all(pool.get_ref())
    .await;

    let grocery_earnings_all = match grocery_earnings_res {
        Ok(rows) => rows,
        _ => Vec::new(),
    };

    let mut total_today = rust_decimal::Decimal::from(0);
    let mut total_month = rust_decimal::Decimal::from(0);
    let total_count = food_earnings_all.len() + grocery_earnings_all.len();

    for o in food_earnings_all {
        use sqlx::Row;
        let created_at: chrono::DateTime<chrono::Utc> = o.get("created_at");
        let total: rust_decimal::Decimal = o.get("total");
        if created_at >= today_start {
            total_today += total;
        }
        if created_at >= month_start {
            total_month += total;
        }
    }

    for o in grocery_earnings_all {
        use sqlx::Row;
        let created_at: chrono::DateTime<chrono::Utc> = o.get("created_at");
        let total: rust_decimal::Decimal = o.get("total");
        if created_at >= today_start {
            total_today += total;
        }
        if created_at >= month_start {
            total_month += total;
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "todayEarnings": total_today,
        "monthEarnings": total_month,
        "totalDeliveries": total_count
    }))
}

pub async fn submit_review(
    req: HttpRequest,
    payload: web::Json<ReviewRequest>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let service_id = match Uuid::parse_str(payload.service_id.trim()) {
        Ok(id) => id,
        Err(_) => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({ "error": "Invalid service_id" }))
        }
    };

    let parsed_kind = match payload.service_kind.trim().to_lowercase().as_str() {
        "ride" => ServiceKind::Ride,
        "package" => ServiceKind::Package,
        "food" => ServiceKind::Food,
        "grocery" => ServiceKind::Grocery,
        _ => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({ "error": "Invalid service_kind" }))
        }
    };

    match sqlx::query(
        "INSERT INTO rweezy.order_reviews (id, user_id, service_kind, service_id, rating, comment, created_at)
         VALUES ($1, $2, $3::rweezy.ServiceKind, $4, $5, $6, now())
         ON CONFLICT (user_id, service_kind, service_id) DO UPDATE SET rating = $5, comment = $6
         RETURNING id"
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(parsed_kind as ServiceKind)
    .bind(service_id)
    .bind(payload.rating)
    .bind(payload.comment.as_deref())
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(row) => {
            use sqlx::Row;
            let row_id: Uuid = row.get("id");
            HttpResponse::Ok().json(serde_json::json!({ "review": { "id": row_id } }))
        }
        Err(e) => {
            error!("Failed to submit review: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Database error submitting review" }))
        }
    }
}

pub async fn get_reviews(
    path: web::Path<(String, Uuid)>,
    pool: web::Data<PgPool>,
) -> impl Responder {
    let (kind, service_id) = path.into_inner();
    let parsed_kind = match kind.trim().to_lowercase().as_str() {
        "ride" => ServiceKind::Ride,
        "package" => ServiceKind::Package,
        "food" => ServiceKind::Food,
        "grocery" => ServiceKind::Grocery,
        _ => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({ "error": "Invalid service_kind" }))
        }
    };

    let rows_res = sqlx::query(
        "SELECT r.id, r.user_id, r.rating, r.comment, r.created_at, p.full_name as reviewer_name FROM rweezy.order_reviews r
         LEFT JOIN rweezy.profiles p ON r.user_id = p.id
         WHERE r.service_kind = $1::rweezy.ServiceKind AND r.service_id = $2
         ORDER BY r.created_at DESC LIMIT 20"
    )
    .bind(parsed_kind as ServiceKind)
    .bind(service_id)
    .fetch_all(pool.get_ref())
    .await;

    let mapped_reviews: Vec<serde_json::Value> = match rows_res {
        Ok(rows) => rows
            .iter()
            .map(|r| {
                use sqlx::Row;
                let id: Uuid = r.get("id");
                let r_user_id: Uuid = r.get("user_id");
                let rating: i32 = r.get("rating");
                let comment: Option<String> = r.get("comment");
                let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");
                let reviewer_name: Option<String> = r.get("reviewer_name");

                serde_json::json!({
                    "id": id,
                    "user_id": r_user_id,
                    "rating": rating,
                    "comment": comment,
                    "created_at": created_at,
                    "reviewer_name": reviewer_name
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    HttpResponse::Ok().json(serde_json::json!({ "reviews": mapped_reviews }))
}

fn distance_km(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    let earth_radius_km = 6371.0;
    let d_lat = (lat2 - lat1).to_radians();
    let d_lng = (lng2 - lng1).to_radians();
    let a = (d_lat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (d_lng / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
    earth_radius_km * c
}

pub async fn get_delivery_history(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let food_rows_res = sqlx::query(
        "SELECT o.id, o.status, o.total, o.delivery_address, o.pickup_address, o.created_at, o.delivery_boy_id, r.name as restaurant_name, pc.full_name as customer_name, pc.phone as customer_phone
         FROM rweezy.food_orders o
         JOIN rweezy.restaurants r ON o.restaurant_id = r.id
         LEFT JOIN rweezy.profiles pc ON o.customer_id = pc.id
         WHERE o.delivery_boy_id = $1 AND o.status IN ('completed'::rweezy.OrderStatus, 'delivered'::rweezy.OrderStatus, 'cancelled'::rweezy.OrderStatus) ORDER BY o.created_at DESC"
    )
    .bind(user_id)
    .fetch_all(pool.get_ref())
    .await;

    let mapped_food: Vec<serde_json::Value> = match food_rows_res {
        Ok(rows) => rows
            .iter()
            .map(|o| {
                use sqlx::Row;
                let id: Uuid = o.get("id");
                let status: OrderStatus = o.get("status");
                let total: rust_decimal::Decimal = o.get("total");
                let delivery_address: String = o.get("delivery_address");
                let pickup_address: Option<String> = o.get("pickup_address");
                let created_at: chrono::DateTime<chrono::Utc> = o.get("created_at");
                let delivery_boy_id: Option<Uuid> = o.get("delivery_boy_id");
                let restaurant_name: String = o.get("restaurant_name");
                let customer_name: Option<String> = o.get("customer_name");
                let customer_phone: Option<String> = o.get("customer_phone");

                let profiles =
                    serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
                serde_json::json!({
                    "id": id,
                    "delivery_boy_id": delivery_boy_id,
                    "rider_id": delivery_boy_id,
                    "status": status as OrderStatus,
                    "total": total,
                    "delivery_address": delivery_address,
                    "pickup_address": pickup_address,
                    "created_at": created_at,
                    "restaurants": { "name": restaurant_name },
                    "profiles": profiles,
                    "customer": profiles
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    let grocery_rows_res = sqlx::query(
        "SELECT o.id, o.status, o.total, o.delivery_address, o.pickup_address, o.created_at, o.delivery_boy_id, s.name as store_name, pc.full_name as customer_name, pc.phone as customer_phone
         FROM rweezy.grocery_orders o
         JOIN rweezy.grocery_stores s ON o.store_id = s.id
         LEFT JOIN rweezy.profiles pc ON o.customer_id = pc.id
         WHERE o.delivery_boy_id = $1 AND o.status IN ('completed'::rweezy.OrderStatus, 'delivered'::rweezy.OrderStatus, 'cancelled'::rweezy.OrderStatus) ORDER BY o.created_at DESC"
    )
    .bind(user_id)
    .fetch_all(pool.get_ref())
    .await;

    let mapped_grocery: Vec<serde_json::Value> = match grocery_rows_res {
        Ok(rows) => rows
            .iter()
            .map(|o| {
                use sqlx::Row;
                let id: Uuid = o.get("id");
                let status: OrderStatus = o.get("status");
                let total: rust_decimal::Decimal = o.get("total");
                let delivery_address: String = o.get("delivery_address");
                let pickup_address: Option<String> = o.get("pickup_address");
                let created_at: chrono::DateTime<chrono::Utc> = o.get("created_at");
                let delivery_boy_id: Option<Uuid> = o.get("delivery_boy_id");
                let store_name: String = o.get("store_name");
                let customer_name: Option<String> = o.get("customer_name");
                let customer_phone: Option<String> = o.get("customer_phone");

                let profiles =
                    serde_json::json!({ "full_name": customer_name, "phone": customer_phone });
                serde_json::json!({
                    "id": id,
                    "delivery_boy_id": delivery_boy_id,
                    "rider_id": delivery_boy_id,
                    "status": status as OrderStatus,
                    "total": total,
                    "delivery_address": delivery_address,
                    "pickup_address": pickup_address,
                    "created_at": created_at,
                    "grocery_stores": { "name": store_name },
                    "profiles": profiles,
                    "customer": profiles
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "food": mapped_food,
        "grocery": mapped_grocery
    }))
}
