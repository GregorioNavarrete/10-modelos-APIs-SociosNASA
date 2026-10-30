const APPS = [
  {
    n: '01', slug: '01-radar-cambios', nombre: 'Radar de Cambios', icono: '🛰️', cat: 'tierra', accent: '#38d0ff',
    desc: 'Serie temporal Sentinel-1 para detectar inundaciones y subsidencia; mide cadencia de pases y prepara pares interferométricos.',
    agencias: ['ESA', 'NASA/ASF', 'CONAE'], reto: 'Dancing with the SARs',
  },
  {
    n: '02', slug: '02-calendario-fuego', nombre: 'Calendario del Fuego', icono: '🔥', cat: 'clima', accent: '#ff7a3d',
    desc: 'Focos de calor de INPE armonizados por satélite y provincia, con calendario de semanas anómalas y priorización por FRP.',
    agencias: ['INPE', 'NASA', 'CONAE'], reto: 'Fire/Climate',
  },
  {
    n: '03', slug: '03-detective-tendencias', nombre: 'Detective de Tendencias', icono: '📈', cat: 'clima', accent: '#35d39a',
    desc: 'Test de Mann-Kendall y pendiente de Sen sobre 10 años de precipitación y temperatura; mapas de significancia.',
    agencias: ['NASA', 'ESA', 'JAXA'], reto: 'Climate trends',
  },
  {
    n: '04', slug: '04-rotacion-inteligente', nombre: 'Rotación Inteligente', icono: '🌱', cat: 'tierra', accent: '#a3e635',
    desc: 'Recomendador de rotaciones de cultivo con clima POWER y suelo SoilGrids; supuestos de agua, mercado y riesgo editables.',
    agencias: ['NASA', 'ISRIC', 'ESA'], reto: 'Agriculture',
  },
  {
    n: '05', slug: '05-centinela-sequia', nombre: 'Centinela de Sequía', icono: '🚨', cat: 'clima', accent: '#ffc247',
    desc: 'Semáforo de sequía por distrito con SPI-3, alertas por SMS simulado y voz en español, inglés y portugués.',
    agencias: ['JAXA', 'ESA', 'NASA'], reto: 'Drought early warning',
  },
  {
    n: '06', slug: '06-base-lunar', nombre: 'Base Lunar', icono: '🌕', cat: 'espacio', accent: '#b8b8ff',
    desc: 'Comparador de sitios polares por iluminación solar y ventanas de comunicación con la Tierra, con mapa LRO.',
    agencias: ['NASA', 'NAIF'], reto: 'Lunar surface',
  },
  {
    n: '07', slug: '07-mapa-marciano', nombre: 'Mapa Marciano', icono: '🔴', cat: 'espacio', accent: '#ff6b4a',
    desc: 'Planificador de un sol marciano: clima de Curiosity, Ls, elevación solar, polvo y ruta entre sitios con capas de riesgo.',
    agencias: ['NASA', 'EMM'], reto: 'Mars exploration',
  },
  {
    n: '08', slug: '08-jukebox-tierra', nombre: 'Jukebox de la Tierra', icono: '🎵', cat: 'tierra', accent: '#d86bff',
    desc: 'Sonificación en vivo de imágenes EPIC/DSCOVR con ficha de accesibilidad y mapa GIBS del mismo día.',
    agencias: ['NASA'], reto: 'Art & technology',
  },
  {
    n: '09', slug: '09-clima-espacial', nombre: 'Clima Espacial para Operadores', icono: '⚡', cat: 'espacio', accent: '#4f8cff',
    desc: 'Riesgo GNSS y de aviación por ruta a partir de Kp, alertas SWPC y escalas NOAA; umbrales editables.',
    agencias: ['NOAA', 'KASA', 'ESA'], reto: 'Space weather',
  },
  {
    n: '10', slug: '10-aula-mision', nombre: 'Aula de Misión', icono: '🎓', cat: 'espacio', accent: '#ffd166',
    desc: 'Juego serio de trade-offs de misión: masa, potencia, Δv y costo contra un catálogo real de lanzadores.',
    agencias: ['NASA', 'ESA', 'JAXA', 'ISRO'], reto: 'Mission design',
  },
];

const grid = document.getElementById('grid-apps');
const nota = document.getElementById('nota-filtro');

function tarjeta(app) {
  return `<a class="app-card" href="/apps/${app.slug}/" style="--a:${app.accent}" data-cat="${app.cat}">
    <div class="fila">
      <span class="icono" aria-hidden="true">${app.icono}</span>
      <span class="num">APP ${app.n}</span>
    </div>
    <h2>${app.nombre}</h2>
    <p>${app.desc}</p>
    <div class="chips">${app.agencias.map((a) => `<span class="chip">${a}</span>`).join('')}</div>
    <span class="abrir">Abrir app <span>→</span></span>
  </a>`;
}

function render(filtro = 'todas') {
  const lista = filtro === 'todas' ? APPS : APPS.filter((a) => a.cat === filtro);
  grid.innerHTML = lista.map(tarjeta).join('');
  nota.textContent = `${lista.length} aplicaci${lista.length === 1 ? 'ón' : 'ones'} · datos en vivo con respaldo automático`;
}

document.querySelectorAll('[data-filtro]').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-filtro]').forEach((x) => x.classList.toggle('activo', x === b));
    render(b.dataset.filtro);
  });
});

render();

fetch('/api/salud').then((r) => r.json()).then((s) => {
  const el = document.getElementById('estado-api');
  if (!el) return;
  el.textContent = s.ok ? `${s.respaldos.length} respaldos · ${s.fuentes.length} fuentes` : 'servidor sin datos';
  el.title = s.fuentes.join(' · ');
}).catch(() => {
  const el = document.getElementById('estado-api');
  if (el) { el.textContent = 'modo estático'; el.classList.remove('vivo'); }
});
