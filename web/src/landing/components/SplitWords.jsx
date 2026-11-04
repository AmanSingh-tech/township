import { Fragment } from 'react';

// Text split into masked words for reveal and highlight effects. Screen readers
// get the sentence once, as plain text. "\n" in `text` is a line break.
export default function SplitWords({ text, as: Tag = 'span', className, ...rest }) {
  return (
    <Tag className={className} {...rest}>
      <span className="lp-sr">{text.replace(/\n/g, ' ')}</span>
      <span aria-hidden="true">
        {text.split('\n').map((line, li) => (
          <Fragment key={li}>
            {li > 0 && <br />}
            {line.split(' ').map((w, i) => (
              <Fragment key={i}>{i > 0 && ' '}<span className="sw"><span className="sw-i">{w}</span></span></Fragment>
            ))}
          </Fragment>
        ))}
      </span>
    </Tag>
  );
}
