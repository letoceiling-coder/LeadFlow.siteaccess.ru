import type { OfferLetter } from "./offer-content";

type Reply = {
  phone: { display: string; href: string } | null;
  email: string | null;
  telegram: string | null;
  max: string | null;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

function httpsUrl(value: string | null | undefined) {
  if (!value || !/^https:\/\/\S+$/i.test(value)) return "";
  return value;
}

function brand(file: string) {
  const base = (process.env.APP_URL || "https://leadflow.siteaccess.ru").replace(/\/$/, "");
  const root = base.startsWith("https://") ? base : "https://leadflow.siteaccess.ru";
  return `${root}/brand/${file}`;
}

function button(href: string, label: string, bg: string, color: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${bg}" style="border-radius:8px;background:${bg};"><a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:14px 22px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;font-weight:bold;color:${color};text-decoration:none;">${escapeHtml(label)}</a></td></tr></table>`;
}

function ghostButton(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#ffffff" style="border:1px solid #1c2422;border-radius:8px;background:#ffffff;"><a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:12px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:18px;font-weight:bold;color:#1c2422;text-decoration:none;">${escapeHtml(label)}</a></td></tr></table>`;
}

function card(title: string, text: string, icon: string) {
  const src = brand(`benefit-${icon}.png`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f4ee;border-radius:12px;"><tr><td style="padding:16px;">
    <img src="${src}" width="36" height="36" alt="" style="display:block;width:36px;height:36px;border:0;">
    <div class="ink" style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:22px;font-weight:bold;color:#172421;padding-top:10px;">${escapeHtml(title)}</div>
    <div class="muted" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#5c6562;padding-top:6px;">${escapeHtml(text)}</div>
  </td></tr></table>`;
}

export function renderOfferHtml(input: {
  letter: OfferLetter;
  name: string;
  siteUrl: string;
  optOutUrl: string;
  desktopShot?: string | null;
  mobileShot?: string | null;
  reply: Reply;
}) {
  const letter = input.letter;
  const siteUrl = httpsUrl(input.siteUrl);
  const optOutUrl = httpsUrl(input.optOutUrl);
  const desktop = httpsUrl(input.desktopShot);
  const mobile = httpsUrl(input.mobileShot);
  const logo = brand("logo.png");
  const shot = desktop
    ? `<a href="${escapeHtml(siteUrl)}" target="_blank" style="text-decoration:none;"><img src="${escapeHtml(desktop)}" width="592" alt="Главный экран демонстрационного сайта ${escapeHtml(input.name)}" style="display:block;width:100%;max-width:592px;height:auto;border:0;border-radius:12px;"></a>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f4ee;border-radius:12px;"><tr><td style="padding:28px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#172421;">Скриншот первого экрана появится рядом со ссылкой. Открыть демонстрационный сайт ${escapeHtml(input.name)} можно кнопкой ниже.</td></tr></table>`;
  const phone = mobile
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr><td bgcolor="#1c2422" style="background:#1c2422;border-radius:24px;padding:10px;">
        <img src="${escapeHtml(mobile)}" width="220" alt="Мобильная версия демонстрационного сайта ${escapeHtml(input.name)}" style="display:block;width:220px;max-width:100%;height:auto;border:0;border-radius:16px;">
      </td></tr></table>
      <div class="muted" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:19px;color:#5c6562;padding-top:10px;">На экране — мобильная версия уже собранного сайта. Мини-приложение собирается отдельно и открывается внутри мессенджера.</div>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#172421;border-radius:16px;"><tr><td style="padding:22px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#f6f4ef;">Мини-приложение открывается в Telegram или MAX. Отдельная установка из магазина приложений не нужна.</td></tr></table>`;
  const benefits = letter.benefits
    .map((item, index) => {
      const cell = `<td class="stack" width="50%" valign="top" style="width:50%;padding:6px;vertical-align:top;">${card(item.title, item.text, item.icon)}</td>`;
      if (index % 2 === 0) return `<tr>${cell}`;
      return `${cell}</tr>`;
    })
    .join("");
  const benefitRows = letter.benefits.length % 2 === 0 ? benefits : `${benefits}<td class="stack" width="50%" style="width:50%;padding:6px;"></td></tr>`;
  const features = letter.miniappFeatures.map((item) => `<tr><td style="padding:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#172421;" class="ink">• ${escapeHtml(item)}</td></tr>`).join("");
  const steps = letter.retentionSteps.map((item, index) => `<tr><td width="28" valign="top" style="width:28px;padding:0 8px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;font-weight:bold;color:#1f6f64;">${index + 1}</td><td style="padding:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#172421;" class="ink">${escapeHtml(item)}</td></tr>`).join("");
  const groups = letter.serviceGroups
    .map(
      (group) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px 0;"><tr><td class="line" style="border:1px solid #e4ddd2;border-radius:12px;padding:16px;">
        <div class="ink" style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:22px;font-weight:bold;color:#172421;">${escapeHtml(group.title)}</div>
        <div class="muted" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#5c6562;padding-top:6px;">${group.items.map((item) => escapeHtml(item)).join(" · ")}</div>
      </td></tr></table>`,
    )
    .join("");
  const paragraphs = letter.paragraphs
    .map((item) => `<div class="ink" style="font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:25px;color:#172421;padding-bottom:12px;">${escapeHtml(item)}</div>`)
    .join("");
  const cta = letter.ctaParagraphs
    .map((item) => `<div class="ink" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#172421;padding-bottom:10px;">${escapeHtml(item)}</div>`)
    .join("");
  const contacts = [
    input.reply.phone ? contact("phone.png", "Телефон", input.reply.phone.display, input.reply.phone.href) : "",
    input.reply.email ? contact("mail.png", "Почта", input.reply.email, `mailto:${input.reply.email}`) : "",
    input.reply.telegram ? contact("telegram.png", "Telegram", "Написать в Telegram", input.reply.telegram) : "",
    input.reply.max ? contact("max.png", "MAX", "Написать в MAX", input.reply.max) : "",
  ]
    .filter(Boolean)
    .join("");
  const discuss = input.reply.email
    ? `mailto:${input.reply.email}?subject=${encodeURIComponent(letter.subject)}`
    : input.reply.telegram || input.reply.max || siteUrl;
  const secondary = [
    input.reply.telegram ? ghostButton(input.reply.telegram, "Написать в Telegram") : "",
    input.reply.max ? ghostButton(input.reply.max, "Написать в MAX") : "",
  ].filter(Boolean);
  const secondaryRow = secondary
    .map((item) => `<td class="stack" style="padding:0 8px 8px 0;">${item}</td>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(letter.subject)}</title>
<style>
@media only screen and (max-width:640px){
  .wrap{width:100%!important;}
  .pad{padding-left:16px!important;padding-right:16px!important;}
  .stack{display:block!important;width:100%!important;box-sizing:border-box!important;}
}
@media (prefers-color-scheme:dark){
  .page{background:#161918!important;}
  .card{background:#232826!important;}
  .ink{color:#f4f1ea!important;}
  .muted{color:#c9c3b8!important;}
  .line{border-color:#3c4440!important;}
}
</style>
</head>
<body class="page" style="margin:0;padding:0;background:#e8e3d9;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;color:#e8e3d9;">${escapeHtml(letter.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="page" bgcolor="#e8e3d9" style="background:#e8e3d9;margin:0;padding:0;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" class="wrap card" bgcolor="#ffffff" style="width:640px;max-width:640px;background:#ffffff;border-radius:16px;">
<tr><td class="pad" style="padding:28px 24px 8px 24px;">
  <img src="${logo}" width="168" height="34" alt="SHOTBRO" style="display:block;width:168px;height:auto;border:0;">
  <div class="muted" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#5c6562;padding-top:8px;">SHOTBRO — цифровые решения для бизнеса</div>
</td></tr>
<tr><td class="pad" style="padding:20px 24px 8px 24px;">
  <div class="ink" style="font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:36px;color:#172421;">${escapeHtml(letter.headline)}</div>
  <div class="ink" style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#1f6f64;padding-top:12px;">${escapeHtml(letter.subhead)}</div>
</td></tr>
<tr><td class="pad" style="padding:8px 24px 8px 24px;">${paragraphs}</td></tr>
<tr><td class="pad" style="padding:8px 24px 8px 24px;">${shot}</td></tr>
<tr><td class="pad" style="padding:16px 24px 4px 24px;">${button(siteUrl, letter.shotCaption, "#172421", "#ffffff")}</td></tr>
<tr><td class="pad" style="padding:10px 24px 8px 24px;"><div class="muted" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#5c6562;">${escapeHtml(letter.shotDisclaimer)}</div></td></tr>
<tr><td class="pad" style="padding:22px 18px 8px 18px;">
  <div class="ink" style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;color:#172421;padding:0 6px 10px 6px;">Что это может дать вашему бизнесу?</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${benefitRows}</table>
</td></tr>
<tr><td class="pad" style="padding:18px 24px 8px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f7f4ee" style="background:#f7f4ee;border-radius:16px;"><tr>
    <td class="stack" width="240" valign="top" style="width:240px;padding:18px;vertical-align:top;">${phone}</td>
    <td class="stack" valign="top" style="padding:18px;vertical-align:top;">
      <div class="ink" style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;color:#172421;">${escapeHtml(letter.miniappTitle)}</div>
      <div class="ink" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#1f6f64;padding-top:8px;">${escapeHtml(letter.miniappLead)}</div>
      <div class="muted" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#5c6562;padding:10px 0;">${escapeHtml(letter.miniappNote)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${features}</table>
    </td>
  </tr></table>
</td></tr>
<tr><td class="pad" style="padding:18px 24px 8px 24px;">
  <div class="ink" style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;color:#172421;">${escapeHtml(letter.retentionTitle)}</div>
  <div class="ink" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#172421;padding-top:10px;">${escapeHtml(letter.retentionLead)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="padding-top:12px;">${steps}</table>
  <div class="muted" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#5c6562;padding-top:6px;">${escapeHtml(letter.retentionClose)}</div>
</td></tr>
${
  groups
    ? `<tr><td class="pad" style="padding:18px 24px 8px 24px;">
  <div class="ink" style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;color:#172421;padding-bottom:8px;">${escapeHtml(letter.serviceTitle)}</div>
  <div class="muted" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#5c6562;padding-bottom:12px;">SHOTBRO закрывает не только сайт: разработку, продвижение, автоматизацию и работу с клиентской базой можно собрать у одного партнёра. Ниже — то, что ближе к этой задаче.</div>
  ${groups}
</td></tr>`
    : ""
}
<tr><td class="pad" style="padding:12px 24px 8px 24px;">
  <div class="ink" style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;color:#172421;padding-bottom:10px;">${escapeHtml(letter.ctaTitle)}</div>
  ${cta}
  <div style="padding-top:6px;">${button(discuss, "Обсудить проект", "#1f6f64", "#ffffff")}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;"><tr>${secondaryRow}</tr></table>
</td></tr>
<tr><td class="pad" bgcolor="#172421" style="padding:24px;background:#172421;border-radius:0 0 16px 16px;">
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:24px;font-weight:bold;color:#ffffff;">SHOTBRO</div>
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#d9d3c8;padding:4px 0 14px 0;">Разработка · Маркетинг · Автоматизация · AI</div>
  ${contacts}
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#d9d3c8;padding-top:16px;">Если вы не хотите получать от нас предложения, вы можете отказаться от дальнейших сообщений.</div>
  <div style="padding-top:6px;"><a href="${escapeHtml(optOutUrl)}" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#ffffff;text-decoration:underline;">Отписаться от рассылки</a></div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function contact(icon: string, label: string, text: string, href: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;"><tr>
    <td width="28" valign="middle" style="width:28px;"><img src="${brand(icon)}" width="20" height="20" alt="${escapeHtml(label)}" style="display:block;width:20px;height:20px;border:0;"></td>
    <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;"><a href="${escapeHtml(href)}" target="_blank" style="color:#ffffff;text-decoration:underline;">${escapeHtml(text)}</a></td>
  </tr></table>`;
}
