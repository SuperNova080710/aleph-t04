// api/players.js
// live: 실제 스팀 호출 + Supabase 저장
// replay: 합성 fixture 재생 (카드 3용)

const GAMES = [
  { appid: 1623730, name: '팰월드' },
  { appid: 3240220, name: 'GTA V Enhanced' },
  { appid: 578080, name: 'PUBG' }
];

// 카드 3 검사용 fixture (필요한 것만 내장)
const FIXTURES = {
  'T04-NORMAL-D1-A': {
    fixture_id: 'T04-NORMAL-D1-A',
    transport: { mode: 'http', status: 200 },
    payload: {
      normalized_value: 100,
      unit: 'pt',
      source_name: 'ALEPH 결정론 replay',
      source_url: 'https://fixtures.aleph.invalid/t04/demo-index',
      source_time: '2026-08-23T23:59:00.000Z',
      record_date: '2026-08-24'
    },
    expected: { freshness: 'fresh', error_code: 'none' }
  },
  'T04-NORMAL-D1-B': {
    fixture_id: 'T04-NORMAL-D1-B',
    transport: { mode: 'http', status: 200 },
    payload: {
      normalized_value: 105,
      unit: 'pt',
      source_name: 'ALEPH 결정론 replay',
      source_url: 'https://fixtures.aleph.invalid/t04/demo-index',
      source_time: '2026-08-24T01:00:00.000Z',
      record_date: '2026-08-24'
    },
    expected: { freshness: 'fresh', error_code: 'none' }
  },
  'T04-NORMAL-D2': {
    fixture_id: 'T04-NORMAL-D2',
    transport: { mode: 'http', status: 200 },
    payload: {
      normalized_value: 120,
      unit: 'pt',
      source_name: 'ALEPH 결정론 replay',
      source_url: 'https://fixtures.aleph.invalid/t04/demo-index',
      source_time: '2026-08-24T23:59:00.000Z',
      record_date: '2026-08-25'
    },
    expected: { freshness: 'fresh', error_code: 'none' }
  },
  'T04-TIMEOUT': {
    fixture_id: 'T04-TIMEOUT',
    transport: { mode: 'timeout', status: null },
    payload: null,
    expected: { freshness: 'stale', error_code: 'timeout' }
  },
  'T04-AUTH-401': {
    fixture_id: 'T04-AUTH-401',
    transport: { mode: 'http', status: 401 },
    payload: { message: 'unauthorized synthetic fixture' },
    expected: { freshness: 'stale', error_code: 'auth' }
  },
  'T04-RATE-429': {
    fixture_id: 'T04-RATE-429',
    transport: { mode: 'http', status: 429 },
    payload: { message: 'rate limited synthetic fixture' },
    expected: { freshness: 'stale', error_code: 'rate_limit' }
  },
  'T04-OFFLINE': {
    fixture_id: 'T04-OFFLINE',
    transport: { mode: 'offline', status: null },
    payload: null,
    expected: { freshness: 'stale', error_code: 'offline' }
  },
  'T04-SCHEMA-BREAK': {
    fixture_id: 'T04-SCHEMA-BREAK',
    transport: { mode: 'http', status: 200 },
    payload: {
      normalized_value: '105', // 문자열 → schema 오류
      unit: 'pt',
      source_time: null,
      record_date: '2026-08-24'
    },
    expected: { freshness: 'stale', error_code: 'schema_error' }
  },
  'T04-RECOVER-D2': {
    fixture_id: 'T04-RECOVER-D2',
    transport: { mode: 'http', status: 200 },
    payload: {
      normalized_value: 120,
      unit: 'pt',
      source_name: 'ALEPH 결정론 replay',
      source_url: 'https://fixtures.aleph.invalid/t04/demo-index',
      source_time: '2026-08-24T23:59:00.000Z',
      record_date: '2026-08-25'
    },
    expected: { freshness: 'fresh', error_code: 'none' }
  }
};

function getSeoulDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

// Supabase REST 헬퍼 (fetch만 사용)
async function supabaseRequest(path, options = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=minimal',
      ...options.headers
    }
  });
  return res;
}

