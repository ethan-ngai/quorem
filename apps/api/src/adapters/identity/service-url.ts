export function serviceURL(value: string, originOnly: boolean): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid identity service URL'); }
  const hostname = url.hostname.toLowerCase();
  const loopback = hostname === 'localhost' || hostname === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
  if (url.username || url.password || url.href.includes('#') || url.href.includes('?') ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      (originOnly && url.pathname !== '/')) throw new Error('Invalid identity service URL');
  return url;
}
