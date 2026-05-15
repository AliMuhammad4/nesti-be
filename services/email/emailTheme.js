export const EMAIL_BRAND = {
  primary: '#34C759',
  primaryDark: '#2AA84A',
  pageBg: '#f3faf5',
  cardBg: '#ffffff',
  border: '#e2e8f0',
  heading: '#2D3748',
  body: '#4A5568',
  muted: '#718096',
  link: '#2AA84A',
  ctaBlue: '#006BFF',
};

export const EMAIL_FONT = {
  heading: "Inter,Segoe UI,Arial,sans-serif",
  body: "Poppins,Segoe UI,Arial,sans-serif",
};

export const EMAIL_ICON_BADGE_HTML =
  `<div style="height:30px;width:30px;border-radius:8px;background:#ffffff;color:${EMAIL_BRAND.primaryDark};font-family:${EMAIL_FONT.heading};font-size:16px;font-weight:800;line-height:30px;text-align:center;">N</div>`;

export const EMAIL_LINK_STYLE = `color:${EMAIL_BRAND.link};text-decoration:underline;font-weight:600;`;
export const EMAIL_GREEN_CTA_STYLE = `display:inline-block;background:${EMAIL_BRAND.primaryDark};color:#ffffff !important;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;`;
export const EMAIL_BLUE_CTA_STYLE = `display:inline-block;background:${EMAIL_BRAND.ctaBlue};color:#ffffff !important;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;`;

export function renderBrandedEmailShell({ kicker, title, innerHtml, footerHtml = '', maxWidth = 600 }) {
  const safeKicker = String(kicker || '').trim();
  const safeTitle = String(title || '').trim();
  const safeInner = String(innerHtml || '').trim();
  const safeFooter = String(footerHtml || '').trim();
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background-color:${EMAIL_BRAND.pageBg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${EMAIL_BRAND.pageBg};padding:28px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:${Number(maxWidth) || 600}px;background:${EMAIL_BRAND.cardBg};border-radius:12px;overflow:hidden;border:1px solid ${EMAIL_BRAND.border};">
      <tr><td style="background:linear-gradient(135deg,${EMAIL_BRAND.primary} 0%,${EMAIL_BRAND.primaryDark} 100%);padding:22px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="width:36px;vertical-align:middle;">${EMAIL_ICON_BADGE_HTML}</td>
            <td style="vertical-align:middle;padding-left:10px;">
              ${safeKicker ? `<div style="font-family:${EMAIL_FONT.heading};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#eaffee;">${safeKicker}</div>` : ''}
              ${safeTitle ? `<div style="font-family:${EMAIL_FONT.heading};font-size:19px;font-weight:700;color:#ffffff;margin-top:8px;line-height:1.25;">${safeTitle}</div>` : ''}
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:28px 28px 32px;font-family:${EMAIL_FONT.body};color:${EMAIL_BRAND.heading};">
        ${safeInner}
        ${safeFooter}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
