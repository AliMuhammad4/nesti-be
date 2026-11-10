/**
 * Single localized table for the fixed lines the chat writes itself (not the model), and the visitor words it
 * recognizes. Keys are the language ids replyLanguage() can return:
 * english, french, spanish, arabic, urdu, hindi, punjabi (Gurmukhi), tamil, mandarin.
 * Urdu is detected from Urdu-only letters (see replyStyle.detectLanguage) even though it is not a selectable
 * setting language. Cantonese is not produced by the detector for saved assistants, so it has no rows.
 * A missing row means "keep the model reply" for replies, and English for link labels.
 */

/** Display names for detected languages that are not in the settings catalog (prompt instructions). */
export const DETECTED_LANGUAGE_NAMES = {
  urdu: 'Urdu',
  mandarin: 'Mandarin Chinese',
  cantonese: 'Cantonese',
};

/** Investor opening (goal unknown) and the location prefix for each language. */
export const INVESTOR_OPENING_QUESTION = {
  english: { intro: 'Great start.', question: 'Should we prioritize rental yield or long-term appreciation first?' },
  french: { intro: 'Très bon début.', question: 'Faut-il privilégier le rendement locatif ou l’appréciation à long terme ?' },
  spanish: { intro: 'Excelente comienzo.', question: '¿Priorizamos primero el rendimiento del alquiler o la apreciación a largo plazo?' },
  urdu: { intro: 'بہت اچھا آغاز۔', question: 'کیا ہم پہلے کرائے کی آمدنی کو ترجیح دیں یا طویل مدت میں قیمت میں اضافے کو؟' },
  arabic: { intro: 'بداية رائعة.', question: 'هل نُعطي الأولوية لعائد الإيجار أم لزيادة القيمة على المدى الطويل؟' },
  hindi: { intro: 'बहुत अच्छी शुरुआत।', question: 'क्या हम पहले किराये की आय को प्राथमिकता दें या लंबी अवधि में मूल्य वृद्धि को?' },
  punjabi: { intro: 'ਬਹੁਤ ਵਧੀਆ ਸ਼ੁਰੂਆਤ।', question: 'ਕੀ ਅਸੀਂ ਪਹਿਲਾਂ ਕਿਰਾਏ ਦੀ ਆਮਦਨ ਨੂੰ ਤਰਜੀਹ ਦੇਈਏ ਜਾਂ ਲੰਬੇ ਸਮੇਂ ਦੇ ਮੁੱਲ ਵਾਧੇ ਨੂੰ?' },
  tamil: { intro: 'சிறந்த தொடக்கம்.', question: 'வாடகை வருவாய்க்கு முன்னுரிமை அளிப்போமா அல்லது நீண்டகால மதிப்பு உயர்வுக்கா?' },
  mandarin: { intro: '很好的开始。', question: '我们先优先考虑租金回报，还是长期增值？' },
};

export const AREA_PREFIX = {
  english: (area, question) => `In ${area}, ${question.charAt(0).toLowerCase()}${question.slice(1)}`,
  french: (area, question) => `À ${area}, ${question}`,
  spanish: (area, question) => `En ${area}, ${question}`,
  arabic: (area, question) => `في ${area}، ${question}`,
  urdu: (area, question) => `${area} میں، ${question}`,
  hindi: (area, question) => `${area} में, ${question}`,
  punjabi: (area, question) => `${area} ਵਿੱਚ, ${question}`,
  tamil: (area, question) => `${area}-இல், ${question}`,
  mandarin: (area, question) => `在${area}，${question}`,
};

