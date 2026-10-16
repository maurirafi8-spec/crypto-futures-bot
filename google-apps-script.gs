const VERSION = '1.10.0-google-sync';

const TRADE_HEADERS = [
  'Timestamp','Event','Trade ID','Symbol','Side','Setup','Profile','Score','AI %',
  'Entry','Exit','Notional USDC','Margin USDC','Leverage','PnL Net USDC','Fees USDC',
  'Return Margin %','MFE R','MAE R','Outcome','Regime','OI Regime','Confirmed Entry',
  'Chase ATR','Quick Target Net','Quick Stop Net','Balance'
];

const EVENT_HEADERS = [
  'Timestamp','Event','Symbol','Side','Setup','Score','AI %','Reason/Outcome','Phase','Version'
];

function setupCryptoBot() {
  const props = PropertiesService.getScriptProperties();

  let ss;
  const existingSheetId = props.getProperty('SHEET_ID');

  if (existingSheetId) {
    ss = SpreadsheetApp.openById(existingSheetId);
  } else {
    ss = SpreadsheetApp.create('Crypto Futures Bot — Histórico');
    props.setProperty('SHEET_ID', ss.getId());
  }

  let folder;
  const existingFolderId = props.getProperty('DRIVE_FOLDER_ID');

  if (existingFolderId) {
    folder = DriveApp.getFolderById(existingFolderId);
  } else {
    folder = DriveApp.createFolder('Crypto Futures Bot — Backups');
    props.setProperty('DRIVE_FOLDER_ID', folder.getId());
  }

  let token = props.getProperty('SYNC_TOKEN');

  if (!token) {
    token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('SYNC_TOKEN', token);
  }

  ensureSheets_(ss);

  console.log('SHEET_URL=' + ss.getUrl());
  console.log('DRIVE_FOLDER_URL=' + folder.getUrl());
  console.log('SYNC_TOKEN=' + token);
  console.log('Agora publique como Web app e copie a URL terminada em /exec.');
}

function doGet() {
  const props = PropertiesService.getScriptProperties();

  return json_({
    ok: true,
    service: 'crypto-futures-google-sync',
    version: VERSION,
    configured: Boolean(
      props.getProperty('SHEET_ID') &&
      props.getProperty('DRIVE_FOLDER_ID') &&
      props.getProperty('SYNC_TOKEN')
    )
  });
}

function doPost(e) {
  try {
    const body = JSON.parse(e?.postData?.contents || '{}');
    const props = PropertiesService.getScriptProperties();
    const expected = props.getProperty('SYNC_TOKEN');

    if (!expected || String(body.token || '') !== String(expected)) {
      return json_({ ok: false, error: 'token inválido' });
    }

    const ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
    ensureSheets_(ss);

    const event = String(body.event || 'UNKNOWN');
    const payload = body.payload || {};
    const version = String(body.version || VERSION);

    if (event === 'PAPER_TRADE_OPENED' || event === 'PAPER_TRADE_CLOSED') {
      appendTrade_(ss, event, payload, version);
    } else {
      appendEvent_(ss, event, payload, version);
    }

    if (payload.snapshot) {
      updateDashboard_(ss, payload.snapshot);
      writeLatestBackup_(payload.snapshot);

      if (event === 'PAPER_TRADE_CLOSED') {
        writeHistoricalBackup_(payload.snapshot, payload.trade || {});
      }
    }

    return json_({ ok: true, event, version });
  } catch (error) {
    return json_({ ok: false, error: String(error?.message || error) });
  }
}

