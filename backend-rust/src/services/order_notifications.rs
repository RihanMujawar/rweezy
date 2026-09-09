use chrono::{DateTime, Utc};
use sqlx::PgPool;
use tracing::{error, info};
use uuid::Uuid;

use super::whatsapp::WhatsAppService;

fn short_id(id: &Uuid) -> String {
    id.to_string()[..8].to_uppercase()
}

fn format_eta_minutes(at: DateTime<Utc>) -> i64 {
    (at - Utc::now()).num_minutes().max(1)
}

async fn user_phone(pool: &PgPool, user_id: Uuid) -> Option<String> {
    sqlx::query_scalar::<_, Option<String>>(
        "SELECT COALESCE(u.phone, p.phone)
         FROM rweezy.users u
         LEFT JOIN rweezy.profiles p ON p.id = u.id
         WHERE u.id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .flatten()
    .map(|p| p.trim().to_string())
    .filter(|p| !p.is_empty())
}

async fn phones_by_roles(pool: &PgPool, roles: &[&str]) -> Vec<String> {
    let rows = sqlx::query_scalar::<_, Option<String>>(
        "SELECT DISTINCT COALESCE(u.phone, p.phone)
         FROM rweezy.user_roles ur
         JOIN rweezy.users u ON u.id = ur.user_id
         LEFT JOIN rweezy.profiles p ON p.id = u.id
         WHERE ur.role::text = ANY($1)
           AND COALESCE(u.phone, p.phone) IS NOT NULL",
    )
    .bind(roles)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    rows.into_iter()
        .flatten()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect()
}

async fn send_to_user(pool: &PgPool, whatsapp: &WhatsAppService, user_id: Uuid, text: &str) {
    let Some(phone) = user_phone(pool, user_id).await else {
        return;
    };
    send_to_phone(whatsapp, &phone, text).await;
}

async fn send_to_phone(whatsapp: &WhatsAppService, phone: &str, text: &str) {
    if let Err(e) = whatsapp.send_message(phone, text).await {
        error!("WhatsApp notification to {} failed: {}", phone, e);
    }
}

async fn broadcast_to_roles(pool: &PgPool, whatsapp: &WhatsAppService, roles: &[&str], text: &str) {
    for phone in phones_by_roles(pool, roles).await {
        send_to_phone(whatsapp, &phone, text).await;
    }
}

fn customer_status_message(kind: &str, status: &str) -> String {
    let label = match kind {
        "food" => "food order",
        "grocery" => "grocery order",
        "ride" => "ride",
        "package" => "package delivery",
        _ => "order",
    };

    match status {
        "pending" => format!("Rweezy: Your {} has been placed.", label),
        "accepted" => format!(
            "Rweezy: Your {} has been accepted{}.",
            label,
            if kind == "food" || kind == "grocery" {
                " by the store"
            } else {
                ""
            }
        ),
        "preparing" => format!("Rweezy: Your {} is being prepared.", label),
        "ready" => format!("Rweezy: Your {} is ready for pickup.", label),
        "picked_up" => {
            "Rweezy: Your order is on the way! Expected delivery in ~20 minutes.".to_string()
        }
        "started" => "Rweezy: Your ride has started. You'll arrive soon.".to_string(),
        "delivered" | "completed" => {
            format!("Rweezy: Your {} has been delivered. Thank you!", label)
        }
        "cancelled" => format!("Rweezy: Your {} has been cancelled.", label),
        other => format!("Rweezy: Your {} is now {}.", label, other.replace('_', " ")),
    }
}

async fn food_order_context(pool: &PgPool, order_id: Uuid) -> Option<(Uuid, String, Option<Uuid>)> {
    let row = sqlx::query(
        "SELECT o.customer_id, r.name as venue_name, r.manager_id
         FROM rweezy.food_orders o
         JOIN rweezy.restaurants r ON o.restaurant_id = r.id
         WHERE o.id = $1",
    )
    .bind(order_id)
    .fetch_optional(pool)
    .await
    .ok()??;

    use sqlx::Row;
    Some((
        row.get("customer_id"),
        row.get("venue_name"),
        row.get("manager_id"),
    ))
}

async fn grocery_order_context(
    pool: &PgPool,
    order_id: Uuid,
) -> Option<(Uuid, String, Option<Uuid>)> {
    let row = sqlx::query(
        "SELECT o.customer_id, s.name as venue_name, s.manager_id
         FROM rweezy.grocery_orders o
         JOIN rweezy.grocery_stores s ON o.store_id = s.id
         WHERE o.id = $1",
    )
    .bind(order_id)
    .fetch_optional(pool)
    .await
    .ok()??;

    use sqlx::Row;
    Some((
        row.get("customer_id"),
        row.get("venue_name"),
        row.get("manager_id"),
    ))
}

async fn notify_food_grocery_status(
    pool: &PgPool,
    whatsapp: &WhatsAppService,
    kind: &str,
    order_id: Uuid,
    status: &str,
) {
    let (customer_id, venue_name, manager_id) = match kind {
        "food" => food_order_context(pool, order_id).await,
        "grocery" => grocery_order_context(pool, order_id).await,
        _ => None,
    }
    .unwrap_or((Uuid::nil(), "Store".to_string(), None));

    if customer_id != Uuid::nil() {
        let msg = customer_status_message(kind, status);
        send_to_user(pool, whatsapp, customer_id, &msg).await;
    }

    if status == "preparing" || status == "ready" {
        let job_label = if kind == "food" {
            "food delivery"
        } else {
            "grocery delivery"
        };
        let text = format!(
            "Rweezy: New {} job available from {}! Order #{}. Open the app to accept.",
            job_label,
            venue_name,
            short_id(&order_id)
        );
        broadcast_to_roles(
            pool,
            whatsapp,
            &["delivery_boy", "all_in_one_partner"],
            &text,
        )
        .await;
    }

    if status == "cancelled" {
        if let Some(manager_id) = manager_id {
            let text = format!(
                "Rweezy: Order #{} ({}) was cancelled.",
                short_id(&order_id),
                venue_name
            );
            send_to_user(pool, whatsapp, manager_id, &text).await;
        }
    }
}

pub fn spawn_food_order_placed(
    pool: PgPool,
    whatsapp: WhatsAppService,
    order_id: Uuid,
    customer_id: Uuid,
    restaurant_id: Uuid,
    estimated_delivery_at: DateTime<Utc>,
) {
    tokio::spawn(async move {
        let venue_name: String =
            sqlx::query_scalar("SELECT name FROM rweezy.restaurants WHERE id = $1")
                .bind(restaurant_id)
                .fetch_optional(&pool)
                .await
                .ok()
                .flatten()
                .unwrap_or_else(|| "restaurant".to_string());

        let manager_id: Option<Uuid> =
            sqlx::query_scalar("SELECT manager_id FROM rweezy.restaurants WHERE id = $1")
                .bind(restaurant_id)
                .fetch_optional(&pool)
                .await
                .ok()
                .flatten();

        let eta = format_eta_minutes(estimated_delivery_at);
        let customer_msg = format!(
            "Rweezy: Your food order from {} has been placed! Estimated delivery in ~{} min. Order #{}.",
            venue_name,
            eta,
            short_id(&order_id)
        );
        send_to_user(&pool, &whatsapp, customer_id, &customer_msg).await;

        if let Some(manager_id) = manager_id {
            let manager_msg = format!(
                "Rweezy: New food order received at {}! Order #{}. Please accept and prepare.",
                venue_name,
                short_id(&order_id)
            );
            send_to_user(&pool, &whatsapp, manager_id, &manager_msg).await;
        }

        info!("WhatsApp notifications sent for food order {}", order_id);
    });
}

pub fn spawn_grocery_order_placed(
    pool: PgPool,
    whatsapp: WhatsAppService,
    order_id: Uuid,
    customer_id: Uuid,
    store_id: Uuid,
    estimated_delivery_at: DateTime<Utc>,
) {
    tokio::spawn(async move {
        let venue_name: String =
            sqlx::query_scalar("SELECT name FROM rweezy.grocery_stores WHERE id = $1")
                .bind(store_id)
                .fetch_optional(&pool)
                .await
                .ok()
                .flatten()
                .unwrap_or_else(|| "store".to_string());

        let manager_id: Option<Uuid> =
            sqlx::query_scalar("SELECT manager_id FROM rweezy.grocery_stores WHERE id = $1")
                .bind(store_id)
                .fetch_optional(&pool)
                .await
                .ok()
                .flatten();

        let eta = format_eta_minutes(estimated_delivery_at);
        let customer_msg = format!(
            "Rweezy: Your grocery order from {} has been placed! Estimated delivery in ~{} min. Order #{}.",
            venue_name,
            eta,
            short_id(&order_id)
        );
        send_to_user(&pool, &whatsapp, customer_id, &customer_msg).await;

        if let Some(manager_id) = manager_id {
            let manager_msg = format!(
                "Rweezy: New grocery order received at {}! Order #{}. Please accept and prepare.",
                venue_name,
                short_id(&order_id)
            );
            send_to_user(&pool, &whatsapp, manager_id, &manager_msg).await;
        }

        info!("WhatsApp notifications sent for grocery order {}", order_id);
    });
}

pub fn spawn_order_status(
    pool: PgPool,
    whatsapp: WhatsAppService,
    kind: String,
    order_id: Uuid,
    status: String,
) {
    tokio::spawn(async move {
        notify_food_grocery_status(&pool, &whatsapp, &kind, order_id, &status).await;
        info!(
            "WhatsApp status notification sent for {} order {} -> {}",
            kind, order_id, status
        );
    });
}

pub fn spawn_order_cancelled(
    pool: PgPool,
    whatsapp: WhatsAppService,
    kind: String,
    order_id: Uuid,
) {
    spawn_order_status(pool, whatsapp, kind, order_id, "cancelled".to_string());
}

pub fn spawn_delivery_accepted(
    pool: PgPool,
    whatsapp: WhatsAppService,
    kind: String,
    order_id: Uuid,
) {
    tokio::spawn(async move {
        let customer_id = match kind.as_str() {
            "food" => sqlx::query_scalar::<_, Uuid>(
                "SELECT customer_id FROM rweezy.food_orders WHERE id = $1",
            )
            .bind(order_id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten(),
            "grocery" => sqlx::query_scalar::<_, Uuid>(
                "SELECT customer_id FROM rweezy.grocery_orders WHERE id = $1",
            )
            .bind(order_id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten(),
            _ => None,
        };

        if let Some(customer_id) = customer_id {
            let label = if kind == "food" { "food" } else { "grocery" };
            let msg = format!(
                "Rweezy: A delivery partner has been assigned to your {} order #{}.",
                label,
                short_id(&order_id)
            );
            send_to_user(&pool, &whatsapp, customer_id, &msg).await;
        }
    });
}

pub fn spawn_ride_booked(
    pool: PgPool,
    whatsapp: WhatsAppService,
    ride_id: Uuid,
    customer_id: Uuid,
) {
    tokio::spawn(async move {
        let pickup: String =
            sqlx::query_scalar("SELECT pickup_address FROM rweezy.rides WHERE id = $1")
                .bind(ride_id)
                .fetch_optional(&pool)
                .await
                .ok()
                .flatten()
                .unwrap_or_else(|| "your location".to_string());

        let customer_msg = format!(
            "Rweezy: Your ride has been requested! We're finding a rider for you. Ride #{}.",
            short_id(&ride_id)
        );
        send_to_user(&pool, &whatsapp, customer_id, &customer_msg).await;

        let rider_msg = format!(
            "Rweezy: New ride request available! Pickup: {}. Ride #{}. Open the app to accept.",
            pickup,
            short_id(&ride_id)
        );
        broadcast_to_roles(
            &pool,
            &whatsapp,
            &["rider", "all_in_one_partner"],
            &rider_msg,
        )
        .await;
    });
}

pub fn spawn_package_booked(
    pool: PgPool,
    whatsapp: WhatsAppService,
    package_id: Uuid,
    customer_id: Uuid,
) {
    tokio::spawn(async move {
        let customer_msg = format!(
            "Rweezy: Your package delivery has been requested! Package #{}.",
            short_id(&package_id)
        );
        send_to_user(&pool, &whatsapp, customer_id, &customer_msg).await;

        let rider_msg = format!(
            "Rweezy: New package delivery job available! Package #{}. Open the app to accept.",
            short_id(&package_id)
        );
        broadcast_to_roles(
            &pool,
            &whatsapp,
            &["rider", "all_in_one_partner"],
            &rider_msg,
        )
        .await;
    });
}

pub fn spawn_ride_status(
    pool: PgPool,
    whatsapp: WhatsAppService,
    table: String,
    job_id: Uuid,
    status: String,
) {
    tokio::spawn(async move {
        let kind = if table == "package_deliveries" {
            "package"
        } else {
            "ride"
        };

        let customer_id = match table.as_str() {
            "rides" => {
                sqlx::query_scalar::<_, Uuid>("SELECT customer_id FROM rweezy.rides WHERE id = $1")
                    .bind(job_id)
                    .fetch_optional(&pool)
                    .await
                    .ok()
                    .flatten()
            }
            "package_deliveries" => sqlx::query_scalar::<_, Uuid>(
                "SELECT customer_id FROM rweezy.package_deliveries WHERE id = $1",
            )
            .bind(job_id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten(),
            _ => None,
        };

        if let Some(customer_id) = customer_id {
            let msg = customer_status_message(kind, &status);
            send_to_user(&pool, &whatsapp, customer_id, &msg).await;
        }

        if status == "accepted" {
            if let Some(customer_id) = customer_id {
                let msg = format!(
                    "Rweezy: A rider has been assigned to your {} #{}.",
                    kind,
                    short_id(&job_id)
                );
                send_to_user(&pool, &whatsapp, customer_id, &msg).await;
            }
        }
    });
}

pub fn spawn_role_request_created(
    pool: PgPool,
    whatsapp: WhatsAppService,
    user_id: Uuid,
    requested_role: &str,
) {
    let role_label = requested_role.replace('_', " ");
    tokio::spawn(async move {
        let applicant_name: String = sqlx::query_scalar(
            "SELECT COALESCE(full_name, 'Someone') FROM rweezy.profiles WHERE id = $1",
        )
        .bind(user_id)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "Someone".to_string());

        let text = format!(
            "Rweezy Admin: New role request from {} for {}. Review in the admin panel.",
            applicant_name, role_label
        );
        broadcast_to_roles(&pool, &whatsapp, &["admin"], &text).await;
    });
}

pub fn spawn_role_request_reviewed(
    pool: PgPool,
    whatsapp: WhatsAppService,
    user_id: Uuid,
    approved: bool,
    requested_role: &str,
) {
    let role_label = requested_role.replace('_', " ");
    tokio::spawn(async move {
        let text = if approved {
            format!(
                "Rweezy: Your request for the {} role has been approved. You can now use partner features in the app.",
                role_label
            )
        } else {
            format!(
                "Rweezy: Your request for the {} role was not approved at this time.",
                role_label
            )
        };
        send_to_user(&pool, &whatsapp, user_id, &text).await;
    });
}

pub fn spawn_chat_message(
    pool: PgPool,
    whatsapp: WhatsAppService,
    recipient_id: Uuid,
    sender_name: &str,
    preview: &str,
    service_kind: &str,
) {
    let sender_name = sender_name.to_string();
    let preview = preview.to_string();
    let service_kind = service_kind.to_string();
    tokio::spawn(async move {
        let kind_label = service_kind.replace('_', " ");
        let text = format!(
            "Rweezy Chat ({}): {} sent: {}",
            kind_label, sender_name, preview
        );
        send_to_user(&pool, &whatsapp, recipient_id, &text).await;
    });
}
