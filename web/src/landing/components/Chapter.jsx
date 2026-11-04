// The small labels in a chapter's top corners: what it is about, and its number.
export default function Chapter({ about, n }) {
  return (
    <div className="lp-chapter" aria-hidden="true">
      <span>About {about}</span>
      <span>Chapter {String(n).padStart(2, '0')}</span>
    </div>
  );
}
