import { Router } from 'express';
import { h } from '../http.js';
import { requestOtp, verifyOtp, pinLogin, pairDevice } from '../lib/auth.js';

const r = Router();
r.post('/auth/otp', h(async (req, res) => {
  await requestOtp(req.body.phone, req.meta.ip);
  res.json({ sent: true });
}));
r.post('/auth/verify', h(async (req, res) => res.json(await verifyOtp(req.body.phone, req.body.code, req.meta))));
r.post('/auth/pin', h(async (req, res) => res.json(await pinLogin(req.body.phone, req.body.pin, req.get('x-device-token'), req.meta))));
r.post('/devices/pair', h(async (req, res) => res.json(await pairDevice(req.body.code, req.meta.ip))));
export default r;
