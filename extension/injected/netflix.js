// Netflixのページコンテキストで動くスクリプト。
// Netflixプレイヤーは<video>のcurrentTime直接書き換えを受け付けないため、
// 内部プレイヤーAPI(非公開)経由で play / pause / seek を行う。
// ※ Netflix側の内部実装変更で動かなくなる可能性がある点に注意。
(function () {
  function getPlayer() {
    try {
      const videoPlayer = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const sessionIds = videoPlayer.getAllPlayerSessionIds();
      if (!sessionIds.length) return null;
      // 再生中の本編セッション(watch-で始まる)を優先
      const id = sessionIds.find((s) => s.startsWith('watch-')) || sessionIds[0];
      return videoPlayer.getVideoPlayerBySessionId(id);
    } catch {
      return null;
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'mwp-ext') return;
    const player = getPlayer();
    if (!player) return;

    switch (e.data.action) {
      case 'play':
        player.play();
        break;
      case 'pause':
        player.pause();
        break;
      case 'seek':
        if (e.data.timeMs != null) player.seek(e.data.timeMs);
        break;
    }
  });
})();
