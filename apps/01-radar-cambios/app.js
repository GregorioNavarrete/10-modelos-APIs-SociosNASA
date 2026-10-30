(function () {
  const { qs, qsa, fmt, fecha, num, toast, fetchJSON, barras, descargar } = UI;
  const estado = { datos: null, mapa: null, capa: null };

  UI.initTabs();

  function mesCorto(ym) {
    const [y, m] = ym.split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
  }

  function initMapa(lat, lon) {
    if (!window.L) return;
    if (!estado.mapa) {
      estado.mapa = L.map('mapa', { scrollWheelZoom: false }).setView([lat, lon], 7);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 17,
        attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics',
      }).addTo(estado.mapa);
    } else {
      estado.mapa.setView([lat, lon], 7);
    }
    if (estado.capa) estado.capa.remove();
    const d = 0.28;
    estado.capa = L.rectangle([[lat - d, lon - d], [lat + d, lon + d]], {
      color: '#38d0ff', weight: 1.5, fillColor: '#38d0ff', fillOpacity: 0.09,
    }).addTo(estado.mapa);
    estado.capa.bindPopup(`<b>AOI</b><br>${lat.toFixed(2)}, ${lon.toFixed(2)}<br>~${Math.round(d * 222)} km de lado`).openPopup();
  }

  function render(j) {
    estado.datos = j;
    if (j.error) {
      toast('No se pudo cargar el catálogo: ' + j.error, 'error');
      return;
    }
    const chip = qs('#chip-fuente');
    const vivo = j._meta?.fuente === 'vivo';
    chip.textContent = vivo ? 'catálogo en vivo · CDSE' : 'respaldo local declarado';
    chip.classList.toggle('vivo', vivo);
    chip.title = j._meta?.aviso || '';

    const r = j.resumen || {};
    qs('#m-escenas').textContent = fmt(r.total, 0);
    qs('#m-escenas-sub').textContent = `${j.ventanaDias} días · ${r.diasConPase || 0} días con pase`;
    qs('#m-ultimo').textContent = r.ultima ? fecha(r.ultima) : '—';
    qs('#m-ultimo-sub').textContent = r.ultima ? new Date(r.ultima).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + ' UTC' : 'sin datos';
    qs('#m-cadencia').textContent = r.cadenciaDias ? fmt(r.cadenciaDias, 1) + ' d' : '—';
    qs('#m-pares').textContent = fmt(r.paresPotenciales, 0);
    qs('#badge-aoi').textContent = `${j.aoi?.lat?.toFixed(2)}, ${j.aoi?.lon?.toFixed(2)} · ±${j.aoi?.radioKm} km`;

    if (j.aoi) initMapa(j.aoi.lat, j.aoi.lon);

    qs('#chart-mes').innerHTML = j.porMes?.length
      ? barras({ valores: j.porMes.map((m) => m.escenas), etiquetas: j.porMes.map((m) => mesCorto(m.mes)), color: '#38d0ff', alto: 220, formato: (v) => fmt(v, 0) })
      : '<p class="aviso">Sin escenas en esta ventana. Probá ampliar los días o mover el AOI.</p>';

    qs('#chart-tipo').innerHTML = j.porTipo?.length
      ? barras({ valores: j.porTipo.map((t) => t.valor), etiquetas: j.porTipo.map((t) => t.nombre), color: '#2f7dff', alto: 220, formato: (v) => fmt(v, 0) })
      : '';
    qs('#leyenda-tipo').innerHTML = (j.porModo || []).map((m) => `<span><i style="background:#38d0ff"></i>Modo ${m.nombre}: <b>${m.valor}</b></span>`).join('');

    const filas = j.escenas || [];
    qs('#tabla-escenas').innerHTML = filas.length
      ? filas.map((e) => `<tr>
          <td>${fecha(e.fecha)}<br><small style="color:var(--suave)">${new Date(e.fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</small></td>
          <td title="${UI.esc(e.nombre)}">${UI.esc(e.nombre)}</td>
          <td><span class="badge">${e.modo}</span></td>
          <td>${e.tipo}</td>
          <td class="num">${e.mb ? fmt(e.mb, 0) + ' MB' : '—'}</td>
          <td>${e.online ? '<span class="badge ok">online</span>' : '<span class="badge warn">offline</span>'}</td>
        </tr>`).join('')
      : '<tr><td colspan="6">Sin productos para mostrar.</td></tr>';
  }

  async function cargar() {
    const lat = num(qs('#lat').value, -34.6);
    const lon = num(qs('#lon').value, -58.4);
    const dias = num(qs('#dias').value, 120);
    const chip = qs('#chip-fuente');
    chip.textContent = 'consultando CDSE…';
    chip.classList.remove('vivo');
    try {
      const j = await fetchJSON(`/api/radar?lat=${lat}&lon=${lon}&dias=${dias}`);
      render(j);
    } catch (e) {
      chip.textContent = 'sin conexión';
      toast('Error al consultar el catálogo: ' + e.message, 'error');
    }
  }

  qs('#btn-consultar').addEventListener('click', cargar);

  qsa('.preset').forEach((b) => b.addEventListener('click', () => {
    qs('#lat').value = b.dataset.lat;
    qs('#lon').value = b.dataset.lon;
    cargar();
  }));

  qs('#btn-csv').addEventListener('click', () => {
    if (!estado.datos) return toast('Todavía no hay datos para descargar', 'error');
    descargar('radar-de-cambios.json', estado.datos);
  });

  cargar();
})();