async function upsertRecord(record) {
  const res = await supabaseRequest(
    'daily_records?on_conflict=appid,record_date',
    {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: JSON.stringify(record)
    }
  );

  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    console.error('Supabase upsert 실패:', res.status, body);
    return { ok: false, status: res.status, error: body };
  }
  return { ok: true, data: body };
}

async function getRecords(dates) {
  const filter = dates.map(d => `"${d}"`).join(',');
  const res = await supabaseRequest(
    `daily_records?record_date=in.(${filter})&order=record_date.desc`,
    { method: 'GET', prefer: 'return=representation' }
  );
  if (!res.ok) return [];
  return res.json();
}

function isSchemaValid(payload) {
  if (!payload) return false;
  if (typeof payload.normalized_value !== 'number') return false;
  if (payload.source_time == null) return false;
  return true;
}

function judgeTransport(fixture) {
  const t = fixture.transport || {};
  if (t.mode === 'timeout') return { ok: false, error_code: 'timeout' };
  if (t.mode === 'offline') return { ok: false, error_code: 'offline' };
  if (t.status === 401) return { ok: false, error_code: 'auth' };
  if (t.status === 429) return { ok: false, error_code: 'rate_limit' };
  if (t.status === 200) {
    if (!isSchemaValid(fixture.payload)) {
      return { ok: false, error_code: 'schema_error' };
    }
    return { ok: true, error_code: 'none' };
  }
  return { ok: false, error_code: 'unknown' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Supabase 환경변수가 없습니다.' });
  }

  const mode = (req.query.mode || 'live').toLowerCase();
  const fixtureId = req.query.fixture || '';
  const queriedAt = new Date().toISOString();
  const today = getSeoulDateString();

  // ---------- Replay 모드 (카드 3) ----------
  if (mode === 'replay') {
    const fixture = FIXTURES[fixtureId];
    if (!fixture) {
      return res.status(400).json({ error: `알 수 없는 fixture: ${fixtureId}` });
    }

    const judgment = judgeTransport(fixture);
    let saved = false;

    // 성공일 때만 저장 (데모용 signal로 저장)
    let saved = false;
let saveResult = null;

if (judgment.ok && fixture.payload) {
  const p = fixture.payload;
  saveResult = await upsertRecord({
    appid: 0,
    game_name: 'ALEPH Demo Index',
    record_date: p.record_date,
    player_count: Number(p.normalized_value),
    source: p.source_name || 'ALEPH replay',
    source_time: p.source_time || queriedAt
  });
  saved = saveResult.ok === true;
}

    // 현재 저장된 기록 조회
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const records = await getRecords([
      fixture.payload?.record_date || today,
      getSeoulDateString(yesterday)
    ]);

    return res.status(200).json({
      mode: 'replay',
      fixture_id: fixtureId,
      timezone: 'Asia/Seoul',
      queriedAt,
      freshness: judgment.ok ? 'fresh' : 'stale',
      error_code: judgment.error_code,
      saved,
      saveResult,
      payload: fixture.payload,
      expected: fixture.expected,
      records
    });
  }

  // ---------- Live 모드 (실제 스팀) ----------
  const results = [];

  for (const game of GAMES) {
    try {
      const url = `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${game.appid}`;
      const response = await fetch(url);
      const data = await response.json();

      const ok = response.ok && data?.response?.result === 1;
      const playerCount = data?.response?.player_count ?? null;

      if (ok && playerCount !== null) {
        await upsertRecord({
          appid: game.appid,
          game_name: game.name,
          record_date: today,
          player_count: playerCount,
          source: `Steam Web API (appid=${game.appid})`,
          source_time: queriedAt
        });
      }

      results.push({
        appid: game.appid,
        name: game.name,
        ok,
        player_count: playerCount,
        freshness: ok ? 'fresh' : 'stale',
        error_code: ok ? 'none' : 'fetch_error',
        status: response.status,
        raw: data
      });
    } catch (err) {
      results.push({
        appid: game.appid,
        name: game.name,
        ok: false,
        player_count: null,
        freshness: 'stale',
        error_code: 'offline',
        status: 0,
        error: err.message
      });
    }
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const records = await getRecords([today, getSeoulDateString(yesterday)]);

  return res.status(200).json({
    mode: 'live',
    timezone: 'Asia/Seoul',
    queriedAt,
    today,
    games: results,
    records: records || []
  });
}
