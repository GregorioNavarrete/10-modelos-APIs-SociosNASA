(function () {
  const { qs, qsa, fmt, num, toast, fetchJSON, barras, graficoLineas } = UI;
  const estado = { datos: null };

  UI.initTabs();

  const ROTACIONES = [
    { id: 'soja-maiz', nombre: 'Soja → Maíz', anios: 2, agua: 58, renta: 88, suelo: 48, riesgo: 62, leguminosa: true, nota: 'Alta renta, depende de precio y lluvia de verano.' },
    { id: 'trigo-soja', nombre: 'Trigo → Soja', anios: 2, agua: 52, renta: 76, suelo: 62, riesgo: 48, leguminosa: true, nota: 'Cobertura invernal y menor exposición a un solo cultivo.' },
    { id: 'maiz-soja-trigo', nombre: 'Maíz → Soja → Trigo', anios: 3, agua: 60, renta: 82, suelo: 68, riesgo: 54, leguminosa: true, nota: 'Diversifica y mejora materia orgánica; pide más manejo.' },
    { id: 'soja-girasol', nombre: 'Soja → Girasol', anios: 2, agua: 46, renta: 64, suelo: 45, riesgo: 44, leguminosa: true, nota: 'Menor demanda de agua; sensible a precios del aceite.' },
    { id: 'pastura-maiz-soja', nombre: 'Pastura → Maíz → Soja', anios: 4, agua: 55, renta: 58, suelo: 88, riesgo: 34, leguminosa: true, nota: 'La mejor para recuperar suelo, pero inmoviliza tierra.' },
    { id: 'sorgo-soja', nombre: 'Sorgo → Soja', anios: 2, agua: 34, renta: 55, suelo: 64, riesgo: 28, leguminosa: true, nota: 'Tolerante a sequía; menor renta esperada.' },
    { id: 'trigo-maiz', nombre: 'Trigo → Maíz', anios: 2, agua: 66, renta: 80, suelo: 52, riesgo: 66, leguminosa: false, nota: 'Alto potencial si el agua acompaña; riesgo climático.' },
  ];

  const OBJETIVOS = {
    equilibrio: { renta: 0.30, suelo: 0.30, agua: 0.20, riesgo: 0.20, nombre: 'Equilibrio renta–suelo' },
    renta: { renta: 0.55, suelo: 0.15, agua: 0.15, riesgo: 0.15, nombre: 'Maximizar renta' },
    suelo: { renta: 0.15, suelo: 0.55, agua: 0.20, riesgo: 0.10, nombre: 'Cuidar el suelo' },
    agua: { renta: 0.15, suelo: 0.20, agua: 0.50, riesgo: 0.15, nombre: 'Ahorrar agua' },
  };

  function renderSuelo(j) {
    const s = j.suelo || {};
    qs('#m-lluvia').textContent = fmt(j.meta?.resumenClima?.precipAnual, 0) + ' mm';
    qs('#m-textura').textContent = s.textura || '—';
    qs('#m-textura-sub').textContent = `arena ${fmt(s.arena, 0)}% · limo ${fmt(s.limo, 0)}%`;
    qs('#m-arcilla').textContent = fmt(s.arcilla, 1) + '%';
    qs('#m-retencion').textContent = fmt(s.retencionAgua, 0);
    qs('#badge-suelo').textContent = `pH ${s.ph == null ? 'sin dato' : fmt(s.ph, 1)} · SOC ${s.soc == null ? '—' : fmt(s.soc, 1)} g/kg`;

    const items = [
      ['Arena', fmt(s.arena, 1) + '%', 'fracción gruesa'],
      ['Arcilla', fmt(s.arcilla, 1) + '%', 'retención y estructura'],
      ['Limo', fmt(s.limo, 1) + '%', 'fracción media'],
      ['pH', s.ph == null ? '—' : fmt(s.ph, 1), '0–5 cm'],
      ['Carbono orgánico', s.soc == null ? '—' : fmt(s.soc, 1), 'g/kg'],
      ['Nitrógeno', s.nitrogeno == null ? '—' : fmt(s.nitrogeno, 1), 'g/kg'],
      ['Textura USDA', s.textura || '—', 'clasificación'],
      ['Retención', fmt(s.retencionAgua, 0) + '/45', 'índice derivado'],
    ];
    qs('#suelo-cards').innerHTML = items.map(([k, v, sub]) => `<div class="mini"><span>${k}</span><b>${v}</b><small>${sub}</small></div>`).join('');
    qs('#nota-suelo').innerHTML = j.meta?.nota
      ? UI.esc(j.meta.nota)
      : 'La retención de agua es un índice propio de la demo (8 + 1,4·arcilla + 0,35·limo), no una medición de campo.';
  }

  function score(r, sup) {
    const objetivo = OBJETIVOS[sup.objetivo] || OBJETIVOS.equilibrio;
    const fitAgua = Math.max(0, 100 - Math.abs(sup.agua - r.agua) * 1.5);
    const fitRenta = Math.min(100, r.renta * (0.55 + 0.45 * (sup.precio / 100)));
    const fitRiesgo = Math.max(0, 100 - Math.abs(r.riesgo - sup.riesgo) * 0.9);
    const fitClima = Math.max(0, 100 - Math.abs((sup.lluvia || 800) - (300 + r.agua * 9)) / 9);
    const base = objetivo.renta * fitRenta + objetivo.suelo * r.suelo + objetivo.agua * fitAgua + objetivo.riesgo * fitRiesgo;
    const total = base * 0.85 + fitClima * 0.15 + (r.leguminosa ? 2 : 0);
    return { total: Math.min(100, Math.max(0, total)), fitAgua, fitRenta, fitRiesgo, fitClima };
  }

  function renderRanking() {
    const sup = {
      agua: num(qs('#agua').value, 60),
      precio: num(qs('#precio').value, 60),
      riesgo: num(qs('#riesgo').value, 50),
      objetivo: qs('#objetivo').value,
      lluvia: estado.datos?.meta?.resumenClima?.precipAnual || 800,
    };
    qs('#v-agua').textContent = sup.agua;
    qs('#v-precio').textContent = sup.precio;
    qs('#v-riesgo').textContent = sup.riesgo;

    const ranking = ROTACIONES.map((r) => ({ ...r, ...score(r, sup) })).sort((a, b) => b.total - a.total);
    qs('#ranking').innerHTML = ranking.map((r, i) => `<div class="rot-card ${i === 0 ? 'destacada' : ''}">
      <div class="cab">
        <div><span class="kicker">${i === 0 ? 'Recomendada' : 'Alternativa ' + (i + 1)}</span><h3>${r.nombre}</h3></div>
        <div class="score">${fmt(r.total, 0)}</div>
      </div>
      <p>${r.nota}</p>
      <div class="barra"><i style="width:${r.total}%"></i></div>
      <div class="tags">
        <span>${r.anios} años</span>
        <span>agua ${r.agua}/100</span>
        <span>renta ${r.renta}/100</span>
        <span>suelo ${r.suelo}/100</span>
      </div>
      <div class="detalle">Ajuste agua ${fmt(r.fitAgua, 0)} · clima ${fmt(r.fitClima, 0)} · riesgo ${fmt(r.fitRiesgo, 0)} · ${OBJETIVOS[sup.objetivo].nombre}</div>
    </div>`).join('');

    qs('#explicacion').innerHTML = `<b>Fórmula:</b> score = 0,85 × (${OBJETIVOS[sup.objetivo].renta}·renta + ${OBJETIVOS[sup.objetivo].suelo}·suelo + ${OBJETIVOS[sup.objetivo].agua}·agua + ${OBJETIVOS[sup.objetivo].riesgo}·riesgo) + 0,15·clima + 2 si es leguminosa.
      <br><b>Variables:</b> agua = 100 − |tu agua − agua del cultivo|×1,5; clima = 100 − |lluvia anual − (300 + 9·agua del cultivo)|/9. Todo entre 0 y 100.`;
  }

  function renderClima(j) {
    const clima = j.clima || [];
    if (!clima.length) { qs('#chart-clima').innerHTML = '<p class="aviso">Sin climatología.</p>'; return; }
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const barrasHtml = barras({ valores: clima.map((m) => m.precip), etiquetas: meses, color: '#a3e635', alto: 220, formato: (v) => fmt(v, 0) });
    const lineaHtml = graficoLineas({
      series: [{ nombre: 'Temperatura media', color: '#ffb03d', valores: clima.map((m) => m.temp) }],
      etiquetas: meses, alto: 190, yLabel: 'Temperatura media mensual', formatoY: (v) => fmt(v, 0) + '°', mostrarPuntos: true,
    });
    qs('#chart-clima').innerHTML = barrasHtml + lineaHtml + `<p class="nota">Lluvia anual: <b>${fmt(j.meta?.resumenClima?.precipAnual, 0)} mm</b> · temperatura media: <b>${fmt(j.meta?.resumenClima?.tempMedia, 1)} °C</b>.</p>`;
  }

  function render(j) {
    estado.datos = j;
    if (j.error) { toast('No se pudo cargar clima/suelo: ' + j.error, 'error'); return; }
    const chip = qs('#chip-fuente');
    const vivo = j._meta?.fuente === 'vivo';
    chip.textContent = vivo ? 'POWER + SoilGrids en vivo' : 'respaldo local declarado';
    chip.classList.toggle('vivo', vivo);
    chip.title = j._meta?.aviso || '';
    renderClima(j);
    renderSuelo(j);
    renderRanking();
  }

  async function cargar() {
    const lat = num(qs('#lat').value, -27.8);
    const lon = num(qs('#lon').value, -64.2);
    const chip = qs('#chip-fuente');
    chip.textContent = 'consultando POWER y SoilGrids…';
    chip.classList.remove('vivo');
    try {
      const j = await fetchJSON(`/api/rotacion?lat=${lat}&lon=${lon}`);
      render(j);
    } catch (e) {
      chip.textContent = 'sin conexión';
      toast('Error al consultar clima/suelo: ' + e.message, 'error');
    }
  }

  qs('#btn-consultar').addEventListener('click', cargar);
  qsa('.preset').forEach((b) => b.addEventListener('click', () => {
    qs('#lat').value = b.dataset.lat;
    qs('#lon').value = b.dataset.lon;
    cargar();
  }));

  ['#agua', '#precio', '#riesgo'].forEach((sel) => qs(sel).addEventListener('input', renderRanking));
  qs('#objetivo').addEventListener('change', renderRanking);
  qs('#btn-explicar').addEventListener('click', () => {
    const e = qs('#explicacion');
    e.hidden = !e.hidden;
  });

  cargar();
})();
