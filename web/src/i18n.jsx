import { createContext, useContext, useState } from 'react';

// Resident screens in English, Marathi and Hindi. Staff screens are English.
const STR = {
  en: {
    aboutTownship: 'About Township',
    installApp: 'Install app', macStep: 'In Safari, open the File menu and choose Add to Dock.',
    installTitle: 'Add Township to your home screen', installBody: 'Opens like an app, full screen, with alerts.', install: 'Install', installed: 'Installed', howTo: 'How', notNow: 'Not now', iosStep1: 'Tap the Share button in Safari.', iosStep2: 'Choose Add to Home Screen.',
    quickPay: 'Pay', quickRaise: 'Report', quickGuest: 'Guest code', quickBook: 'Book', whatsInIt: 'What is in this', hideDetails: 'Hide details', interestLabel: 'Interest, per bye-laws', filterOpen: 'Open', filterDone: 'Resolved', filterAll: 'All', copy: 'Copy', copied: 'Copied', validFor: 'Valid for {t} more', expiredCode: 'Expired', last6: 'Last 6 months',
    book: 'Book', bookTitle: 'Book an amenity', freeCancel: 'Free cancellation until {h} hours before', perSlot: 'per slot', free: 'Free', yourBookings: 'Your bookings', noBookings: 'No upcoming bookings.', confirmBooking: 'Book', cancelBooking: 'Cancel', closed: 'Closed', full: 'Full', slotsLeft: '{n} left', noSlotsLeft: 'No more slots today. Pick another day.', chargedToBill: 'Charged to your maintenance account', g_newVisitor: 'New visitor', g_guestCode: 'Guest code', g_endShift: 'End shift', g_takePhoto: 'Take photo', g_name: 'Visitor name', g_tower: 'Tower', g_flat: 'Flat', g_enterFlat: 'Enter tower and flat number', g_notFlat: '{f} is not a flat here', g_cancel: 'Cancel', g_ask: 'Ask flat to approve', g_letIn: 'Let in', g_code: '6-digit code', g_guestOf: 'Guest of {f}', g_waiting: 'Waiting for flat', g_approved: 'Let in', g_denied: 'Do not let in', g_inside: 'Inside', g_left: 'Left', g_queued: 'Saved, sending…', g_entered: 'Mark entered', g_exited: 'Mark left', g_offline: 'Offline · {n} saved on tablet', g_none: 'No visitors yet today.', g_purpose_Delivery: 'Delivery', g_purpose_Guest: 'Guest', g_purpose_Cab: 'Cab', g_purpose_Service: 'Service', 'g_purpose_Daily help': 'Daily help', g_notice: 'Notice to visitors: your name, phone number and photo are recorded for the safety of residents, shared only with the flat you are visiting, and photos are deleted after 90 days under the Digital Personal Data Protection Act, 2023.', g_asked: 'Asked {f} to approve {n}', g_goIn: '{n} can go in',
    alertsTitle: 'Get alerts on this phone', alertsBody: 'When visitors arrive, complaints change and bills are ready.', turnOn: 'Turn on', alerts: 'Alerts', yourData: 'Your data', downloadData: 'Download my data', askCorrect: 'Ask to correct my details', askErase: 'Ask to delete my data',
    hello: 'Hello', home: 'Home', bills: 'Bills', complaints: 'Complaints', visitors: 'Visitors', me: 'Profile',
    due: 'Amount due', allPaid: 'All paid', nothingDue: 'Nothing due right now.', payNow: 'Pay now', overdueBy: 'overdue by {n} days',
    dueBy: 'Due by {d}', inclInterest: 'includes {a} interest', openComplaints: 'Open complaints', noComplaints: 'No open complaints.',
    raise: 'Raise a complaint', todaysVisitors: "Today's visitors", noVisitors: 'No visitors today.', approve: 'Approve', deny: 'Deny',
    notices: 'Notices', waiting: 'Waiting at gate', approved: 'Approved', denied: 'Denied', inside: 'Inside', left: 'Left',
    status_open: 'Raised', status_assigned: 'Assigned', status_in_progress: 'In progress', status_resolved: 'Resolved', status_closed: 'Closed',
    describe: 'What is the problem?', describeHint: 'For example: water leaking under the kitchen sink', addPhoto: 'Add photo', submit: 'Submit',
    safetyNote: 'For fire, gas leak, lift stuck or electric shock, the duty manager is alerted immediately.',
    reopen: 'Not fixed, reopen', rateIt: 'How was the fix?', close: 'Confirm and close', guestCode: 'Guest code', newCode: 'Create guest code',
    guestName: "Guest's name", forDate: 'For', share: 'Share this code with your guest. It works once, on that day.',
    language: 'Language', theme: 'Appearance', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark', household: 'Household', signOut: 'Sign out', ledger: 'Ledger', receipts: 'Receipts', receipt: 'Receipt',
    payTitle: 'Pay maintenance', amount: 'Amount', payFull: 'Full dues', payOther: 'Other amount', paySuccess: 'Payment received',
    loginTitle: 'Sign in with your mobile number', sendOtp: 'Send code', verify: 'Sign in', otpSent: 'Enter the 6-digit code sent to {p}',
    linked: 'Same issue reported by {n} other flats. We are fixing it once for everyone.', assignedTo: 'Assigned to {n}',
    respondBy: 'Response due by {t}', escalated: 'Escalated to duty manager',
  },
  mr: {
    aboutTownship: 'Township विषयी',
    installApp: 'अ‍ॅप इन्स्टॉल करा', macStep: 'Safari मध्ये File मेनूमधून Add to Dock निवडा.',
    installTitle: 'Township होम स्क्रीनवर जोडा', installBody: 'अ‍ॅपसारखे पूर्ण स्क्रीनवर उघडते, सूचनांसह.', install: 'इन्स्टॉल करा', installed: 'इन्स्टॉल झाले', howTo: 'कसे', notNow: 'आता नाही', iosStep1: 'Safari मधील Share बटण दाबा.', iosStep2: 'Add to Home Screen निवडा.',
    quickPay: 'भरा', quickRaise: 'तक्रार', quickGuest: 'पाहुणा कोड', quickBook: 'बुक करा', whatsInIt: 'तपशील पहा', hideDetails: 'तपशील लपवा', interestLabel: 'व्याज, उपविधीनुसार', filterOpen: 'सुरू', filterDone: 'सोडवलेल्या', filterAll: 'सर्व', copy: 'कॉपी', copied: 'कॉपी केले', validFor: 'आणखी {t} वैध', expiredCode: 'मुदत संपली', last6: 'मागील ६ महिने',
    book: 'बुकिंग', bookTitle: 'सुविधा बुक करा', freeCancel: '{h} तास आधीपर्यंत मोफत रद्द', perSlot: 'प्रति स्लॉट', free: 'मोफत', yourBookings: 'तुमची बुकिंग', noBookings: 'पुढील बुकिंग नाही.', confirmBooking: 'बुक करा', cancelBooking: 'रद्द करा', closed: 'बंद', full: 'भरले', slotsLeft: '{n} उपलब्ध', noSlotsLeft: 'आज आणखी स्लॉट नाहीत. दुसरा दिवस निवडा.', chargedToBill: 'तुमच्या देखभाल खात्यात लावले जाईल', g_newVisitor: 'नवीन पाहुणा', g_guestCode: 'पाहुणे कोड', g_endShift: 'ड्युटी संपवा', g_takePhoto: 'फोटो काढा', g_name: 'पाहुण्याचे नाव', g_tower: 'टॉवर', g_flat: 'फ्लॅट', g_enterFlat: 'टॉवर आणि फ्लॅट नंबर टाका', g_notFlat: '{f} हा फ्लॅट येथे नाही', g_cancel: 'रद्द', g_ask: 'फ्लॅटची परवानगी मागा', g_letIn: 'आत सोडा', g_code: '6 अंकी कोड', g_guestOf: '{f} चे पाहुणे', g_waiting: 'फ्लॅटच्या उत्तराची वाट', g_approved: 'आत सोडा', g_denied: 'आत सोडू नका', g_inside: 'आत आहेत', g_left: 'गेले', g_queued: 'जतन, पाठवत आहे…', g_entered: 'आत गेले नोंदवा', g_exited: 'बाहेर गेले नोंदवा', g_offline: 'नेटवर्क नाही · {n} टॅबलेटवर जतन', g_none: 'आज अजून कोणी पाहुणे नाहीत.', g_purpose_Delivery: 'डिलिव्हरी', g_purpose_Guest: 'पाहुणे', g_purpose_Cab: 'कॅब', g_purpose_Service: 'सर्व्हिस', 'g_purpose_Daily help': 'घरकाम मदतनीस', g_notice: 'पाहुण्यांसाठी सूचना: रहिवाशांच्या सुरक्षेसाठी तुमचे नाव, फोन नंबर आणि फोटो नोंदवला जातो, तो फक्त तुम्ही भेट देत असलेल्या फ्लॅटला दिसतो, आणि डिजिटल वैयक्तिक डेटा संरक्षण कायदा, 2023 नुसार फोटो 90 दिवसांनी हटवले जातात.', g_asked: '{f} ला {n} साठी परवानगी विचारली', g_goIn: '{n} आत जाऊ शकतात',
    alertsTitle: 'या फोनवर सूचना मिळवा', alertsBody: 'पाहुणे आल्यावर, तक्रारीत बदल झाल्यावर आणि बिल तयार झाल्यावर.', turnOn: 'सुरू करा', alerts: 'सूचना', yourData: 'तुमची माहिती', downloadData: 'माझी माहिती डाउनलोड करा', askCorrect: 'माझी माहिती दुरुस्त करण्याची विनंती', askErase: 'माझी माहिती हटवण्याची विनंती',
    hello: 'नमस्कार', home: 'मुख्य', bills: 'बिले', complaints: 'तक्रारी', visitors: 'पाहुणे', me: 'प्रोफाइल',
    due: 'थकबाकी', allPaid: 'सर्व भरले', nothingDue: 'सध्या काहीही देय नाही.', payNow: 'आता भरा', overdueBy: '{n} दिवस उशीर',
    dueBy: '{d} पर्यंत भरा', inclInterest: '{a} व्याज समाविष्ट', openComplaints: 'चालू तक्रारी', noComplaints: 'कोणतीही चालू तक्रार नाही.',
    raise: 'तक्रार नोंदवा', todaysVisitors: 'आजचे पाहुणे', noVisitors: 'आज कोणी पाहुणे नाहीत.', approve: 'परवानगी द्या', deny: 'नकार द्या',
    notices: 'सूचना', waiting: 'गेटवर थांबले आहेत', approved: 'परवानगी दिली', denied: 'नकार दिला', inside: 'आत आहेत', left: 'गेले',
    status_open: 'नोंदवली', status_assigned: 'सोपवली', status_in_progress: 'काम सुरू', status_resolved: 'सोडवली', status_closed: 'बंद',
    describe: 'समस्या काय आहे?', describeHint: 'उदा. स्वयंपाकघरातील सिंकखाली पाणी गळत आहे', addPhoto: 'फोटो जोडा', submit: 'पाठवा',
    safetyNote: 'आग, गॅस गळती, लिफ्टमध्ये अडकणे किंवा विजेचा धक्का असल्यास ड्युटी मॅनेजरला लगेच कळवले जाते.',
    reopen: 'दुरुस्त झाले नाही, पुन्हा उघडा', rateIt: 'दुरुस्ती कशी झाली?', close: 'खात्री करा आणि बंद करा', guestCode: 'पाहुणे कोड', newCode: 'पाहुणे कोड तयार करा',
    guestName: 'पाहुण्याचे नाव', forDate: 'दिनांक', share: 'हा कोड पाहुण्याला पाठवा. तो त्या दिवशी एकदाच चालेल.',
    language: 'भाषा', theme: 'दिसणे', themeSystem: 'सिस्टम', themeLight: 'लाइट', themeDark: 'डार्क', household: 'घरातील सदस्य', signOut: 'बाहेर पडा', ledger: 'खतावणी', receipts: 'पावत्या', receipt: 'पावती',
    payTitle: 'देखभाल शुल्क भरा', amount: 'रक्कम', payFull: 'पूर्ण थकबाकी', payOther: 'इतर रक्कम', paySuccess: 'रक्कम मिळाली',
    loginTitle: 'मोबाइल नंबरने साइन इन करा', sendOtp: 'कोड पाठवा', verify: 'साइन इन', otpSent: '{p} वर आलेला 6 अंकी कोड टाका',
    linked: 'हीच समस्या आणखी {n} फ्लॅट्सनी नोंदवली आहे. सर्वांसाठी एकदाच दुरुस्ती करत आहोत.', assignedTo: '{n} यांच्याकडे सोपवली',
    respondBy: '{t} पर्यंत प्रतिसाद', escalated: 'ड्युटी मॅनेजरकडे पाठवली',
  },
  hi: {
    aboutTownship: 'Township के बारे में',
    installApp: 'ऐप इंस्टॉल करें', macStep: 'Safari में File मेनू से Add to Dock चुनें.',
    installTitle: 'Township को होम स्क्रीन पर जोड़ें', installBody: 'ऐप की तरह पूरी स्क्रीन पर खुलता है, सूचनाओं के साथ.', install: 'इंस्टॉल करें', installed: 'इंस्टॉल हो गया', howTo: 'कैसे', notNow: 'अभी नहीं', iosStep1: 'Safari में Share बटन दबाएँ.', iosStep2: 'Add to Home Screen चुनें.',
    quickPay: 'भुगतान', quickRaise: 'शिकायत', quickGuest: 'मेहमान कोड', quickBook: 'बुक करें', whatsInIt: 'विवरण देखें', hideDetails: 'विवरण छिपाएँ', interestLabel: 'ब्याज, उपनियमों के अनुसार', filterOpen: 'खुली', filterDone: 'सुलझी', filterAll: 'सभी', copy: 'कॉपी', copied: 'कॉपी हो गया', validFor: '{t} और मान्य', expiredCode: 'समय समाप्त', last6: 'पिछले 6 महीने',
    book: 'बुकिंग', bookTitle: 'सुविधा बुक करें', freeCancel: '{h} घंटे पहले तक मुफ़्त रद्द', perSlot: 'प्रति स्लॉट', free: 'मुफ़्त', yourBookings: 'आपकी बुकिंग', noBookings: 'कोई आगामी बुकिंग नहीं.', confirmBooking: 'बुक करें', cancelBooking: 'रद्द करें', closed: 'बंद', full: 'भरा हुआ', slotsLeft: '{n} बाकी', noSlotsLeft: 'आज और स्लॉट नहीं हैं. कोई और दिन चुनें.', chargedToBill: 'आपके मेंटेनेंस खाते में जोड़ा जाएगा', g_newVisitor: 'नया मेहमान', g_guestCode: 'मेहमान कोड', g_endShift: 'ड्यूटी ख़त्म', g_takePhoto: 'फ़ोटो लें', g_name: 'मेहमान का नाम', g_tower: 'टावर', g_flat: 'फ़्लैट', g_enterFlat: 'टावर और फ़्लैट नंबर डालें', g_notFlat: '{f} यहाँ का फ़्लैट नहीं है', g_cancel: 'रद्द', g_ask: 'फ़्लैट से अनुमति माँगें', g_letIn: 'अंदर जाने दें', g_code: '6 अंकों का कोड', g_guestOf: '{f} के मेहमान', g_waiting: 'फ़्लैट के जवाब का इंतज़ार', g_approved: 'अंदर जाने दें', g_denied: 'अंदर न जाने दें', g_inside: 'अंदर हैं', g_left: 'चले गए', g_queued: 'सहेजा, भेज रहे हैं…', g_entered: 'अंदर गए दर्ज करें', g_exited: 'बाहर गए दर्ज करें', g_offline: 'नेटवर्क नहीं · {n} टैबलेट पर सहेजे', g_none: 'आज अभी तक कोई मेहमान नहीं.', g_purpose_Delivery: 'डिलीवरी', g_purpose_Guest: 'मेहमान', g_purpose_Cab: 'कैब', g_purpose_Service: 'सर्विस', 'g_purpose_Daily help': 'घरेलू सहायक', g_notice: 'मेहमानों के लिए सूचना: निवासियों की सुरक्षा के लिए आपका नाम, फ़ोन नंबर और फ़ोटो दर्ज किया जाता है, यह केवल उसी फ़्लैट को दिखता है जहाँ आप जा रहे हैं, और डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023 के तहत फ़ोटो 90 दिनों बाद हटा दी जाती है.', g_asked: '{f} से {n} के लिए अनुमति माँगी', g_goIn: '{n} अंदर जा सकते हैं',
    alertsTitle: 'इस फ़ोन पर सूचनाएं पाएं', alertsBody: 'मेहमान आने पर, शिकायत में बदलाव पर और बिल तैयार होने पर.', turnOn: 'चालू करें', alerts: 'सूचनाएं', yourData: 'आपकी जानकारी', downloadData: 'मेरी जानकारी डाउनलोड करें', askCorrect: 'मेरी जानकारी सुधारने का अनुरोध', askErase: 'मेरी जानकारी हटाने का अनुरोध',
    hello: 'नमस्ते', home: 'होम', bills: 'बिल', complaints: 'शिकायतें', visitors: 'मेहमान', me: 'प्रोफ़ाइल',
    due: 'बकाया राशि', allPaid: 'सब चुका दिया', nothingDue: 'अभी कुछ बकाया नहीं है.', payNow: 'अभी भुगतान करें', overdueBy: '{n} दिन की देरी',
    dueBy: '{d} तक भुगतान करें', inclInterest: '{a} ब्याज शामिल', openComplaints: 'खुली शिकायतें', noComplaints: 'कोई खुली शिकायत नहीं.',
    raise: 'शिकायत दर्ज करें', todaysVisitors: 'आज के मेहमान', noVisitors: 'आज कोई मेहमान नहीं.', approve: 'अनुमति दें', deny: 'मना करें',
    notices: 'सूचनाएं', waiting: 'गेट पर इंतज़ार', approved: 'अनुमति दी', denied: 'मना किया', inside: 'अंदर हैं', left: 'चले गए',
    status_open: 'दर्ज', status_assigned: 'सौंपी गई', status_in_progress: 'काम जारी', status_resolved: 'सुलझाई गई', status_closed: 'बंद',
    describe: 'समस्या क्या है?', describeHint: 'जैसे: किचन सिंक के नीचे पानी टपक रहा है', addPhoto: 'फ़ोटो जोड़ें', submit: 'भेजें',
    safetyNote: 'आग, गैस लीक, लिफ्ट में फंसना या करंट लगने पर ड्यूटी मैनेजर को तुरंत सूचना जाती है.',
    reopen: 'ठीक नहीं हुआ, फिर खोलें', rateIt: 'मरम्मत कैसी रही?', close: 'पुष्टि करें और बंद करें', guestCode: 'मेहमान कोड', newCode: 'मेहमान कोड बनाएं',
    guestName: 'मेहमान का नाम', forDate: 'तारीख', share: 'यह कोड मेहमान को भेजें. यह उसी दिन एक बार चलेगा.',
    language: 'भाषा', theme: 'दिखावट', themeSystem: 'सिस्टम', themeLight: 'लाइट', themeDark: 'डार्क', household: 'घर के सदस्य', signOut: 'साइन आउट', ledger: 'खाता', receipts: 'रसीदें', receipt: 'रसीद',
    payTitle: 'मेंटेनेंस भुगतान', amount: 'राशि', payFull: 'पूरा बकाया', payOther: 'दूसरी राशि', paySuccess: 'भुगतान मिल गया',
    loginTitle: 'मोबाइल नंबर से साइन इन करें', sendOtp: 'कोड भेजें', verify: 'साइन इन', otpSent: '{p} पर भेजा गया 6 अंकों का कोड डालें',
    linked: 'यही समस्या {n} और फ़्लैट्स ने बताई है. सबके लिए एक बार में ठीक कर रहे हैं.', assignedTo: '{n} को सौंपी गई',
    respondBy: '{t} तक जवाब', escalated: 'ड्यूटी मैनेजर को भेजी गई',
  },
};

const Ctx = createContext(null);
const read = () => { try { return localStorage.getItem('township.lang') || 'en'; } catch { return 'en'; } };

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(read);
  const setLang = (l) => { setLangState(l); try { localStorage.setItem('township.lang', l); } catch { /* ignore */ } };
  const t = (key, vars = {}) => (STR[lang][key] ?? STR.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return <Ctx.Provider value={{ lang, setLang, t }}><div lang={lang} className={lang === 'en' ? '' : 'deva'}>{children}</div></Ctx.Provider>;
}
export const useT = () => useContext(Ctx);
export const LANGS = [['en', 'English'], ['mr', 'मराठी'], ['hi', 'हिन्दी']];
