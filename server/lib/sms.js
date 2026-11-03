import { env, smsEnabled } from '../env.js';

// MSG91 Flow API. In India every template must be DLT-approved; the OTP
// template's body must contain the variable ##otp##.
async function msg91(templateId, mobile, vars) {
  const res = await fetch('https://control.msg91.com/api/v5/flow', {
    method: 'POST',
    headers: { authkey: env.MSG91_AUTH_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ template_id: templateId, short_url: '0', recipients: [{ mobiles: `91${mobile}`, ...vars }] }),
    signal: AbortSignal.timeout(10000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.type === 'error') throw new Error(body.message || `MSG91 HTTP ${res.status}`);
  return body.request_id || body.message || 'ok';
}

export class SmsUnavailable extends Error {}

export async function sendOtpSms(phone, code) {
  if (!smsEnabled) throw new SmsUnavailable('SMS is not configured');
  return msg91(env.MSG91_OTP_TEMPLATE_ID, phone, { otp: code });
}

export async function sendAlertSms(phone, message) {
  if (!smsEnabled || !env.MSG91_ALERT_TEMPLATE_ID) throw new SmsUnavailable('Alert SMS template is not configured');
  return msg91(env.MSG91_ALERT_TEMPLATE_ID, phone, { message: message.slice(0, 120) });
}
