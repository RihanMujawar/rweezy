use actix_web::{web, HttpRequest, HttpResponse, Responder};
use serde::Deserialize;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

use crate::handlers::auth::get_auth_user;
use crate::models::*;

#[derive(Deserialize)]
pub struct QueryCoords {
    pub lat: Option<f64>,
    pub lng: Option<f64>,
}

struct UserCatalogLocation {
    town_name: Option<String>,
    pincode: Option<String>,
    lat: Option<f64>,
    lng: Option<f64>,
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

async fn get_catalog_radius_km(pool: &PgPool) -> f64 {
    let row_res =
        sqlx::query("SELECT value FROM rweezy.platform_settings WHERE key = 'catalog_radius_km'")
            .fetch_optional(pool)
            .await;

    if let Ok(Some(row)) = row_res {
        use sqlx::Row;
        let val: serde_json::Value = row.get("value");
        val.as_f64().unwrap_or(25.0)
    } else {
        25.0
    }
}

async fn get_user_catalog_location(user_id: Uuid, pool: &PgPool) -> UserCatalogLocation {
    let profile_res = sqlx::query("SELECT town_name, pincode FROM rweezy.profiles WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await;

    let (town, pin) = match profile_res {
        Ok(Some(p)) => {
            use sqlx::Row;
            (p.get("town_name"), p.get("pincode"))
        }
        _ => (None, None),
    };

    let address_res = sqlx::query(
        "SELECT lat, lng FROM rweezy.saved_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC LIMIT 1"
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await;

    let (lat, lng) = match address_res {
        Ok(Some(a)) => {
            use sqlx::Row;
            (a.get("lat"), a.get("lng"))
        }
        _ => (None, None),
    };

    UserCatalogLocation {
        town_name: town,
        pincode: pin,
        lat,
        lng,
    }
}

fn is_location_match_by_text(
    user_town: Option<&str>,
    user_pin: Option<&str>,
    row_town: Option<&str>,
    row_pin: Option<&str>,
) -> bool {
    let u_pin = user_pin.unwrap_or("").trim().to_lowercase();
    let r_pin = row_pin.unwrap_or("").trim().to_lowercase();
    if !u_pin.is_empty() && !r_pin.is_empty() {
        return u_pin == r_pin;
    }

    let u_town = user_town.unwrap_or("").trim().to_lowercase();
    let r_town = row_town.unwrap_or("").trim().to_lowercase();
    if !u_town.is_empty() && !r_town.is_empty() {
        return u_town == r_town;
    }

    false
}

pub async fn list_restaurants(
    req: HttpRequest,
    coords: web::Query<QueryCoords>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let mut loc = get_user_catalog_location(user_id, pool.get_ref()).await;
    let radius_km = get_catalog_radius_km(pool.get_ref()).await;

    if let Some(lat) = coords.lat {
        loc.lat = Some(lat);
    }
    if let Some(lng) = coords.lng {
        loc.lng = Some(lng);
    }

    let all_restaurants = sqlx::query_as::<_, DbRestaurant>(
        "SELECT * FROM rweezy.restaurants ORDER BY created_at DESC",
    )
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    let mut filtered = Vec::new();
    for rest in all_restaurants {
        let mut matched = false;
        if let (Some(u_lat), Some(u_lng), Some(r_lat), Some(r_lng)) =
            (loc.lat, loc.lng, rest.lat, rest.lng)
        {
            if distance_km(u_lat, u_lng, r_lat, r_lng) <= radius_km {
                matched = true;
            }
        }
        if !matched
            && is_location_match_by_text(
                loc.town_name.as_deref(),
                loc.pincode.as_deref(),
                rest.town_name.as_deref(),
                rest.pincode.as_deref(),
            )
        {
            matched = true;
        }
        if matched {
            filtered.push(rest);
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "restaurants": filtered,
        "location": {
            "town_name": loc.town_name,
            "pincode": loc.pincode,
            "lat": loc.lat,
            "lng": loc.lng,
            "radius_km": radius_km
        }
    }))
}

pub async fn get_restaurant_details(
    path: web::Path<Uuid>,
    pool: web::Data<PgPool>,
) -> impl Responder {
    let id = path.into_inner();

    let restaurant =
        match sqlx::query_as::<_, DbRestaurant>("SELECT * FROM rweezy.restaurants WHERE id = $1")
            .bind(id)
            .fetch_optional(pool.get_ref())
            .await
        {
            Ok(Some(r)) => r,
            _ => {
                return HttpResponse::NotFound()
                    .json(serde_json::json!({ "error": "Restaurant not found" }))
            }
        };

    let items = sqlx::query_as::<_, DbMenuItem>(
        "SELECT * FROM rweezy.menu_items WHERE restaurant_id = $1 AND is_available = true ORDER BY category ASC"
    )
    .bind(id)
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "restaurant": restaurant,
        "items": items
    }))
}

