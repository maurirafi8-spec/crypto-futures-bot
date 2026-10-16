const VERSION = '1.10.2-google-full-verify';

// Estrutura já criada no seu Drive.
const SHEET_ID = '1rhoLz9SRSaudiBcbqVnJ4h7UCls_Mr8xY1PUN2tBWhc';
const DRIVE_FOLDER_ID = '1OhRhSM28aVq35Pbb1-aGnqs7j1K0mulw';

function configurarArquivosExistentes() {
  const props =
    PropertiesService
      .getScriptProperties();

  props.setProperty(
    'SHEET_ID',
    SHEET_ID
  );

  props.setProperty(
    'DRIVE_FOLDER_ID',
    DRIVE_FOLDER_ID
  );

  let token =
    props.getProperty(
      'SYNC_TOKEN'
    );

  if (!token) {
    token =
      (
        Utilities.getUuid() +
        Utilities.getUuid()
      ).replace(/-/g, '');

    props.setProperty(
      'SYNC_TOKEN',
      token
    );
  }

  console.log('CONFIGURAÇÃO OK');
  console.log('SHEET_ID=' + SHEET_ID);
  console.log('DRIVE_FOLDER_ID=' + DRIVE_FOLDER_ID);
  console.log('SYNC_TOKEN=' + token);
}

function doGet() {
  const props =
    PropertiesService
      .getScriptProperties();

  return json_({
    ok: true,
    written: false,
    service:
      'crypto-futures-google-sync',
    version:
      VERSION,
    configured:
      Boolean(
        props.getProperty('SYNC_TOKEN') &&
        props.getProperty('SHEET_ID') &&
        props.getProperty('DRIVE_FOLDER_ID')
      ),
    sheetId:
      props.getProperty('SHEET_ID') || '',
    folderId:
      props.getProperty('DRIVE_FOLDER_ID') || ''
  });
}

function doPost(e) {
  try {
    const body =
      JSON.parse(
        e &&
        e.postData &&
        e.postData.contents
          ? e.postData.contents
          : '{}'
      );

    const props =
      PropertiesService
        .getScriptProperties();

    const expected =
      props.getProperty(
        'SYNC_TOKEN'
      );

    if (!expected) {
      return json_({
        ok: false,
        written: false,
        dashboardUpdated: false,
        backupWritten: false,
        error:
          'SYNC_TOKEN não configurado'
      });
    }

    if (
      String(body.token || '') !==
      String(expected)
    ) {
      return json_({
        ok: false,
        written: false,
        dashboardUpdated: false,
        backupWritten: false,
        error:
          'token inválido'
      });
    }

    const sheetId =
      props.getProperty(
        'SHEET_ID'
      ) || SHEET_ID;

    const folderId =
      props.getProperty(
        'DRIVE_FOLDER_ID'
      ) || DRIVE_FOLDER_ID;

    const ss =
      SpreadsheetApp
        .openById(
          sheetId
        );

    const events =
      ss.getSheetByName(
        'Events'
      );

    if (!events) {
      return json_({
        ok: false,
        written: false,
        dashboardUpdated: false,
        backupWritten: false,
        error:
          'aba Events não encontrada'
      });
    }

    const event =
      String(
        body.event ||
        'UNKNOWN'
      );

    const payload =
      body.payload || {};

    const signal =
      payload.signal ||
      payload.trade ||
      payload.item ||
      {};

    events.appendRow([
      new Date(),
      event,
      signal.symbol || '',
      signal.side || '',
      signal.entryMode ||
        signal.setupEntryMode ||
        '',
      Number(
        signal.score || 0
      ),
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
        (
          event === 'TEST'
            ? 'Teste completo do bot'
            : ''
        ),
      payload.phase || '',
      String(
        body.version ||
        VERSION
      )
    ]);

    let dashboardUpdated =
      false;

    let backupWritten =
      false;

    if (payload.snapshot) {
      updateDashboard_(
        ss,
        payload.snapshot
      );

      dashboardUpdated =
        true;

      writeLatestBackup_(
        folderId,
        payload.snapshot
      );

      backupWritten =
        true;
    }

    if (
      event ===
        'PAPER_TRADE_OPENED' ||
      event ===
        'PAPER_TRADE_CLOSED'
    ) {
      appendTrade_(
        ss,
        event,
        payload
      );
    }

    if (
      event ===
        'PAPER_TRADE_CLOSED' &&
      payload.snapshot
    ) {
      writeHistoricalBackup_(
        folderId,
        payload.snapshot,
        payload.trade || {}
      );
    }

    SpreadsheetApp.flush();

    const row =
      events.getLastRow();

    return json_({
      ok: true,
      written: true,
      dashboardUpdated,
      backupWritten,
      event,
      row,
      version:
        VERSION,
      sheetId,
      folderId,
      backupFile:
        backupWritten
          ? 'paper-state-latest.json'
          : ''
    });
  } catch (error) {
    return json_({
      ok: false,
      written: false,
      dashboardUpdated: false,
      backupWritten: false,
      error:
        String(
          error &&
          error.message
            ? error.message
            : error
        )
    });
  }
}

