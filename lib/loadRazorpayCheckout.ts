// Loads Razorpay's Checkout.js once and caches the promise, so multiple
// "Go Pro" clicks (or multiple UpgradeCard instances) don't inject the
// script tag more than once.
let loadPromise: Promise<void> | null = null;

export function loadRazorpayCheckout(): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).Razorpay) {
    return Promise.resolve();
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load the payment form. Check your connection.'));
    document.body.appendChild(script);
  });

  return loadPromise;
}