pub async fn list_stores(
    req: HttpRequest,
    coords: web::Query<QueryCoords>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let mut loc = get_user_catalog_location(user_id, pool.get_ref()).await;
    let radius_km = get_catalog_radius_km(pool.get_ref()).await;

    if let Some(lat) = coords.lat {
        loc.lat = Some(lat);
    }
    if let Some(lng) = coords.lng {
        loc.lng = Some(lng);
    }

    let all_stores = sqlx::query_as::<_, DbGroceryStore>(
        "SELECT * FROM rweezy.grocery_stores ORDER BY created_at DESC",
    )
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    let mut filtered = Vec::new();
    for store in all_stores {
        let mut matched = false;
        if let (Some(u_lat), Some(u_lng), Some(s_lat), Some(s_lng)) =
            (loc.lat, loc.lng, store.lat, store.lng)
        {
            if distance_km(u_lat, u_lng, s_lat, s_lng) <= radius_km {
                matched = true;
            }
        }
        if !matched
            && is_location_match_by_text(
                loc.town_name.as_deref(),
                loc.pincode.as_deref(),
                store.town_name.as_deref(),
                store.pincode.as_deref(),
            )
        {
            matched = true;
        }
        if matched {
            filtered.push(store);
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "stores": filtered,
        "location": {
            "town_name": loc.town_name,
            "pincode": loc.pincode,
            "lat": loc.lat,
            "lng": loc.lng,
            "radius_km": radius_km
        }
    }))
}

pub async fn get_store_details(path: web::Path<Uuid>, pool: web::Data<PgPool>) -> impl Responder {
    let id = path.into_inner();

    let store = match sqlx::query_as::<_, DbGroceryStore>(
        "SELECT * FROM rweezy.grocery_stores WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool.get_ref())
    .await
    {
        Ok(Some(s)) => s,
        _ => {
            return HttpResponse::NotFound().json(serde_json::json!({ "error": "Store not found" }))
        }
    };

    let items = sqlx::query_as::<_, DbGroceryItem>(
        "SELECT * FROM rweezy.grocery_items WHERE store_id = $1 AND is_available = true ORDER BY category ASC"
    )
    .bind(id)
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "store": store,
        "items": items
    }))
}

