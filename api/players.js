export default async function handler(req, res) {
  // CORS 헤더 (같은 도메인에서는 사실 필요 없지만 안전하게)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const appids = [1623730, 3240220, 578080]; // 팰월드, GTA V Enhanced, PUBG
  const results = [];

  for (const appid of appids) {
    try {
      const url = `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`;
      const response = await fetch(url);
      const data = await response.json();

      results.push({
        appid,
        ok: response.ok && data?.response?.result === 1,
        player_count: data?.response?.player_count ?? null,
        raw: data,
        status: response.status
      });
    } catch (err) {
      results.push({
        appid,
        ok: false,
        player_count: null,
        error: err.message,
        status: 0
      });
    }
  }

  // 조회 시각을 서버에서 한 번 찍어서 내려줌
  const queriedAt = new Date().toISOString();

  res.status(200).json({
    timezone: "Asia/Seoul",
    queriedAt,
    games: results
  });
}