/** Investor refinement when every saved question is answered and no conflict exists. */
export const INVESTOR_REFINEMENT_QUESTION = {
  english: 'What matters most on the first shortlist: purchase price, renovation scope, or exit timeline?',
  french: 'Qu’est-ce qui compte le plus pour la première sélection : le prix d’achat, l’ampleur des rénovations ou l’horizon de sortie ?',
  spanish: '¿Qué importa más en la primera selección: el precio de compra, el alcance de la renovación o el plazo de salida?',
  arabic: 'ما الأهم في القائمة الأولى: سعر الشراء أم حجم التجديد أم موعد الخروج؟',
  urdu: 'پہلی فہرست میں سب سے اہم کیا ہے: خریداری کی قیمت، مرمت کا دائرہ، یا فروخت کا وقت؟',
  hindi: 'पहली सूची में सबसे ज़रूरी क्या है: खरीद मूल्य, मरम्मत का दायरा, या निकलने की समय-सीमा?',
  punjabi: 'ਪਹਿਲੀ ਸੂਚੀ ਵਿੱਚ ਸਭ ਤੋਂ ਜ਼ਰੂਰੀ ਕੀ ਹੈ: ਖਰੀਦ ਕੀਮਤ, ਮੁਰੰਮਤ ਦਾ ਦਾਇਰਾ, ਜਾਂ ਵੇਚਣ ਦੀ ਸਮਾਂ-ਸੀਮਾ?',
  tamil: 'முதல் பட்டியலில் எது மிக முக்கியம்: வாங்கும் விலை, புதுப்பிப்பு அளவு, அல்லது வெளியேறும் காலம்?',
  mandarin: '第一批筛选时您最看重什么：购买价格、翻新范围，还是退出时间？',
};

/** Flip strategy with a rental-income goal: ask which one leads. */
export const INVESTOR_STRATEGY_CONFIRM_QUESTION = {
  english: 'Should we prioritize resale profit from the flip, or hold the property for rental income?',
  french: 'Faut-il viser le profit à la revente après rénovation, ou garder le bien pour le revenu locatif ?',
  spanish: '¿Priorizamos la ganancia de reventa tras la renovación o conservamos la propiedad para obtener ingresos de alquiler?',
  arabic: 'هل نُعطي الأولوية لربح إعادة البيع بعد التجديد، أم نحتفظ بالعقار لدخل الإيجار؟',
  urdu: 'کیا ہم مرمت کے بعد دوبارہ فروخت کے منافع کو ترجیح دیں، یا کرائے کی آمدنی کے لیے جائیداد رکھیں؟',
  hindi: 'क्या हम मरम्मत के बाद दोबारा बेचने के मुनाफ़े को प्राथमिकता दें, या किराये की आय के लिए संपत्ति रखें?',
  punjabi: 'ਕੀ ਅਸੀਂ ਮੁਰੰਮਤ ਤੋਂ ਬਾਅਦ ਮੁੜ ਵੇਚਣ ਦੇ ਮੁਨਾਫ਼ੇ ਨੂੰ ਤਰਜੀਹ ਦੇਈਏ, ਜਾਂ ਕਿਰਾਏ ਦੀ ਆਮਦਨ ਲਈ ਜਾਇਦਾਦ ਰੱਖੀਏ?',
  tamil: 'புதுப்பித்து மறுவிற்பனை செய்யும் லாபத்துக்கு முன்னுரிமை அளிப்போமா, அல்லது வாடகை வருமானத்துக்காக சொத்தை வைத்திருப்போமா?',
  mandarin: '我们是优先考虑翻新后转售的利润，还是持有房产获取租金收入？',
};

