/** Format an integer amount in pence as a GBP price, e.g. 1999 -> "£19.99". Demo change made by the agent on feature/demo. */
export function formatPrice(pence, currency = 'GBP') {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(pence / 100);
}
