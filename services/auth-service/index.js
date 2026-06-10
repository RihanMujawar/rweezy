import express from "express";
import cookieParser from "cookie-parser";
import { prisma } from "../../shared/lib/prisma.mjs";
import {
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  buildSessionCookies,
  clearSessionCookies,
  authenticate,
  getRoles
} from "../../shared/lib/auth.mjs";
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
import { env } from "../../shared/lib/env.mjs";

const app = express();
app.use(express.json());
app.use(cookieParser());

// --- Helper ---
async function resolveUserByPhone(phone) {
  return prisma.user.findFirst({
    where: {
      profile: {
        phone: phone
      }
    },
    include: { profile: true }
  });
}

function normalizeAuthPurpose(value) {
    if (value === "register") return "register";
    if (value === "reset_password") return "reset_password";
    return "login";
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
    let user;

    if (phone) {
      user = await resolveUserByPhone(normalizeIndianPhone(phone));
      if (!user) throw new HttpError(404, "No account found for this phone number");
    } else if (email) {
      user = await prisma.user.findUnique({
        where: { email: cleanText(email).toLowerCase() },
        include: { profile: true }
      });
    }

    if (!user) throw new HttpError(400, "User not found");

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) throw new HttpError(401, "Invalid password");

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    const roles = await getRoles(user.id);

    const cookies = buildSessionCookies(accessToken, refreshToken);
    cookies.forEach(cookie => res.append("Set-Cookie", cookie));

    const { passwordHash: _, ...safeUser } = user;
    res.json({ user: safeUser, roles });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", async (req, res, next) => {
  try {
    const cookies = clearSessionCookies();
    cookies.forEach(c => res.append("Set-Cookie", c));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", authenticate, async (req, res, next) => {
  try {
    const roles = await getRoles(req.user.id);
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
            const user = await resolveUserByPhone(phone);
            if (!user) throw new HttpError(404, "No account found");
        } else if (purpose === "reset_password") {
            const email = cleanText(req.body.email)?.toLowerCase();
            const user = await prisma.user.findUnique({
                where: { email },
                include: { profile: true }
            });
            if (!user?.profile?.phone || user.profile.phone !== phone) throw new HttpError(400, "Invalid email/phone combination");
        }
        await sendPhoneVerificationCode(phone);
        res.json({ ok: true, purpose, provider: "bypass", message: "Verification code sent" });
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

        const user = await resolveUserByPhone(phone);
        if (!user) throw new HttpError(404, "User not found");

        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);
        const roles = await getRoles(user.id);
        const cookies = buildSessionCookies(accessToken, refreshToken);
        cookies.forEach(c => res.append("Set-Cookie", c));
        const { passwordHash: _, ...safeUser } = user;
        res.json({ user: safeUser, roles });
    } catch (error) { next(error); }
});

app.post("/api/auth/password-reset/request", async (req, res, next) => {
    try {
        const email = cleanText(req.body.email)?.toLowerCase();
        const user = await prisma.user.findUnique({
            where: { email },
            include: { profile: true }
        });
        if (user) await sendPasswordResetEmailOtp(user.email);
        res.json({ ok: true, message: "Code sent", phoneHint: user?.profile?.phone ? maskPhoneHint(user.profile.phone) : null });
    } catch (error) { next(error); }
});

app.post("/api/auth/password-reset/complete", async (req, res, next) => {
    try {
        const { email, email_otp, phone, phone_verification_token, password } = req.body;
        const normalizedEmail = cleanText(email)?.toLowerCase();
        const normalizedPhone = normalizeIndianPhone(phone);

        const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            include: { profile: true }
        });

        if (!user || user.profile.phone !== normalizedPhone) throw new HttpError(400, "Invalid reset details");

        verifyPhoneVerificationToken(phone_verification_token, normalizedPhone);
        verifyPasswordResetEmailOtp(user.email, email_otp);

        const passwordHash = await hashPassword(password);
        await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash }
        });

        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);
        const roles = await getRoles(user.id);
        const cookies = buildSessionCookies(accessToken, refreshToken);
        cookies.forEach(c => res.append("Set-Cookie", c));
        const { passwordHash: _, ...safeUser } = user;
        res.json({ ok: true, user: safeUser, roles, message: "Password updated" });
    } catch (error) { next(error); }
});

app.post("/api/auth/register", async (req, res, next) => {
    try {
        const { email, full_name, password, phone, phone_verification_token, requested_role } = req.body;
        const normalizedPhone = normalizeIndianPhone(phone);
        const normalizedEmail = cleanText(email).toLowerCase();

        verifyPhoneVerificationToken(phone_verification_token, normalizedPhone);

        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) throw new HttpError(400, "Email already exists");

        const passwordHash = await hashPassword(password);

        const user = await prisma.$transaction(async (tx) => {
            const newUser = await tx.user.create({
                data: {
                    email: normalizedEmail,
                    passwordHash,
                    profile: {
                        create: {
                            fullName: full_name,
                            phone: normalizedPhone
                        }
                    },
                    roles: {
                        create: {
                            role: 'customer'
                        }
                    }
                },
                include: { profile: true }
            });

            if (requested_role) {
                await tx.roleRequest.create({
                    data: {
                        userId: newUser.id,
                        requestedRole: requested_role,
                        message: "Requested during registration"
                    }
                });
            }

            return newUser;
        });

        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);
        const roles = ['customer'];
        const cookies = buildSessionCookies(accessToken, refreshToken);
        cookies.forEach(c => res.append("Set-Cookie", c));

        const { passwordHash: _, ...safeUser } = user;
        res.json({ user: safeUser, roles });
    } catch (error) { next(error); }
});

// Profile and Role Request routes
app.get("/api/profile", authenticate, async (req, res, next) => {
    try {
        const profile = await prisma.profile.findUnique({
            where: { id: req.user.id }
        });
        res.json({ profile });
    } catch (error) { next(error); }
});

app.get("/api/role-requests", authenticate, async (req, res, next) => {
    try {
        const requests = await prisma.roleRequest.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: 'desc' }
        });
        res.json({ requests });
    } catch (error) { next(error); }
});

// Admin User Routes
app.get("/api/admin/users", authenticate, async (req, res, next) => {
    try {
        const profiles = await prisma.profile.findMany({
            take: 50
        });
        res.json({ profiles });
    } catch (error) { next(error); }
});

app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Auth Service running on port ${PORT}`));
