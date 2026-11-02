/* App 08 · Jukebox de la Tierra
   Flujo: /api/jukebox devuelve las imágenes EPIC de un día (o del último día
   con datos si la fecha pedida está vacía), el resumen y el template WMTS de
   GIBS. Acá se pinta la galería con `imagenes[].local` (proxy sin CORS), el
   mapa Leaflet con la capa GIBS, una ficha de accesibilidad por imagen y una
   sonificación real con Web Audio API (brillo de píxeles → frecuencia).
   El alt de cada foto es el caption real de NASA, no una descripción inventada. */
(function () {
  const { qs, qsa, fmt, num, toast, fetchJSON, esc, descargar } = UI;
  const estado = {
    datos: null, mapa: null, capa: null, marcadores: null, seleccion: null,
    /* Estado de audio: contexto, master, osciladores programados, progreso. */
    audio: { ctx: null, master: null, nodos: [], activo: false, inicio: 0, duracion: 0, timer: null, anim: null },
  };

  UI.initTabs();

  /* Parámetros de sonificación: 72 pasos en 8 s ≈ 111 ms por nota. */
  const AUDIO_PASOS = 72;
  const AUDIO_DURACION = 8;
  const AUDIO_LADO = 64; // la imagen se reduce a 64×64 para muestrear

  /* Escala pentatónica menor de La (A3 = 220 Hz), intervalos en semitonos.
     Una escala sin semitonos hace que cualquier barrido suene consonante,
     incluso si la imagen tiene cambios bruscos de brillo. */
  const AUDIO_ESCALA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];

  /* Fecha de hoy en UTC: EPIC publica con fecha UTC, no local. */
  function hoyUTC() {
    return new Date().toISOString().slice(0, 10);
  }

  /* Formatea "YYYY-MM-DD" sin corrimiento de zona horaria
     (new Date('2025-10-28') se interpreta UTC y en Argentina mostraría el 27). */
  function fechaDia(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '—';
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /* EPIC entrega "2025-10-28 03:35:00" sin zona: se interpreta como UTC. */
  function horaUTC(s) {
    if (!s) return '—';
    const d = new Date(String(s).replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return String(s);
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
  }

  /* Carga la imagen en memoria. Se usa `img.local` (proxy del backend) para que
     el canvas sea same-origin y `getImageData` no lance SecurityError. */
  function cargarImagen(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('la imagen no cargó'));
      im.src = src;
    });
  }

  /* Reduce la imagen a 64×64 y devuelve AUDIO_PASOS brillos (uno por franja de
     columnas). Luminancia perceptual Rec. 709:
       0,2126·R + 0,7152·G + 0,0722·B
     Se ignoran los píxeles transparentes del borde del disco para que el
     fondo negro no aplaste el promedio. */
  function muestrearBrillos(im) {
    const lado = AUDIO_LADO;
    const c = document.createElement('canvas');
    c.width = lado;
    c.height = lado;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0, lado, lado);
    const px = g.getImageData(0, 0, lado, lado).data;

    const brillos = [];
    for (let paso = 0; paso < AUDIO_PASOS; paso++) {
      const x0 = Math.floor((paso / AUDIO_PASOS) * lado);
      const x1 = Math.max(x0 + 1, Math.floor(((paso + 1) / AUDIO_PASOS) * lado));
      let suma = 0;
      let n = 0;
      for (let x = x0; x < x1; x++) {
        for (let y = 0; y < lado; y++) {
          const k = (y * lado + x) * 4;
          if (px[k + 3] < 16) continue; // transparencia
          const lum = (0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2]) / 255;
          suma += lum;
          n++;
        }
      }
      brillos.push(n ? suma / n : 0);
    }
    return brillos;
  }

  /* Brillo 0..1 → nota de la escala. Se redondea al grado más cercano para que
     el resultado sea musical; A3 = 220 Hz es la fundamental. */
  function frecuenciaDeBrillo(brillo) {
    const idx = Math.round(Math.max(0, Math.min(1, brillo)) * (AUDIO_ESCALA.length - 1));
    return 220 * Math.pow(2, AUDIO_ESCALA[idx] / 12);
  }

  /* Programa toda la secuencia en el reloj de Web Audio. Cada nota dura
     AUDIO_DURACION / AUDIO_PASOS (~111 ms) y su envolvente se solapa con la
     siguiente: ataque de 10 ms y caída exponencial a 2,2× el paso. El volumen
     depende del brillo (0,05–0,16) y el master deja headroom para no saturar. */
  function programarAudio(brillos) {
    const a = estado.audio;
    const ctx = a.ctx;
    const ahora = ctx.currentTime + 0.08;
    const pasoDur = AUDIO_DURACION / AUDIO_PASOS;
    a.nodos = [];

    brillos.forEach((brillo, i) => {
      const t = ahora + i * pasoDur;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frecuenciaDeBrillo(brillo), t);

      const amp = 0.05 + 0.11 * Math.max(0, Math.min(1, brillo));
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(amp, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + pasoDur * 2.2);

      osc.connect(gain);
      gain.connect(a.master);
      osc.start(t);
      osc.stop(t + pasoDur * 2.4);
      a.nodos.push(osc);
    });
  }

  /* Barra de progreso ligada al reloj de audio, no a setTimeout: si el
     navegador suspende el contexto, el progreso se detiene con él. */
  function animarProgreso() {
    const a = estado.audio;
    if (!a.activo) return;
    const transcurrido = a.ctx.currentTime - a.inicio;
    const p = Math.max(0, Math.min(1, transcurrido / a.duracion));
    qs('#audio-progreso').style.width = (p * 100).toFixed(1) + '%';
    qs('#audio-barra').setAttribute('aria-valuenow', String(Math.round(p * 100)));
    qs('#audio-texto').textContent = p < 1
      ? `Sonificando… ${Math.round(p * 100)} %`
      : 'Fin de la sonificación.';
    if (p < 1) a.anim = requestAnimationFrame(animarProgreso);
  }

  /* Detiene la sonificación y limpia nodos/animación. `texto` distingue un
     stop manual de un final natural. */
  function detenerAudio(texto = 'Sonificación detenida.') {
    const a = estado.audio;
    if (!a.activo) return;
    a.activo = false;
    clearTimeout(a.timer);
    cancelAnimationFrame(a.anim);
    for (const osc of a.nodos) {
      try { osc.stop(); } catch (_) { /* ya estaba detenido */ }
    }
    a.nodos = [];
    qs('#audio-progreso').style.width = '0%';
    qs('#audio-barra').setAttribute('aria-valuenow', '0');
    qs('#btn-sonificar').disabled = false;
    qs('#btn-detener').disabled = true;
    qs('#audio-texto').textContent = texto;
  }

  /* Sonificación real con Web Audio. Requiere un click (política de autoplay):
     1. Toma la imagen activa y la carga desde el proxy local.
     2. Muestrea brillo por columna en un canvas 64×64.
     3. Mapea brillo → nota pentatónica y brillo → amplitud.
     4. Programa 72 osciladores con envolvente y muestra el progreso.
     No reproduce audio de la misión: es una traducción de píxeles a sonido. */
  async function sonificar() {
    const img = (estado.datos?.imagenes || []).find((x) => x.id === estado.seleccion);
    if (!img) return toast('Elegí una imagen de la galería primero', 'error');
    if (estado.audio.activo) detenerAudio();

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return toast('Este navegador no soporta Web Audio API', 'error');

    const a = estado.audio;
    if (!a.ctx) {
      a.ctx = new AC();
      a.master = a.ctx.createGain();
      a.master.gain.value = 0.55; // headroom para que no sature
      a.master.connect(a.ctx.destination);
    }
    // El contexto puede nacer "suspended" hasta un gesto del usuario.
    if (a.ctx.state === 'suspended') await a.ctx.resume();

    qs('#audio-texto').textContent = 'Leyendo píxeles de la imagen…';
    qs('#btn-sonificar').disabled = true;

    try {
      const imagen = await cargarImagen(img.local);
      const brillos = muestrearBrillos(imagen);
      a.activo = true;
      a.inicio = a.ctx.currentTime;
      a.duracion = AUDIO_DURACION;
      programarAudio(brillos);
      qs('#btn-detener').disabled = false;
      a.timer = setTimeout(() => {
        if (a.activo) detenerAudio('Fin de la sonificación.');
      }, AUDIO_DURACION * 1000 + 350);
      animarProgreso();
    } catch (e) {
      if (a.activo) detenerAudio('Sonificación no disponible para esta imagen.');
      qs('#btn-sonificar').disabled = false;
      qs('#audio-texto').textContent = 'Sonificación no disponible para esta imagen.';
      toast('No se pudo sonificar la imagen: ' + e.message, 'error');
    }
  }

  function renderGaleria(j) {
    const imgs = j.imagenes || [];
    if (!imgs.length) {
      qs('#galeria').innerHTML = '<p class="aviso">Sin imágenes para este día. Probá con otra fecha: EPIC no publica todos los días.</p>';
      qs('#badge-galeria').textContent = '0 imágenes';
      qs('#ficha-img').innerHTML = '<p class="aviso">No hay imagen seleccionada para este día.</p>';
      qs('#btn-sonificar').disabled = true;
      qs('#btn-detener').disabled = true;
      qs('#audio-texto').textContent = 'No hay imagen para sonificar en este día.';
      return;
    }
    qs('#badge-galeria').textContent = `${imgs.length} imágenes · ${imgs[0].version || 'natural'}`;
    qs('#galeria').innerHTML = imgs.map((img) => `<button class="epic" type="button" data-id="${esc(img.id)}" aria-label="Ver ficha de la imagen: ${esc(img.caption)}">
      <img src="${esc(img.local)}" alt="${esc(img.caption)}" loading="lazy">
      <span class="epic-hora">${esc(horaUTC(img.fecha))}</span>
      <span class="epic-caption">${esc(img.caption)}</span>
      <span class="epic-coords">${fmt(img.lat, 1)}°, ${fmt(img.lon, 1)}°</span>
    </button>`).join('');

    /* Delegación: un solo listener para toda la galería (las tarjetas se recrean). */
    qsa('.epic').forEach((b) => b.addEventListener('click', () => seleccionar(b.dataset.id)));
    qsa('.epic').forEach((b) => b.classList.toggle('activa', b.dataset.id === estado.seleccion));
  }

  /* Ficha accesible: mismo caption como alt, más los metadatos que la foto no dice. */
  function renderFicha(img) {
    if (!img) return;
    qs('#ficha-img').innerHTML = `<p class="ficha-caption">${esc(img.caption)}</p>
      <dl class="kv">
        <dt>ID EPIC</dt><dd>${esc(img.id)}</dd>
        <dt>Hora UTC</dt><dd>${esc(horaUTC(img.fecha))}</dd>
        <dt>Centroide</dt><dd>${fmt(img.lat, 2)}°, ${fmt(img.lon, 2)}°</dd>
        <dt>Texto alternativo</dt><dd>${esc(img.caption)}</dd>
      </dl>`;
  }

  function seleccionar(id) {
    const img = (estado.datos?.imagenes || []).find((x) => x.id === id);
    if (!img) return;
    if (estado.audio.activo) detenerAudio('Sonificación detenida al cambiar de imagen.');
    estado.seleccion = id;
    qsa('.epic').forEach((b) => b.classList.toggle('activa', b.dataset.id === id));
    renderFicha(img);
    if (estado.mapa && Number.isFinite(img.lat) && Number.isFinite(img.lon)) {
      estado.mapa.panTo([img.lat, img.lon]);
    }
  }

  /* Mapa: capa GIBS del día + centroides EPIC. Si Leaflet no cargó, avisa. */
  function renderMapa(j) {
    if (!window.L) {
      qs('#mapa').innerHTML = '<p class="aviso" style="padding:14px">No se pudo cargar Leaflet desde el CDN. La galería sigue disponible.</p>';
      return;
    }
    if (!estado.mapa) {
      estado.mapa = L.map('mapa', { scrollWheelZoom: false, worldCopyJump: true }).setView([0, -40], 2);
    }
    if (estado.capa) { estado.capa.remove(); estado.capa = null; }
    if (estado.marcadores) { estado.marcadores.remove(); estado.marcadores = null; }

    if (j.gibs) {
      /* El template ya trae {fecha} sustituida y los tokens {z}/{y}/{x} en el
         orden que Leaflet los reemplaza; no hay que reordenarlos. */
      estado.capa = L.tileLayer(j.gibs, {
        maxZoom: 9,
        attribution: 'NASA GIBS · MODIS Terra True Color',
      }).addTo(estado.mapa);
      qs('#badge-gibs').textContent = `MODIS Terra · ${j.fecha}`;
    } else {
      qs('#badge-gibs').textContent = 'sin capa GIBS';
    }

    const grupo = L.layerGroup();
    (j.imagenes || []).forEach((img) => {
      if (!Number.isFinite(img.lat) || !Number.isFinite(img.lon)) return;
      L.circleMarker([img.lat, img.lon], {
        radius: 5, color: '#d86bff', weight: 1.5, fillColor: '#d86bff', fillOpacity: 0.3,
      }).bindPopup(esc(img.caption)).addTo(grupo);
    });
    grupo.addTo(estado.mapa);
    estado.marcadores = grupo;
    /* El contenedor pudo cambiar de tamaño al cambiar de solapa. */
    setTimeout(() => estado.mapa && estado.mapa.invalidateSize(), 80);
  }

  function render(j) {
    estado.datos = j;
    if (estado.audio.activo) detenerAudio('Sonificación detenida al cambiar de álbum.');
    if (j.error) {
      toast('No se pudo cargar el álbum: ' + j.error, 'error');
      qs('#chip-fuente').textContent = 'sin conexión';
      qs('#chip-fuente').classList.remove('vivo');
      qs('#btn-sonificar').disabled = true;
      qs('#btn-detener').disabled = true;
      return;
    }
    const chip = qs('#chip-fuente');
    const vivo = j._meta?.fuente === 'vivo';
    chip.textContent = vivo ? 'EPIC + GIBS en vivo' : 'respaldo local declarado';
    chip.classList.toggle('vivo', vivo);
    chip.title = j._meta?.aviso || '';

    const r = j.resumen || {};
    qs('#m-cantidad').textContent = fmt(r.cantidad, 0);
    qs('#m-cantidad-sub').textContent = r.cantidad ? `primera ${horaUTC(r.primera)}` : 'sin imágenes';
    qs('#m-fecha').textContent = fechaDia(j.fecha);
    qs('#m-fecha-sub').textContent = 'día con datos disponibles';
    qs('#m-ventana').textContent = r.primera && r.ultima ? `${horaUTC(r.primera)} → ${horaUTC(r.ultima)}` : '—';
    qs('#m-distancia').textContent = r.distanciaTierraKm ? fmt(r.distanciaTierraKm, 0) + ' km' : '—';
    qs('#m-satelite').textContent = r.satelite || 'DSCOVR / EPIC';
    qs('#badge-fecha').textContent = `UTC · ${j.fecha}`;

    /* Si el servidor retrocedió a otra fecha, el input refleja la fecha real. */
    qs('#fecha').value = j.fecha;

    renderGaleria(j);
    renderMapa(j);
    /* Si la imagen seleccionada sigue existiendo en el nuevo día, se conserva;
       si no, se elige la primera. La ficha y el botón de audio usan la misma. */
    const elegida = (j.imagenes || []).find((x) => x.id === estado.seleccion) || j.imagenes?.[0];
    renderFicha(elegida);
    estado.seleccion = elegida?.id || null;
    qsa('.epic').forEach((b) => b.classList.toggle('activa', b.dataset.id === estado.seleccion));
    qs('#btn-sonificar').disabled = !estado.seleccion;
  }

  async function cargar(fecha) {
    const chip = qs('#chip-fuente');
    chip.textContent = 'consultando EPIC…';
    chip.classList.remove('vivo');
    UI.cargando(qs('#galeria'), 'Buscando imágenes de la Tierra…');
    try {
      const url = fecha ? `/api/jukebox?fecha=${encodeURIComponent(fecha)}` : '/api/jukebox';
      const j = await fetchJSON(url);
      render(j);
    } catch (e) {
      chip.textContent = 'sin conexión';
      chip.classList.remove('vivo');
      qs('#galeria').innerHTML = '<p class="aviso">No se pudieron cargar imágenes. Revisá la conexión e intentá de nuevo.</p>';
      toast('Error al consultar EPIC: ' + e.message, 'error');
    }
  }

  qs('#btn-buscar').addEventListener('click', () => {
    const fecha = qs('#fecha').value;
    cargar(fecha || null);
  });

  /* Atajos relativos: se calculan en UTC para no cruzar el día por zona horaria. */
  qsa('.preset').forEach((b) => b.addEventListener('click', () => {
    const dias = num(b.dataset.dias, 0);
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - dias);
    const fecha = d.toISOString().slice(0, 10);
    qs('#fecha').value = fecha;
    cargar(fecha);
  }));

  qs('#btn-json').addEventListener('click', () => {
    if (!estado.datos) return toast('Todavía no hay datos para descargar', 'error');
    descargar('jukebox-tierra.json', estado.datos);
  });

  /* Sonificación: ambos botones dependen de un gesto del usuario. */
  qs('#btn-sonificar').addEventListener('click', sonificar);
  qs('#btn-detener').addEventListener('click', () => detenerAudio());

  /* Arranque: hoy en UTC. Si EPIC no publicó, el servidor busca hacia atrás. */
  qs('#fecha').value = hoyUTC();
  cargar(hoyUTC());
})();
