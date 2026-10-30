/* Utilidades compartidas: pestañas, fetch, formato, gráficos SVG y avisos. */
(function () {
  const qs = (sel, raiz = document) => raiz.querySelector(sel);
  const qsa = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

  const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

  function num(v, def = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  }

  function fmt(v, dec = 1) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
    return dec === 0 ? nf0.format(Number(v)) : nf.format(Number(v));
  }

  function pct(v, dec = 0) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
    return fmt(v, dec) + '%';
  }

  function fecha(iso, opciones = {}) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', ...opciones });
  }

  function fechaHora(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  async function fetchJSON(url, opciones = {}) {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, ...opciones });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toast(mensaje, tipo = 'info') {
    let caja = qs('#toast');
    if (!caja) {
      caja = document.createElement('div');
      caja.id = 'toast';
      caja.className = 'toast';
      caja.setAttribute('role', 'status');
      caja.setAttribute('aria-live', 'polite');
      document.body.appendChild(caja);
    }
    caja.textContent = mensaje;
    caja.dataset.tipo = tipo;
    caja.classList.add('visible');
    clearTimeout(caja._t);
    caja._t = setTimeout(() => caja.classList.remove('visible'), 3800);
  }

  /* Pestañas genéricas: [data-tab="x"] y [data-panel="x"] */
  function initTabs(raiz = document) {
    const botones = qsa('[data-tab]', raiz);
    const paneles = qsa('[data-panel]', raiz);
    if (!botones.length) return;
    function activar(id, foco) {
      botones.forEach((b) => {
        const on = b.dataset.tab === id;
        b.classList.toggle('activo', on);
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
        if (on && foco) b.focus();
      });
      paneles.forEach((p) => {
        const on = p.dataset.panel === id;
        p.hidden = !on;
        p.classList.toggle('activo', on);
      });
    }
    botones.forEach((b, i) => {
      b.addEventListener('click', () => activar(b.dataset.tab));
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const siguiente = botones[(i + dir + botones.length) % botones.length];
        activar(siguiente.dataset.tab, true);
      });
    });
    activar(botones.find((b) => b.classList.contains('activo'))?.dataset.tab || botones[0].dataset.tab);
  }

  function escala(valores, alto, pad) {
    const validos = valores.filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v))).map(Number);
    if (!validos.length) return { min: 0, max: 1, y: () => alto - pad };
    let min = Math.min(...validos);
    let max = Math.max(...validos);
    if (min === max) { min -= 1; max += 1; }
    const margen = (max - min) * 0.12;
    min -= margen; max += margen;
    return { min, max, y: (v) => pad + (1 - (Number(v) - min) / (max - min)) * (alto - pad * 2) };
  }

  /* Gráfico de líneas responsive en SVG. */
  function graficoLineas({ series = [], etiquetas = [], alto = 260, ancho = 760, yLabel = '', formatoY = (v) => fmt(v), mostrarPuntos = false }) {
    const pad = 42;
    const todos = series.flatMap((s) => s.valores.map((v) => (v === null || v === undefined ? null : Number(v))));
    const { min, max, y } = escala(todos, alto, pad);
    const n = Math.max(1, etiquetas.length - 1);
    const x = (i) => pad + (i / n) * (ancho - pad * 2);
    const xticks = Math.min(6, etiquetas.length);
    let svg = `<svg class="chart" viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="${esc(yLabel || 'Serie de datos')}">`;
    for (let g = 0; g <= 4; g++) {
      const v = min + ((max - min) * g) / 4;
      const yy = y(v);
      svg += `<line class="chart-grid" x1="${pad}" x2="${ancho - pad}" y1="${yy}" y2="${yy}"/>`;
      svg += `<text class="chart-label" x="${pad - 8}" y="${yy + 4}" text-anchor="end">${esc(formatoY(v))}</text>`;
    }
    for (let g = 0; g < xticks; g++) {
      const i = Math.round((g / Math.max(1, xticks - 1)) * (etiquetas.length - 1));
      if (!etiquetas[i]) continue;
      svg += `<text class="chart-label" x="${x(i)}" y="${alto - 12}" text-anchor="middle">${esc(etiquetas[i])}</text>`;
    }
    series.forEach((s) => {
      let d = '';
      let abierto = false;
      s.valores.forEach((v, i) => {
        if (v === null || v === undefined || !Number.isFinite(Number(v))) { abierto = false; return; }
        d += (abierto ? ' L' : ' M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
        abierto = true;
      });
      if (d) svg += `<path d="${d}" fill="none" stroke="${esc(s.color || 'var(--accent)')}" stroke-width="${s.grosor || 2.4}" stroke-linejoin="round" stroke-linecap="round" ${s.punteado ? 'stroke-dasharray="6 5"' : ''}/>`;
      if (mostrarPuntos) {
        s.valores.forEach((v, i) => {
          if (v !== null && v !== undefined && Number.isFinite(Number(v))) {
            svg += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6" fill="${esc(s.color || 'var(--accent)')}"/>`;
          }
        });
      }
    });
    svg += '</svg>';
    return svg;
  }

  function barras({ valores = [], etiquetas = [], color = 'var(--accent)', alto = 220, ancho = 760, formato = (v) => fmt(v) }) {
    const pad = 38;
    const max = Math.max(1, ...valores.map((v) => Number(v) || 0));
    const n = Math.max(1, valores.length);
    const anchoB = (ancho - pad * 2) / n;
    let svg = `<svg class="chart" viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="Gráfico de barras">`;
    for (let g = 0; g <= 3; g++) {
      const v = (max * g) / 3;
      const yy = pad + (1 - g / 3) * (alto - pad * 2);
      svg += `<line class="chart-grid" x1="${pad}" x2="${ancho - pad}" y1="${yy}" y2="${yy}"/>`;
      svg += `<text class="chart-label" x="${pad - 8}" y="${yy + 4}" text-anchor="end">${esc(formato(v))}</text>`;
    }
    valores.forEach((v, i) => {
      const h = ((Number(v) || 0) / max) * (alto - pad * 2);
      const xx = pad + i * anchoB + anchoB * 0.18;
      const w = anchoB * 0.64;
      svg += `<rect x="${xx.toFixed(1)}" y="${(alto - pad - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${esc(color)}" opacity="0.85"/>`;
      if (etiquetas[i] && (n <= 14 || i % Math.ceil(n / 8) === 0)) {
        svg += `<text class="chart-label" x="${(xx + w / 2).toFixed(1)}" y="${alto - 12}" text-anchor="middle">${esc(etiquetas[i])}</text>`;
      }
    });
    svg += '</svg>';
    return svg;
  }

  function colorNivel(nivel) {
    return ({ verde: '#2fbf71', amarillo: '#f5b301', naranja: '#f07a24', rojo: '#e5484d', azul: '#4aa8ff' })[nivel] || 'var(--accent)';
  }

  function descargar(nombre, datos) {
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2500);
  }

  function cargando(el, texto = 'Consultando datos abiertos…') {
    if (!el) return;
    el.innerHTML = `<div class="cargando"><span class="spinner" aria-hidden="true"></span><span>${esc(texto)}</span></div>`;
  }

  window.UI = { qs, qsa, num, fmt, pct, fecha, fechaHora, fetchJSON, esc, toast, initTabs, graficoLineas, barras, colorNivel, descargar, cargando };
})();
