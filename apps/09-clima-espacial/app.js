/* App 09 · Clima Espacial para Operadores
   Flujo: /api/clima-espacial devuelve el Kp de las últimas horas, el máximo de
   24 h, el nivel, las escalas NOAA, las alertas SWPC y tres corredores con su
   umbral. El cliente pinta los KPIs, la serie de Kp y —sin volver a consultar—
   recalcula qué rutas quedan expuestas al mover el umbral de decisión. */
(function () {
  const { qs, qsa, fmt, num, toast, fetchJSON, graficoLineas, esc, colorNivel } = UI;
  const estado = { datos: null, umbral: 5 };

  UI.initTabs();

  /* Traducción de nivel del servidor a la paleta de UI.colorNivel. */
  const NIVELES = {
    quieto: { color: 'verde', etiqueta: 'Quieto' },
    alerta: { color: 'amarillo', etiqueta: 'Alerta' },
    tormenta: { color: 'naranja', etiqueta: 'Tormenta' },
    severo: { color: 'rojo', etiqueta: 'Severo' },
  };

  /* Las horas de SWPC vienen sin zona ("2025-10-28 03:00:00"): se asume UTC.
     Si ya trajeran Z o offset, se respeta lo que venga. */
  function aFecha(t) {
    if (!t) return null;
    const s = String(t).trim().replace(' ', 'T');
    const conZona = /Z$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z';
    const d = new Date(conZona);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function etiquetaKp(t) {
    const d = aFecha(t);
    if (!d) return String(t || '');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    return `${dd}/${mm} ${hh}Z`;
  }

  function horaCompleta(t) {
    const d = aFecha(t);
    if (!d) return '—';
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
  }

  /* Gráfico Kp + umbral elegido + bordes 0/9 para fijar la escala. */
  function renderGrafico() {
    const kp = estado.datos?.kp || [];
    if (!kp.length) {
      qs('#chart-kp').innerHTML = '<p class="aviso">Sin muestras de Kp para graficar.</p>';
      return;
    }
    const etiquetas = kp.map((x) => etiquetaKp(x.t));
    const umbralSerie = kp.map(() => estado.umbral);
    qs('#chart-kp').innerHTML = graficoLineas({
      series: [
        { nombre: 'Kp', color: '#4f8cff', valores: kp.map((x) => x.kp), grosor: 2.4 },
        { nombre: 'Umbral', color: '#f07a24', valores: umbralSerie, grosor: 1.6, punteado: true },
        { nombre: 'Máximo', color: '#5e6c85', valores: kp.map(() => 9), grosor: 1 },
        { nombre: 'Mínimo', color: '#5e6c85', valores: kp.map(() => 0), grosor: 1 },
      ],
      etiquetas,
      alto: 300,
      yLabel: 'Kp planetario de las últimas horas',
      formatoY: (v) => fmt(v, 0),
    });
    qs('#badge-muestras').textContent = `${kp.length} muestras · 3 h`;
  }

  /* Rutas: se resaltan cuando el umbral de la ruta es ≤ el umbral elegido.
     El Kp seleccionado es una decisión del operador, no el Kp observado. */
  function renderRutas() {
    const rutas = estado.datos?.rutas || [];
    const kpSel = estado.umbral;
    if (!rutas.length) {
      qs('#rutas').innerHTML = '<p class="aviso">Sin corredores configurados.</p>';
      qs('#badge-rutas').textContent = 'sin datos';
      return;
    }
    qs('#rutas').innerHTML = rutas.map((r) => {
      const enRiesgo = num(r.umbral, 99) <= kpSel;
      return `<div class="ruta-card ${enRiesgo ? 'riesgo' : ''}">
        <div class="ruta-cab">
          <h3>${esc(r.nombre)}</h3>
          <span class="badge ${enRiesgo ? 'bad' : ''}">${enRiesgo ? 'en riesgo' : 'sin alerta'}</span>
        </div>
        <div class="ruta-umbral">Kp ≥ ${fmt(r.umbral, 1)}</div>
        <p>${esc(r.gnss)}</p>
        <div class="tags">
          <span>exposición ${esc(r.exposicion)}</span>
          <span>umbral ${fmt(r.umbral, 1)}</span>
        </div>
      </div>`;
    }).join('');

    const enRiesgo = rutas.filter((r) => num(r.umbral, 99) <= kpSel).length;
    qs('#badge-rutas').textContent = `${enRiesgo}/${rutas.length} en riesgo · Kp ${fmt(kpSel, 1)}`;
    qs('#resumen-umbral').innerHTML = `<b>${enRiesgo}</b> de ${rutas.length} corredores cruzan tu umbral de Kp ${fmt(kpSel, 1)}.`;
    qs('#nota-umbral').textContent = kpSel >= 7
      ? 'Umbral severo: solo eventos muy fuertes activan protocolos.'
      : kpSel >= 5
        ? 'Umbral de tormenta geomagnética (G1 o superior).'
        : 'Umbral laxo: vas a recibir avisos con perturbaciones menores.';
  }

  function renderAlertas(j) {
    const alertas = j.alertas || [];
    qs('#badge-alertas').textContent = alertas.length ? `${alertas.length} activas` : 'sin alertas';
    qs('#alertas').innerHTML = alertas.length
      ? alertas.map((a) => `<article class="alerta">
          <div class="alerta-cab">
            <span class="badge warn">${esc(a.producto || 'SWPC')}</span>
            <time>${esc(horaCompleta(a.emitido))}</time>
          </div>
          <h3>${esc(a.titulo || 'Aviso SWPC')}</h3>
          <p>${esc(a.detalle || '')}</p>
        </article>`).join('')
      : '<p class="aviso">No hay alertas SWPC activas en este momento. El Kp sigue siendo la referencia.</p>';
  }

  /* Escalas G/S/R: el objeto puede traer {G:{Scale,Text}} o variantes en minúscula. */
  function renderEscalas(j) {
    const esc0 = j.escalas || {};
    const filas = [
      ['G', 'Geomagnética (G)'],
      ['S', 'Radiación solar (S)'],
      ['R', 'Apagón de radio (R)'],
    ];
    qs('#tabla-escalas').innerHTML = filas.map(([k, nombre]) => {
      const x = esc0[k] || esc0[k.toLowerCase()] || {};
      const nivel = x.Scale ?? x.scale ?? '—';
      const texto = x.Text ?? x.text ?? '—';
      return `<tr><td>${nombre}</td><td class="num">${esc(nivel)}</td><td>${esc(texto)}</td></tr>`;
    }).join('');
    qs('#nota-escalas').textContent = j.actual?.actualizado
      ? `Actualizado: ${horaCompleta(j.actual.actualizado)}.`
      : 'SWPC no informó la hora de actualización.';
  }

  function render(j) {
    estado.datos = j;
    if (j.error) {
      toast('No se pudo leer el clima espacial: ' + j.error, 'error');
      qs('#chip-fuente').textContent = 'sin conexión';
      qs('#chip-fuente').classList.remove('vivo');
      return;
    }
    const chip = qs('#chip-fuente');
    const vivo = j._meta?.fuente === 'vivo';
    chip.textContent = vivo ? 'NOAA SWPC en vivo' : 'respaldo local declarado';
    chip.classList.toggle('vivo', vivo);
    chip.title = j._meta?.aviso || '';

    const a = j.actual || {};
    const nv = NIVELES[a.nivel] || { color: 'azul', etiqueta: a.nivel || '—' };
    qs('#m-kp').textContent = a.kp == null ? '—' : fmt(a.kp, 1);
    qs('#m-kp-sub').textContent = j.kp?.at(-1) ? `muestra ${etiquetaKp(j.kp.at(-1).t)}` : 'sin serie';
    qs('#m-kpmax').textContent = a.kpMax24 == null ? '—' : fmt(a.kpMax24, 1);
    const nivelEl = qs('#m-nivel');
    const color = colorNivel(nv.color);
    nivelEl.textContent = nv.etiqueta;
    nivelEl.style.color = color;
    qs('#m-nivel-sub').innerHTML = `<span class="badge" style="color:${color};border-color:${color}">escala G · Kp ${fmt(a.kpMax24, 1)}</span>`;
    qs('#m-flujo').textContent = a.flujo10cm == null ? '—' : fmt(a.flujo10cm, 0);

    renderGrafico();
    renderRutas();
    renderAlertas(j);
    renderEscalas(j);
  }

  async function cargar() {
    const chip = qs('#chip-fuente');
    chip.textContent = 'consultando SWPC…';
    chip.classList.remove('vivo');
    try {
      const j = await fetchJSON('/api/clima-espacial');
      render(j);
    } catch (e) {
      qs('#chip-fuente').textContent = 'sin conexión';
      qs('#chip-fuente').classList.remove('vivo');
      qs('#tabla-escalas').innerHTML = '<tr><td colspan="3">Sin datos de escalas.</td></tr>';
      qs('#rutas').innerHTML = '<p class="aviso">No se pudieron leer los corredores. Revisá la conexión.</p>';
      qs('#alertas').innerHTML = '<p class="aviso">Sin datos de alertas.</p>';
      toast('Error al consultar NOAA SWPC: ' + e.message, 'error');
    }
  }

  /* El slider solo cambia el umbral local: no dispara otra consulta. */
  qs('#umbral').addEventListener('input', () => {
    estado.umbral = num(qs('#umbral').value, 5);
    qs('#v-umbral').textContent = fmt(estado.umbral, 1);
    if (estado.datos) {
      renderGrafico();
      renderRutas();
    }
  });

  qsa('[data-umbral]').forEach((b) => b.addEventListener('click', () => {
    estado.umbral = num(b.dataset.umbral, 5);
    qs('#umbral').value = estado.umbral;
    qs('#v-umbral').textContent = fmt(estado.umbral, 1);
    if (estado.datos) {
      renderGrafico();
      renderRutas();
    }
  }));

  cargar();
})();