pub async fn list_food_items(
    req: HttpRequest,
    coords: web::Query<QueryCoords>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let mut loc = get_user_catalog_location(user_id, pool.get_ref()).await;
    let radius_km = get_catalog_radius_km(pool.get_ref()).await;

    if let Some(lat) = coords.lat {
        loc.lat = Some(lat);
    }
    if let Some(lng) = coords.lng {
        loc.lng = Some(lng);
    }

    let all_restaurants =
        sqlx::query_as::<_, DbRestaurant>("SELECT * FROM rweezy.restaurants WHERE is_open = true")
            .fetch_all(pool.get_ref())
            .await
            .unwrap_or_default();

    let mut rest_ids = Vec::new();
    let mut rest_names = HashMap::new();

    for rest in all_restaurants {
        let mut matched = false;
        if let (Some(u_lat), Some(u_lng), Some(r_lat), Some(r_lng)) =
            (loc.lat, loc.lng, rest.lat, rest.lng)
        {
            if distance_km(u_lat, u_lng, r_lat, r_lng) <= radius_km {
                matched = true;
            }
        }
        if !matched
            && is_location_match_by_text(
                loc.town_name.as_deref(),
                loc.pincode.as_deref(),
                rest.town_name.as_deref(),
                rest.pincode.as_deref(),
            )
        {
            matched = true;
        }
        if matched {
            rest_ids.push(rest.id);
            rest_names.insert(rest.id, rest.name.clone());
        }
    }

    if rest_ids.is_empty() {
        return HttpResponse::Ok().json(serde_json::json!({ "items": [] }));
    }

    let items = sqlx::query_as::<_, DbMenuItem>(
        "SELECT * FROM rweezy.menu_items WHERE is_available = true AND restaurant_id = ANY($1) LIMIT 12"
    )
    .bind(&rest_ids)
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    let mapped_items: Vec<serde_json::Value> = items
        .iter()
        .map(|item| {
            let rest_name = rest_names
                .get(&item.restaurant_id)
                .cloned()
                .unwrap_or_default();
            serde_json::json!({
                "id": item.id,
                "restaurant_id": item.restaurant_id,
                "name": item.name,
                "description": item.description,
                "price": item.price,
                "image_url": item.image_url,
                "category": item.category,
                "is_available": item.is_available,
                "is_veg": item.is_veg,
                "prep_time_minutes": item.prep_time_minutes,
                "is_special": item.is_special,
                "modifiers": item.modifiers,
                "restaurants": {
                    "name": rest_name
                }
            })
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({ "items": mapped_items }))
}

#[derive(Deserialize)]
pub struct SearchQuery {
    pub query: String,
}

#[derive(serde::Serialize)]
pub struct LocationSearchResult {
    pub town: String,
    pub district: Option<String>,
    pub state: Option<String>,
    pub lat: f64,
    pub lng: f64,
    pub available: bool,
}

pub async fn search_locations(
    query: web::Query<SearchQuery>,
    pool: web::Data<PgPool>,
) -> impl Responder {
    let q = query.query.trim().to_lowercase();
    if q.len() < 2 {
        return HttpResponse::Ok().json(serde_json::Value::Array(vec![]));
    }

    let search_pattern = format!("%{}%", q);

    let rows_res = sqlx::query(
        "SELECT
            town_name,
            AVG(lat) as avg_lat,
            AVG(lng) as avg_lng
         FROM (
            SELECT town_name, lat, lng FROM rweezy.restaurants WHERE town_name IS NOT NULL
            UNION ALL
            SELECT town_name, lat, lng FROM rweezy.grocery_stores WHERE town_name IS NOT NULL
         ) combined
         WHERE LOWER(town_name) LIKE $1
         GROUP BY town_name
         ORDER BY town_name ASC",
    )
    .bind(search_pattern)
    .fetch_all(pool.get_ref())
    .await;

    match rows_res {
        Ok(rows) => {
            use sqlx::Row;
            let mut results = Vec::new();
            for r in rows {
                let town: String = r.get("town_name");
                let lat: Option<f64> = r.get("avg_lat");
                let lng: Option<f64> = r.get("avg_lng");
                results.push(LocationSearchResult {
                    town,
                    district: None,
                    state: None,
                    lat: lat.unwrap_or(0.0),
                    lng: lng.unwrap_or(0.0),
                    available: true,
                });
            }
            HttpResponse::Ok().json(results)
        }
        Err(e) => {
            tracing::error!("Failed to search locations: {}", e);
            HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": "Database error" }))
        }
    }
}

pub async fn list_grocery_items(
    req: HttpRequest,
    coords: web::Query<QueryCoords>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let mut loc = get_user_catalog_location(user_id, pool.get_ref()).await;
    let radius_km = get_catalog_radius_km(pool.get_ref()).await;

    if let Some(lat) = coords.lat {
        loc.lat = Some(lat);
    }
    if let Some(lng) = coords.lng {
        loc.lng = Some(lng);
    }

    let all_stores = sqlx::query_as::<_, DbGroceryStore>(
        "SELECT * FROM rweezy.grocery_stores WHERE is_open = true",
    )
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    let mut store_ids = Vec::new();
    let mut store_names = HashMap::new();

    for store in all_stores {
        let mut matched = false;
        if let (Some(u_lat), Some(u_lng), Some(s_lat), Some(s_lng)) =
            (loc.lat, loc.lng, store.lat, store.lng)
        {
            if distance_km(u_lat, u_lng, s_lat, s_lng) <= radius_km {
                matched = true;
            }
        }
        if !matched
            && is_location_match_by_text(
                loc.town_name.as_deref(),
                loc.pincode.as_deref(),
                store.town_name.as_deref(),
                store.pincode.as_deref(),
            )
        {
            matched = true;
        }
        if matched {
            store_ids.push(store.id);
            store_names.insert(store.id, store.name.clone());
        }
    }

    if store_ids.is_empty() {
        return HttpResponse::Ok().json(serde_json::json!({ "items": [] }));
    }

    let items = sqlx::query_as::<_, DbGroceryItem>(
        "SELECT * FROM rweezy.grocery_items WHERE is_available = true AND store_id = ANY($1) LIMIT 12"
    )
    .bind(&store_ids)
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    let mapped_items: Vec<serde_json::Value> = items
        .iter()
        .map(|item| {
            let store_name = store_names.get(&item.store_id).cloned().unwrap_or_default();
            serde_json::json!({
                "id": item.id,
                "store_id": item.store_id,
                "name": item.name,
                "description": item.description,
                "price": item.price,
                "image_url": item.image_url,
                "category": item.category,
                "is_available": item.is_available,
                "stock_quantity": item.stock_quantity,
                "low_stock_threshold": item.low_stock_threshold,
                "expiry_date": item.expiry_date,
                "aisle_location": item.aisle_location,
                "unit": item.unit,
                "grocery_stores": {
                    "name": store_name
                }
            })
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({ "items": mapped_items }))
}