function ensureSheets_(ss) {
  ['Dashboard','Trades','Events'].forEach(name => {
    if (!ss.getSheetByName(name)) ss.insertSheet(name);
  });

  const trades = ss.getSheetByName('Trades');
  if (trades.getLastRow() === 0) {
    trades.getRange(1,1,1,TRADE_HEADERS.length).setValues([TRADE_HEADERS]);
    trades.setFrozenRows(1);
  }

  const events = ss.getSheetByName('Events');
  if (events.getLastRow() === 0) {
    events.getRange(1,1,1,EVENT_HEADERS.length).setValues([EVENT_HEADERS]);
    events.setFrozenRows(1);
  }

  const dashboard = ss.getSheetByName('Dashboard');
  if (dashboard.getLastRow() === 0) {
    dashboard.getRange('A1:B14').setValues([
      ['Crypto Futures Bot','V1.10.0 Google Sync'],
      ['Última atualização','—'],
      ['Banca realizada',0],
      ['Equity',0],
      ['Trades fechados',0],
      ['Wins',0],
      ['Losses',0],
      ['Win rate',0],
      ['PnL líquido total',0],
      ['Taxas totais',0],
      ['Profit Factor',0],
      ['MFE médio R',0],
      ['MAE médio R',0],
      ['Quick trades',0]
    ]);
    dashboard.setFrozenRows(1);
  }
}

function appendTrade_(ss, event, payload, version) {
  const t = payload.trade || {};
  const snap = payload.snapshot || {};

  ss.getSheetByName('Trades').appendRow([
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

function appendEvent_(ss, event, payload, version) {
  const signal = payload.signal || payload.trade || payload.item || {};

  ss.getSheetByName('Events').appendRow([
    new Date(),
    event,
    signal.symbol || '',
    signal.side || '',
    signal.entryMode || signal.setupEntryMode || '',
    Number(signal.score || 0),
    Number(signal?.ai?.confidence ?? signal.aiConfidence ?? 0),
    payload.reason || payload.outcome || payload.message || '',
    payload.phase || '',
    version
  ]);
}

function updateDashboard_(ss, snapshot) {
  const closed = Array.isArray(snapshot.closedTrades) ? snapshot.closedTrades : [];
  const wins = closed.filter(t => Number(t.netPnl || 0) > 0.000001);
  const losses = closed.filter(t => Number(t.netPnl || 0) < -0.000001);

  const grossWins = wins.reduce((a,t) => a + Number(t.netPnl || 0), 0);
  const grossLosses = Math.abs(losses.reduce((a,t) => a + Number(t.netPnl || 0), 0));
  const pnl = closed.reduce((a,t) => a + Number(t.netPnl || 0), 0);
  const fees = closed.reduce((a,t) => a + Number(t.totalFees || 0), 0);
  const mfe = closed.length ? closed.reduce((a,t) => a + Number(t.mfeR || 0), 0) / closed.length : 0;
  const mae = closed.length ? closed.reduce((a,t) => a + Number(t.maeR || 0), 0) / closed.length : 0;
  const quick = closed.filter(t => t.quickScalpEnabled === true).length;
  const pf = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0;

  ss.getSheetByName('Dashboard').getRange('B2:B14').setValues([
    [new Date()],
    [Number(snapshot.balance || 0)],
    [Number(snapshot.equity || snapshot.balance || 0)],
    [closed.length],
    [wins.length],
    [losses.length],
    [closed.length ? wins.length / closed.length : 0],
    [pnl],
    [fees],
    [pf],
    [mfe],
    [mae],
    [quick]
  ]);
}

function writeLatestBackup_(snapshot) {
  const folder = backupFolder_();
  const name = 'paper-state-latest.json';
  const content = JSON.stringify(snapshot, null, 2);
  const files = folder.getFilesByName(name);

  if (files.hasNext()) files.next().setContent(content);
  else folder.createFile(name, content, MimeType.PLAIN_TEXT);
}

function writeHistoricalBackup_(snapshot, trade) {
  const folder = backupFolder_();
  const symbol = String(trade.symbol || 'TRADE').replace(/[^A-Z0-9_-]/gi, '');
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');

  folder.createFile(
    `paper-${stamp}-${symbol}.json`,
    JSON.stringify(snapshot, null, 2),
    MimeType.PLAIN_TEXT
  );
}

function backupFolder_() {
  const props = PropertiesService.getScriptProperties();
  return DriveApp.getFolderById(props.getProperty('DRIVE_FOLDER_ID'));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
