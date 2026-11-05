const API = token => `https://api.telegram.org/bot${token}`;

function htmlToPlainText(text) {
  return String(text ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:b|strong|i|em|u|s|code|pre)>/gi, '')
    .replace(/<a\s+href="[^"]*">/gi, '')
    .replace(/<\/a>/gi, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function telegramSend(
  token,
  payload
) {
  const res =
    await fetch(
      API(token) + '/sendMessage',
      {
        method: 'POST',
        headers: {
          'content-type':
            'application/json'
        },
        body:
          JSON.stringify(
            payload
          )
      }
    );

  const raw =
    await res.text();

  let data = null;

  try {
    data =
      raw
        ? JSON.parse(raw)
        : null;
  } catch {
    data = null;
  }

  return {
    res,
    raw,
    data
  };
}

export async function sendMessage(
  token,
  chatId,
  text
) {
  const htmlAttempt =
    await telegramSend(
      token,
      {
        chat_id:
          chatId,
        text:
          String(text ?? ''),
        parse_mode:
          'HTML',
        disable_web_page_preview:
          true
      }
    );

  if (htmlAttempt.res.ok) {
    return htmlAttempt.data;
  }

  const description =
    String(
      htmlAttempt.data?.description ||
      htmlAttempt.raw ||
      ''
    );

  const parseError =
    htmlAttempt.res.status === 400 &&
    (
      description.includes(
        "can't parse entities"
      ) ||
      description.includes(
        'Unsupported start tag'
      ) ||
      description.includes(
        'Unsupported end tag'
      )
    );

  if (!parseError) {
    throw new Error(
      `Telegram ${htmlAttempt.res.status}: ${htmlAttempt.raw}`
    );
  }

  // V1.7.1:
  // Um caractere dinâmico como "<" não pode derrubar o scan inteiro.
  // Se o HTML do Telegram rejeitar a mensagem, reenvia sem parse_mode.
  const plainText =
    htmlToPlainText(
      text
    );

  console.warn(
    '[telegram] HTML inválido; reenviando mensagem em texto puro'
  );

  const plainAttempt =
    await telegramSend(
      token,
      {
        chat_id:
          chatId,
        text:
          plainText,
        disable_web_page_preview:
          true
      }
    );

  if (!plainAttempt.res.ok) {
    throw new Error(
      `Telegram ${plainAttempt.res.status}: ${plainAttempt.raw}`
    );
  }

  return plainAttempt.data;
}

export async function getUpdates(token, offset, timeout = 25) {
  const url = new URL(API(token) + '/getUpdates');
  url.searchParams.set('timeout', String(timeout));
  if (offset) url.searchParams.set('offset', String(offset));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Telegram polling ${res.status}: ${await res.text()}`);
  return res.json();
}