/** Booking link label and the skipped-upload note. */
export const BOOKING_COPY = {
  english: { label: 'Book an appointment', sendLater: 'You can send the documents whenever they are ready.', pickTime: 'We can also pick a time to go through this.' },
  french: { label: 'Prendre rendez-vous', sendLater: 'Vous pouvez envoyer les documents quand ils seront prêts.', pickTime: 'Nous pouvons aussi choisir un moment pour en parler.' },
  spanish: { label: 'Reservar una cita', sendLater: 'Puede enviar los documentos cuando los tenga listos.', pickTime: 'También podemos elegir un horario para revisarlo.' },
  arabic: { label: 'احجز موعدًا', sendLater: 'يمكنك إرسال المستندات عندما تكون جاهزة.', pickTime: 'يمكننا أيضًا اختيار وقت لمراجعة ذلك.' },
  urdu: { label: 'ملاقات بک کریں', sendLater: 'دستاویزات تیار ہونے پر آپ انہیں کسی بھی وقت بھیج سکتے ہیں۔', pickTime: 'ہم اس پر بات کرنے کے لیے وقت بھی طے کر سکتے ہیں۔' },
  hindi: { label: 'अपॉइंटमेंट बुक करें', sendLater: 'दस्तावेज़ तैयार होने पर आप उन्हें कभी भी भेज सकते हैं।', pickTime: 'हम इस पर बात करने के लिए एक समय भी तय कर सकते हैं।' },
  punjabi: { label: 'ਮੁਲਾਕਾਤ ਬੁੱਕ ਕਰੋ', sendLater: 'ਦਸਤਾਵੇਜ਼ ਤਿਆਰ ਹੋਣ ’ਤੇ ਤੁਸੀਂ ਉਹ ਕਦੇ ਵੀ ਭੇਜ ਸਕਦੇ ਹੋ।', pickTime: 'ਅਸੀਂ ਇਸ ਬਾਰੇ ਗੱਲ ਕਰਨ ਲਈ ਸਮਾਂ ਵੀ ਤੈਅ ਕਰ ਸਕਦੇ ਹਾਂ।' },
  tamil: { label: 'சந்திப்பை முன்பதிவு செய்யுங்கள்', sendLater: 'ஆவணங்கள் தயாரானதும் எப்போது வேண்டுமானாலும் அனுப்பலாம்.', pickTime: 'இதைப் பற்றிப் பேச ஒரு நேரத்தையும் தேர்வு செய்யலாம்.' },
  mandarin: { label: '预约时间', sendLater: '文件准备好后随时发给我们。', pickTime: '我们也可以约个时间一起过一遍。' },
};

/** Visitor pauses the details ("later" / "let's meet") and the reply had nothing left to keep. */
export const PAUSE_COPY = {
  english: { meet: 'I can meet with you. Choose a time that works.', later: 'We can go through those details when you are ready.' },
  french: { meet: 'Je peux vous rencontrer. Choisissez un moment qui vous convient.', later: 'Nous pourrons voir ces détails quand vous serez prêt.' },
  spanish: { meet: 'Puedo reunirme con usted. Elija un horario que le convenga.', later: 'Podemos ver esos detalles cuando esté listo.' },
  arabic: { meet: 'يمكنني الاجتماع معك. اختر وقتًا مناسبًا.', later: 'يمكننا مراجعة هذه التفاصيل عندما تكون جاهزًا.' },
  urdu: { meet: 'ہم مل سکتے ہیں۔ اپنی سہولت کا وقت منتخب کریں۔', later: 'جب آپ تیار ہوں، ہم یہ تفصیلات دیکھ سکتے ہیں۔' },
  hindi: { meet: 'हम मिल सकते हैं। अपनी सुविधा का समय चुनें।', later: 'जब आप तैयार हों, तब हम ये जानकारी देख सकते हैं।' },
  punjabi: { meet: 'ਅਸੀਂ ਮਿਲ ਸਕਦੇ ਹਾਂ। ਆਪਣੀ ਸਹੂਲਤ ਦਾ ਸਮਾਂ ਚੁਣੋ।', later: 'ਜਦੋਂ ਤੁਸੀਂ ਤਿਆਰ ਹੋਵੋ, ਅਸੀਂ ਇਹ ਵੇਰਵੇ ਦੇਖ ਸਕਦੇ ਹਾਂ।' },
  tamil: { meet: 'நாம் சந்திக்கலாம். உங்களுக்கு வசதியான நேரத்தைத் தேர்வு செய்யுங்கள்.', later: 'நீங்கள் தயாரானதும் இந்த விவரங்களைப் பார்க்கலாம்.' },
  mandarin: { meet: '我可以和您见面。请选择一个方便的时间。', later: '这些细节可以等您准备好再谈。' },
};

