const API = token => `https://api.telegram.org/bot${token}`;

export async function sendMessage(token, chatId, text) {
  const res = await fetch(API(token) + '/sendMessage', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function getUpdates(token, offset, timeout = 25) {
  const url = new URL(API(token) + '/getUpdates');
  url.searchParams.set('timeout', String(timeout));
  if (offset) url.searchParams.set('offset', String(offset));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Telegram polling ${res.status}: ${await res.text()}`);
  return res.json();
}
