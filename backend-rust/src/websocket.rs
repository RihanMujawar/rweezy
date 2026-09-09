use actix_web::{get, web, Error, HttpRequest, HttpResponse};
use actix_ws::{Message, Session};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, error, info};

#[derive(Deserialize, Debug)]
struct ClientMessage {
    #[serde(rename = "type")]
    msg_type: String,
    payload: serde_json::Value,
}

#[derive(Serialize, Clone, Debug)]
pub struct ServerMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub payload: serde_json::Value,
}

pub struct WebSocketBroker {
    rooms: HashMap<String, Vec<(String, mpsc::UnboundedSender<String>)>>,
}

impl WebSocketBroker {
    pub fn new() -> Self {
        Self {
            rooms: HashMap::new(),
        }
    }

    pub fn join_room(
        &mut self,
        room_name: &str,
        conn_id: String,
        tx: mpsc::UnboundedSender<String>,
    ) {
        info!("Connection {} joined room {}", conn_id, room_name);
        self.rooms
            .entry(room_name.to_string())
            .or_insert_with(Vec::new)
            .push((conn_id, tx));
    }

    pub fn leave_room(&mut self, conn_id: &str) {
        for (room, conns) in self.rooms.iter_mut() {
            let before = conns.len();
            conns.retain(|(cid, _)| cid != conn_id);
            if conns.len() < before {
                debug!("Connection {} left room {}", conn_id, room);
            }
        }
        self.rooms.retain(|_, conns| !conns.is_empty());
    }

    pub fn broadcast(&self, room_name: &str, message: &str) {
        if let Some(conns) = self.rooms.get(room_name) {
            info!(
                "Broadcasting message to {} subscribers in room {}",
                conns.len(),
                room_name
            );
            for (_, tx) in conns {
                let _ = tx.send(message.to_string());
            }
        }
    }
}

pub type SharedBroker = Arc<Mutex<WebSocketBroker>>;

#[get("/ws")]
pub async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    broker: web::Data<SharedBroker>,
) -> Result<HttpResponse, Error> {
    let (res, session, stream) = actix_ws::handle(&req, stream)?;
    let conn_id = uuid::Uuid::new_v4().to_string();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    let broker_clone = broker.get_ref().clone();
    let conn_id_clone = conn_id.clone();

    let mut session_sender = session.clone();

    actix_rt::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if session_sender.text(msg).await.is_err() {
                break;
            }
        }
        let mut b = broker_clone.lock().await;
        b.leave_room(&conn_id_clone);
    });

    let conn_id_inner = conn_id.clone();
    let mut session_receiver = session;

    actix_rt::spawn(async move {
        let mut stream = stream;
        while let Some(Ok(msg)) = stream.next().await {
            match msg {
                Message::Text(text) => {
                    debug!("Received text from client {}: {}", conn_id_inner, text);
                    if let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) {
                        if client_msg.msg_type == "join_order" {
                            if let Some(order_id) =
                                client_msg.payload.get("orderId").and_then(|v| v.as_str())
                            {
                                let room_name = format!("order_{}", order_id);
                                let mut b = broker.lock().await;
                                b.join_room(&room_name, conn_id_inner.clone(), tx.clone());
                            }
                        } else if client_msg.msg_type == "join_chat" {
                            if let Some(service_id) =
                                client_msg.payload.get("serviceId").and_then(|v| v.as_str())
                            {
                                let room_name = format!("chat_{}", service_id);
                                let mut b = broker.lock().await;
                                b.join_room(&room_name, conn_id_inner.clone(), tx.clone());
                            }
                        }
                    }
                }
                Message::Ping(bytes) => {
                    let _ = session_receiver.pong(&bytes).await;
                }
                Message::Close(_) => {
                    break;
                }
                _ => {}
            }
        }
        info!("WebSocket connection closed: {}", conn_id_inner);
        let mut b = broker.lock().await;
        b.leave_room(&conn_id_inner);
    });

    Ok(res)
}
