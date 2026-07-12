use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Copy, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "approle", rename_all = "snake_case")]
pub enum AppRole {
    Customer,
    Admin,
    HotelManager,
    GroceryManager,
    DeliveryBoy,
    Rider,
}

impl AppRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            AppRole::Customer => "customer",
            AppRole::Admin => "admin",
            AppRole::HotelManager => "hotel_manager",
            AppRole::GroceryManager => "grocery_manager",
            AppRole::DeliveryBoy => "delivery_boy",
            AppRole::Rider => "rider",
        }
    }
}

#[derive(Debug, Copy, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "orderstatus", rename_all = "snake_case")]
pub enum OrderStatus {
    Pending,
    Accepted,
    Preparing,
    Ready,
    PickedUp,
    Delivered,
    Cancelled,
}

impl OrderStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            OrderStatus::Pending => "pending",
            OrderStatus::Accepted => "accepted",
            OrderStatus::Preparing => "preparing",
            OrderStatus::Ready => "ready",
            OrderStatus::PickedUp => "picked_up",
            OrderStatus::Delivered => "delivered",
            OrderStatus::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Copy, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "ridestatus", rename_all = "snake_case")]
pub enum RideStatus {
    Requested,
    Accepted,
    Started,
    Completed,
    Cancelled,
}

impl RideStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            RideStatus::Requested => "requested",
            RideStatus::Accepted => "accepted",
            RideStatus::Started => "started",
            RideStatus::Completed => "completed",
            RideStatus::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Copy, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "servicekind", rename_all = "snake_case")]
pub enum ServiceKind {
    Ride,
    Package,
    Food,
    Grocery,
}

impl ServiceKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ServiceKind::Ride => "ride",
            ServiceKind::Package => "package",
            ServiceKind::Food => "food",
            ServiceKind::Grocery => "grocery",
        }
    }
}

#[derive(Debug, Copy, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "rolerequeststatus", rename_all = "snake_case")]
pub enum RoleRequestStatus {
    Pending,
    Approved,
    Rejected,
}

impl RoleRequestStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            RoleRequestStatus::Pending => "pending",
            RoleRequestStatus::Approved => "approved",
            RoleRequestStatus::Rejected => "rejected",
        }
    }
}

// REST API Payloads
#[derive(Deserialize, validator::Validate)]
pub struct PhoneOtpSendRequest {
    pub phone: String,
    pub purpose: String,
}

#[derive(Deserialize)]
pub struct PhoneOtpVerifyRequest {
    pub phone: String,
    pub code: String,
    pub purpose: String,
}

#[derive(Deserialize)]
pub struct PasswordResetRequest {
    pub phone: String,
}

#[derive(Deserialize)]
pub struct PasswordResetCompleteRequest {
    pub phone: String,
    pub phone_verification_token: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub phone: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub full_name: String,
    pub phone: String,
    pub password: String,
    pub phone_verification_token: String,
    pub requested_role: Option<String>,
    pub business_name: Option<String>,
    pub business_address: Option<String>,
    pub business_lat: Option<f64>,
    pub business_lng: Option<f64>,
    pub town_name: Option<String>,
    pub pincode: Option<String>,
    pub role_message: Option<String>,
}

#[derive(Deserialize)]
pub struct AddressRequest {
    pub label: Option<String>,
    pub address: String,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub is_default: Option<bool>,
}

#[derive(Deserialize)]
pub struct ProfileUpdateRequest {
    pub full_name: String,
    pub phone: String,
}

#[derive(Deserialize)]
pub struct RoleRequestPayload {
    pub requested_role: String,
    pub business_name: Option<String>,
    pub message: Option<String>,
}

#[derive(Deserialize)]
pub struct LiveLocationPayload {
    pub table: String,
    pub row_id: String,
    pub rider_lat: f64,
    pub rider_lng: f64,
}

#[derive(Deserialize)]
pub struct CartItem {
    pub id: String,
    pub name: String,
    pub price: f64,
    pub quantity: i32,
}

#[derive(Deserialize)]
pub struct FoodOrderRequest {
    pub restaurant_id: String,
    pub delivery_address: String,
    pub delivery_lat: f64,
    pub delivery_lng: f64,
    pub notes: Option<String>,
    pub payment_method: Option<String>,
    pub contactless_delivery: Option<bool>,
    pub items: Vec<CartItem>,
}

