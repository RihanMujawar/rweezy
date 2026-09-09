use actix_web::{web, HttpRequest, HttpResponse, Responder};
use sqlx::PgPool;
use std::collections::HashMap;
use tracing::error;
use uuid::Uuid;

use crate::handlers::auth::get_auth_user;
use crate::models::*;
use crate::services::fcm::FcmService;
use crate::services::order_notifications;
use crate::services::whatsapp::WhatsAppService;
use crate::websocket::SharedBroker;

async fn get_chat_participants(
    kind: &str,
    service_id: &Uuid,
    pool: &PgPool,
) -> Result<(Uuid, Option<Uuid>), String> {
    match kind {
        "food" => {
            let row_res = sqlx::query(
                "SELECT o.customer_id, COALESCE(o.delivery_boy_id, r.manager_id) as partner_id
                 FROM rweezy.food_orders o
                 JOIN rweezy.restaurants r ON o.restaurant_id = r.id
                 WHERE o.id = $1",
            )
            .bind(service_id)
            .fetch_optional(pool)
            .await;

            if let Ok(Some(r)) = row_res {
                use sqlx::Row;
                Ok((r.get("customer_id"), r.get("partner_id")))
            } else {
                Err("Order not found".to_string())
            }
        }
        "grocery" => {
            let row_res = sqlx::query(
                "SELECT o.customer_id, COALESCE(o.delivery_boy_id, s.manager_id) as partner_id
                 FROM rweezy.grocery_orders o
                 JOIN rweezy.grocery_stores s ON o.store_id = s.id
                 WHERE o.id = $1",
            )
            .bind(service_id)
            .fetch_optional(pool)
            .await;

            if let Ok(Some(r)) = row_res {
                use sqlx::Row;
                Ok((r.get("customer_id"), r.get("partner_id")))
            } else {
                Err("Order not found".to_string())
            }
        }
        "ride" => {
            let row_res =
                sqlx::query("SELECT customer_id, rider_id FROM rweezy.rides WHERE id = $1")
                    .bind(service_id)
                    .fetch_optional(pool)
                    .await;

            if let Ok(Some(r)) = row_res {
                use sqlx::Row;
                Ok((r.get("customer_id"), r.get("rider_id")))
            } else {
                Err("Ride not found".to_string())
            }
        }
        "package" => {
            let row_res = sqlx::query(
                "SELECT customer_id, rider_id FROM rweezy.package_deliveries WHERE id = $1",
            )
            .bind(service_id)
            .fetch_optional(pool)
            .await;

            if let Ok(Some(r)) = row_res {
                use sqlx::Row;
                Ok((r.get("customer_id"), r.get("rider_id")))
            } else {
                Err("Package not found".to_string())
            }
        }
        _ => Err("Invalid service kind".to_string()),
    }
}

pub async fn get_chat_history(
    req: HttpRequest,
    path: web::Path<(String, Uuid)>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let (kind, service_id) = path.into_inner();
    let service_kind = match kind.as_str() {
        "ride" => ServiceKind::Ride,
        "package" => ServiceKind::Package,
        "food" => ServiceKind::Food,
        "grocery" => ServiceKind::Grocery,
        _ => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({ "error": "Invalid chat kind" }))
        }
    };

    let (customer_id, partner_id) =
        match get_chat_participants(&kind, &service_id, pool.get_ref()).await {
            Ok(parts) => parts,
            Err(err) => return HttpResponse::NotFound().json(serde_json::json!({ "error": err })),
        };

    let is_admin = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM rweezy.user_roles WHERE user_id = $1 AND role = 'admin'::rweezy.AppRole)"
    )
    .bind(user_id)
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or(false);

    if user_id != customer_id && partner_id != Some(user_id) && !is_admin {
        return HttpResponse::Forbidden()
            .json(serde_json::json!({ "error": "You do not have access to this chat" }));
    }

    let messages = sqlx::query_as::<_, DbChatMessage>(
        "SELECT * FROM rweezy.chat_messages WHERE service_kind = $1::rweezy.ServiceKind AND service_id = $2 ORDER BY created_at ASC LIMIT 100"
    )
    .bind(service_kind as ServiceKind)
    .bind(service_id)
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "messages": messages,
        "participant": {
            "customer_id": customer_id,
            "partner_id": partner_id
        }
    }))
}

