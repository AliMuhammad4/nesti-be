// Document type matching, localized names, and review reply copy.

const DOCUMENT_RECEIVED = {
  pay_stubs: /pay\s*stubs?|paystubs?|payslips?/i,
  notice_of_assessment: /notice of assessment|\bt4\b|\bnoa\b/i,
  mortgage_statement: /mortgage statement/i,
  preapproval_letter: /pre-?approval/i,
  proof_of_funds: /proof of funds|bank statement|down payment|funds available/i,
  photo_id: /photo id|passport|driver'?s licen[cs]e|government id|photo identification/i,
  home_photos: /photos? of the home|home photos|property photos/i,
  listing_sheet: /listing sheet|\bmls\b/i,
  purchase_agreement: /purchase agreement|sale agreement|agreement of purchase/i,
  title_deed: /title deed|certificate of title|\bdeed\b/i,
  mortgage_commitment: /mortgage commitment/i,
  condo_status: /status certificate|condo status/i,
};

const GENERIC_DOCUMENT_TYPES = new Set(['document', 'photo', 'file', 'image', 'pdf', 'word', 'attachment', 'upload']);

export function documentCoversRequest(doc, id) {
  if (doc?.status && doc.status !== 'ready') return false;
  const type = String(doc?.document_type || '').trim().toLowerCase();
  const typeText = GENERIC_DOCUMENT_TYPES.has(type) ? '' : type;
  const text = `${doc?.original_filename || ''} ${typeText} ${doc?.summary || ''} ${(doc?.key_facts || []).join(' ')} ${String(doc?.extracted_text || '').slice(0, 3000)}`;
  if (DOCUMENT_RECEIVED[id]?.test(text)) return true;
  const folded = text.toLowerCase();
  return Object.values(DOCUMENT_NAMES).some((pack) => {
    const name = String(pack?.[id] || '').toLowerCase().replace(/^(recent|current)\s+/, '').trim();
    return name.length >= 2 && folded.includes(name);
  });
}

const DOCUMENT_REVIEW = {
  english: {
    exactNext: (got, next) => `This is the ${got}. When you are ready, you can send the ${next} as well.`,
    exactDone: (got) => `This is the ${got}. That is all the documents I need for now.`,
    other: (got, next) => (next ? `This is the ${got}. When you are ready, you can send the ${next}.` : `This is the ${got}. We can continue with the other details.`),
    different: (next) => (next ? `This is a different file. When you are ready, you can send the ${next}.` : 'This is a different file. We can continue with the other details.'),
    duplicate: (next) => (next ? `You already sent this file. When you are ready, you can send the ${next}.` : 'You already sent this file. We can continue with the other details.'),
    received: () => 'I have the file.',
    receivedDone: () => 'I have the file. That is all the documents I need for now.',
  },
  french: {
    exactNext: (got, next) => `C'est bien ${got}. Quand vous êtes prêt, vous pouvez aussi envoyer ${next}.`,
    exactDone: (got) => `C'est bien ${got}. Ce sont tous les documents dont j'ai besoin pour le moment.`,
    other: (got, next) => (next ? `C'est bien ${got}. Quand vous êtes prêt, vous pouvez envoyer ${next}.` : `C'est bien ${got}. Nous pouvons continuer avec les autres détails.`),
    different: (next) => (next ? `C'est un autre fichier. Quand vous êtes prêt, vous pouvez envoyer ${next}.` : `C'est un autre fichier. Nous pouvons continuer avec les autres détails.`),
    duplicate: (next) => (next ? `Vous avez déjà envoyé ce fichier. Quand vous êtes prêt, vous pouvez envoyer ${next}.` : 'Vous avez déjà envoyé ce fichier. Nous pouvons continuer avec les autres détails.'),
    received: () => `J'ai bien le fichier.`,
    receivedDone: () => `J'ai bien le fichier. Ce sont tous les documents dont j'ai besoin pour le moment.`,
  },
  spanish: {
    exactNext: (got, next) => `Este es ${got}. Cuando pueda, también puede enviar ${next}.`,
    exactDone: (got) => `Este es ${got}. Con esto tengo los documentos que necesito por ahora.`,
    other: (got, next) => (next ? `Este es ${got}. Cuando pueda, puede enviar ${next}.` : `Este es ${got}. Podemos seguir con los otros detalles.`),
    different: (next) => (next ? `Este es otro archivo. Cuando pueda, puede enviar ${next}.` : 'Este es otro archivo. Podemos seguir con los otros detalles.'),
    duplicate: (next) => (next ? `Ya envió este archivo. Cuando pueda, puede enviar ${next}.` : 'Ya envió este archivo. Podemos seguir con los otros detalles.'),
    received: () => 'Ya tengo el archivo.',
    receivedDone: () => 'Ya tengo el archivo. Con esto tengo los documentos que necesito por ahora.',
  },
  arabic: {
    exactNext: (got, next) => `هذا هو ${got}. عندما تكون جاهزًا، يمكنك أيضًا إرسال ${next}.`,
    exactDone: (got) => `هذا هو ${got}. هذه كل المستندات التي أحتاجها الآن.`,
    other: (got, next) => (next ? `هذا هو ${got}. عندما تكون جاهزًا، يمكنك إرسال ${next}.` : `هذا هو ${got}. يمكننا المتابعة بالتفاصيل الأخرى.`),
    different: (next) => (next ? `هذا ملف مختلف. عندما تكون جاهزًا، يمكنك إرسال ${next}.` : 'هذا ملف مختلف. يمكننا المتابعة بالتفاصيل الأخرى.'),
    duplicate: (next) => (next ? `لقد أرسلت هذا الملف من قبل. عندما تكون جاهزًا، يمكنك إرسال ${next}.` : 'لقد أرسلت هذا الملف من قبل. يمكننا المتابعة بالتفاصيل الأخرى.'),
    received: () => 'وصلتني الملف.',
    receivedDone: () => 'وصلتني الملف. هذه كل المستندات التي أحتاجها الآن.',
  },
  hindi: {
    exactNext: (got, next) => `यह ${got} है। जब आप तैयार हों, ${next} भी भेज सकते हैं।`,
    exactDone: (got) => `यह ${got} है। अभी के लिए मुझे यही दस्तावेज़ चाहिए थे।`,
    other: (got, next) => (next ? `यह ${got} है। जब आप तैयार हों, ${next} भेज सकते हैं।` : `यह ${got} है। हम बाकी बातचीत जारी रख सकते हैं।`),
    different: (next) => (next ? `यह कोई और फ़ाइल है। जब आप तैयार हों, ${next} भेज सकते हैं।` : 'यह कोई और फ़ाइल है। हम बाकी बातचीत जारी रख सकते हैं।'),
    duplicate: (next) => (next ? `आप यह फ़ाइल पहले ही भेज चुके हैं। जब आप तैयार हों, ${next} भेज सकते हैं।` : 'आप यह फ़ाइल पहले ही भेज चुके हैं। हम बाकी बातचीत जारी रख सकते हैं।'),
    received: () => 'फ़ाइल मिल गई।',
    receivedDone: () => 'फ़ाइल मिल गई। अभी के लिए मुझे यही दस्तावेज़ चाहिए थे।',
  },
};