#[derive(Deserialize)]
pub struct GroceryOrderRequest {
    pub store_id: String,
    pub delivery_address: String,
    pub delivery_lat: f64,
    pub delivery_lng: f64,
    pub notes: Option<String>,
    pub payment_method: Option<String>,
    pub contactless_delivery: Option<bool>,
    pub items: Vec<CartItem>,
}

#[derive(Deserialize)]
pub struct RideBookingRequest {
    pub pickup_address: String,
    pub pickup_lat: f64,
    pub pickup_lng: f64,
    pub drop_address: String,
    pub drop_lat: f64,
    pub drop_lng: f64,
    pub fare_estimate: f64,
    pub vehicle_type: Option<String>,
    pub notes: Option<String>,
    pub payment_method: Option<String>,
}

#[derive(Deserialize)]
pub struct PackageBookingRequest {
    pub pickup_address: String,
    pub pickup_lat: f64,
    pub pickup_lng: f64,
    pub drop_address: String,
    pub drop_lat: f64,
    pub drop_lng: f64,
    pub package_size: Option<String>,
    pub receiver_name: String,
    pub receiver_phone: String,
    pub notes: Option<String>,
    pub fare_estimate: f64,
    pub payment_method: Option<String>,
}

#[derive(Deserialize)]
pub struct ReviewRequest {
    pub service_kind: String,
    pub service_id: String,
    pub rating: i32,
    pub comment: Option<String>,
}

// Db Entities
#[derive(FromRow, Serialize, Deserialize, Clone)]
pub struct DbUser {
    pub id: Uuid,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub password_hash: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize, Deserialize, Clone)]
pub struct DbProfile {
    pub id: Uuid,
    pub full_name: Option<String>,
    pub phone: Option<String>,
    pub avatar_url: Option<String>,
    pub town_name: Option<String>,
    pub pincode: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize, Deserialize, Clone)]
pub struct DbRestaurant {
    pub id: Uuid,
    pub manager_id: Option<Uuid>,
    pub name: String,
    pub description: Option<String>,
    pub address: Option<String>,
    pub image_url: Option<String>,
    pub is_open: bool,
    pub town_name: Option<String>,
    pub pincode: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize, Deserialize, Clone)]
pub struct DbMenuItem {
    pub id: Uuid,
    pub restaurant_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub price: Decimal,
    pub image_url: Option<String>,
    pub category: Option<String>,
    pub is_available: bool,
    pub is_veg: bool,
    pub prep_time_minutes: i32,
    pub is_special: bool,
    pub modifiers: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize, Deserialize, Clone)]
pub struct DbGroceryStore {
    pub id: Uuid,
    pub manager_id: Option<Uuid>,
    pub name: String,
    pub description: Option<String>,
    pub address: Option<String>,
    pub image_url: Option<String>,
    pub is_open: bool,
    pub town_name: Option<String>,
    pub pincode: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize, Deserialize, Clone)]
pub struct DbGroceryItem {
    pub id: Uuid,
    pub store_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub price: Decimal,
    pub image_url: Option<String>,
    pub category: Option<String>,
    pub is_available: bool,
    pub stock_quantity: i32,
    pub low_stock_threshold: i32,
    pub expiry_date: Option<DateTime<Utc>>,
    pub aisle_location: Option<String>,
    pub unit: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize, Deserialize, Clone)]
pub struct DbSavedAddress {
    pub id: Uuid,
    pub user_id: Uuid,
    pub label: String,
    pub address: String,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize, Deserialize, Clone)]
pub struct DbChatMessage {
    pub id: Uuid,
    pub service_kind: ServiceKind,
    pub service_id: Uuid,
    pub sender_id: Uuid,
    pub body: String,
    pub created_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize, Deserialize, Clone)]
pub struct DbRoleRequest {
    pub id: Uuid,
    pub user_id: Uuid,
    pub requested_role: AppRole,
    pub status: RoleRequestStatus,
    pub business_name: Option<String>,
    pub business_address: Option<String>,
    pub business_lat: Option<f64>,
    pub business_lng: Option<f64>,
    pub town_name: Option<String>,
    pub pincode: Option<String>,
    pub message: Option<String>,
    pub reviewed_by: Option<Uuid>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
