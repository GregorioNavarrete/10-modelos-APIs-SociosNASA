/* App 05 · Centinela de Sequía
   Flujo: se consulta /api/sequia con un punto y una ventana de años; el servidor
   devuelve lluvia mensual ya agregada, normales por mes calendario y SPI-3
   (gamma por mes calendario con respaldo z-score declarado en meta.metodoDetalle).
   Acá solo se pinta: KPIs con semáforo, gráfico de la serie, barras de normales
   y una tabla auditable. No se recalcula el índice en el cliente. */
(function () {
  const { qs, qsa, fmt, num, toast, fetchJSON, graficoLineas, barras, esc, descargar } = UI;
  const estado = { datos: null };

  UI.initTabs();

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  /* Método real declarado por el servidor. `metodoDetalle` es el contrato nuevo
     ("gamma" | "z-score-respaldo"); si una respuesta vieja no lo trae, se infiere
     de `meta.metodo` para no romper la app. */
  function metodoReal(j) {
    if (j.meta?.metodoDetalle === 'gamma') return 'gamma';
    if (j.meta?.metodoDetalle === 'z-score-respaldo') return 'z-score';
    return /gamma/i.test(j.meta?.metodo || '') ? 'gamma' : 'z-score';
  }

  /* ym llega como "202401": se muestra "ene 2024" para leer rápido la estación. */
  function etiquetaMes(ym) {
    const anio = String(ym).slice(0, 4);
    const mes = Number(String(ym).slice(4, 6));
    return `${MESES[mes - 1] || '?'} ${anio}`;
  }

  /* Semáforo del SPI, alineado con la escala clásica:
     ≥ 0 verde · −1 a 0 amarillo · −1,5 a −1 naranja · < −1,5 rojo. */
  function clasificarSpi(spi) {
    if (spi == null || Number.isNaN(Number(spi))) return { color: 'var(--muted)', texto: 'sin cálculo', clase: '' };
    const v = Number(spi);
    if (v >= 0) return { color: 'var(--ok)', texto: 'normal o húmedo', clase: 'ok' };
    if (v >= -1) return { color: 'var(--warn)', texto: 'déficit leve', clase: 'warn' };
    if (v >= -1.5) return { color: '#f07a24', texto: 'déficit moderado', clase: 'warn' };
    return { color: 'var(--bad)', texto: 'sequía severa', clase: 'bad' };
  }

  /* Badge con el color del semáforo; el borde queda neutro para no competir. */
  function badgeSpi(spi) {
    const c = clasificarSpi(spi);
    return `<span class="badge" style="color:${c.color}">${spi == null ? '—' : fmt(spi, 2)}</span>`;
  }

  function renderKpis(j) {
    const r = j.resumen || {};
    const c = clasificarSpi(r.spiActual);
    const spiEl = qs('#m-spi');
    spiEl.textContent = r.spiActual == null ? '—' : fmt(r.spiActual, 2);
    spiEl.style.color = c.color;
    qs('#m-spi-sub').textContent = c.texto;
    qs('#m-spi-sub').style.color = c.color;

    qs('#m-acum').textContent = r.acum3 == null ? '—' : fmt(r.acum3, 0) + ' mm';
    qs('#m-min').textContent = r.minSpi == null ? '—' : fmt(r.minSpi, 2);
    qs('#m-meses').textContent = r.meses == null ? '—' : fmt(r.meses, 0);

    const primero = j.mensual?.[0]?.ym;
    const ultimo = j.mensual?.at(-1)?.ym;
    qs('#m-meses-sub').textContent = primero && ultimo ? `${etiquetaMes(primero)} → ${etiquetaMes(ultimo)}` : 'sin serie';
    const metodo = metodoReal(j);
    qs('#badge-serie').textContent = `${fmt(j.punto?.lat, 2)}, ${fmt(j.punto?.lon, 2)} · ${j.anios} años · ${metodo === 'gamma' ? 'gamma' : 'z-score'}`;
  }

  function renderGraficos(j) {
    const mensual = j.mensual || [];
    const etiquetas = mensual.map((m) => etiquetaMes(m.ym));

    if (!mensual.length) {
      qs('#chart-spi').innerHTML = '<p class="aviso">Sin datos para esta ventana. Probá con más años o revisá el punto.</p>';
      qs('#chart-normales').innerHTML = '';
      return;
    }

    /* Serie principal + dos referencias constantes (0 y −1,5) para leer el
       semáforo sin agregar elementos fuera de UI.graficoLineas. */
    const ceros = mensual.map(() => 0);
    const severo = mensual.map(() => -1.5);
    qs('#chart-spi').innerHTML = graficoLineas({
      series: [
        { nombre: 'SPI-3', color: '#ffc247', valores: mensual.map((m) => m.spi), grosor: 2.6 },
        { nombre: 'Normal', color: '#8d9ab1', valores: ceros, grosor: 1, punteado: true },
        { nombre: 'Sequía severa', color: '#e5484d', valores: severo, grosor: 1, punteado: true },
      ],
      etiquetas,
      alto: 300,
      yLabel: 'Serie SPI-3 con umbrales de referencia',
      formatoY: (v) => fmt(v, 1),
    });

    const normales = j.normales || [];
    qs('#chart-normales').innerHTML = normales.length
      ? barras({
          valores: normales.map((n) => n.media),
          etiquetas: normales.map((n) => MESES[n.mes - 1] || '?'),
          color: '#ffc247',
          alto: 240,
          formato: (v) => fmt(v, 0),
        }) + `<p class="nota">Máximo del año típico: <b>${fmt(Math.max(...normales.map((n) => n.media)), 0)} mm</b>. Las barras no suman el total anual exacto porque cada mes usa los años disponibles.</p>`
      : '<p class="aviso">Sin normales calculables con esta ventana.</p>';
  }

  function renderTabla(j) {
    const filas = j.mensual || [];
    if (!filas.length) {
      qs('#tabla-mensual').innerHTML = '<tr><td colspan="5">Sin meses para mostrar.</td></tr>';
      return;
    }
    /* Se listan de más reciente a más viejo: lo urgente primero. */
    qs('#tabla-mensual').innerHTML = [...filas].reverse().map((m) => {
      const c = clasificarSpi(m.spi);
      return `<tr>
        <td>${esc(etiquetaMes(m.ym))}</td>
        <td class="num">${fmt(m.mm, 1)}</td>
        <td class="num">${m.acum3 == null ? '—' : fmt(m.acum3, 1)}</td>
        <td class="num">${badgeSpi(m.spi)}</td>
        <td style="color:${c.color}">${m.spi == null ? 'Sin 3 meses acumulados' : c.texto}</td>
      </tr>`;
    }).join('');
  }

  function render(j) {
    estado.datos = j;
    if (j.error) {
      toast('No se pudo calcular la sequía: ' + j.error, 'error');
      qs('#chip-fuente').textContent = 'sin conexión';
      qs('#chip-fuente').classList.remove('vivo');
      qs('#chart-spi').innerHTML = '<p class="aviso">El servidor no pudo consultar POWER. Reintentá con otro punto o más tarde.</p>';
      qs('#leyenda-metodo').textContent = 'SPI-3';
      qs('#nota-metodo').textContent = 'El servidor no devolvió datos; no hay método que declarar.';
      return;
    }
    const chip = qs('#chip-fuente');
    const vivo = j._meta?.fuente === 'vivo';
    const metodo = metodoReal(j);
    chip.textContent = vivo
      ? (metodo === 'gamma' ? 'POWER en vivo · SPI-3 gamma' : 'POWER en vivo · SPI-3 respaldo')
      : 'respaldo local declarado';
    chip.classList.toggle('vivo', vivo);
    chip.title = j._meta?.aviso || '';

    /* La leyenda y la nota declaran el método que realmente devolvió el server. */
    qs('#leyenda-metodo').textContent = metodo === 'gamma' ? 'SPI-3 (gamma por mes)' : 'SPI-3 (z-score, respaldo)';
    qs('#nota-metodo').textContent = j.meta?.nota
      || (metodo === 'gamma'
        ? 'Gamma ajustada por mes calendario sobre acumulados de 3 meses.'
        : 'Respaldo z-score: no hay muestras suficientes para el ajuste gamma por mes calendario.');

    renderKpis(j);
    renderGraficos(j);
    renderTabla(j);
  }

  async function cargar() {
    const lat = num(qs('#lat').value, -27.78);
    const lon = num(qs('#lon').value, -64.26);
    const anios = Math.min(15, Math.max(3, Math.round(num(qs('#anios').value, 5))));
    qs('#anios').value = anios; // corrige lo que el usuario haya escrito fuera de rango
    const chip = qs('#chip-fuente');
    chip.textContent = 'consultando POWER…';
    chip.classList.remove('vivo');
    qs('#chart-spi').innerHTML = '<div class="cargando"><span class="spinner" aria-hidden="true"></span><span>Descargando lluvia diaria…</span></div>';
    try {
      const j = await fetchJSON(`/api/sequia?lat=${lat}&lon=${lon}&anios=${anios}`);
      render(j);
    } catch (e) {
      qs('#chip-fuente').textContent = 'sin conexión';
      statusFallback(e);
    }
  }

  /* Estado de error homogéneo: chip apagado + mensaje amable. */
  function statusFallback(e) {
    qs('#chip-fuente').textContent = 'sin conexión';
    qs('#chip-fuente').classList.remove('vivo');
    qs('#chart-spi').innerHTML = '<p class="aviso">No se pudo consultar POWER. Revisá la conexión o intentá con otro punto.</p>';
    qs('#leyenda-metodo').textContent = 'SPI-3';
    qs('#nota-metodo').textContent = 'No se pudo consultar POWER; el método real se declara cuando hay datos.';
    toast('Error al consultar POWER: ' + e.message, 'error');
  }

  qs('#btn-consultar').addEventListener('click', cargar);

  qsa('.preset').forEach((b) => b.addEventListener('click', () => {
    qs('#lat').value = b.dataset.lat;
    qs('#lon').value = b.dataset.lon;
    cargar();
  }));

  qs('#btn-json').addEventListener('click', () => {
    if (!estado.datos) return toast('Todavía no hay datos para descargar', 'error');
    descargar('centinela-de-sequia.json', estado.datos);
  });

  cargar();
})();
