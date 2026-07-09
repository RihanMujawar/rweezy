# API Reference & Authentication Flow

This document details the REST API endpoints and transactional payload requirements for Rweezy's core authentication and verification modules.

---

## 1. Authentication Flow Overview

The platform uses a **phone-first, verification-backed** registration and login mechanism:

```
[Register Page] ────────► Send WhatsApp OTP ────────► Verify OTP ────► [JWT Token Session]
                        (POST /phone/send-otp)     (POST /verify-otp)  (POST /register)
```

---

## 2. Core Endpoints

### 1. Request WhatsApp OTP
Triggers an automated WhatsApp OTP containing a randomly generated 6-digit challenge code.

- **URL**: `POST /api/auth/phone/send-otp`
- **Request Body**:
  ```json
  {
    "phone": "+919876543210",
    "purpose": "register"
  }
  ```
  *(Supported purposes: `"register"`, `"login"`, `"reset_password"`)*
- **Success Response**:
  ```json
  {
    "ok": true,
    "purpose": "register",
    "provider": "whatsapp",
    "message": "Verification code sent to your WhatsApp"
  }
  ```

---

### 2. Verify WhatsApp OTP
Validates the 6-digit challenge code sent via WhatsApp.

- **URL**: `POST /api/auth/phone/verify-otp`
- **Request Body**:
  ```json
  {
    "phone": "+919876543210",
    "code": "123456",
    "purpose": "register"
  }
  ```
- **Success Response (for register / reset_password)**:
  ```json
  {
    "ok": true,
    "phoneVerificationToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
  *(Returns a temporary, signed signature token validating that the owner has successfully proven ownership of the specified phone number)*

- **Success Response (for login)**:
  ```json
  {
    "user": {
      "id": "769910d5-bb9f-4318-8f81-547e221ee598",
      "email": "customer@rweezy.test",
      "phone": "+919876543210"
    },
    "roles": ["customer"]
  }
  ```
  *(Directly logs the user in, injecting an `rweezy_access_token` cookie in the `Set-Cookie` header)*

---

### 3. Create Account
Completes the sign-up process. Requires a valid `phone_verification_token` from the verification step.

- **URL**: `POST /api/auth/register`
- **Body**:
  ```json
  {
    "full_name": "John Doe",
    "phone": "+919876543210",
    "password": "Password123",
    "phone_verification_token": "ey...",
    "requested_role": "customer",
    "town_name": "New Delhi",
    "pincode": "110001"
  }
  ```
- **Success Response**:
  ```json
  {
    "user": {
      "id": "76dfbc3d-5564-4bf8-b649-166299cb8788",
      "email": null,
      "phone": "+919876543210"
    },
    "roles": ["customer"],
    "authenticated": true
  }
  ```

---

### 4. Direct Login with Password
Authenticate directly using your phone number and password.

- **URL**: `POST /api/auth/login`
- **Body**:
  ```json
  {
    "phone": "+919876543210",
    "password": "Password123"
  }
  ```
- **Response**:
  ```json
  {
    "user": {
      "id": "76dfbc3d...",
      "email": null,
      "phone": "+919876543210"
    },
    "roles": ["customer"]
  }
  ```

---

### 5. Check Active Session (Me)
- **URL**: `GET /api/auth/me`
- **Response**:
  ```json
  {
    "user": {
      "id": "76dfbc3d...",
      "email": null,
      "phone": "+919876543210"
    },
    "roles": ["customer"]
  }
  ```

---

### 6. Password Reset Flow
1. **Request Reset OTP**: `POST /api/auth/password-reset/request` with body `{"phone": "+919876543210"}`.
2. **Verify OTP**: `POST /api/auth/phone/verify-otp` with body `{"phone": "+919876543210", "code": "123456", "purpose": "reset_password"}`. This returns a `phoneVerificationToken`.
3. **Commit New Password**: `POST /api/auth/password-reset/complete`
   - **Body**:
     ```json
     {
       "phone": "+919876543210",
       "phone_verification_token": "eyJ...",
       "password": "NewSecurePassword1"
     }
     ```
