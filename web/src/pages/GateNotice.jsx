import { useEffect, useState } from 'react';

// A4 poster for the gates (DPDP Act 2023): what is recorded, why, for how long.
const TEXT = [
  ['en', 'Notice to visitors', [
    'For the safety of residents, the security staff record your name, mobile number, the flat you are visiting and a photograph.',
    'This is shown only to the flat you are visiting and to the society office.',
    'Photographs are deleted after {days} days. Other entry records are kept for security reviews.',
    'To ask about your data, contact the society office.',
  ], 'Digital Personal Data Protection Act, 2023'],
  ['mr', 'पाहुण्यांसाठी सूचना', [
    'रहिवाशांच्या सुरक्षेसाठी सुरक्षा कर्मचारी तुमचे नाव, मोबाइल नंबर, तुम्ही भेट देत असलेला फ्लॅट आणि फोटो नोंदवतात.',
    'ही माहिती फक्त तुम्ही भेट देत असलेल्या फ्लॅटला आणि सोसायटी कार्यालयाला दिसते.',
    'फोटो {days} दिवसांनी हटवले जातात. इतर नोंदी सुरक्षा तपासणीसाठी ठेवल्या जातात.',
    'तुमच्या माहितीबद्दल विचारण्यासाठी सोसायटी कार्यालयाशी संपर्क साधा.',
  ], 'डिजिटल वैयक्तिक डेटा संरक्षण कायदा, 2023'],
  ['hi', 'मेहमानों के लिए सूचना', [
    'निवासियों की सुरक्षा के लिए सुरक्षा कर्मचारी आपका नाम, मोबाइल नंबर, जिस फ़्लैट में आप जा रहे हैं और आपकी फ़ोटो दर्ज करते हैं.',
    'यह जानकारी केवल उसी फ़्लैट और सोसायटी कार्यालय को दिखती है.',
    'फ़ोटो {days} दिनों बाद हटा दी जाती हैं. अन्य प्रविष्टियाँ सुरक्षा समीक्षा के लिए रखी जाती हैं.',
    'अपनी जानकारी के बारे में पूछने के लिए सोसायटी कार्यालय से संपर्क करें.',
  ], 'डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023'],
];

export default function GateNotice() {
  const days = Number(new URLSearchParams(location.search).get('days')) || 90;
  const society = new URLSearchParams(location.search).get('society') || '';
  const [ready, setReady] = useState(false);
  useEffect(() => { document.fonts.ready.then(() => setReady(true)); }, []);
  return (
    <div className="notice-poster">
      <style>{`
        @page { size: A4; margin: 14mm; }
        .notice-poster { max-width: 800px; margin: 0 auto; padding: 32px 24px; background: #fff; color: #111; }
        .notice-poster section { padding: 22px 0; border-bottom: 1px solid #ddd; }
        .notice-poster section:last-of-type { border-bottom: 0; }
        .notice-poster h2 { font-size: 26px; margin-bottom: 10px; }
        .notice-poster li { font-size: 17px; line-height: 1.55; margin-bottom: 4px; }
        .notice-poster .law { color: #555; font-size: 14px; margin-top: 8px; }
        @media print { .no-print { display: none; } .notice-poster { padding: 0; } }
      `}</style>
      <div className="row between no-print" style={{ marginBottom: 20 }}>
        <span className="faint small">Print on A4 and display at each gate.</span>
        <button className="btn primary" disabled={!ready} onClick={() => window.print()}>Print</button>
      </div>
      {society && <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 8 }}>{society}</div>}
      {TEXT.map(([lang, title, lines, law]) => (
        <section key={lang} lang={lang} className={lang === 'en' ? '' : 'deva'}>
          <h2>{title}</h2>
          <ul>{lines.map((l) => <li key={l}>{l.replace('{days}', days)}</li>)}</ul>
          <div className="law">{law}</div>
        </section>
      ))}
    </div>
  );
}
