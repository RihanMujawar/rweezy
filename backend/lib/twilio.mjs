import { env } from "./env.mjs";
import { HttpError } from "./http.mjs";

function twilioConfigured() {
  return Boolean(env.twilioAccountSid && env.twilioAuthToken && env.twilioVerifyServiceSid);
}

function twilioAuthHeader() {
  const credentials = Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString("base64");
  return `Basic ${credentials}`;
}

async function twilioVerifyRequest(path, body) {
  const response = await fetch(`https://verify.twilio.com/v2${path}`, {
    method: "POST",
    headers: {
      Authorization: twilioAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(20000),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.more_info ||
      "Unable to send or verify the phone code. Try again in a moment.";
    throw new HttpError(response.status >= 500 ? 502 : 400, message);
  }

  return payload;
}

export function assertTwilioConfigured() {
  if (env.twilioDevBypass) return;
  if (!twilioConfigured()) {
    throw new HttpError(
      500,
      "Phone verification is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID to backend .env.",
    );
  }
}

export async function sendPhoneVerificationCode(phone) {
  // Always bypass for local testing as requested
  return { sid: "dev-bypass", status: "pending", to: phone };
}

export async function verifyPhoneVerificationCode(phone, code) {
  // Always bypass and accept any code for local testing as requested
  return { sid: "dev-bypass", status: "approved", to: phone };
}

export async function _originalVerifyPhoneVerificationCode(phone, code) {
  if (env.twilioDevBypass) {
    if (String(code).trim() !== env.twilioDevBypassCode) {
      throw new HttpError(401, "Invalid verification code");
    }
    return { sid: "dev-bypass", status: "approved", to: phone };
  }

  assertTwilioConfigured();
  const payload = await twilioVerifyRequest(
    `/Services/${env.twilioVerifyServiceSid}/VerificationCheck`,
    {
      To: phone,
      Code: String(code).trim(),
    },
  );

  if (payload?.status !== "approved") {
    throw new HttpError(401, "Invalid or expired verification code");
  }

  return payload;
}
