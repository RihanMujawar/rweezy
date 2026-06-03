import express from "express";
import cookieParser from "cookie-parser";
import {
  findUserByEmail,
  signInWithPassword,
  signUpWithPassword,
  createConfirmedUserWithPassword,
  createSessionForEmail,
  revokeSession,
  serviceRoleRestRequest,
  updateUserPassword,
  resendSignupConfirmation,
  findUserEmailByPhone,
  restRequest
} from "../../shared/lib/supabase.mjs";
import {
  sendPasswordResetEmailOtp,
  verifyPasswordResetEmailOtp
} from "../../shared/lib/email-otp.mjs";
import {
  createPhoneVerificationToken,
  verifyPhoneVerificationToken
} from "../../shared/lib/phone-verification.mjs";
import {
  sendPhoneVerificationCode,
  verifyPhoneVerificationCode
} from "../../shared/lib/twilio.mjs";
import {
  HttpError,
  getBearerToken,
} from "../../shared/lib/http.mjs";
import {
  cleanText,
  normalizeIndianPhone
} from "../../shared/lib/request-utils.mjs";
import {
  authenticate,
  getRoles,
  buildSessionCookies,
  clearSessionCookies,
  normalizeAuthSession
} from "../../shared/lib/auth.mjs";
import { env } from "../../shared/lib/env.mjs";

const app = express();
app.use(express.json());
app.use(cookieParser());

// --- Helper ---
async function resolveEmailForPhone(phone) {
  let foundEmail = null;
  try {
    const rows = await serviceRoleRestRequest("/rpc/email_for_phone_login", {
      method: "POST",
      body: { lookup_phone: phone },
    });
    foundEmail = typeof rows === "string" ? rows : null;
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw error;
  }
  if (!foundEmail) {
    foundEmail = await findUserEmailByPhone(phone);
  }
  return foundEmail;
}

function normalizeAuthPurpose(value) {
    if (value === "register") return "register";
    if (value === "reset_password") return "reset_password";
    return "login";
}

async function resolveAccountForPasswordReset(email) {
    const user = await findUserByEmail(email);
    if (!user?.id) return null;
    const rows = await serviceRoleRestRequest("/profiles?select=phone&id=eq." + user.id + "&limit=1");
    const phone = rows?.[0]?.phone || user?.user_metadata?.phone || user?.phone;
    return { userId: user.id, email: user.email?.toLowerCase() ?? email, phone: phone || null };
}

function maskPhoneHint(phone) {
    const digits = String(phone ?? "").replace(/\D/g, "");
    if (digits.length < 4) return null;
    return `••••${digits.slice(-4)}`;
}

// --- Routes ---

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const { email, phone, password } = req.body;
    let identifier = { email: cleanText(email) };

    if (phone) {
      const resolvedEmail = await resolveEmailForPhone(normalizeIndianPhone(phone));
      if (!resolvedEmail) throw new HttpError(404, "No account found for this phone number");
      identifier = { email: resolvedEmail };
    }

    if (!identifier.email) throw new HttpError(400, "Email or phone number is required");

    const session = await signInWithPassword(identifier, password);
    const normalized = normalizeAuthSession(session);
    const roles = normalized.accessToken ? await getRoles(normalized.accessToken, normalized.user.id) : [];

    const cookies = buildSessionCookies(session);
    cookies.forEach(cookie => res.append("Set-Cookie", cookie));

    res.json({ user: normalized.user, roles });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", async (req, res, next) => {
  try {
    const accessToken = getBearerToken(req) || req.cookies["rweezy_access_token"];
    if (accessToken) await revokeSession(accessToken);
    const cookies = clearSessionCookies();
    cookies.forEach(c => res.append("Set-Cookie", c));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", authenticate, async (req, res, next) => {
  try {
    const roles = await getRoles(req.token, req.user.id);
    res.json({ user: req.user, roles });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/phone/send-otp", async (req, res, next) => {
    try {
        const phone = normalizeIndianPhone(req.body.phone);
        if (!phone || !/^\+\d{10,15}$/.test(phone)) throw new HttpError(400, "Enter a valid phone number");
        const purpose = normalizeAuthPurpose(cleanText(req.body.purpose));

        if (purpose === "login") {
            const email = await resolveEmailForPhone(phone);
            if (!email) throw new HttpError(404, "No account found");
        } else if (purpose === "reset_password") {
            const email = cleanText(req.body.email)?.toLowerCase();
            const account = await resolveAccountForPasswordReset(email);
            if (!account?.phone || account.phone !== phone) throw new HttpError(400, "Invalid email/phone combination");
        }
        await sendPhoneVerificationCode(phone);
        res.json({ ok: true, purpose, provider: "twilio", message: "Verification code sent" });
    } catch (error) { next(error); }
});

