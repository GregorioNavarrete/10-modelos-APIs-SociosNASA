(function () {
  const { qs, fmt, fecha, num, toast, fetchJSON, barras, descargar } = UI;
  const estado = { datos: null, mapa: null, capa: null, cargado: false };

  UI.initTabs();

  function initMapa() {
    if (!window.L || estado.mapa) return;
    estado.mapa = L.map('mapa', { scrollWheelZoom: false }).setView([-38, -63], 4);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 17,
      attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics',
    }).addTo(estado.mapa);
    estado.capa = L.layerGroup().addTo(estado.mapa);
  }

  function colorRiesgo(r) {
    if (r >= 0.8) return '#e5484d';
    if (r >= 0.5) return '#f07a24';
    return '#ffb03d';
  }

  function pintarMapa(j) {
    if (!window.L) return;
    initMapa();
    estado.capa.clearLayers();
    const puntos = [];
    for (const f of j.focos || []) {
      if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon)) continue;
      const radio = Math.max(4, Math.min(17, 3 + Math.sqrt(Math.max(0, f.frp)) * 0.75));
      const m = L.circleMarker([f.lat, f.lon], {
        radius: radio, color: colorRiesgo(f.riesgo), weight: 1.2,
        fillColor: colorRiesgo(f.riesgo), fillOpacity: 0.55,
      }).addTo(estado.capa);
      m.bindPopup(`<b>${f.municipio || 'Sin municipio'}</b> · ${f.estado || ''}<br>
        ${f.fecha} · ${f.satelite}<br>
        FRP: <b>${fmt(f.frp, 1)} MW</b> · riesgo ${fmt(f.riesgo, 2)}<br>
        ${f.diasSinChuva} días sin lluvia · precip. ${fmt(f.precip, 1)} mm`);
      puntos.push([f.lat, f.lon]);
    }
    if (puntos.length) estado.mapa.fitBounds(L.latLngBounds(puntos).pad(0.15), { maxZoom: 7 });
    else estado.mapa.setView([-38, -63], 4);
  }

  function renderCalendario(j) {
    const dias = j.porDia || [];
    if (!dias.length) { qs('#calendario').innerHTML = '<p class="aviso">Sin días con datos.</p>'; return; }
    const valores = dias.map((d) => d.valor);
    const media = valores.reduce((a, b) => a + b, 0) / valores.length;
    const sd = Math.sqrt(valores.reduce((a, b) => a + (b - media) ** 2, 0) / Math.max(1, valores.length - 1)) || 1;
    qs('#calendario').innerHTML = dias.map((d) => {
      const z = (d.valor - media) / sd;
      const clase = z < -0.5 ? 'bajo' : z <= 0.5 ? 'normal' : z <= 1.5 ? 'alto' : 'muyalto';
      const etiqueta = new Date(d.dia + 'T12:00:00Z').toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' });
      return `<div class="dia-cal ${clase}" title="${d.valor} focos · z=${z.toFixed(2)}">
        <b>${d.valor}</b><small>${etiqueta}</small><span class="z">z ${z.toFixed(1)}</span>
      </div>`;
    }).join('');
  }

  function renderLectura(j) {
    const r = j.resumen || {};
    const pico = r.pico || {};
    const picoTxt = pico.dia ? `${fecha(pico.dia)} · ${pico.valor} focos` : '—';
    qs('#lectura').innerHTML = `
      <div class="linea"><span>Promedio diario</span><b>${fmt(r.promedioDiario, 0)} focos</b></div>
      <div class="linea"><span>Día pico</span><b>${picoTxt}</b></div>
      <div class="linea"><span>Focos de riesgo alto</span><b>${fmt(r.riesgoAlto, 0)}</b></div>
      <div class="linea"><span>FRP medio</span><b>${fmt(r.frpMedio, 1)} MW</b></div>
      <div class="linea"><span>País / días</span><b>${j.pais} · ${j.dias}</b></div>
      <p class="aviso">El calendario compara contra el promedio del período cargado. Para una anomalía climática real hace falta una climatología de varios años.</p>`;
  }

  function render(j) {
    estado.datos = j;
    if (j.error) { toast('No se pudo cargar INPE: ' + j.error, 'error'); return; }

    const chip = qs('#chip-fuente');
    const vivo = j._meta?.fuente === 'vivo';
    chip.textContent = vivo ? `INPE en vivo · ${j.fecha}` : 'respaldo local declarado';
    chip.classList.toggle('vivo', vivo);
    chip.title = j._meta?.aviso || '';

    if (!estado.cargado) {
      const sel = qs('#pais');
      const paises = j.paisesDisponibles || ['Argentina'];
      sel.innerHTML = paises.map((p) => `<option ${p === j.pais ? 'selected' : ''}>${UI.esc(p)}</option>`).join('');
      estado.cargado = true;
    }

    const r = j.resumen || {};
    qs('#m-total').textContent = fmt(r.total, 0);
    qs('#m-total-sub').textContent = `${r.diasConDatos || 0} días · ${r.promedioDiario || 0}/día`;
    qs('#m-frp').textContent = fmt(r.frpMax, 0);
    qs('#m-prov').textContent = fmt(r.provincias, 0);
    qs('#m-sat').textContent = fmt(r.satelites, 0);

    pintarMapa(j);
    renderCalendario(j);
    renderLectura(j);

    qs('#chart-sat').innerHTML = (j.porSatelite || []).length
      ? barras({ valores: j.porSatelite.map((s) => s.valor), etiquetas: j.porSatelite.map((s) => s.nombre), color: '#ff7a3d', alto: 210, formato: (v) => fmt(v, 0) })
      : '<p class="aviso">Sin datos de satélite.</p>';

    qs('#chart-prov').innerHTML = (j.porProvincia || []).length
      ? barras({ valores: j.porProvincia.map((s) => s.valor), etiquetas: j.porProvincia.map((s) => s.nombre), color: '#ff3d68', alto: 210, formato: (v) => fmt(v, 0) })
      : '<p class="aviso">Sin datos provinciales.</p>';

    const filas = (j.focos || []).slice(0, 60);
    qs('#tabla').innerHTML = filas.length ? filas.map((f) => `<tr>
      <td>${f.fecha}</td>
      <td>${UI.esc(f.estado || '—')}</td>
      <td title="${UI.esc(f.municipio)}">${UI.esc(f.municipio || '—')}</td>
      <td>${UI.esc(f.satelite)}</td>
      <td class="num">${fmt(f.frp, 1)}</td>
      <td class="num">${fmt(f.riesgo, 2)}</td>
      <td class="num">${fmt(f.diasSinChuva, 0)}</td>
      <td>${f.lat.toFixed(3)}, ${f.lon.toFixed(3)}</td>
    </tr>`).join('') : '<tr><td colspan="8">Sin focos para el filtro elegido.</td></tr>';
  }

  async function cargar() {
    const pais = qs('#pais').value || 'Argentina';
    const dias = qs('#dias').value || 3;
    const chip = qs('#chip-fuente');
    chip.textContent = `descargando ${dias} día(s) de INPE…`;
    chip.classList.remove('vivo');
    try {
      const j = await fetchJSON(`/api/fuego?pais=${encodeURIComponent(pais)}&dias=${dias}`);
      render(j);
    } catch (e) {
      chip.textContent = 'sin conexión';
      toast('Error al consultar INPE: ' + e.message, 'error');
    }
  }

  qs('#btn-actualizar').addEventListener('click', cargar);
  qs('#dias').addEventListener('change', cargar);
  qs('#pais').addEventListener('change', cargar);

  qs('#btn-json').addEventListener('click', () => {
    if (!estado.datos) return toast('Todavía no hay datos', 'error');
    descargar('calendario-del-fuego.json', estado.datos);
  });

  cargar();
})();
