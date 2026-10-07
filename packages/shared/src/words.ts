import { round2, DecInput } from './money';

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below100(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? ONES[h] + ' Hundred' : '', r ? below100(r) : ''].filter(Boolean).join(' ');
}

/** Integer to words using the Indian/Nepali system: Thousand, Lakh, Crore (Arab, Kharab beyond). */
function intToWordsLakh(n: bigint): string {
  if (n === 0n) return 'Zero';
  const parts: string[] = [];
  const units: [bigint, string][] = [
    [10n ** 11n, 'Kharab'],
    [10n ** 9n, 'Arab'],
    [10n ** 7n, 'Crore'],
    [10n ** 5n, 'Lakh'],
    [10n ** 3n, 'Thousand'],
  ];
  let rem = n;
  for (const [size, name] of units) {
    if (rem >= size) {
      const q = rem / size;
      parts.push((q >= 100n ? intToWordsLakh(q) : below100(Number(q))) + ' ' + name);
      rem %= size;
    }
  }
  if (rem > 0n) parts.push(below1000(Number(rem)));
  return parts.join(' ');
}

/** Integer to words using the international system: Thousand, Million, Billion, Trillion. */
function intToWordsIntl(n: bigint): string {
  if (n === 0n) return 'Zero';
  const scales = ['', 'Thousand', 'Million', 'Billion', 'Trillion', 'Quadrillion'];
  const groups: number[] = [];
  let rem = n;
  while (rem > 0n) {
    groups.push(Number(rem % 1000n));
    rem /= 1000n;
  }
  const out: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i]) out.push(below1000(groups[i]) + (scales[i] ? ' ' + scales[i] : ''));
  }
  return out.join(' ');
}

const CURRENCY_WORDS: Record<string, [string, string]> = {
  NPR: ['Rupees', 'Paisa'],
  INR: ['Rupees', 'Paise'],
  AUD: ['Dollars', 'Cents'],
  USD: ['Dollars', 'Cents'],
};

/**
 * Amount in words for invoices, e.g. NPR 1,25,000.50 →
 * "Rupees One Lakh Twenty-Five Thousand and Paisa Fifty Only".
 */
export function amountInWords(amount: DecInput, currency = 'NPR', system?: 'LAKH' | 'MILLION'): string {
  const v = round2(amount);
  const neg = v.isNeg();
  const [ip, fp] = v.abs().toFixed(2).split('.');
  const sys = system ?? (currency === 'NPR' || currency === 'INR' ? 'LAKH' : 'MILLION');
  const conv = sys === 'LAKH' ? intToWordsLakh : intToWordsIntl;
  const [major, minor] = CURRENCY_WORDS[currency] ?? [currency, 'Cents'];
  let text = `${major} ${conv(BigInt(ip))}`;
  const cents = Number(fp);
  if (cents) text += ` and ${minor} ${below100(cents)}`;
  return (neg ? 'Minus ' : '') + text + ' Only';
}