app.post("/api/auth/phone/verify-otp", async (req, res, next) => {
    try {
        const phone = normalizeIndianPhone(req.body.phone);
        const code = cleanText(req.body.code);
        const purpose = normalizeAuthPurpose(cleanText(req.body.purpose));
        await verifyPhoneVerificationCode(phone, code);

        if (purpose === "register" || purpose === "reset_password") {
            return res.json({ ok: true, phoneVerificationToken: createPhoneVerificationToken(phone) });
        }
        const email = await resolveEmailForPhone(phone);
        const session = await createSessionForEmail(email);
        const normalized = normalizeAuthSession(session);
        const roles = await getRoles(normalized.accessToken, normalized.user.id);
        const cookies = buildSessionCookies(session);
        cookies.forEach(c => res.append("Set-Cookie", c));
        res.json({ user: normalized.user, roles });
    } catch (error) { next(error); }
});

app.post("/api/auth/password-reset/request", async (req, res, next) => {
    try {
        const email = cleanText(req.body.email)?.toLowerCase();
        const account = await resolveAccountForPasswordReset(email);
        if (account) await sendPasswordResetEmailOtp(account.email);
        res.json({ ok: true, message: "Code sent", phoneHint: account?.phone ? maskPhoneHint(account.phone) : null });
    } catch (error) { next(error); }
});

app.post("/api/auth/password-reset/complete", async (req, res, next) => {
    try {
        const { email, email_otp, phone, phone_verification_token, password } = req.body;
        const account = await resolveAccountForPasswordReset(cleanText(email)?.toLowerCase());
        if (!account || account.phone !== normalizeIndianPhone(phone)) throw new HttpError(400, "Invalid reset details");
        verifyPhoneVerificationToken(phone_verification_token, normalizeIndianPhone(phone));
        verifyPasswordResetEmailOtp(account.email, email_otp);
        await updateUserPassword(account.userId, password);
        const session = await createSessionForEmail(account.email);
        const normalized = normalizeAuthSession(session);
        const roles = await getRoles(normalized.accessToken, normalized.user.id);
        const cookies = buildSessionCookies(session);
        cookies.forEach(c => res.append("Set-Cookie", c));
        res.json({ ok: true, user: normalized.user, roles, message: "Password updated" });
    } catch (error) { next(error); }
});

app.post("/api/auth/register", async (req, res, next) => {
    try {
        const { email, full_name, password, phone, phone_verification_token, requested_role } = req.body;
        verifyPhoneVerificationToken(phone_verification_token, normalizeIndianPhone(phone));
        // Simple registration logic (can be expanded to match monolith)
        const signup = await signUpWithPassword(email, password, full_name, { phone: normalizeIndianPhone(phone), requested_role });
        res.json(signup);
    } catch (error) { next(error); }
});

// Profile and Role Request routes
app.get("/api/profile", authenticate, async (req, res, next) => {
    try {
        const rows = await restRequest(req.token, "/profiles?id=eq." + req.user.id);
        res.json({ profile: rows?.[0] || null });
    } catch (error) { next(error); }
});

app.get("/api/role-requests", authenticate, async (req, res, next) => {
    try {
        const rows = await restRequest(req.token, "/role_requests?user_id=eq." + req.user.id + "&order=created_at.desc");
        res.json({ requests: rows ?? [] });
    } catch (error) { next(error); }
});

// Admin User Routes
app.get("/api/admin/users", authenticate, async (req, res, next) => {
    try {
        // Only admin check could be added here
        const profiles = await restRequest(req.token, "/profiles?limit=50");
        res.json({ profiles });
    } catch (error) { next(error); }
});

app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Auth Service running on port ${PORT}`));
