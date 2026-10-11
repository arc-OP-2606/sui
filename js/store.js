/* sui — 保存: localStorage（設定・年齢・記録メタ）と IndexedDB（写真）。失敗しても例外を投げない。 */
(function (global) {
  'use strict';
  const SUI = global.SUI = global.SUI || {};
  const KEYS = { age: 'sui.age.v1', theme: 'sui.theme.v1', records: 'sui.records.v1', apiKey: 'gemini_api_key', saved: 'sui.saved.v1', seen: 'sui.seen.v1' };
  const ls = () => { try { return global.localStorage || null; } catch (e) { return null; } };
  function ok() { try { const l = ls(); if (!l) return false; l.setItem('sui.__t', '1'); l.removeItem('sui.__t'); return true; } catch (e) { return false; } }
  function get(key, def) { try { const v = ls().getItem(key); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
  function set(key, v) { try { ls().setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function getRaw(key, def) { try { const v = ls().getItem(key); return v == null ? def : v; } catch (e) { return def; } }
  function setRaw(key, v) { try { if (v == null || v === '') ls().removeItem(key); else ls().setItem(key, String(v)); return true; } catch (e) { return false; } }
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function records() { const v = get(KEYS.records, []); return Array.isArray(v) ? v : []; }
  function addRecord(r) {
    const list = records(); const rec = Object.assign({ id: newId(), ts: Date.now() }, r || {});
    list.unshift(rec); return set(KEYS.records, list) ? rec.id : false;
  }
  function updateRecord(id, patch) { const list = records(); const i = list.findIndex(x => x.id === id); if (i < 0) return false; list[i] = Object.assign({}, list[i], patch); return set(KEYS.records, list); }
  function removeRecord(id) { const list = records().filter(x => x.id !== id); deletePhoto(id); return set(KEYS.records, list); }
  function exportJson() { return JSON.stringify({ app: 'sui', v: 1, exportedAt: new Date().toISOString(), records: records(), saved: get(KEYS.saved, []) }, null, 2); }

  /* saved (保存した酒) */
  function saved() { const v = get(KEYS.saved, []); return Array.isArray(v) ? v : []; }
  function toggleSaved(id) { const l = saved(); const i = l.indexOf(id); if (i >= 0) l.splice(i, 1); else l.unshift(id); set(KEYS.saved, l); return i < 0; }

  /* IndexedDB photos */
  const DB = 'sui', STORE = 'photos';
  function openDb() {
    return new Promise((res) => {
      try {
        const idb = global.indexedDB; if (!idb) return res(null);
        const req = idb.open(DB, 1);
        req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE); } catch (e) { /* exists */ } };
        req.onsuccess = () => res(req.result); req.onerror = () => res(null); req.onblocked = () => res(null);
      } catch (e) { res(null); }
    });
  }
  function putPhoto(id, blob) {
    return openDb().then(db => new Promise(res => { if (!db) return res(false); try { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(blob, id); tx.oncomplete = () => res(true); tx.onerror = () => res(false); tx.onabort = () => res(false); } catch (e) { res(false); } }));
  }
  function getPhoto(id) {
    return openDb().then(db => new Promise(res => { if (!db) return res(null); try { const tx = db.transaction(STORE, 'readonly'); const rq = tx.objectStore(STORE).get(id); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); } catch (e) { res(null); } }));
  }
  function deletePhoto(id) {
    return openDb().then(db => new Promise(res => { if (!db) return res(false); try { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = () => res(true); tx.onerror = () => res(false); } catch (e) { res(false); } }));
  }
  function dataUrlToBlob(dataUrl) {
    try { const [h, b64] = dataUrl.split(','); const mime = (h.match(/data:([^;]+)/) || [])[1] || 'image/jpeg'; const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new Blob([u8], { type: mime }); } catch (e) { return null; }
  }

  SUI.store = { KEYS, ok, get, set, getRaw, setRaw, records, addRecord, updateRecord, removeRecord, exportJson, saved, toggleSaved, putPhoto, getPhoto, deletePhoto, dataUrlToBlob, newId };
})(globalThis);