function appendTrade_(
  ss,
  event,
  payload
) {
  const trades =
    ss.getSheetByName(
      'Trades'
    );

  if (!trades) return;

  const t =
    payload.trade || {};

  const snap =
    payload.snapshot || {};

  trades.appendRow([
    new Date(
      Number(
        t.closedAt ||
        t.openedAt ||
        Date.now()
      )
    ),
    event,
    t.id || '',
    t.symbol || '',
    t.side || '',
    t.setupEntryMode || '',
    t.quickScalpEnabled
      ? 'ELITE QUICK SCALP'
      : (
          t.strategyProfile ||
          ''
        ),
    Number(t.score || 0),
    Number(t.aiConfidence || 0),
    Number(t.entryFill || 0),
    Number(t.exitMark || 0),
    Number(t.initialNotional || 0),
    Number(t.initialMargin || 0),
    Number(t.leverage || 0),
    event ===
      'PAPER_TRADE_CLOSED'
        ? Number(t.netPnl || 0)
        : '',
    event ===
      'PAPER_TRADE_CLOSED'
        ? Number(t.totalFees || 0)
        : Number(t.entryFee || 0),
    event ===
      'PAPER_TRADE_CLOSED'
        ? Number(
            t.returnOnMarginPct ||
            0
          )
        : '',
    Number(t.mfeR || 0),
    Number(t.maeR || 0),
    t.outcome || '',
    t.setupMarketRegime || '',
    t.setupOiContextRegime || '',
    t.confirmedEntryUsed
      ? 'SIM'
      : 'NÃO',
    Number(
      t.confirmedEntryChaseAtr ||
      0
    ),
    Number(
      t.quickScalpTargetNetUsdc ||
      0
    ),
    Number(
      t.quickScalpStopNetUsdc ||
      0
    ),
    Number(
      snap.balance || 0
    )
  ]);
}

