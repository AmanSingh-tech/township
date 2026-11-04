// Device shells. Screens inside size themselves in container units, so a
// device can be any width (set --pw on the phone, --tw on the tablet).
export function Phone({ children, className = '', ...rest }) {
  return (
    <div className={`lp-phone ${className}`} {...rest}>
      <div className="lp-phone-screen">{children}</div>
    </div>
  );
}

export function Tablet({ children, className = '', ...rest }) {
  return (
    <div className={`lp-tablet ${className}`} {...rest}>
      <div className="lp-tablet-screen">{children}</div>
    </div>
  );
}
