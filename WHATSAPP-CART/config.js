// Follow-up stages for one abandoned cart.
// `delayMinutes` counts from the moment Salla reported the cart.
// `text(cart)` returns the WhatsApp message body.
// Remove a stage here and it stops being scheduled for new carts.

const stages = [
  {
    delayMinutes: 45,
    text: (cart) =>
      `هلا ${cart.name || ''} 👋\n` +
      `لاحظنا إنك تركت سلتك بدون ما تكمل الطلب.\n` +
      (cart.total ? `إجمالي السلة: ${cart.total} ${cart.currency || ''}\n` : '') +
      (cart.checkout_url ? `تقدر تكمل من هنا: ${cart.checkout_url}\n` : '') +
      `\nلو واجهتك أي مشكلة راسلنا وبنساعدك.\n` +
      `للإيقاف اكتب: إلغاء`,
  },
  {
    delayMinutes: 60 * 24,
    text: (cart) =>
      `تذكير أخير ${cart.name || ''} 🌟\n` +
      `سلتك لا تزال محفوظة، والكميات محدودة.\n` +
      (cart.checkout_url ? `${cart.checkout_url}\n` : '') +
      `\nللإيقاف اكتب: إلغاء`,
  },
];

// Incoming replies containing any of these opt the customer out permanently.
const optOutKeywords = ['الغاء', 'إلغاء', 'ايقاف', 'إيقاف', 'stop', 'unsubscribe'];

module.exports = { stages, optOutKeywords };