function updateDashboard_(
  ss,
  snapshot
) {
  const dashboard =
    ss.getSheetByName(
      'Dashboard'
    );

  if (!dashboard) {
    throw new Error(
      'aba Dashboard não encontrada'
    );
  }

  const closed =
    Array.isArray(
      snapshot.closedTrades
    )
      ? snapshot.closedTrades
      : [];

  const wins =
    closed.filter(
      t =>
        Number(
          t.netPnl || 0
        ) > 0.000001
    );

  const losses =
    closed.filter(
      t =>
        Number(
          t.netPnl || 0
        ) < -0.000001
    );

  const grossWins =
    wins.reduce(
      (sum, t) =>
        sum +
        Number(
          t.netPnl || 0
        ),
      0
    );

  const grossLosses =
    Math.abs(
      losses.reduce(
        (sum, t) =>
          sum +
          Number(
            t.netPnl || 0
          ),
        0
      )
    );

  const pnl =
    closed.reduce(
      (sum, t) =>
        sum +
        Number(
          t.netPnl || 0
        ),
      0
    );

  const fees =
    closed.reduce(
      (sum, t) =>
        sum +
        Number(
          t.totalFees || 0
        ),
      0
    );

  const mfe =
    closed.length
      ? closed.reduce(
          (sum, t) =>
            sum +
            Number(
              t.mfeR || 0
            ),
          0
        ) /
        closed.length
      : 0;

  const mae =
    closed.length
      ? closed.reduce(
          (sum, t) =>
            sum +
            Number(
              t.maeR || 0
            ),
          0
        ) /
        closed.length
      : 0;

  const quick =
    closed.filter(
      t =>
        t.quickScalpEnabled ===
        true
    ).length;

  const pf =
    grossLosses > 0
      ? grossWins /
        grossLosses
      : grossWins > 0
        ? 999
        : 0;

  dashboard
    .getRange(
      'B2:B14'
    )
    .setValues([
      [new Date()],
      [
        Number(
          snapshot.balance || 0
        )
      ],
      [
        Number(
          snapshot.equity ||
          snapshot.balance ||
          0
        )
      ],
      [closed.length],
      [wins.length],
      [losses.length],
      [
        closed.length
          ? wins.length /
            closed.length
          : 0
      ],
      [pnl],
      [fees],
      [pf],
      [mfe],
      [mae],
      [quick]
    ]);

  dashboard
    .getRange(
      'B8'
    )
    .setNumberFormat(
      '0.00%'
    );

  dashboard
    .getRange(
      'B3:B4'
    )
    .setNumberFormat(
      '0.00'
    );
}

function writeLatestBackup_(
  folderId,
  snapshot
) {
  const folder =
    DriveApp
      .getFolderById(
        folderId
      );

  const name =
    'paper-state-latest.json';

  const content =
    JSON.stringify(
      snapshot,
      null,
      2
    );

  const files =
    folder.getFilesByName(
      name
    );

  if (files.hasNext()) {
    files
      .next()
      .setContent(
        content
      );
  } else {
    folder.createFile(
      name,
      content,
      MimeType.PLAIN_TEXT
    );
  }
}

function writeHistoricalBackup_(
  folderId,
  snapshot,
  trade
) {
  const folder =
    DriveApp
      .getFolderById(
        folderId
      );

  const symbol =
    String(
      trade.symbol ||
      'TRADE'
    ).replace(
      /[^A-Z0-9_-]/gi,
      ''
    );

  const stamp =
    Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyyMMdd-HHmmss'
    );

  folder.createFile(
    `paper-${stamp}-${symbol}.json`,
    JSON.stringify(
      snapshot,
      null,
      2
    ),
    MimeType.PLAIN_TEXT
  );
}

// Teste local do Apps Script.
// Deve gravar Events + atualizar Dashboard + criar backup no Drive.
function testeCompletoLocal() {
  const props =
    PropertiesService
      .getScriptProperties();

  const sheetId =
    props.getProperty(
      'SHEET_ID'
    ) || SHEET_ID;

  const folderId =
    props.getProperty(
      'DRIVE_FOLDER_ID'
    ) || DRIVE_FOLDER_ID;

  const ss =
    SpreadsheetApp
      .openById(
        sheetId
      );

  const events =
    ss.getSheetByName(
      'Events'
    );

  const snapshot = {
    at: Date.now(),
    startingBalance: 50,
    balance: 50,
    equity: 50,
    unrealized: 0,
    totalGrossPnl: 0,
    totalNetPnl: 0,
    totalFees: 0,
    maxDrawdownPct: 0,
    day: {
      realizedPnl: 0,
      trades: 0
    },
    openPositions: [],
    closedTrades: []
  };

  events.appendRow([
    new Date(),
    'TESTE_COMPLETO_LOCAL',
    '',
    '',
    '',
    '',
    '',
    'Events + Dashboard + Drive',
    'DIAGNOSTICO',
    VERSION
  ]);

  updateDashboard_(
    ss,
    snapshot
  );

  writeLatestBackup_(
    folderId,
    snapshot
  );

  SpreadsheetApp.flush();

  console.log(
    'TESTE COMPLETO OK'
  );

  console.log(
    'Events linha=' +
    events.getLastRow()
  );

  console.log(
    'Backup=paper-state-latest.json'
  );
}

function json_(obj) {
  return ContentService
    .createTextOutput(
      JSON.stringify(obj)
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );
}
