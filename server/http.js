import { HttpError } from './lib/util.js';

export const ROLES = {
  complaints: ['helpdesk', 'admin'],
  money: ['accounts', 'admin'],
  report: ['committee', 'accounts', 'helpdesk', 'admin'],
  admin: ['admin'],
  committee: ['committee', 'admin'],
  staff: ['helpdesk', 'accounts', 'committee', 'admin'],
};
export const allow = (...roles) => (req, res, next) =>
  (roles.flat().includes(req.user?.role) ? next() : next(new HttpError(403, 'Not allowed for your role.')));
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
