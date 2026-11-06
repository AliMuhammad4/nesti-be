import { DOCUMENT_REQUESTS, idsOf, labelOf } from '../../professionalAssistant/catalog.js';
import { visitorSkipsDocumentRequest } from '../utils/chatBookingReply.js';
import { documentCoversRequest } from './documentCoverage.js';
import { requestDocumentForReply } from './documentAsk.js';
function payingCashFromContext(context = {}) {
  const status = String(context.mortgageStatus || context.mortgage_status || '').trim().toLowerCase();
  if (status === 'paying_cash' || status === 'cash') return true;
  const text = `${context.text || ''}`;
  return /\b(paying cash|pay(ing)? (all )?cash|all[- ]cash|cash purchase|cash buyer)\b/i.test(text);
}

export function requestContext(intentOrContext) {
  if (typeof intentOrContext === 'string') {
    return { intent: intentOrContext, text: '', propertyImages: false, clientType: '', mortgageStatus: '' };
  }
  return {
    intent: String(intentOrContext?.intent || ''),
    text: String(intentOrContext?.text || ''),
    propertyImages: Boolean(intentOrContext?.propertyImages),
    clientType: String(intentOrContext?.clientType || '').trim().toLowerCase(),
    mortgageStatus: String(intentOrContext?.mortgageStatus || intentOrContext?.mortgage_status || '').trim().toLowerCase(),
  };
}

function agentAudience(context) {
  const explicit = String(context.clientType || '').trim().toLowerCase();
  if (explicit === 'buyer' || explicit === 'seller' || explicit === 'investor') return explicit;
  const text = `${context.intent} ${context.text}`;
  if (context.intent === 'sell' || /\b(sell|selling|list my|listing my home)\b/i.test(text)) return 'seller';
  if (/\b(investor|investment|rental income|fix and flip)\b/i.test(text)) return 'investor';
  return 'buyer';
}

export function intakeHasPropertyImages(form) {
  const images = form?.property_images || form?.property?.images || form?.images;
  if (!Array.isArray(images)) return false;
  return images.some((image) => {
    if (typeof image === 'string') return image.trim().length > 0;
    return Boolean(String(image?.secure_url || image?.url || '').trim());
  });
}

function orderedRequestIds(role, wanted, context) {
  const text = `${context.intent} ${context.text}`;
  const condo = /\b(condo|condominium|strata)\b/i.test(text);
  const cashPurchase = payingCashFromContext(context);
  let order = wanted;
  if (role === 'agent') {
    const audience = agentAudience(context);
    let forVisitor;
    if (audience === 'seller') {
      forVisitor = ['home_photos', 'listing_sheet', 'photo_id'];
    } else if (audience === 'investor') {
      // Investors: capital proof first; skip pre-approval when they are paying cash.
      forVisitor = cashPurchase
        ? ['proof_of_funds', 'photo_id']
        : ['proof_of_funds', 'photo_id', 'preapproval_letter'];
    } else {
      forVisitor = cashPurchase
        ? ['proof_of_funds', 'photo_id']
        : ['preapproval_letter', 'proof_of_funds', 'photo_id'];
    }
    return forVisitor.filter((id) => wanted.includes(id) && !(id === 'home_photos' && context.propertyImages));
  } else if (role === 'mortgage_broker') {
    if (/\brenew/i.test(text)) order = ['mortgage_statement', 'photo_id', 'notice_of_assessment', 'pay_stubs', 'preapproval_letter'];
    else if (/\brefinanc/i.test(text)) order = ['mortgage_statement', 'pay_stubs', 'notice_of_assessment', 'photo_id', 'preapproval_letter'];
    else order = ['pay_stubs', 'notice_of_assessment', 'photo_id', 'preapproval_letter', 'mortgage_statement'];
  } else if (role === 'lawyer') {
    order = ['purchase_agreement', 'photo_id', 'title_deed', 'mortgage_commitment', ...(condo ? ['condo_status'] : [])];
  }
  const ranked = [...order.filter((id) => wanted.includes(id)), ...wanted.filter((id) => !order.includes(id))];
  if (role === 'lawyer' && !condo) {
    const withoutCondo = ranked.filter((id) => id !== 'condo_status');
    return withoutCondo.length ? withoutCondo : ranked;
  }
  return ranked;
}

export function documentRequestIds(setting, intentOrContext = '') {
  const catalog = DOCUMENT_REQUESTS[setting?.role] || [];
  const allowed = new Set(idsOf(catalog));
  const selected = (Array.isArray(setting?.document_requests) ? setting.document_requests : []).filter((id) => allowed.has(id));
  if (!selected.length) return [];
  return orderedRequestIds(setting?.role, selected, requestContext(intentOrContext));
}

export function nextDocumentRequest(setting, documents = [], intentOrContext = '', skipIds = []) {
  const catalog = DOCUMENT_REQUESTS[setting?.role] || [];
  const skip = new Set(skipIds);
  const missing = documentRequestIds(setting, intentOrContext).find((id) => !skip.has(id) && labelOf(catalog, id) && !(documents || []).some((doc) => documentCoversRequest(doc, id)));
  if (!missing) return null;
  return { id: missing, label: labelOf(catalog, missing) };
}

/** Document ids the assistant already requested in prior replies (do not re-ask on a wrong upload). */
export function alreadyRequestedDocumentIds(setting, intentOrContext = '', history = [], previousReply = '') {
  const catalog = DOCUMENT_REQUESTS[setting?.role] || [];
  const ids = documentRequestIds(setting, intentOrContext);
  const texts = [
    previousReply,
    ...(Array.isArray(history) ? history : [])
      .filter((message) => message?.role === 'assistant')
      .map((message) => message.content),
  ];
  return ids.filter((id) => {
    const request = { id, label: labelOf(catalog, id) };
    return texts.some((text) => requestDocumentForReply(request, text));
  });
}

export function followUpSkipIds(setting, documents = [], intentOrContext = '', history = [], previousReply = '') {
  const catalog = DOCUMENT_REQUESTS[setting?.role] || [];
  const ids = documentRequestIds(setting, intentOrContext);
  const messages = Array.isArray(history) ? [...history] : [];
  const hasPreviousReply = messages.some(
    (message) => message?.role === 'assistant' && String(message.content || '') === String(previousReply || ''),
  );
  if (previousReply && !hasPreviousReply) {
    const lastUserIndex = messages.map((message) => message?.role).lastIndexOf('user');
    messages.splice(lastUserIndex < 0 ? messages.length : lastUserIndex, 0, {
      role: 'assistant',
      content: previousReply,
    });
  }

  const outstanding = new Set();
  const skipped = new Set();
  for (const message of messages) {
    if (message?.role === 'assistant') {
      for (const id of ids) {
        const request = { id, label: labelOf(catalog, id) };
        if (requestDocumentForReply(request, message.content)) outstanding.add(id);
      }
      continue;
    }
    if (message?.role !== 'user' || !outstanding.size) continue;
    let skippedRequest = false;
    for (const id of [...outstanding]) {
      if (!visitorSkipsDocumentRequest(message.content, labelOf(catalog, id))) continue;
      skipped.add(id);
      outstanding.delete(id);
      skippedRequest = true;
    }
    if (!skippedRequest && Array.isArray(message?.meta?.attachments) && message.meta.attachments.length) {
      outstanding.clear();
    }
  }

  return ids.filter((id) => skipped.has(id) && !(documents || []).some((doc) => documentCoversRequest(doc, id)));
}
