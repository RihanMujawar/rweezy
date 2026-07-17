#![allow(
    clippy::all,
    unused_imports,
    dead_code,
    unused_variables,
    unused_assignments
)]

use actix_cors::Cors;
use actix_web::{middleware, web, App, HttpServer};
use sqlx::postgres::PgPoolOptions;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::info;
use tracing_subscriber::EnvFilter;

mod auth;
mod config;
mod models;
mod services {
    pub mod fcm;
    pub mod whatsapp;
}
mod websocket;
mod handlers {
    pub mod admin;
    pub mod auth;
    pub mod catalog;
    pub mod chat;
    pub mod orders;
    pub mod profile;
    pub mod rides;
}

use config::Config;
use services::fcm::FcmService;
use services::whatsapp::WhatsAppService;
use websocket::{ws_handler, WebSocketBroker};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    info!("Starting Rweezy Rust Backend...");

    let config = Config::from_env();

    info!(
        "Connecting to PostgreSQL database at {}...",
        &config.database_url[..std::cmp::min(30, config.database_url.len())]
    );
    let pool = PgPoolOptions::new()
        .max_connections(config.database_max_connections)
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to database");

    info!("Running database migrations...");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Failed to run database migrations");
    info!("Database migrations executed successfully.");

    let whatsapp_service = WhatsAppService::new(
        config.whatsapp_sidecar_url.clone(),
        config.internal_token.clone(),
    );

    let fcm_service = FcmService::new(
        config.google_application_credentials.clone(),
        config.fcm_project_id.clone(),
    );

    let broker = Arc::new(Mutex::new(WebSocketBroker::new()));
    let otp_store: crate::handlers::auth::OtpStore = Arc::new(Mutex::new(HashMap::new()));

    let port = config.port;
    let host = config.host.clone();

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .supports_credentials()
            .max_age(3600);

        App::new()
            .wrap(middleware::Logger::default())
            .wrap(cors)
            .app_data(web::Data::new(pool.clone()))
            .app_data(web::Data::new(config.clone()))
            .app_data(web::Data::new(whatsapp_service.clone()))
            .app_data(web::Data::new(fcm_service.clone()))
            .app_data(web::Data::new(broker.clone()))
            .app_data(web::Data::new(otp_store.clone()))
            .service(ws_handler)
            .service(
                web::scope("/api")
                    .route("/health", web::get().to(handlers::auth::health))
                    .route("/admin/health", web::get().to(handlers::auth::admin_health))
                    .route(
                        "/auth/phone/send-otp",
                        web::post().to(handlers::auth::send_otp),
                    )
                    .route(
                        "/auth/phone/verify-otp",
                        web::post().to(handlers::auth::verify_otp),
                    )
                    .route(
                        "/auth/password-reset/request",
                        web::post().to(handlers::auth::password_reset_request),
                    )
                    .route(
                        "/auth/password-reset/complete",
                        web::post().to(handlers::auth::password_reset_complete),
                    )
                    .route("/auth/login", web::post().to(handlers::auth::login))
                    .route("/auth/register", web::post().to(handlers::auth::register))
                    .route("/auth/logout", web::post().to(handlers::auth::logout))
                    .route("/auth/me", web::get().to(handlers::auth::me))
                    .route(
                        "/notifications/token",
                        web::post().to(handlers::auth::register_push_token),
                    )
                    .route(
                        "/map/route",
                        web::get().to(handlers::rides::get_map_route),
                    )
                    .route("/profile", web::get().to(handlers::profile::get_profile))
                    .route("/profile", web::put().to(handlers::profile::update_profile))
                    .route(
                        "/profile/addresses",
                        web::get().to(handlers::profile::get_addresses),
                    )
                    .route(
                        "/profile/addresses",
                        web::post().to(handlers::profile::create_address),
                    )
                    .route(
                        "/profile/addresses/{id}",
                        web::delete().to(handlers::profile::delete_address),
                    )
                    .route(
                        "/role-requests",
                        web::get().to(handlers::profile::get_role_requests),
                    )
                    .route(
                        "/role-requests",
                        web::post().to(handlers::profile::create_role_request),
                    )
                    .route(
                        "/live-location",
                        web::post().to(handlers::profile::update_live_location),
                    )
                    .route(
                        "/catalog/search-locations",
                        web::get().to(handlers::catalog::search_locations),
                    )
                    .route(
                        "/catalog/restaurants",
                        web::get().to(handlers::catalog::list_restaurants),
                    )
                    .route(
                        "/catalog/restaurants/{id}",
                        web::get().to(handlers::catalog::get_restaurant_details),
                    )
                    .route(
                        "/catalog/stores",
                        web::get().to(handlers::catalog::list_stores),
                    )
                    .route(
                        "/catalog/stores/{id}",
                        web::get().to(handlers::catalog::get_store_details),
                    )
                    .route(
                        "/catalog/items/food",
                        web::get().to(handlers::catalog::list_food_items),
                    )
                    .route(
                        "/catalog/items/grocery",
                        web::get().to(handlers::catalog::list_grocery_items),
                    )
                    .route(
                        "/orders/food",
                        web::post().to(handlers::orders::checkout_food),
                    )
                    .route(
                        "/orders/grocery",
                        web::post().to(handlers::orders::checkout_grocery),
                    )
                    .route("/orders/me", web::get().to(handlers::orders::get_my_orders))
                    .route(
                        "/orders/{kind}/{id}/cancel",
                        web::post().to(handlers::orders::cancel_order),
                    )
                    .route(
                        "/track/{kind}/{id}",
                        web::get().to(handlers::orders::track_order),
                    )
                    .route(
                        "/delivery/available",
                        web::get().to(handlers::orders::get_available_deliveries),
                    )
                    .route(
                        "/delivery/active",
                        web::get().to(handlers::orders::get_active_deliveries),
                    )
                    .route(
                        "/delivery/{kind}/{id}/accept",
                        web::post().to(handlers::orders::accept_delivery),
                    )
                    .route(
                        "/delivery/{kind}/{id}/advance",
                        web::post().to(handlers::orders::advance_delivery),
                    )
                    .route(
                        "/delivery/earnings",
                        web::get().to(handlers::orders::get_delivery_earnings),
                    )
                    .route(
                        "/delivery/history",
                        web::get().to(handlers::orders::get_delivery_history),
                    )
                    .route("/reviews", web::post().to(handlers::orders::submit_review))
                    .route(
                        "/reviews/{kind}/{id}",
                        web::get().to(handlers::orders::get_reviews),
                    )
                    .route("/rides", web::post().to(handlers::rides::book_ride))
                    .route("/packages", web::post().to(handlers::rides::book_package))
                    .route(
                        "/rider/jobs",
                        web::get().to(handlers::rides::get_rider_jobs),
                    )
                    .route(
                        "/rider/active",
                        web::get().to(handlers::rides::get_rider_active),
                    )
                    .route(
                        "/rider/rides/{id}/accept",
                        web::post().to(handlers::rides::accept_ride_job),
                    )
                    .route(
                        "/rider/packages/{id}/accept",
                        web::post().to(handlers::rides::accept_package_job),
                    )
                    .route(
                        "/rider/{kind}/{id}/advance",
                        web::post().to(handlers::rides::advance_rider_job),
                    )
                    .route(
                        "/rider/{kind}/{id}/cancel",
                        web::post().to(handlers::rides::cancel_rider_job),
                    )
                    .route(
                        "/rider/history",
                        web::get().to(handlers::rides::get_rider_history),
                    )
                    .route(
                        "/rider/earnings",
                        web::get().to(handlers::rides::get_rider_earnings),
                    )
                    .route(
                        "/chat/{kind}/{id}",
                        web::get().to(handlers::chat::get_chat_history),
                    )
                    .route(
                        "/chat/{kind}/{id}",
                        web::post().to(handlers::chat::post_chat_message),
                    )
                    .route(
                        "/admin/stats",
                        web::get().to(handlers::admin::get_admin_stats),
                    )
                    .route(
                        "/admin/analytics",
                        web::get().to(handlers::admin::get_admin_analytics),
                    )
                    .route(
                        "/admin/restaurants",
                        web::get().to(handlers::admin::admin_list_restaurants),
                    )
                    .route(
                        "/admin/restaurants",
                        web::post().to(handlers::admin::admin_create_restaurant),
                    )
                    .route(
                        "/admin/restaurants/{id}",
                        web::put().to(handlers::admin::admin_update_restaurant),
                    )
                    .route(
                        "/admin/restaurants/{id}",
                        web::delete().to(handlers::admin::admin_delete_restaurant),
                    )
                    .route(
                        "/admin/restaurants/{id}/toggle",
                        web::post().to(handlers::admin::admin_toggle_restaurant),
                    )
                    .route(
                        "/admin/restaurants/{id}/grant-manager",
                        web::post().to(handlers::admin::admin_grant_restaurant_manager),
                    )
                    .route(
                        "/admin/restaurants/{id}/revoke-manager",
                        web::post().to(handlers::admin::admin_revoke_restaurant_manager),
                    )
                    .route(
                        "/admin/stores",
                        web::get().to(handlers::admin::admin_list_stores),
                    )
                    .route(
                        "/admin/stores",
                        web::post().to(handlers::admin::admin_create_store),
                    )
                    .route(
                        "/admin/stores/{id}",
                        web::put().to(handlers::admin::admin_update_store),
                    )
                    .route(
                        "/admin/stores/{id}",
                        web::delete().to(handlers::admin::admin_delete_store),
                    )
                    .route(
                        "/admin/users",
                        web::get().to(handlers::admin::admin_list_users),
                    )
                    .route(
                        "/admin/users/{userId}/roles/toggle",
                        web::post().to(handlers::admin::admin_toggle_user_role),
                    )
                    .route(
                        "/admin/role-requests/{id}/review",
                        web::post().to(handlers::admin::admin_review_role_request),
                    )
                    .route(
                        "/admin/commissions",
                        web::get().to(handlers::admin::get_admin_commissions),
                    )
                    .route(
                        "/admin/commissions",
                        web::put().to(handlers::admin::save_admin_commissions),
                    )
                    .route(
                        "/admin/catalog-settings",
                        web::get().to(handlers::admin::get_admin_catalog_settings),
                    )
                    .route(
                        "/admin/catalog-settings",
                        web::put().to(handlers::admin::save_admin_catalog_settings),
                    )
                    .route(
                        "/admin/notifications/test",
                        web::post().to(handlers::admin::admin_test_notification),
                    )
                    .route(
                        "/hotel/dashboard",
                        web::get().to(handlers::admin::get_hotel_dashboard),
                    )
                    .route(
                        "/hotel/restaurant",
                        web::put().to(handlers::admin::save_hotel_restaurant),
                    )
                    .route(
                        "/hotel/orders",
                        web::get().to(handlers::admin::get_hotel_orders),
                    )
                    .route(
                        "/hotel/orders/{id}/advance",
                        web::post().to(handlers::admin::advance_hotel_order),
                    )
                    .route(
                        "/hotel/orders/{id}/reject",
                        web::post().to(handlers::admin::reject_hotel_order),
                    )
                    .route(
                        "/hotel/history",
                        web::get().to(handlers::admin::get_hotel_history),
                    )
                    .route(
                        "/hotel/menu",
                        web::get().to(handlers::admin::get_hotel_menu),
                    )
                    .route(
                        "/hotel/menu",
                        web::post().to(handlers::admin::create_hotel_menu_item),
                    )
                    .route(
                        "/hotel/menu/{id}",
                        web::put().to(handlers::admin::update_hotel_menu_item),
                    )
                    .route(
                        "/hotel/menu/{id}",
                        web::delete().to(handlers::admin::delete_hotel_menu_item),
                    )
                    .route(
                        "/hotel/menu/{id}/toggle",
                        web::post().to(handlers::admin::toggle_hotel_menu_item),
                    )
                    .route(
                        "/grocery/dashboard",
                        web::get().to(handlers::admin::get_grocery_dashboard),
                    )
                    .route(
                        "/grocery/store",
                        web::put().to(handlers::admin::save_grocery_store),
                    )
                    .route(
                        "/grocery/alerts",
                        web::get().to(handlers::admin::get_grocery_alerts),
                    )
                    .route(
                        "/grocery/items",
                        web::get().to(handlers::admin::get_grocery_items),
                    )
                    .route(
                        "/grocery/items",
                        web::post().to(handlers::admin::create_grocery_item),
                    )
                    .route(
                        "/grocery/items/{id}",
                        web::put().to(handlers::admin::update_grocery_item),
                    )
                    .route(
                        "/grocery/items/{id}",
                        web::delete().to(handlers::admin::delete_grocery_item),
                    )
                    .route(
                        "/grocery/items/{id}/toggle",
                        web::post().to(handlers::admin::toggle_grocery_item),
                    )
                    .route(
                        "/grocery/orders",
                        web::get().to(handlers::admin::get_grocery_orders),
                    )
                    .route(
                        "/grocery/orders/{id}/advance",
                        web::post().to(handlers::admin::advance_grocery_order),
                    )
                    .route(
                        "/grocery/history",
                        web::get().to(handlers::admin::get_grocery_history),
                    ),
            )
    })
    .bind((host.as_str(), port))?
    .run()
    .await
}