/** Fixed fallback replies chatTurnFinish writes over the model reply. */
export const TURN_FALLBACK = {
  english: {
    matchesOff: 'Thanks for sharing. I can help refine your preferences and connect you with the professional for tailored options.',
    needContact: 'I can show available options once I have a contact detail. What name, email, or phone number should I use?',
    clientTypeBlocked: 'This assistant is not set up for that client type. Please choose another option or contact the professional directly.',
    skipListings: 'No problem — we can skip those listings for now and keep refining what you want.',
    skipListingsInvestor: 'No problem — we can skip those listings for now and keep refining your investment criteria.',
  },
  french: {
    matchesOff: 'Merci pour ces précisions. Je peux vous aider à affiner vos critères et vous mettre en contact avec le professionnel pour des options adaptées.',
    needContact: 'Je peux vous montrer les options disponibles dès que j’ai un moyen de vous joindre. Quel nom, courriel ou numéro de téléphone dois-je utiliser ?',
    clientTypeBlocked: 'Cet assistant n’est pas configuré pour ce type de client. Choisissez une autre option ou contactez directement le professionnel.',
    skipListings: 'Aucun problème — on laisse ces annonces de côté pour l’instant et on continue d’affiner ce que vous cherchez.',
    skipListingsInvestor: 'Aucun problème — on laisse ces annonces de côté pour l’instant et on continue d’affiner vos critères d’investissement.',
  },
  spanish: {
    matchesOff: 'Gracias por compartirlo. Puedo ayudarle a afinar sus preferencias y ponerle en contacto con el profesional para opciones a su medida.',
    needContact: 'Puedo mostrarle las opciones disponibles en cuanto tenga un dato de contacto. ¿Qué nombre, correo o teléfono debo usar?',
    clientTypeBlocked: 'Este asistente no está configurado para ese tipo de cliente. Elija otra opción o contacte directamente al profesional.',
    skipListings: 'No hay problema — dejamos esos anuncios por ahora y seguimos afinando lo que busca.',
    skipListingsInvestor: 'No hay problema — dejamos esos anuncios por ahora y seguimos afinando sus criterios de inversión.',
  },
  arabic: {
    matchesOff: 'شكرًا على المشاركة. يمكنني مساعدتك في تحديد تفضيلاتك وربطك بالمختص للحصول على خيارات مناسبة.',
    needContact: 'يمكنني عرض الخيارات المتاحة بعد الحصول على وسيلة للتواصل. ما الاسم أو البريد الإلكتروني أو رقم الهاتف الذي أستخدمه؟',
    clientTypeBlocked: 'هذا المساعد غير مُعدّ لهذا النوع من العملاء. يُرجى اختيار خيار آخر أو التواصل مع المختص مباشرة.',
    skipListings: 'لا مشكلة — سنترك هذه العقارات الآن ونواصل تحديد ما تبحث عنه.',
    skipListingsInvestor: 'لا مشكلة — سنترك هذه العقارات الآن ونواصل تحديد معايير الاستثمار لديك.',
  },
  urdu: {
    matchesOff: 'معلومات دینے کا شکریہ۔ ہم آپ کی ترجیحات مزید واضح کر سکتے ہیں اور مناسب آپشنز کے لیے آپ کو ماہر سے جوڑ سکتے ہیں۔',
    needContact: 'دستیاب آپشنز دکھانے کے لیے رابطے کی ایک تفصیل درکار ہے۔ کون سا نام، ای میل یا فون نمبر استعمال کریں؟',
    clientTypeBlocked: 'یہ اسسٹنٹ اس قسم کے کلائنٹ کے لیے سیٹ نہیں ہے۔ براہ کرم کوئی دوسرا آپشن منتخب کریں یا براہ راست ماہر سے رابطہ کریں۔',
    skipListings: 'کوئی بات نہیں — ابھی یہ لسٹنگز چھوڑ دیتے ہیں اور آپ کی ضرورت کو مزید واضح کرتے ہیں۔',
    skipListingsInvestor: 'کوئی بات نہیں — ابھی یہ لسٹنگز چھوڑ دیتے ہیں اور آپ کے سرمایہ کاری کے معیار کو مزید واضح کرتے ہیں۔',
  },
  hindi: {
    matchesOff: 'जानकारी देने के लिए धन्यवाद। हम आपकी पसंद को और स्पष्ट कर सकते हैं और उपयुक्त विकल्पों के लिए आपको विशेषज्ञ से जोड़ सकते हैं।',
    needContact: 'उपलब्ध विकल्प दिखाने के लिए संपर्क की एक जानकारी चाहिए। कौन-सा नाम, ईमेल या फ़ोन नंबर इस्तेमाल करें?',
    clientTypeBlocked: 'यह असिस्टेंट इस प्रकार के क्लाइंट के लिए सेट नहीं है। कृपया कोई दूसरा विकल्प चुनें या सीधे विशेषज्ञ से संपर्क करें।',
    skipListings: 'कोई बात नहीं — अभी इन लिस्टिंग को छोड़ देते हैं और आपकी ज़रूरत को और स्पष्ट करते हैं।',
    skipListingsInvestor: 'कोई बात नहीं — अभी इन लिस्टिंग को छोड़ देते हैं और आपके निवेश के मानदंड और स्पष्ट करते हैं।',
  },
  punjabi: {
    matchesOff: 'ਜਾਣਕਾਰੀ ਦੇਣ ਲਈ ਧੰਨਵਾਦ। ਅਸੀਂ ਤੁਹਾਡੀ ਪਸੰਦ ਨੂੰ ਹੋਰ ਸਪਸ਼ਟ ਕਰ ਸਕਦੇ ਹਾਂ ਅਤੇ ਢੁਕਵੇਂ ਵਿਕਲਪਾਂ ਲਈ ਤੁਹਾਨੂੰ ਮਾਹਰ ਨਾਲ ਜੋੜ ਸਕਦੇ ਹਾਂ।',
    needContact: 'ਉਪਲਬਧ ਵਿਕਲਪ ਦਿਖਾਉਣ ਲਈ ਸੰਪਰਕ ਦੀ ਇੱਕ ਜਾਣਕਾਰੀ ਚਾਹੀਦੀ ਹੈ। ਕਿਹੜਾ ਨਾਮ, ਈਮੇਲ ਜਾਂ ਫ਼ੋਨ ਨੰਬਰ ਵਰਤੀਏ?',
    clientTypeBlocked: 'ਇਹ ਅਸਿਸਟੈਂਟ ਇਸ ਕਿਸਮ ਦੇ ਕਲਾਇੰਟ ਲਈ ਸੈੱਟ ਨਹੀਂ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਕੋਈ ਹੋਰ ਵਿਕਲਪ ਚੁਣੋ ਜਾਂ ਸਿੱਧਾ ਮਾਹਰ ਨਾਲ ਸੰਪਰਕ ਕਰੋ।',
    skipListings: 'ਕੋਈ ਗੱਲ ਨਹੀਂ — ਹੁਣ ਲਈ ਇਹ ਲਿਸਟਿੰਗਾਂ ਛੱਡ ਦਿੰਦੇ ਹਾਂ ਅਤੇ ਤੁਹਾਡੀ ਲੋੜ ਨੂੰ ਹੋਰ ਸਪਸ਼ਟ ਕਰਦੇ ਹਾਂ।',
    skipListingsInvestor: 'ਕੋਈ ਗੱਲ ਨਹੀਂ — ਹੁਣ ਲਈ ਇਹ ਲਿਸਟਿੰਗਾਂ ਛੱਡ ਦਿੰਦੇ ਹਾਂ ਅਤੇ ਤੁਹਾਡੇ ਨਿਵੇਸ਼ ਦੇ ਮਾਪਦੰਡ ਹੋਰ ਸਪਸ਼ਟ ਕਰਦੇ ਹਾਂ।',
  },
  tamil: {
    matchesOff: 'பகிர்ந்ததற்கு நன்றி. உங்கள் விருப்பங்களைத் தெளிவுபடுத்தவும், பொருத்தமான தேர்வுகளுக்காக நிபுணருடன் இணைக்கவும் உதவ முடியும்.',
    needContact: 'கிடைக்கும் தேர்வுகளைக் காட்ட ஒரு தொடர்பு விவரம் தேவை. எந்தப் பெயர், மின்னஞ்சல் அல்லது தொலைபேசி எண்ணைப் பயன்படுத்தலாம்?',
    clientTypeBlocked: 'இந்த உதவியாளர் இந்த வகை வாடிக்கையாளருக்கு அமைக்கப்படவில்லை. வேறு தேர்வைத் தேர்ந்தெடுக்கவும் அல்லது நிபுணரை நேரடியாகத் தொடர்பு கொள்ளவும்.',
    skipListings: 'பரவாயில்லை — இப்போதைக்கு இந்தப் பட்டியல்களைத் தவிர்த்து, நீங்கள் தேடுவதைத் தொடர்ந்து தெளிவுபடுத்துவோம்.',
    skipListingsInvestor: 'பரவாயில்லை — இப்போதைக்கு இந்தப் பட்டியல்களைத் தவிர்த்து, உங்கள் முதலீட்டு அளவுகோல்களைத் தொடர்ந்து தெளிவுபடுத்துவோம்.',
  },
  mandarin: {
    matchesOff: '感谢您的分享。我可以帮您进一步明确需求，并为您联系专业人士，获取更合适的选择。',
    needContact: '留下一个联系方式后，我就可以为您展示可选房源。请问用哪个姓名、邮箱或电话？',
    clientTypeBlocked: '此助手未针对该客户类型设置。请选择其他选项，或直接联系专业人士。',
    skipListings: '没问题——这些房源先放一放，我们继续细化您的需求。',
    skipListingsInvestor: '没问题——这些房源先放一放，我们继续细化您的投资标准。',
  },
};

