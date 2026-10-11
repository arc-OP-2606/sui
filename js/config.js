/* sui — 配布設定。中継サーバー（Cloudflare Workers）を使うときは url と token を入れる。空ならユーザー自身の Gemini キー（設定画面）で直接呼ぶ。 */
(function (global) {
  'use strict';
  const SUI = global.SUI = global.SUI || {};
  SUI.CONFIG = {
    relayUrl: 'https://sui-relay.natsu-sui.workers.dev',        /* 例: 'https://sui-relay.<account>.workers.dev' */
    relayToken: 'mi7IHsMZf5Ykk7R7cCU63SKlCLGUFskyX1_9bGSe8Lo',      /* Worker の APP_TOKEN と同じ値 */
    privacyUrl: 'https://arc-op-2606.github.io/sui-privacy/',
    version: '1.0.0',
  };
})(globalThis);
