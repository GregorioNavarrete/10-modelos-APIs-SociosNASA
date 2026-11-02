/* App 06 · Base Lunar
   Flujo: /api/lunar devuelve, para cada sitio polar, una serie temporal cada
   3 h con la elevación del Sol y de la Tierra. Acá se comparan los sitios:
   porcentajes de iluminación/enlace, racha de oscuridad, gráficos, tabla y un
   mapa Leaflet con el mosaico público LRO WAC de NASA Moon Trek.
   Los porcentajes ya vienen calculados por el servidor; el cliente no los recalcula. */
(function () {
  const { qs, qsa, fmt, num, pct, fecha, toast, fetchJSON, graficoLineas, esc, descargar } = UI;
  const estado = { datos: null, mapaLunar: null, marcadoresLunar: null };

  UI.initTabs();

  /* Un color fijo por sitio: se usa en tarjetas, gráficos, mapa y leyenda. */
  const COLORES = ['#b8b8ff', '#7cf0ff', '#ffd166', '#ff8fb1'];

  /* Mosaico LRO WAC global 303 ppd servido por NASA Moon Trek.
     Verificado con peticiones reales a z0–z7. La grilla de este producto tiene
     2^(z+1) columnas y 2^z filas por nivel; el CRS propio de abajo reproduce
     exactamente esa grilla, así que los tokens {z}/{y}/{x} van tal cual. */
  const TILES_LUNA = 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd/1.0.0/default/default028mm/{z}/{y}/{x}.png';
  const LIMITES_LUNA = [[0, 0], [256, 512]]; // [lat=y, lng=x] del plano en zoom 0
  const MAX_ZOOM_LUNA = 7;

  /* Etiqueta corta para el eje X: "14/03 15h". */
  function etiquetaTiempo(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    return `${dd}/${mm} ${hh}h`;
  }

  /* Lat/lon selenográficas → plano del mapa:
       x = (lon + 180) / 360 · 512   (0 = −180°, 512 = +180°)
       y = (90 − lat) / 180 · 256   (0 = +90°, 256 = −90°)
     El mosaico es equirectangular, así que la conversión es lineal. */
  function aPlanoLunar(lat, lon) {
    return [((90 - num(lat, 0)) / 180) * 256, ((num(lon, 0) + 180) / 360) * 512];
  }

  /* Crea el mapa una sola vez. Si Leaflet no cargó desde el CDN, deja un aviso
     dentro del contenedor y no rompe los gráficos ni la tabla. */
  function initMapaLunar() {
    if (estado.mapaLunar) return estado.mapaLunar;
    if (!window.L) {
      qs('#mapa-lunar').innerHTML = '<p class="aviso" style="padding:14px">No se pudo cargar Leaflet desde el CDN. Los gráficos y la tabla siguen disponibles.</p>';
      return null;
    }
    /* CRS propio: igual a L.CRS.Simple pero con el eje Y hacia abajo. Así la
       fila 0 del mosaico (polo norte) queda arriba y {y} coincide con Moon Trek. */
    const CRS_LUNA = L.Util.extend({}, L.CRS.Simple, {
      transformation: new L.Transformation(1, 0, 1, 0),
    });
    const mapa = L.map('mapa-lunar', {
      crs: CRS_LUNA,
      center: [128, 256],
      // En pantallas angostas conviene ver el disco completo; en desktop, zoom 1.
      zoom: (qs('#mapa-lunar').clientWidth || 900) < 700 ? 0 : 1,
      minZoom: 0,
      maxZoom: MAX_ZOOM_LUNA,
      maxBounds: LIMITES_LUNA,
      maxBoundsViscosity: 0.7,
      scrollWheelZoom: false,
    });
    L.tileLayer(TILES_LUNA, {
      tileSize: 256,
      minZoom: 0,
      maxZoom: MAX_ZOOM_LUNA,
      noWrap: true,
      bounds: LIMITES_LUNA,
      attribution: 'LRO WAC · NASA/GSFC/ASU · <a href="https://trek.nasa.gov/moon/" target="_blank" rel="noopener">Moon Trek</a>',
    }).addTo(mapa);
    estado.mapaLunar = mapa;
    return mapa;
  }

  /* Marcadores numerados con popup: nombre, coordenadas e indicadores de la
     ventana calculada. Se recrean en cada consulta porque cambian los días. */
  function dibujarSitiosMapa(sitios) {
    const mapa = estado.mapaLunar || initMapaLunar();
    if (!mapa) return;
    if (estado.marcadoresLunar) estado.marcadoresLunar.remove();
    const grupo = L.layerGroup();
    sitios.forEach((s, i) => {
      const [y, x] = aPlanoLunar(s.lat, s.lon);
      const color = COLORES[i % COLORES.length];
      const icono = L.divIcon({
        className: 'marcador-lunar',
        html: `<span style="--color-sitio:${color}">${i + 1}</span>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -14],
      });
      L.marker([y, x], { icon: icono, title: s.nombre })
        .bindPopup(`<b>${esc(s.nombre)}</b><br>
          ${fmt(s.lat, 2)}°, ${fmt(s.lon, 2)}°<br>
          Iluminación: <b>${pct(s.resumen?.iluminacionPct, 0)}</b><br>
          Enlace Tierra: <b>${pct(s.resumen?.comunicacionPct, 0)}</b>`)
        .addTo(grupo);
    });
    grupo.addTo(mapa);
    estado.marcadoresLunar = grupo;
    /* El contenedor pudo cambiar de tamaño al cargar; Leaflet recalcula. */
    setTimeout(() => mapa.invalidateSize(), 80);
  }

  /* Tarjeta de un sitio. Se destaca el mejor en iluminación y en comunicación. */
  function tarjetaSitio(s, i, mejorIlum, mejorCom) {
    const r = s.resumen || {};
    const esIlum = s.id === mejorIlum?.id;
    const esCom = s.id === mejorCom?.id;
    return `<div class="sitio-card ${esIlum ? 'mejor' : ''}">
      <div class="sitio-cab">
        <h3>${esc(s.nombre)}</h3>
        <i class="punto-color" style="background:${COLORES[i % COLORES.length]}"></i>
      </div>
      <div class="sitio-metric">${pct(r.iluminacionPct, 0)}</div>
      <span class="sitio-sub">iluminación solar</span>
      <div class="sitio-barras">
        <div><span>Enlace Tierra</span><b>${pct(r.comunicacionPct, 0)}</b></div>
        <div class="barra"><i style="width:${Math.min(100, r.comunicacionPct || 0)}%;background:${COLORES[i % COLORES.length]}"></i></div>
        <div><span>Oscuridad máx.</span><b>${fmt(r.oscuridadMaxHoras, 0)} h</b></div>
      </div>
      <div class="tags">
        <span>${fmt(s.elevM, 0)} m</span>
        <span>pend. ${fmt(s.pendiente, 0)}°</span>
        <span>hielo ${esc(s.hielo)}</span>
        ${esIlum ? '<span class="tag-ok">más sol</span>' : ''}
        ${esCom ? '<span class="tag-ok">mejor enlace</span>' : ''}
      </div>
    </div>`;
  }

  function render(j) {
    estado.datos = j;
    if (j.error) {
      toast('No se pudo calcular la geometría lunar: ' + j.error, 'error');
      qs('#chip-fuente').textContent = 'sin conexión';
      qs('#chip-fuente').classList.remove('vivo');
      qs('#sitios').innerHTML = '<p class="aviso">Sin datos de sitios. Reintentá en unos segundos.</p>';
      qs('#tabla-sitios').innerHTML = '<tr><td colspan="8">Sin datos para mostrar.</td></tr>';
      return;
    }
    const chip = qs('#chip-fuente');
    const vivo = j._meta?.fuente === 'vivo';
    chip.textContent = vivo ? 'SPICE simplificado en vivo' : 'respaldo local declarado';
    chip.classList.toggle('vivo', vivo);
    chip.title = j._meta?.aviso || '';

    const sitios = j.sitios || [];
    if (!sitios.length) {
      qs('#sitios').innerHTML = '<p class="aviso">Sin sitios para esta ventana.</p>';
      return;
    }

    /* Mejores por cada criterio: máximo de iluminación y máximo de enlace. */
    const mejorIlum = sitios.reduce((a, b) => ((b.resumen?.iluminacionPct || 0) > (a.resumen?.iluminacionPct || 0) ? b : a), sitios[0]);
    const mejorCom = sitios.reduce((a, b) => ((b.resumen?.comunicacionPct || 0) > (a.resumen?.comunicacionPct || 0) ? b : a), sitios[0]);

    qs('#m-ilum').textContent = pct(mejorIlum.resumen?.iluminacionPct, 0);
    qs('#m-ilum-sub').textContent = mejorIlum.nombre;
    qs('#m-com').textContent = pct(mejorCom.resumen?.comunicacionPct, 0);
    qs('#m-com-sub').textContent = mejorCom.nombre;
    qs('#m-subsolar').textContent = `${fmt(j.subSolar?.lat, 1)}°, ${fmt(j.subSolar?.lon, 1)}°`;
    qs('#m-ventana').textContent = `${fmt(j.dias, 0)} d`;
    qs('#m-ventana-sub').textContent = `${fmt(j.pasoHoras, 0)} h · ${fmt(sitios[0].serie?.length, 0)} muestras por sitio`;

    qs('#badge-inicio').textContent = `desde ${fecha(j.inicio)} · ${j.dias} días`;
    qs('#sitios').innerHTML = sitios.map((s, i) => tarjetaSitio(s, i, mejorIlum, mejorCom)).join('');

    /* Mapa: el mosaico se crea una vez y los marcadores se recrean por consulta. */
    dibujarSitiosMapa(sitios);

    /* Las etiquetas salen de la primera serie: todos los sitios comparten tiempos. */
    const etiquetas = (sitios[0].serie || []).map((p) => etiquetaTiempo(p.t));

    qs('#chart-sol').innerHTML = graficoLineas({
      series: sitios.map((s, i) => ({
        nombre: s.nombre,
        color: COLORES[i % COLORES.length],
        valores: (s.serie || []).map((p) => p.solEl),
        grosor: 2,
      })),
      etiquetas,
      alto: 280,
      yLabel: 'Elevación del Sol por sitio lunar (grados)',
      formatoY: (v) => fmt(v, 0) + '°',
    });
    qs('#chart-tierra').innerHTML = graficoLineas({
      series: sitios.map((s, i) => ({
        nombre: s.nombre,
        color: COLORES[i % COLORES.length],
        valores: (s.serie || []).map((p) => p.tierraEl),
        grosor: 2,
      })),
      etiquetas,
      alto: 280,
      yLabel: 'Elevación de la Tierra por sitio lunar (grados)',
      formatoY: (v) => fmt(v, 0) + '°',
    });

    const leyenda = sitios.map((s, i) => `<span><i style="background:${COLORES[i % COLORES.length]}"></i>${esc(s.nombre)}</span>`).join('');
    qs('#leyenda-sol').innerHTML = leyenda;
    qs('#leyenda-tierra').innerHTML = leyenda;

    qs('#tabla-sitios').innerHTML = sitios.map((s) => `<tr>
      <td>${esc(s.nombre)}</td>
      <td class="num">${fmt(s.elevM, 0)} m</td>
      <td class="num">${fmt(s.pendiente, 0)}°</td>
      <td><span class="badge">${esc(s.hielo)}</span></td>
      <td class="num">${fmt(s.horizonte, 1)}°</td>
      <td class="num">${pct(s.resumen?.iluminacionPct, 0)}</td>
      <td class="num">${pct(s.resumen?.comunicacionPct, 0)}</td>
      <td class="num">${fmt(s.resumen?.oscuridadMaxHoras, 0)} h</td>
    </tr>`).join('');
  }

  async function cargar() {
    const dias = Math.min(30, Math.max(7, Math.round(num(qs('#dias').value, 14))));
    qs('#dias').value = dias;
    const chip = qs('#chip-fuente');
    chip.textContent = 'calculando órbita…';
    chip.classList.remove('vivo');
    UI.cargando(qs('#sitios'), 'Calculando iluminación y enlaces…');
    try {
      const j = await fetchJSON(`/api/lunar?dias=${dias}`);
      render(j);
    } catch (e) {
      qs('#chip-fuente').textContent = 'sin conexión';
      qs('#chip-fuente').classList.remove('vivo');
      qs('#sitios').innerHTML = '<p class="aviso">No se pudo calcular la ventana. Revisá la conexión e intentá de nuevo.</p>';
      toast('Error al consultar la geometría lunar: ' + e.message, 'error');
    }
  }

  qs('#btn-simular').addEventListener('click', cargar);
  qsa('.preset').forEach((b) => b.addEventListener('click', () => {
    qs('#dias').value = b.dataset.dias;
    cargar();
  }));

  qs('#btn-json').addEventListener('click', () => {
    if (!estado.datos) return toast('Todavía no hay datos para descargar', 'error');
    descargar('base-lunar.json', estado.datos);
  });

  /* El mapa se crea al inicio para mostrar el mosaico aunque la API tarde. */
  initMapaLunar();
  cargar();
})();