const DOCUMENT_NAMES = {
  english: {
    pay_stubs: 'recent pay stubs',
    notice_of_assessment: 'notice of assessment or T4',
    mortgage_statement: 'current mortgage statement',
    preapproval_letter: 'pre-approval letter',
    proof_of_funds: 'proof of funds',
    photo_id: 'photo ID',
    home_photos: 'photos of the home',
    listing_sheet: 'listing or MLS sheet',
    purchase_agreement: 'purchase or sale agreement',
    title_deed: 'title or deed',
    mortgage_commitment: 'mortgage commitment',
    condo_status: 'condo status certificate',
  },
  french: {
    pay_stubs: 'talons de paie récents',
    notice_of_assessment: 'avis de cotisation ou T4',
    mortgage_statement: 'relevé hypothécaire actuel',
    preapproval_letter: 'lettre de préapprobation',
    proof_of_funds: 'preuve de fonds',
    photo_id: 'pièce d\'identité',
    home_photos: 'photos du logement',
    listing_sheet: 'fiche d\'inscription',
    purchase_agreement: 'promesse d\'achat ou de vente',
    title_deed: 'titre de propriété',
    mortgage_commitment: 'engagement hypothécaire',
    condo_status: 'certificat de l\'état de la copropriété',
  },
  spanish: {
    pay_stubs: 'recibos de nómina recientes',
    notice_of_assessment: 'aviso de evaluación o T4',
    mortgage_statement: 'estado de cuenta hipotecario',
    preapproval_letter: 'carta de preaprobación',
    proof_of_funds: 'comprobante de fondos',
    photo_id: 'identificación con foto',
    home_photos: 'fotos de la vivienda',
    listing_sheet: 'ficha del listado',
    purchase_agreement: 'contrato de compra o venta',
    title_deed: 'título de propiedad',
    mortgage_commitment: 'compromiso hipotecario',
    condo_status: 'certificado de estado del condominio',
  },
  mandarin: {
    pay_stubs: '近期工资单',
    notice_of_assessment: '评估通知或T4',
    mortgage_statement: '当前房贷对账单',
    preapproval_letter: '预批信',
    proof_of_funds: '资金证明',
    photo_id: '带照片的身份证件',
    home_photos: '房屋照片',
    listing_sheet: '挂牌资料',
    purchase_agreement: '买卖协议',
    title_deed: '产权文件',
    mortgage_commitment: '贷款承诺函',
    condo_status: '公寓状态证明',
  },
  cantonese: {
    pay_stubs: '近期糧單',
    notice_of_assessment: '評稅通知或T4',
    mortgage_statement: '現時按揭月結單',
    preapproval_letter: '預批信',
    proof_of_funds: '資金證明',
    photo_id: '有相身份證明',
    home_photos: '屋企相',
    listing_sheet: '放盤資料',
    purchase_agreement: '買賣合約',
    title_deed: '業權文件',
    mortgage_commitment: '按揭承諾書',
    condo_status: '大廈狀況證明',
  },
  arabic: {
    pay_stubs: 'كشوف الرواتب الأخيرة',
    notice_of_assessment: 'إشعار التقييم أو T4',
    mortgage_statement: 'كشف الرهن الحالي',
    preapproval_letter: 'خطاب الموافقة المبدئية',
    proof_of_funds: 'إثبات الأموال',
    photo_id: 'هوية بصورة',
    home_photos: 'صور المنزل',
    listing_sheet: 'ورقة العرض',
    purchase_agreement: 'عقد البيع أو الشراء',
    title_deed: 'سند الملكية',
    mortgage_commitment: 'التزام الرهن',
    condo_status: 'شهادة حالة الشقة',
  },
  hindi: {
    pay_stubs: 'हाल की वेतन पर्चियाँ',
    notice_of_assessment: 'आकलन नोटिस या T4',
    mortgage_statement: 'मौजूदा गिरवी विवरण',
    preapproval_letter: 'पूर्व-स्वीकृति पत्र',
    proof_of_funds: 'धन का प्रमाण',
    photo_id: 'फोटो पहचान',
    home_photos: 'घर की तस्वीरें',
    listing_sheet: 'लिस्टिंग शीट',
    purchase_agreement: 'खरीद या बिक्री समझौता',
    title_deed: 'मालिकाना दस्तावेज़',
    mortgage_commitment: 'गिरवी प्रतिबद्धता',
    condo_status: 'कॉन्डो स्थिति प्रमाणपत्र',
  },
  punjabi: {
    pay_stubs: 'ਹਾਲੀਆ ਤਨਖਾਹ ਸਲਿੱਪਾਂ',
    notice_of_assessment: 'ਮੁਲਾਂਕਣ ਨੋਟਿਸ ਜਾਂ T4',
    mortgage_statement: 'ਮੌਜੂਦਾ ਰਹਿਨ ਬਿਆਨ',
    preapproval_letter: 'ਪ੍ਰੀ-ਅਪਰੂਵਲ ਪੱਤਰ',
    proof_of_funds: 'ਫੰਡਾਂ ਦਾ ਸਬੂਤ',
    photo_id: 'ਫੋਟੋ ਵਾਲੀ ਪਛਾਣ',
    home_photos: 'ਘਰ ਦੀਆਂ ਤਸਵੀਰਾਂ',
    listing_sheet: 'ਲਿਸਟਿੰਗ ਸ਼ੀਟ',
    purchase_agreement: 'ਖਰੀਦ ਜਾਂ ਵਿਕਰੀ ਇਕਰਾਰ',
    title_deed: 'ਮਲਕੀਅਤ ਦਸਤਾਵੇਜ਼',
    mortgage_commitment: 'ਰਹਿਨ ਵਚਨ',
    condo_status: 'ਕੋਂਡੋ ਸਥਿਤੀ ਸਰਟੀਫਿਕੇਟ',
  },
  tamil: {
    pay_stubs: 'சமீபத்திய சம்பளச் சீட்டுகள்',
    notice_of_assessment: 'மதிப்பீட்டு அறிவிப்பு அல்லது T4',
    mortgage_statement: 'தற்போதைய அடமான அறிக்கை',
    preapproval_letter: 'முன்அனுமதி கடிதம்',
    proof_of_funds: 'நிதி சான்று',
    photo_id: 'புகைப்பட அடையாளம்',
    home_photos: 'வீட்டு புகைப்படங்கள்',
    listing_sheet: 'பட்டியல் தாள்',
    purchase_agreement: 'வாங்கல் அல்லது விற்பனை ஒப்பந்தம்',
    title_deed: 'உரிமைப் பத்திரம்',
    mortgage_commitment: 'அடமான உறுதி',
    condo_status: 'காண்டோ நிலை சான்றிதழ்',
  },
};

export function localizedDocumentName(id, language) {
  const names = DOCUMENT_NAMES[language] || DOCUMENT_NAMES.english;
  return names[id] || DOCUMENT_NAMES.english[id] || 'document';
}

export { DOCUMENT_NAMES, DOCUMENT_REVIEW };
