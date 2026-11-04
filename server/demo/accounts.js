// Sign-in numbers of the sample township. Shown on the sign-in page only
// when the server runs with DEMO_DATA=true; all people here are invented,
// except the three flats taken from the brief's sample data.
export const ACCOUNTS = {
  aamir: '9822010003', swati: '9822010002', neeraj: '9822010001',
  helpdesk: '9000000001', accounts: '9000000004', committee: '9000000002', admin: '9000000005', guard: '9000000003',
};
export const GUARD_PIN = '2468';

export const DEMO_LOGINS = [
  { phone: ACCOUNTS.swati, name: 'Swati Joshi', role: 'Resident · T12-0408', note: '47 days overdue, open water leak' },
  { phone: ACCOUNTS.aamir, name: 'Aamir Shaikh', role: 'Resident · T21-1601', note: 'Part paid, 18 days overdue' },
  { phone: ACCOUNTS.neeraj, name: 'Neeraj Kulkarni', role: 'Resident · T07-1203', note: 'Fully paid' },
  { phone: ACCOUNTS.helpdesk, name: 'Priya Patil', role: 'Help desk', note: 'Complaints queue' },
  { phone: ACCOUNTS.accounts, name: 'Meena Kulkarni', role: 'Accounts', note: 'Bank matching, bills' },
  { phone: ACCOUNTS.committee, name: 'Rajan Gokhale', role: 'Committee', note: 'Monthly report' },
  { phone: ACCOUNTS.admin, name: 'Office Admin', role: 'Admin', note: 'Settings, gate tablets' },
];
