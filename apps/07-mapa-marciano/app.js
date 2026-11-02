/* App 07 · Mapa Marciano
   Flujo: /api/marte?hora=N devuelve el clima del último sol de Curiosity, la
   elevación solar por sitio para esa hora y una ruta entre sitios. El endpoint
   NO tiene respaldo y puede colgarse: cada consulta usa AbortController (20 s).

   Además de pintar la hora pedida, el cliente guarda las respuestas por hora
   en `estado.serie`, de modo que al mover el slider se va dibujando la curva
   del sol completa (0–24 h) sin inventar datos: cada punto es una consulta. */
(function () {
  const { qs, qsa, fmt, num, fecha, toast, fetchJSON, graficoLineas, esc, descargar } = UI;
  const estado = {
    datos: null,        // última respuesta completa (la de la hora seleccionada)
    serie: new Map(),   // hora local -> respuesta del endpoint
    seq: 0,             // número de petición para descartar respuestas viejas
    timer: null,        // debounce del slider
    completando: false, // evita doble ejecución del botón de curva
  };

  UI.initTabs();

  const COLORES = ['#ff6b4a', '#ffd166', '#7cf0ff', '#ff8fb1'];
  const TIMEOUT_MS = 20000;

  /* Semáforo del índice de riesgo (0–100). */
  function colorRiesgo(v) {
    if (v >= 65) return 'var(--bad)';
    if (v >= 40) return '#f07a24';
    return 'var(--ok)';
  }

  /* Consulta una hora con corte de 20 s. Si se corta, el error se propaga. */
  async function consultar(hora) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      return await fetchJSON(`/api/marte?hora=${hora}`, { signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  function renderKpis(j) {
    const c = j.clima || {};
    qs('#m-sol').textContent = c.sol == null ? '—' : 'Sol ' + c.sol;
    qs('#m-sol-sub').textContent = c.fechaTierra ? `${fecha(c.fechaTierra)} · ${c.estacion || '—'}` : 'sin fecha terrestre';
    qs('#m-temp').textContent = (c.tempMin == null || c.tempMax == null) ? '—' : `${fmt(c.tempMin, 0)} / ${fmt(c.tempMax, 0)} °C`;
    qs('#m-temp-sub').textContent = `UV: ${c.uv || '—'} · amanecer ${c.amanecer || '—'}`;
    qs('#m-presion').textContent = c.presion == null ? '—' : fmt(c.presion, 0) + ' Pa';
    qs('#m-opacidad').textContent = c.opacidad || '—';
    qs('#m-opacidad-sub').textContent = `Ls ${fmt(c.ls, 1)}° · ${c.estacion || '—'}`;

    qs('#badge-ls').textContent = `Ls ${fmt(c.ls, 1)}° · hora ${fmt(j.horaLocal, 0)}:00`;
    qs('#badge-subsolar').textContent = `subsolar ${fmt(j.subsolarLat, 1)}° de latitud`;
    qs('#nota-subsolar').textContent = `A esta hora el Sol está sobre la latitud ${fmt(j.subsolarLat, 1)}°. Ls ${fmt(c.ls, 1)}° indica el avance de la estación marciana; el sol dura 24 h 39 min.`;
  }

  function renderSitios(j) {
    const sitios = j.sitios || [];
    if (!sitios.length) {
      qs('#sitios').innerHTML = '<p class="aviso">Sin sitios para esta hora.</p>';
      return;
    }
    qs('#sitios').innerHTML = sitios.map((s, i) => {
      const color = colorRiesgo(s.indiceRiesgo || 0);
      return `<div class="sitio-riesgo">
        <div class="sitio-cab">
          <h3>${esc(s.nombre)}</h3>
          <i class="punto-color" style="background:${COLORES[i % COLORES.length]}"></i>
        </div>
        <div class="sitio-metric" style="color:${color}">${fmt(s.indiceRiesgo, 0)}</div>
        <span class="sitio-sub">índice de riesgo /100</span>
        <div class="sitio-datos">
          <div><span>Sol</span><b>${fmt(s.elevacionSol, 1)}°</b></div>
          <div><span>Horas de luz</span><b>${fmt(s.horasLuz, 1)} h</b></div>
          <div><span>Polvo</span><b>${esc(s.riesgoPolvo)}</b></div>
        </div>
        <div class="tags">
          <span>${fmt(s.elevM, 0)} m</span>
          <span>pend. ${fmt(s.pendiente, 0)}°</span>
          <span>${esc(s.polvo)} base</span>
        </div>
      </div>`;
    }).join('');

    qs('#leyenda-sitios').innerHTML = sitios.map((s, i) => `<span><i style="background:${COLORES[i % COLORES.length]}"></i>${esc(s.nombre)}</span>`).join('');
  }

  function renderRuta(j) {
    const ruta = j.ruta || [];
    qs('#tabla-ruta').innerHTML = ruta.length ? ruta.map((r) => {
      const color = colorRiesgo(r.riesgo || 0);
      return `<tr>
        <td>${esc(r.desde)} → ${esc(r.hasta)}</td>
        <td class="num">${fmt(r.km, 0)} km</td>
        <td class="num">${fmt(r.solsRover, 0)} soles</td>
        <td><span class="badge" style="color:${color}">${fmt(r.riesgo, 0)}/100</span></td>
      </tr>`;
    }).join('') : '<tr><td colspan="4">Sin ruta para mostrar.</td></tr>';
  }

  /* Curva del sol: una serie por sitio, un punto por hora ya consultada.
     Las horas sin consultar quedan en null y el gráfico corta la línea ahí. */
  function renderCurva() {
    const horas = [...estado.serie.keys()].sort((a, b) => a - b);
    if (!horas.length) {
      qs('#chart-sol').innerHTML = '<p class="aviso">Consultá al menos una hora para ver la curva.</p>';
      return;
    }
    const base = estado.datos?.sitios || estado.serie.get(horas[0])?.sitios || [];
    const series = base.map((s, i) => ({
      nombre: s.nombre,
      color: COLORES[i % COLORES.length],
      grosor: 2.4,
      valores: horas.map((h) => {
        const d = estado.serie.get(h);
        const sitio = d?.sitios?.find((x) => x.id === s.id);
        return sitio ? sitio.elevacionSol : null;
      }),
    }));
    qs('#chart-sol').innerHTML = graficoLineas({
      series,
      etiquetas: horas.map((h) => `${h}:00`),
      alto: 300,
      yLabel: 'Elevación solar por hora local marciana (grados)',
      formatoY: (v) => fmt(v, 0) + '°',
      mostrarPuntos: true,
    });
  }

  function render(j) {
    estado.datos = j;
    if (j.error) {
      toast('No se pudo cargar el clima marciano: ' + j.error, 'error');
      qs('#chip-fuente').textContent = 'sin conexión';
      qs('#chip-fuente').classList.remove('vivo');
      qs('#sitios').innerHTML = '<p class="aviso">El servidor no pudo leer el clima de Marte.</p>';
      qs('#tabla-ruta').innerHTML = '<tr><td colspan="4">Sin ruta para mostrar.</td></tr>';
      return;
    }
    const chip = qs('#chip-fuente');
    const vivo = j._meta?.fuente === 'vivo';
    /* El endpoint marte es siempre "vivo" (no tiene respaldo declarado). */
    chip.textContent = vivo ? 'MSL Weather en vivo' : 'respaldo local declarado';
    chip.classList.toggle('vivo', vivo);
    chip.title = j._meta?.aviso || '';

    renderKpis(j);
    renderSitios(j);
    renderRuta(j);
    renderCurva();
  }

  /* Carga la hora pedida. `seq` evita que una respuesta lenta pise a una nueva. */
  async function cargar(hora) {
    const seq = ++estado.seq;
    const chip = qs('#chip-fuente');
    chip.textContent = `consultando hora ${hora}:00…`;
    chip.classList.remove('vivo');
    try {
      const j = await consultar(hora);
      if (seq !== estado.seq) return; // llegó tarde: ya hay otra consulta en curso
      if (j.error) {
        toast('No se pudo cargar el clima marciano: ' + j.error, 'error');
        chip.textContent = 'sin conexión';
        return;
      }
      estado.serie.set(hora, j);
      render(j);
    } catch (e) {
      if (seq !== estado.seq) return;
      const mensaje = e.name === 'AbortError' ? 'la API de NASA no respondió en 20 s' : e.message;
      chip.textContent = 'sin conexión';
      chip.classList.remove('vivo');
      qs('#sitios').innerHTML = '<p class="aviso">Sin datos de sitios para esta hora. Reintentá o probá otra hora.</p>';
      qs('#tabla-ruta').innerHTML = '<tr><td colspan="4">Sin ruta para mostrar.</td></tr>';
      toast('Error al consultar Marte: ' + mensaje, 'error');
    }
  }

  /* Completa la curva pidiendo 0, 3, …, 24 h (9 consultas secuenciales).
     El clima está cacheado en el servidor, así que solo la primera es costosa. */
  async function completarCurva() {
    if (estado.completando) return;
    estado.completando = true;
    const btn = qs('#btn-curva');
    btn.disabled = true;
    const chip = qs('#chip-fuente');
    const horas = [0, 3, 6, 9, 12, 15, 18, 21, 24].filter((h) => !estado.serie.has(h));
    for (let i = 0; i < horas.length; i++) {
      chip.textContent = `completando curva ${i + 1}/${horas.length}…`;
      chip.classList.remove('vivo');
      try {
        const j = await consultar(horas[i]);
        if (!j.error) estado.serie.set(horas[i], j);
      } catch (e) {
        toast('Se cortó la curva en la hora ' + horas[i] + ': ' + e.message, 'error');
        break;
      }
    }
    btn.disabled = false;
    estado.completando = false;
    renderCurva();
    /* Restaura el chip al estado de la hora seleccionada. */
    if (estado.datos) {
      chip.textContent = 'MSL Weather en vivo';
      chip.classList.add('vivo');
    } else {
      chip.textContent = 'sin conexión';
    }
  }

  /* Slider: actualiza el número al instante y consulta con debounce (400 ms). */
  qs('#hora').addEventListener('input', () => {
    const h = Math.round(num(qs('#hora').value, 12));
    qs('#v-hora').textContent = h;
    clearTimeout(estado.timer);
    estado.timer = setTimeout(() => cargar(h), 400);
  });

  qsa('.preset').forEach((b) => b.addEventListener('click', () => {
    const h = num(b.dataset.hora, 12);
    qs('#hora').value = h;
    qs('#v-hora').textContent = h;
    cargar(h);
  }));

  qs('#btn-curva').addEventListener('click', completarCurva);

  qs('#btn-json').addEventListener('click', () => {
    if (!estado.datos) return toast('Todavía no hay datos para descargar', 'error');
    descargar('mapa-marciano.json', estado.datos);
  });

  cargar(12);
})();