pub async fn post_chat_message(
    req: HttpRequest,
    path: web::Path<(String, Uuid)>,
    payload: web::Json<serde_json::Value>,
    pool: web::Data<PgPool>,
    config: web::Data<crate::config::Config>,
    broker: web::Data<SharedBroker>,
    fcm_service: web::Data<FcmService>,
    whatsapp: web::Data<WhatsAppService>,
) -> impl Responder {
    let user_id = match get_auth_user(&req, &config.jwt_secret) {
        Ok(uid) => uid,
        Err(e) => return HttpResponse::from_error(e),
    };

    let (kind, service_id) = path.into_inner();
    let service_kind = match kind.as_str() {
        "ride" => ServiceKind::Ride,
        "package" => ServiceKind::Package,
        "food" => ServiceKind::Food,
        "grocery" => ServiceKind::Grocery,
        _ => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({ "error": "Invalid chat kind" }))
        }
    };

    let body = match payload.get("message").and_then(|v| v.as_str()) {
        Some(b) => b.trim(),
        None => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({ "error": "Message is required" }))
        }
    };

    if body.is_empty() {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "Message body is empty" }));
    }

    let (customer_id, partner_id) =
        match get_chat_participants(&kind, &service_id, pool.get_ref()).await {
            Ok(parts) => parts,
            Err(err) => return HttpResponse::NotFound().json(serde_json::json!({ "error": err })),
        };

    if user_id != customer_id && partner_id != Some(user_id) {
        return HttpResponse::Forbidden()
            .json(serde_json::json!({ "error": "You do not have access to this chat" }));
    }

    let msg_id = Uuid::new_v4();

    let saved_msg = match sqlx::query_as::<_, DbChatMessage>(
        "INSERT INTO rweezy.chat_messages (id, service_kind, service_id, sender_id, body, created_at)
         VALUES ($1, $2::rweezy.ServiceKind, $3, $4, $5, now())
         RETURNING *"
    )
    .bind(msg_id)
    .bind(service_kind as ServiceKind)
    .bind(service_id)
    .bind(user_id)
    .bind(body)
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(m) => m,
        Err(e) => {
            error!("Failed to save chat message: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Database error saving message" }));
        }
    };

    let ws_msg = serde_json::json!({
        "type": "chat_message",
        "payload": saved_msg
    })
    .to_string();

    let b = broker.lock().await;
    b.broadcast(&format!("chat_{}", service_id), &ws_msg);

    let recipient_id = if user_id == customer_id {
        partner_id
    } else {
        Some(customer_id)
    };
    if let Some(rec_uid) = recipient_id {
        let tokens_res = sqlx::query(
            "SELECT token FROM rweezy.user_push_tokens WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 5"
        )
        .bind(rec_uid)
        .fetch_all(pool.get_ref())
        .await;

        let tokens: Vec<String> = match tokens_res {
            Ok(rows) => rows
                .iter()
                .map(|row| {
                    use sqlx::Row;
                    row.get::<String, _>("token")
                })
                .collect(),
            _ => Vec::new(),
        };

        let sender_name = sqlx::query_scalar::<_, Option<String>>(
            "SELECT full_name FROM rweezy.profiles WHERE id = $1",
        )
        .bind(user_id)
        .fetch_one(pool.get_ref())
        .await
        .unwrap_or_default()
        .unwrap_or_else(|| "Someone".to_string());

        let preview = if body.len() > 120 {
            format!("{}...", &body[..117])
        } else {
            body.to_string()
        };
        order_notifications::spawn_chat_message(
            pool.get_ref().clone(),
            whatsapp.get_ref().clone(),
            rec_uid,
            &sender_name,
            &preview,
            &kind,
        );
        let title = format!("{} · Chat", sender_name);

        let mut data = HashMap::new();
        data.insert("type".to_string(), "chat".to_string());
        data.insert("service_kind".to_string(), kind);
        data.insert("service_id".to_string(), service_id.to_string());

        for t in tokens {
            let fcm = fcm_service.get_ref().clone();
            let t_clone = t.clone();
            let title_clone = title.clone();
            let preview_clone = preview.clone();
            let data_clone = data.clone();
            tokio::spawn(async move {
                let _ = fcm
                    .send_notification(&t_clone, &title_clone, &preview_clone, Some(data_clone))
                    .await;
            });
        }
    }

    HttpResponse::Ok().json(serde_json::json!({ "message": saved_msg }))
}
