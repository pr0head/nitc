// Map status, bottom-right: what the map is showing right now and whether the
// last load finished. One row per layer, from the server's own LOD metadata:
//   порталы  N            | скрыты — приблизьте (zoom < 15: links-only LOD)
//   линки    N · все      | N · > 300 м (shorter links dropped at this zoom)
//   поля     N
//   карта    готово · z17 | загрузка… | ошибка … | лимит запросов
// A layer cut at the per-response cap gets "обрезано". On loading/error the
// last good counts stay, so the panel never blanks out.
const fmtLen = (m) => (m >= 1000 ? `${+(m / 1000).toFixed(1)} км` : `${m} м`);

export function createMapStatus() {
  const el = document.createElement('div');
  el.className = 'mstat';
  let last = null; // last successful load

  function row(k, v, warn) {
    return `<div class="mstat-row"><span class="mstat-k">${k}</span>` +
      `<span class="mstat-v${warn ? ' mstat-warn' : ''}">${v}</span></div>`;
  }

  function paint(map) {
    const t = last?.truncated || {};
    const cut = (key) => (t[key] ? ' · обрезано' : '');
    let html = '';
    if (last) {
      const c = last.counts;
      const minLen = last.lod?.min_link_length_m || 0;
      html += last.portalsOmitted || last.lod?.has_portals === false
        ? row('порталы', 'скрыты — приблизьте')
        : row('порталы', c.portals + cut('portals'), t.portals);
      html += row('линки', `${c.links} · ${minLen > 0 ? '&gt; ' + fmtLen(minLen) : 'все'}${cut('links')}`, t.links);
      html += row('поля', c.fields + cut('fields'), t.fields);
    }
    html += row('карта', map.text, map.warn);
    el.innerHTML = html;
  }

  // s: engine onStatus payload
  function update(s) {
    const z = s.zoom != null ? ` · z${s.zoom}` : '';
    if (s.loading) return paint({ text: 'загрузка…' + z });
    if (s.error) {
      const text = s.error === 'rate_limited'
        ? `лимит запросов${s.retryAfter ? ` · ${s.retryAfter}с` : ''}`
        : `ошибка: ${s.error}`;
      return paint({ text, warn: true });
    }
    last = s;
    paint({ text: 'готово' + z });
  }

  return { el, update };
}
