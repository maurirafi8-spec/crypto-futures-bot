const VERSION = '1.10.1-google-sync-verified';

// IDs da estrutura que já existe no seu Drive.
const SHEET_ID = '1rhoLz9SRSaudiBcbqVnJ4h7UCls_Mr8xY1PUN2tBWhc';
const DRIVE_FOLDER_ID = '1OhRhSM28aVq35Pbb1-aGnqs7j1K0mulw';

function configurarArquivosExistentes() {
  const props = PropertiesService.getScriptProperties();

  props.setProperty('SHEET_ID', SHEET_ID);
  props.setProperty('DRIVE_FOLDER_ID', DRIVE_FOLDER_ID);

  let token = props.getProperty('SYNC_TOKEN');

  if (!token) {
    token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('SYNC_TOKEN', token);
  }

  console.log('CONFIGURAÇÃO OK');
  console.log('SHEET_ID=' + SHEET_ID);
  console.log('DRIVE_FOLDER_ID=' + DRIVE_FOLDER_ID);
  console.log('SYNC_TOKEN=' + token);
}

function doGet() {
  const props = PropertiesService.getScriptProperties();

  return json_({
    ok: true,
    written: false,
    service: 'crypto-futures-google-sync',
    version: VERSION,
    configured: Boolean(
      props.getProperty('SYNC_TOKEN') &&
      props.getProperty('SHEET_ID') &&
      props.getProperty('DRIVE_FOLDER_ID')
    ),
    sheetId: props.getProperty('SHEET_ID') || '',
    folderId: props.getProperty('DRIVE_FOLDER_ID') || ''
  });
}

function doPost(e) {
  try {
    const body = JSON.parse(
      e && e.postData && e.postData.contents
        ? e.postData.contents
        : '{}'
    );

    const props = PropertiesService.getScriptProperties();
    const expected = props.getProperty('SYNC_TOKEN');

    if (!expected) {
      return json_({
        ok: false,
        written: false,
        error: 'SYNC_TOKEN não configurado no Apps Script'
      });
    }

    if (String(body.token || '') !== String(expected)) {
      return json_({
        ok: false,
        written: false,
        error: 'token inválido'
      });
    }

    const sheetId = props.getProperty('SHEET_ID') || SHEET_ID;
    const folderId = props.getProperty('DRIVE_FOLDER_ID') || DRIVE_FOLDER_ID;

    const ss = SpreadsheetApp.openById(sheetId);
    const events = ss.getSheetByName('Events');

    if (!events) {
      return json_({
        ok: false,
        written: false,
        error: 'aba Events não encontrada'
      });
    }

    const event = String(body.event || 'UNKNOWN');
    const payload = body.payload || {};
    const signal =
      payload.signal ||
      payload.trade ||
      payload.item ||
      {};

    // SEMPRE registra o recebimento em Events.
    events.appendRow([
      new Date(),
      event,
      signal.symbol || '',
      signal.side || '',
      signal.entryMode || signal.setupEntryMode || '',
      Number(signal.score || 0),
      Number(
        signal &&
        signal.ai &&
        signal.ai.confidence != null
          ? signal.ai.confidence
          : signal.aiConfidence || 0
      ),
      payload.reason ||
        payload.outcome ||
        payload.message ||
        (event === 'TEST' ? 'Teste do bot recebido pelo webhook' : ''),
      payload.phase || '',
      String(body.version || VERSION)
    ]);

    // Se houver snapshot, atualiza backup.
    if (payload.snapshot) {
      writeLatestBackup_(folderId, payload.snapshot);
    }

    // Trade aberto/fechado também vai para Trades.
    if (
      event === 'PAPER_TRADE_OPENED' ||
      event === 'PAPER_TRADE_CLOSED'
    ) {
      appendTrade_(ss, event, payload);
    }

    SpreadsheetApp.flush();

    const row = events.getLastRow();

    return json_({
      ok: true,
      written: true,
      event,
      row,
      version: VERSION,
      sheetId
    });
  } catch (error) {
    return json_({
      ok: false,
      written: false,
      error: String(
        error && error.message
          ? error.message
          : error
      )
    });
  }
}

function appendTrade_(ss, event, payload) {
  const trades = ss.getSheetByName('Trades');
  if (!trades) return;

  const t = payload.trade || {};
  const snap = payload.snapshot || {};

  trades.appendRow([
    new Date(Number(t.closedAt || t.openedAt || Date.now())),
    event,
    t.id || '',
    t.symbol || '',
    t.side || '',
    t.setupEntryMode || '',
    t.quickScalpEnabled ? 'ELITE QUICK SCALP' : (t.strategyProfile || ''),
    Number(t.score || 0),
    Number(t.aiConfidence || 0),
    Number(t.entryFill || 0),
    Number(t.exitMark || 0),
    Number(t.initialNotional || 0),
    Number(t.initialMargin || 0),
    Number(t.leverage || 0),
    event === 'PAPER_TRADE_CLOSED' ? Number(t.netPnl || 0) : '',
    event === 'PAPER_TRADE_CLOSED' ? Number(t.totalFees || 0) : Number(t.entryFee || 0),
    event === 'PAPER_TRADE_CLOSED' ? Number(t.returnOnMarginPct || 0) : '',
    Number(t.mfeR || 0),
    Number(t.maeR || 0),
    t.outcome || '',
    t.setupMarketRegime || '',
    t.setupOiContextRegime || '',
    t.confirmedEntryUsed ? 'SIM' : 'NÃO',
    Number(t.confirmedEntryChaseAtr || 0),
    Number(t.quickScalpTargetNetUsdc || 0),
    Number(t.quickScalpStopNetUsdc || 0),
    Number(snap.balance || 0)
  ]);
}

function writeLatestBackup_(folderId, snapshot) {
  const folder = DriveApp.getFolderById(folderId);
  const name = 'paper-state-latest.json';
  const content = JSON.stringify(snapshot, null, 2);
  const files = folder.getFilesByName(name);

  if (files.hasNext()) {
    files.next().setContent(content);
  } else {
    folder.createFile(name, content, MimeType.PLAIN_TEXT);
  }
}

// Teste SEM Render: executa dentro do Apps Script e deve criar uma linha em Events.
function testeDiretoNaPlanilha() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const events = ss.getSheetByName('Events');

  events.appendRow([
    new Date(),
    'TESTE_DIRETO',
    '',
    '',
    '',
    '',
    '',
    'Gravação direta do Apps Script V1.10.1',
    'DIAGNOSTICO',
    VERSION
  ]);

  SpreadsheetApp.flush();
  console.log('TESTE_DIRETO gravado na linha ' + events.getLastRow());
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
