// Fetch Standard §2.9 applies to browsers and Node fetch, including loopback.
// https://fetch.spec.whatwg.org/#port-blocking
const blockedPorts = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179,
  389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601,
  636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000,
  6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);
export const isBrowserBlockedPort = port => blockedPorts.has(port);

// URL normalizes explicit :80/:443 to an empty .port. Empty is not port zero.
export function httpUrlPort(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid HTTP URL');
  return Number(url.port || (url.protocol === 'https:' ? 443 : 80));
}
