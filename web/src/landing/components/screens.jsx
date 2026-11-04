// Product screens shown inside the device shells. They mirror the real app's
// screens with the sample township's people, but are static pictures, not the
// app itself, so they are hidden from screen readers (the copy beside each
// one says what it shows).
import Icon from './Icon.jsx';

function StatusBar({ dark }) {
  return (
    <div className={`scr-status ${dark ? 'on-dark' : ''}`}>
      <span>9:41</span><i className="scr-cam" /><span className="scr-batt"><i /></span>
    </div>
  );
}

function Row({ tone, title, sub, right }) {
  return (
    <div className="scr-row">
      <i className={`scr-dot ${tone}`} />
      <div className="scr-grow"><b>{title}</b><span>{sub}</span></div>
      {right}
    </div>
  );
}

function Shell({ title, children, dark }) {
  return (
    <div className={`scr ${dark ? 'scr-dark' : ''}`} aria-hidden="true">
      <StatusBar dark={dark} />
      {title && <p className="scr-title">{title}</p>}
      {children}
      <i className="scr-home-bar" />
    </div>
  );
}

export function HomeScreen() {
  return (
    <div className="scr scr-home" aria-hidden="true">
      <div className="scr-hero">
        <StatusBar dark />
        <p className="scr-dim">Good evening</p>
        <p className="scr-name">Swati Joshi</p>
        <p className="scr-dim">T12-0408 · Tower 12</p>
        <div className="scr-due">
          <div><p className="scr-dim">Maintenance due</p><p className="scr-amt">₹4,820</p><p className="scr-dim">Due 10 Nov</p></div>
          <span className="scr-pay">Pay now</span>
        </div>
      </div>
      <div className="scr-quick">
        {[['pay', 'Pay'], ['fix', 'Fix'], ['visitor', 'Visitors'], ['book', 'Book']].map(([i, l]) => (
          <span key={l}><i><Icon name={i} /></i>{l}</span>
        ))}
      </div>
      <p className="scr-label">Today</p>
      <div className="scr-list">
        <Row tone="accent" title="Visitor at Gate 1" sub="Ravi, delivery · tap to approve" />
        <Row tone="warn" title="Water leak, kitchen" sub="Plumber assigned · 2:40 pm" />
        <Row tone="ok" title="Clubhouse" sub="Sat, 7–9 pm · booked" />
      </div>
      <i className="scr-home-bar" />
    </div>
  );
}

export function PayScreen() {
  return (
    <Shell title="Pay maintenance">
      <div className="scr-card scr-center">
        <span className="scr-dim">T12-0408 · November</span>
        <span className="scr-big">₹4,820</span>
      </div>
      <div className="scr-card scr-lines">
        <p><span>Maintenance, Nov</span><b>₹4,500</b></p>
        <p><span>Interest, 47 days</span><b>₹320</b></p>
      </div>
      <div className="scr-chips"><span className="on">UPI</span><span>Card</span><span>Net banking</span></div>
      <span className="scr-btn">Pay ₹4,820</span>
      <div className="scr-toast"><Icon name="check" /><div><b>Paid. Receipt saved</b><span>RCT/2026-27/01842</span></div></div>
    </Shell>
  );
}

export function FixScreen() {
  const steps = [['Reported', '9:12 am', 'done'], ['Assigned to Ganesh, plumber', '9:14 am', 'done'], ['On the way', '2:40 pm', 'now'], ['Fixed', 'You rate it', '']];
  return (
    <Shell title="Water leak, kitchen">
      <div className="scr-photo"><Icon name="fix" /></div>
      <div className="scr-chips"><span className="on">Plumbing</span><span className="warn">High</span></div>
      <div className="scr-card scr-steps">
        {steps.map(([t, s, st]) => (
          <p key={t} className={st}><i /><span><b>{t}</b>{s}</span></p>
        ))}
      </div>
    </Shell>
  );
}

export function VisitorScreen() {
  return (
    <Shell title="Visitors">
      <div className="scr-card scr-visitor">
        <span className="scr-live">At Gate 1 now</span>
        <div className="scr-person"><i>RK</i><div><b>Ravi Kumar</b><span>Delivery · Swiggy</span></div></div>
        <div className="scr-two"><span className="scr-btn ghost">Deny</span><span className="scr-btn">Approve</span></div>
      </div>
      <div className="scr-card scr-code">
        <span className="scr-dim">Guest code for tonight</span>
        <b>482 913</b>
        <span className="scr-dim">Valid until 11 pm · share it</span>
      </div>
      <div className="scr-list">
        <Row tone="ok" title="Anita (cook)" sub="Approved · 7:02 am" />
      </div>
    </Shell>
  );
}

export function BookScreen() {
  const slots = [['5–7 pm', 'full'], ['7–9 pm', 'on'], ['9–11 pm', ''], ['6–8 am', ''], ['8–10 am', 'full'], ['10–12', '']];
  return (
    <Shell title="Clubhouse">
      <div className="scr-chips scr-days">{['Thu 6', 'Fri 7', 'Sat 8', 'Sun 9'].map((d) => <span key={d} className={d === 'Sat 8' ? 'on' : ''}>{d}</span>)}</div>
      <div className="scr-slots">{slots.map(([t, s]) => <span key={t} className={s}>{t}</span>)}</div>
      <div className="scr-card scr-lines">
        <p><span>Sat 8, 7–9 pm</span><b>₹500</b></p>
        <p><span>Free to cancel until</span><b>Fri, 7 pm</b></p>
      </div>
      <span className="scr-btn">Book · add to maintenance</span>
    </Shell>
  );
}

export function GateScreen() {
  const rows = [['7:42', 'Ravi Kumar', 'T12-0408', 'Waiting', 'warn'], ['7:38', 'Courier, Blue Dart', 'T21-1601', 'Approved', 'ok'], ['7:31', 'Guest code 482 913', 'T12-0408', 'Saved offline', 'meta'], ['7:26', 'Anil Deshpande', 'T07-1203', 'Saved offline', 'meta']];
  return (
    <div className="gt" aria-hidden="true">
      <div className="gt-top"><b>Gate 1</b><span>Ramesh · night shift</span><span className="gt-off"><Icon name="wifiOff" /> Offline · 2 saved</span></div>
      <div className="gt-grid">
        <div className="gt-actions"><span className="gt-big">New visitor</span><span className="gt-big alt">Guest code</span></div>
        <div className="gt-list">
          <p className="gt-h">Entries</p>
          {rows.map(([t, n, f, s, tone]) => (
            <div className="gt-row" key={t}><span className="gt-t">{t}</span><span className="gt-n"><b>{n}</b>{f}</span><span className={`gt-s ${tone}`}>{s}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}