/**
 * Visitor words, as regex source fragments (no \b around accented or non-Latin letters; \b does not work there).
 * decline: a refusal; shortDecline: a refusal that is the whole message; docs: a document word; meeting: a meeting ask.
 */
export const VISITOR_WORDS = {
  french: {
    decline: ['plus tard', 'pas maintenant', 'non,?\\s*merci', 'pas intéressé', 'je préfère pas', "pas pour l'instant"],
    shortDecline: ['plus tard', 'pas maintenant', 'non,?\\s*merci'],
    docs: ['documents?', 'fichiers?', 'pièces'],
    meeting: ['rendez-vous', 'rendez vous', '\\brdv\\b', 'prendre un appel', 'réserver un', 'rencontrer'],
  },
  spanish: {
    decline: ['más tarde', 'ahora no', 'no,?\\s*gracias', 'prefiero no', 'no me interesa'],
    shortDecline: ['más tarde', 'ahora no', 'no,?\\s*gracias'],
    docs: ['documentos?', 'archivos?'],
    meeting: ['\\bcita\\b', 'reunión', 'reunirnos', 'agendar'],
  },
  arabic: {
    decline: ['لاحقا', 'لاحقًا', 'ليس الآن', 'لا[,،]?\\s*شكرا'],
    shortDecline: ['لاحقا', 'لاحقًا', 'ليس الآن', 'لا[,،]?\\s*شكرا'],
    docs: ['مستندات', 'وثائق', 'ملفات'],
    meeting: ['موعد', 'اجتماع', 'احجز'],
  },
  urdu: {
    decline: ['بعد میں', 'ابھی نہیں', 'نہیں[,،]?\\s*شکریہ', 'رہنے دیں', 'رہنے دو'],
    shortDecline: ['بعد میں', 'ابھی نہیں', 'نہیں[,،]?\\s*شکریہ', 'رہنے دیں', 'رہنے دو'],
    docs: ['دستاویزات', 'دستاویز', 'کاغذات', 'فائل'],
    meeting: ['ملاقات', 'میٹنگ', 'اپوائنٹمنٹ', 'ملنا'],
  },
  hindi: {
    decline: ['बाद में', 'अभी नहीं', 'नहीं,?\\s*धन्यवाद', 'रहने दीजिए', 'रहने दो'],
    shortDecline: ['बाद में', 'अभी नहीं', 'नहीं,?\\s*धन्यवाद', 'रहने दीजिए', 'रहने दो'],
    docs: ['दस्तावेज़', 'दस्तावेज', 'फ़ाइल', 'फाइल', 'कागज़', 'कागज'],
    meeting: ['मीटिंग', 'अपॉइंटमेंट', 'मुलाकात', 'मिलना'],
  },
  punjabi: {
    decline: ['ਬਾਅਦ ਵਿੱਚ', 'ਹੁਣ ਨਹੀਂ', 'ਨਹੀਂ,?\\s*ਧੰਨਵਾਦ', 'ਰਹਿਣ ਦਿਓ'],
    shortDecline: ['ਬਾਅਦ ਵਿੱਚ', 'ਹੁਣ ਨਹੀਂ', 'ਨਹੀਂ,?\\s*ਧੰਨਵਾਦ', 'ਰਹਿਣ ਦਿਓ'],
    docs: ['ਦਸਤਾਵੇਜ਼', 'ਦਸਤਾਵੇਜ', 'ਫਾਈਲ', 'ਫ਼ਾਈਲ', 'ਕਾਗਜ਼'],
    meeting: ['ਮੀਟਿੰਗ', 'ਮੁਲਾਕਾਤ', 'ਮਿਲਣਾ', 'ਅਪੌਇੰਟਮੈਂਟ'],
  },
  tamil: {
    decline: ['பிறகு', 'அப்புறம்', 'இப்போது வேண்டாம்', 'வேண்டாம்'],
    shortDecline: ['பிறகு', 'அப்புறம்', 'இப்போது வேண்டாம்', 'வேண்டாம்'],
    docs: ['ஆவண', 'கோப்பு'],
    meeting: ['சந்திப்பு', 'சந்திக்க'],
  },
  mandarin: {
    decline: ['以后', '稍后', '晚点', '现在不', '不用了', '不了'],
    shortDecline: ['以后', '稍后', '晚点', '现在不', '不用了', '不了'],
    docs: ['文件', '材料', '资料'],
    meeting: ['预约', '见面', '开会'],
  },
};

const allWords = (key) => Object.values(VISITOR_WORDS).flatMap((pack) => pack[key] || []);
export const DECLINE_WORDS_RE = new RegExp(`(${allWords('decline').join('|')})`, 'i');
export const DOCUMENT_WORDS_RE = new RegExp(`(${allWords('docs').join('|')})`, 'i');
export const SHORT_DECLINE_RE = new RegExp(`^(non|no|لا|نہیں|नहीं|ਨਹੀਂ|இல்லை|不)?[,،\\s]*(${allWords('shortDecline').join('|')})[.!।,،，。！\\s]*(thanks|merci|gracias|شكرا|شکریہ|धन्यवाद|ਧੰਨਵਾਦ|நன்றி|谢谢)?[.!।。！\\s]*$`, 'i');
export const MEETING_WORDS_RE = new RegExp(`(${allWords('meeting').join('|')})`, 'i');

/** Row lookup with English fallback (labels) or '' (replies the caller should leave to the model). */
export function localizedCopy(table, language = 'english', { fallbackToEnglish = false } = {}) {
  return table[language] || (fallbackToEnglish ? table.english : null) || null;
}
