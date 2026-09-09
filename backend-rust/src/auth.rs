use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use tracing::{debug, error};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub id: Uuid,
    pub exp: i64,
}

pub fn generate_token(user_id: Uuid, secret: &str) -> Result<String, jsonwebtoken::errors::Error> {
    let expiration = Utc::now()
        .checked_add_signed(Duration::days(7))
        .expect("valid timestamp")
        .timestamp();

    let claims = Claims {
        id: user_id,
        exp: expiration,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

pub fn verify_token(token: &str, secret: &str) -> Option<Uuid> {
    let mut validation = Validation::default();
    validation.validate_exp = true;

    match decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    ) {
        Ok(token_data) => Some(token_data.claims.id),
        Err(e) => {
            debug!("JWT verification failed: {}", e);
            None
        }
    }
}

pub fn hash_password(password: &str) -> String {
    bcrypt::hash(password, bcrypt::DEFAULT_COST).unwrap_or_else(|_| "".to_string())
}

pub fn compare_password(password: &str, hash: &str) -> bool {
    bcrypt::verify(password, hash).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_password_hashing_and_comparing() {
        let password = "super-secret-password-123";
        let hash = hash_password(password);
        assert!(!hash.is_empty(), "Password hash should not be empty");
        assert!(compare_password(password, &hash), "Passwords should match");
        assert!(
            !compare_password("wrong-password", &hash),
            "Incorrect passwords should not match"
        );
    }

    #[test]
    fn test_jwt_generation_and_verification() {
        let secret = "test-jwt-secret-key-must-be-long-enough-for-security";
        let user_id = Uuid::new_v4();

        let token_res = generate_token(user_id, secret);
        assert!(token_res.is_ok(), "Failed to generate token");
        let token = token_res.unwrap();

        let verified_id = verify_token(&token, secret);
        assert_eq!(
            verified_id,
            Some(user_id),
            "Verified user ID does not match generated user ID"
        );

        let verified_id_wrong_secret = verify_token(&token, "wrong-secret-key");
        assert_eq!(
            verified_id_wrong_secret, None,
            "Token should not verify with a wrong secret"
        );
    }
}
