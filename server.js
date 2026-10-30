/**
 * Space Apps 10 — servidor único
 * ------------------------------
 * npm start  ->  http://localhost:3000
 *
 * Sirve el panel y las 10 apps, y expone un proxy /api/* para cada fuente.
 * Diseño:
 *   1. Evita CORS y esconde credenciales opcionales (.env).
 *   2. Cachea en memoria con TTL para no golpear las APIs.
 *   3. Normaliza cada respuesta a una estructura simple para el frontend.
 *   4. Si una API falla o pide registro, devuelve data/respaldo/*.json
 *      y lo declara en _meta.fuente = "respaldo".
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const RAIZ = __dirname;
const DIR_RESPALDO = path.join(RAIZ, 'data', 'respaldo');
const UA = 'SpaceApps10/1.0 (demo educativa; contacto: equipo local)';

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(RAIZ, 'public')));
app.use('/apps', express.static(path.join(RAIZ, 'apps')));

/* ------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* ------------------------------------------------------------------------- */

const cache = new Map();
const TTL = {
  corto: 10 * 60 * 1000,
  medio: 30 * 60 * 1000,
  largo: 6 * 60 * 60 * 1000,
  dia: 24 * 60 * 60 * 1000,
};

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function pad2(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`; }
function isoDia(d) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }

async function traer(url, { timeout = 30000, headers = {}, metodo = 'GET' } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      method: metodo,
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} · ${new URL(url).host}`);
    return r;
  } finally {
    clearTimeout(t);
  }
}
async function traerJSON(url, opt) { return (await traer(url, opt)).json(); }
async function traerTexto(url, opt) { return (await traer(url, opt)).text(); }

function deCache(clave, ttl, fn) {
  const c = cache.get(clave);
  if (c && c.exp > Date.now()) return Promise.resolve(c.dato);
  return fn().then((dato) => {
    cache.set(clave, { exp: Date.now() + ttl, dato });
    if (cache.size > 180) {
      const ahora = Date.now();
      for (const [k, v] of cache) if (v.exp <= ahora) cache.delete(k);
    }
    return dato;
  });
}

function leerRespaldo(nombre) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR_RESPALDO, `${nombre}.json`), 'utf8'));
  } catch (_) {
    return null;
  }
}

async function conRespaldo(nombre, fn) {
  try {
    const dato = await fn();
    return { ...dato, _meta: { fuente: 'vivo', generado: new Date().toISOString() } };
  } catch (err) {
    const r = leerRespaldo(nombre);
    if (r) {
      return { ...r, _meta: { fuente: 'respaldo', generado: new Date().toISOString(), aviso: err.message } };
    }
    return { error: err.message, _meta: { fuente: 'error', generado: new Date().toISOString() } };
  }
}

/* Parser CSV mínimo con soporte de comillas. */
function parseCSV(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
      } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

/* ------------------------------------------------------------------------- */
/* Astronomía de apoyo (modelos de baja precisión, declarados en la UI)       */
/* ------------------------------------------------------------------------- */

const OBLICUIDAD = 23.4392911 * D2R;

function julianDate(fecha) { return fecha.getTime() / 86400000 + 2440587.5; }

function vectorSolEc(jd) {
  const n = jd - 2451545.0;
  const L = (280.460 + 0.9856474 * n) * D2R;
  const g = (357.528 + 0.9856003 * n) * D2R;
  const lambda = L + 1.915 * D2R * Math.sin(g) + 0.020 * D2R * Math.sin(2 * g);
  const eps = (23.439 - 0.0000004 * n) * D2R;
  return [Math.cos(lambda), Math.sin(lambda) * Math.cos(eps), Math.sin(lambda) * Math.sin(eps)];
}

function vectorLunaEc(jd) {
  const n = jd - 2451545.0;
  const L = (218.316 + 13.176396 * n) * D2R;
  const M = (134.963 + 13.064993 * n) * D2R;
  const F = (93.272 + 13.229350 * n) * D2R;
  const lon = L + 6.289 * D2R * Math.sin(M);
  const lat = 5.128 * D2R * Math.sin(F);
  const x = Math.cos(lat) * Math.cos(lon);
  const y = Math.cos(lat) * Math.sin(lon);
  const z = Math.sin(lat);
  // pasar de eclíptica a ecuatorial (el Sol ya viene ecuatorial)
  return {
    dir: [x, y * Math.cos(OBLICUIDAD) - z * Math.sin(OBLICUIDAD), y * Math.sin(OBLICUIDAD) + z * Math.cos(OBLICUIDAD)],
    distKm: 385001 - 20905 * Math.cos(M),
  };
}

function rotacionLunar(jd) {
  const d = jd - 2451545.0;
  const T = d / 36525;
  const ra = (269.9949 + 0.0031 * T - 0.0019 * T * T) * D2R;
  const dec = (66.5392 + 0.0130 * T) * D2R;
  const W = (38.3213 + 13.17635815 * d - 1.4e-12 * d * d) * D2R;
  const b = Math.PI / 2 - dec;
  const a = Math.PI / 2 + ra;
  const cb = Math.cos(b), sb = Math.sin(b);
  const ca = Math.cos(a), sa = Math.sin(a);
  const cw = Math.cos(W), sw = Math.sin(W);
  return [
    [ca * cw - sa * cb * sw, -ca * sw - sa * cb * cw, sa * sb],
    [sa * cw + ca * cb * sw, -sa * sw + ca * cb * cw, -ca * sb],
    [sb * sw, sb * cw, cb],
  ];
}

function aCuerpo(matriz, v) {
  return [
    matriz[0][0] * v[0] + matriz[1][0] * v[1] + matriz[2][0] * v[2],
    matriz[0][1] * v[0] + matriz[1][1] * v[1] + matriz[2][1] * v[2],
    matriz[0][2] * v[0] + matriz[1][2] * v[1] + matriz[2][2] * v[2],
  ];
}

function latLonDeVector(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return {
    lat: Math.asin(v[2] / l) * R2D,
    lon: ((Math.atan2(v[1], v[0]) * R2D) + 540) % 360 - 180,
  };
}

function altAz(dir, latDeg, lonDeg) {
  const lat = latDeg * D2R, lon = lonDeg * D2R;
  const cenit = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const este = [-Math.sin(lon), Math.cos(lon), 0];
  const norte = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const punto = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return {
    elevacion: Math.asin(clamp(punto(dir, cenit), -1, 1)) * R2D,
    azimut: ((Math.atan2(punto(dir, este), punto(dir, norte)) * R2D) + 360) % 360,
  };
}

/* ------------------------------------------------------------------------- */
/* 1. Radar de Cambios — Sentinel-1 / NISAR (catálogo CDSE + ASF documentado) */
/* ------------------------------------------------------------------------- */

function tipoProducto(nombre) {
  if (/_GRD/i.test(nombre)) return 'GRD';
  if (/_OCN/i.test(nombre)) return 'OCN';
  if (/_SLC/i.test(nombre)) return 'SLC';
  if (/_RAW/i.test(nombre)) return 'RAW';
  return 'OTRO';
}
function modoProducto(nombre) {
  const m = nombre.match(/_(IW|EW|SM|WV|EN)_/);
  return m ? m[1] : '—';
}

app.get('/api/radar', async (req, res) => {
  const lat = clamp(num(req.query.lat, -34.6), -85, 85);
  const lon = clamp(num(req.query.lon, -58.4), -180, 180);
  const dias = clamp(num(req.query.dias, 120), 20, 365);
  const d = 0.28;
  const clave = `radar:${lat.toFixed(2)}:${lon.toFixed(2)}:${dias}`;

  res.json(await conRespaldo('radar', () => deCache(clave, TTL.corto, async () => {
    const fin = new Date();
    const ini = new Date(Date.now() - dias * 86400000);
    const poligono = `SRID=4326;POLYGON((${lon - d} ${lat - d},${lon + d} ${lat - d},${lon + d} ${lat + d},${lon - d} ${lat + d},${lon - d} ${lat - d}))`;
    const filtro = `Collection/Name eq 'SENTINEL-1' and OData.CSC.Intersects(area=geography'${poligono}') and ContentDate/Start gt ${ini.toISOString()}`;
    const url = 'https://catalogue.dataspace.copernicus.eu/odata/v1/Products?$filter=' +
      encodeURIComponent(filtro) + '&$top=120&$orderby=' + encodeURIComponent('ContentDate/Start desc');

    const j = await traerJSON(url, { timeout: 30000 });
    const escenas = (j.value || []).map((p) => ({
      id: p.Id,
      nombre: p.Name,
      fecha: p.ContentDate?.Start || p.OriginDate,
      online: Boolean(p.Online),
      mb: p.ContentLength ? Math.round(p.ContentLength / 1048576) : null,
      tipo: tipoProducto(p.Name),
      modo: modoProducto(p.Name),
      coleccion: p.Collection?.Name || 'SENTINEL-1',
    }));

    const porMes = {};
    const porTipo = {};
    const porModo = {};
    const diasSet = new Set();
    for (const e of escenas) {
      const mes = String(e.fecha).slice(0, 7);
      porMes[mes] = (porMes[mes] || 0) + 1;
      porTipo[e.tipo] = (porTipo[e.tipo] || 0) + 1;
      porModo[e.modo] = (porModo[e.modo] || 0) + 1;
      diasSet.add(String(e.fecha).slice(0, 10));
    }
    const meses = Object.keys(porMes).sort().map((m) => ({ mes: m, escenas: porMes[m] }));
    const fechas = escenas.map((e) => new Date(e.fecha).getTime()).filter((x) => Number.isFinite(x));
    const primera = fechas.length ? new Date(Math.min(...fechas)) : null;
    const ultima = fechas.length ? new Date(Math.max(...fechas)) : null;
    const diasUnicos = [...diasSet].sort();
    const cadencia = diasUnicos.length > 1
      ? (new Date(diasUnicos.at(-1)) - new Date(diasUnicos[0])) / 86400000 / (diasUnicos.length - 1)
      : null;
    const pares = Math.max(0, diasUnicos.length - 1);

    return {
      aoi: { lat, lon, radioKm: Math.round(d * 111), bbox: [lon - d, lat - d, lon + d, lat + d] },
      ventanaDias: dias,
      resumen: {
        total: escenas.length,
        primera: primera?.toISOString() || null,
        ultima: ultima?.toISOString() || null,
        diasConPase: diasSet.size,
        cadenciaDias: cadencia ? Number(cadencia.toFixed(1)) : null,
        paresPotenciales: pares,
        modoDominante: Object.entries(porModo).sort((a, b) => b[1] - a[1])[0]?.[0] || '—',
      },
      porMes: meses,
      porTipo: Object.entries(porTipo).map(([nombre, valor]) => ({ nombre, valor })),
      porModo: Object.entries(porModo).map(([nombre, valor]) => ({ nombre, valor })),
      escenas: escenas.slice(0, 40),
      fuentes: ['CDSE OData (Sentinel-1)', 'ASF Search (NISAR/Sentinel-1, documentado)', 'Copernicus DEM'],
    };
  })));
});

/* ------------------------------------------------------------------------- */
/* 2. Calendario del Fuego — INPE Queimadas (CSV abierto)                     */
/* ------------------------------------------------------------------------- */

let cacheQueimadas = { ts: 0, dias: 0, archivos: [] };

async function listarCSVsQueimadas(dias) {
  if (cacheQueimadas.ts && Date.now() - cacheQueimadas.ts < TTL.corto && cacheQueimadas.dias >= dias) {
    return cacheQueimadas.archivos.slice(0, dias);
  }
  const encontrados = [];
  for (let i = 0; i < dias + 4 && encontrados.length < dias; i++) {
    const f = ymd(new Date(Date.now() - i * 86400000));
    const url = `https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/America_Sul/focos_diario_${f}.csv`;
    try {
      const r = await traer(url, { metodo: 'HEAD', timeout: 12000 });
      if (r.ok) encontrados.push({ fecha: f, url });
    } catch (_) { /* probar el día anterior */ }
  }
  if (!encontrados.length) throw new Error('INPE sin CSV diario reciente');
  cacheQueimadas = { ts: Date.now(), dias, archivos: encontrados };
  return encontrados;
}

app.get('/api/fuego', async (req, res) => {
  const pais = String(req.query.pais || 'Argentina');
  const dias = clamp(num(req.query.dias, 1), 1, 7);
  const clave = `fuego:${norm(pais)}:${dias}`;

  res.json(await conRespaldo('fuego', () => deCache(clave, TTL.medio, async () => {
    const archivos = await listarCSVsQueimadas(dias);
    const textos = await Promise.allSettled(archivos.map((a) => traerTexto(a.url, { timeout: 60000 })));
    const focos = [];
    const paises = new Set();
    let cabecera = null;

    for (let k = 0; k < textos.length; k++) {
      if (textos[k].status !== 'fulfilled') continue;
      const filas = parseCSV(textos[k].value);
      if (filas.length < 2) continue;
      if (!cabecera) cabecera = filas[0].map((c) => c.trim());
      const idx = (n) => cabecera.indexOf(n);
      const iLat = idx('lat'), iLon = idx('lon'), iFecha = idx('data_hora_gmt'), iSat = idx('satelite'),
        iMun = idx('municipio'), iEst = idx('estado'), iPais = idx('pais'), iDias = idx('numero_dias_sem_chuva'),
        iPrec = idx('precipitacao'), iRiesgo = idx('riesgo_fogo'), iBioma = idx('bioma'), iFrp = idx('frp'),
        iId = idx('id');

      for (let i = 1; i < filas.length; i++) {
        const r = filas[i];
        if (!r || r.length < 10) continue;
        const p = (r[iPais] || '').trim();
        if (p) paises.add(p);
        if (norm(p) !== norm(pais)) continue;
        focos.push({
          id: r[iId] || `${archivos[k].fecha}-${i}`,
          lat: num(r[iLat]),
          lon: num(r[iLon]),
          fecha: (r[iFecha] || '').trim(),
          satelite: (r[iSat] || '').trim(),
          municipio: (r[iMun] || '').trim(),
          estado: (r[iEst] || '').trim(),
          pais: p,
          diasSinChuva: num(r[iDias]),
          precip: num(r[iPrec]),
          riesgo: num(r[iRiesgo]),
          bioma: (r[iBioma] || '').trim(),
          frp: num(r[iFrp]),
        });
      }
    }

    const porDia = {}, porSat = {}, porEstado = {};
    let frpSuma = 0, frpMax = 0, riesgoAlto = 0;
    for (const f of focos) {
      const dia = f.fecha.slice(0, 10);
      porDia[dia] = (porDia[dia] || 0) + 1;
      porSat[f.satelite] = (porSat[f.satelite] || 0) + 1;
      porEstado[f.estado] = (porEstado[f.estado] || 0) + 1;
      frpSuma += Number.isFinite(f.frp) ? f.frp : 0;
      frpMax = Math.max(frpMax, Number.isFinite(f.frp) ? f.frp : 0);
      if (f.riesgo >= 0.8) riesgoAlto++;
    }

    const top = [...focos].sort((a, b) => b.frp - a.frp).slice(0, 220);
    const diasArr = Object.entries(porDia).sort().map(([dia, valor]) => ({ dia, valor }));
    const pico = diasArr.reduce((a, b) => (b.valor > a.valor ? b : a), { dia: null, valor: 0 });

    return {
      fecha: archivos[0].fecha,
      fechas: archivos.map((a) => a.fecha),
      dias,
      pais,
      paisesDisponibles: [...paises].sort(),
      resumen: {
        total: focos.length,
        frpMedio: focos.length ? Number((frpSuma / focos.length).toFixed(1)) : 0,
        frpMax: Number(frpMax.toFixed(1)),
        riesgoAlto,
        satelites: Object.keys(porSat).length,
        provincias: Object.keys(porEstado).length,
        diasConDatos: diasArr.length,
        promedioDiario: diasArr.length ? Math.round(focos.length / diasArr.length) : 0,
        pico,
      },
      porDia: diasArr,
      porSatelite: Object.entries(porSat).sort((a, b) => b[1] - a[1]).map(([nombre, valor]) => ({ nombre, valor })),
      porProvincia: Object.entries(porEstado).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([nombre, valor]) => ({ nombre, valor })),
      focos: top,
      fuentes: ['INPE Queimadas (datos abiertos)', 'NASA FIRMS (documentado, requiere clave)', 'CONAE focos GOES (documentado)'],
    };
  })));
});

/* 3. Detective de Tendencias — POWER mensual (GES DISC/CCI/GSMaP en docs)    */
/* ------------------------------------------------------------------------- */

function diasDelMes(ym) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(4, 6));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

app.get('/api/tendencias', async (req, res) => {
  const lat = clamp(num(req.query.lat, -34.6), -85, 85);
  const lon = clamp(num(req.query.lon, -58.4), -180, 180);
  const hasta = clamp(num(req.query.hasta, new Date().getUTCFullYear() - 1), 1984, 2026);
  const desde = clamp(num(req.query.desde, hasta - 10), 1981, hasta);
  const clave = `tend:${lat.toFixed(2)}:${lon.toFixed(2)}:${desde}:${hasta}`;

  res.json(await conRespaldo('tendencias', () => deCache(clave, TTL.largo, async () => {
    const url = 'https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=PRECTOTCORR,T2M' +
      `&community=AG&latitude=${lat}&longitude=${lon}&start=${desde}&end=${hasta}&format=JSON`;
    const j = await traerJSON(url, { timeout: 45000 });
    const p = j.properties?.parameter || {};
    const llaves = Object.keys(p.PRECTOTCORR || {}).filter((k) => !k.endsWith('13')).sort();
    const mensual = llaves.map((ym) => ({
      ym,
      precip: p.PRECTOTCORR?.[ym] == null || p.PRECTOTCORR[ym] === -999 ? null : Number((p.PRECTOTCORR[ym] * diasDelMes(ym)).toFixed(1)),
      temp: p.T2M?.[ym] == null || p.T2M[ym] === -999 ? null : Number(p.T2M[ym].toFixed(2)),
    }));

    const anios = {};
    for (const m of mensual) {
      const y = m.ym.slice(0, 4);
      if (!anios[y]) anios[y] = { precip: 0, temp: [], meses: 0 };
      if (m.precip !== null) anios[y].precip += m.precip;
      if (m.temp !== null) anios[y].temp.push(m.temp);
      anios[y].meses++;
    }
    const anual = Object.entries(anios).sort().map(([anio, v]) => ({
      anio,
      precip: Number(v.precip.toFixed(0)),
      temp: v.temp.length ? Number((v.temp.reduce((a, b) => a + b, 0) / v.temp.length).toFixed(2)) : null,
    }));

    return {
      punto: { lat, lon },
      rango: { desde, hasta },
      mensual,
      anual,
      meta: {
        fuente: 'NASA POWER (temporal/monthly)',
        comunidad: 'AG',
        unidades: { precip: 'mm/mes', temp: '°C' },
        celda: '~0.5° × 0.625° (aprox. 50-60 km)',
      },
    };
  })));
});

/* ------------------------------------------------------------------------- */
/* 4. Rotación Inteligente — POWER climatology + SoilGrids                    */
/* ------------------------------------------------------------------------- */

function texturaUSDA(arena, arcilla) {
  const limo = Math.max(0, 100 - arena - arcilla);
  if (arcilla >= 40 && arena <= 45 && limo < 40) return 'Arcillosa';
  if (arcilla >= 35 && arena > 45) return 'Arcillo-arenosa';
  if (arcilla >= 27 && arena <= 45) return 'Arcillo-limosa';
  if (arcilla >= 20 && arena <= 45 && limo >= 28) return 'Franco-arcillo-limosa';
  if (arcilla >= 20 && arena <= 52) return 'Franco-arcillosa';
  if (limo >= 50 && arcilla < 27) return 'Limosa';
  if (arena >= 70) return 'Arenosa';
  if (arena >= 50) return 'Franco-arenosa';
  return 'Franca';
}

async function pedirSuelo(lat, lon) {
  const desplazamientos = [[0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25], [0.5, 0], [-0.5, 0]];
  for (const [dy, dx] of desplazamientos) {
    const la = clamp(lat + dy, -89, 89);
    const lo = clamp(lon + dx, -179, 179);
    const url = 'https://rest.isric.org/soilgrids/v2.0/properties/query?lon=' + lo + '&lat=' + la +
      '&property=clay&property=sand&property=phh2o&property=soc&property=nitrogen' +
      '&depth=0-5cm&depth=5-15cm&value=mean';
    const j = await traerJSON(url, { timeout: 45000 });
    const capas = j.properties?.layers || [];
    const tiene = capas.some((l) => l.depths?.some((d) => d.values?.mean != null));
    if (tiene) return { capas, punto: { lat: la, lon: lo }, desplazado: dy !== 0 || dx !== 0 };
  }
  return { capas: [], punto: { lat, lon }, desplazado: false };
}

app.get('/api/rotacion', async (req, res) => {
  const lat = clamp(num(req.query.lat, -27.8), -85, 85);
  const lon = clamp(num(req.query.lon, -64.2), -180, 180);
  const clave = `rot:${lat.toFixed(2)}:${lon.toFixed(2)}`;

  res.json(await conRespaldo('rotacion', () => deCache(clave, TTL.largo, async () => {
    const urlPower = 'https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=PRECTOTCORR,T2M,T2M_MAX,T2M_MIN' +
      `&community=AG&latitude=${lat}&longitude=${lon}&format=JSON`;

    const [power, suelo] = await Promise.all([
      traerJSON(urlPower, { timeout: 45000 }),
      pedirSuelo(lat, lon),
    ]);

    const p = power.properties?.parameter || {};
    const meses = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const clima = meses.map((m, i) => ({
      mes: m,
      indice: i + 1,
      precip: p.PRECTOTCORR?.[m] != null ? Number((p.PRECTOTCORR[m] * [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i]).toFixed(1)) : null,
      temp: p.T2M?.[m] != null ? Number(p.T2M[m].toFixed(1)) : null,
      tempMax: p.T2M_MAX?.[m] != null ? Number(p.T2M_MAX[m].toFixed(1)) : null,
      tempMin: p.T2M_MIN?.[m] != null ? Number(p.T2M_MIN[m].toFixed(1)) : null,
    }));

    const capas = suelo.capas;
    const valor = (nombre, prof) => {
      const capa = capas.find((l) => l.name === nombre);
      if (!capa) return null;
      const d = capa.depths?.find((x) => Number(x.range?.top_depth) === Number(prof)) || capa.depths?.[0];
      const v = d?.values?.mean;
      if (v == null) return null;
      const f = capa.unit_measure?.d_factor || 1;
      return Number((v / f).toFixed(1));
    };

    const arena = valor('sand', 0) ?? 40;
    const arcilla = valor('clay', 0) ?? 20;
    const limo = Math.max(0, 100 - arena - arcilla);
    const ph = valor('phh2o', 0);
    const soc = valor('soc', 0);
    const nitrogeno = valor('nitrogen', 0);

    return {
      punto: { lat, lon },
      puntoSuelo: suelo.punto,
      clima,
      suelo: {
        arena, arcilla, limo,
        ph, soc, nitrogeno,
        textura: texturaUSDA(arena, arcilla),
        retencionAgua: Number(clamp(8 + arcilla * 1.4 + limo * 0.35, 8, 45).toFixed(0)),
      },
      meta: {
        fuentes: ['NASA POWER climatology 2001-2020', 'ISRIC SoilGrids 2.0 (0-5 cm)'],
        resumenClima: {
          precipAnual: Number(clima.reduce((a, m) => a + (m.precip || 0), 0).toFixed(0)),
          tempMedia: Number((clima.filter((m) => m.temp != null).reduce((a, m) => a + m.temp, 0) / 12).toFixed(1)),
        },
        nota: suelo.desplazado ? 'SoilGrids devolvió una celda vecina sin dato; se usó el punto más cercano con cobertura.' : null,
      },
    };
  })));
});

/* ------------------------------------------------------------------------- */
/* 5. Centinela de Sequía — POWER diario + SPI empírico                       */
/* ------------------------------------------------------------------------- */

app.get('/api/sequia', async (req, res) => {
  const lat = clamp(num(req.query.lat, -31.4), -85, 85);
  const lon = clamp(num(req.query.lon, -64.2), -180, 180);
  const anios = clamp(num(req.query.anios, 5), 3, 15);
  const clave = `sequia:${lat.toFixed(2)}:${lon.toFixed(2)}:${anios}`;

  res.json(await conRespaldo('sequia', () => deCache(clave, TTL.largo, async () => {
    const fin = new Date();
    const ini = new Date(Date.UTC(fin.getUTCFullYear() - anios, fin.getUTCMonth(), 1));
    const url = 'https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR' +
      `&community=AG&latitude=${lat}&longitude=${lon}` +
      `&start=${ymd(ini)}&end=${ymd(fin)}&format=JSON`;
    const j = await traerJSON(url, { timeout: 60000 });
    const serie = j.properties?.parameter?.PRECTOTCORR || {};
    const dias = Object.keys(serie).sort();

    const meses = {};
    for (const d of dias) {
      const ym = d.slice(0, 6);
      if (!meses[ym]) meses[ym] = 0;
      const v = serie[d];
      if (v != null && v !== -999) meses[ym] += v;
    }
    const mensual = Object.entries(meses).sort().map(([ym, mm]) => ({ ym, mm: Number(mm.toFixed(1)) }));

    const porMesCal = {};
    for (const m of mensual) {
      const k = Number(m.ym.slice(4, 6));
      (porMesCal[k] ||= []).push(m.mm);
    }
    const normales = Object.entries(porMesCal).sort((a, b) => a[0] - b[0]).map(([k, vals]) => ({
      mes: Number(k),
      media: Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)),
    }));

    const spi3 = mensual.map((m, i) => {
      if (i < 2) return { ...m, acum3: null, spi: null };
      const acum3 = mensual[i - 2].mm + mensual[i - 1].mm + m.mm;
      const historicos = [];
      for (let k = 2; k <= i; k++) historicos.push(mensual[k - 2].mm + mensual[k - 1].mm + mensual[k].mm);
      const media = historicos.reduce((a, b) => a + b, 0) / historicos.length;
      const sd = Math.sqrt(historicos.reduce((a, b) => a + (b - media) ** 2, 0) / Math.max(1, historicos.length - 1)) || 1;
      return { ...m, acum3: Number(acum3.toFixed(1)), spi: Number(((acum3 - media) / sd).toFixed(2)) };
    });

    return {
      punto: { lat, lon },
      anios,
      mensual: spi3,
      normales,
      resumen: {
        spiActual: spi3.at(-1)?.spi ?? null,
        acum3: spi3.at(-1)?.acum3 ?? null,
        minSpi: Math.min(...spi3.filter((m) => m.spi != null).map((m) => m.spi)),
        meses: mensual.length,
      },
      meta: {
        fuente: 'NASA POWER daily PRECTOTCORR',
        metodo: 'SPI-3 empírico (z-score de acumulados móviles de 3 meses)',
        nota: 'Aproximación de demostración; no reemplaza el SPI oficial (gamma).',
      },
    };
  })));
});

/* ------------------------------------------------------------------------- */
/* 6. Base Lunar — iluminación y comunicación (LOLA + SPICE documentados)     */
/* ------------------------------------------------------------------------- */

const SITIOS_LUNARES = [
  { id: 'shackleton', nombre: 'Borde de Shackleton', lat: -89.9, lon: 0.0, elevM: 1000, pendiente: 8, hielo: 'Alto', horizonte: 1.4 },
  { id: 'malapert', nombre: 'Macizo Malapert', lat: -86.0, lon: 0.0, elevM: 4800, pendiente: 12, hielo: 'Medio', horizonte: 0.9 },
  { id: 'cabeus', nombre: 'Cráter Cabeus', lat: -85.3, lon: -42.0, elevM: -3900, pendiente: 4, hielo: 'Muy alto', horizonte: 0.4 },
  { id: 'mouton', nombre: 'Mons Mouton', lat: -84.0, lon: 31.0, elevM: 5900, pendiente: 6, hielo: 'Bajo', horizonte: 0.6 },
];

app.get('/api/lunar', async (req, res) => {
  const dias = clamp(num(req.query.dias, 14), 7, 30);
  const paso = 3; // horas
  const clave = `lunar:${dias}`;

  res.json(await conRespaldo('lunar', () => deCache(clave, TTL.corto, async () => {
    const inicio = new Date();
    inicio.setUTCHours(0, 0, 0, 0);
    const puntos = Math.floor((dias * 24) / paso);
    const sitios = SITIOS_LUNARES.map((s) => {
      const serie = [];
      let ilum = 0, com = 0, rachaOscura = 0, rachaMax = 0;
      for (let i = 0; i <= puntos; i++) {
        const f = new Date(inicio.getTime() + i * paso * 3600000);
        const jd = julianDate(f);
        const R = rotacionLunar(jd);
        const solEc = vectorSolEc(jd);
        const lunaEc = vectorLunaEc(jd);
        const solCuerpo = aCuerpo(R, solEc);
        const tierraCuerpo = aCuerpo(R, [-lunaEc.dir[0], -lunaEc.dir[1], -lunaEc.dir[2]]);
        const sol = altAz(solCuerpo, s.lat, s.lon);
        const tierra = altAz(tierraCuerpo, s.lat, s.lon);
        const iluminado = sol.elevacion > -s.horizonte;
        if (iluminado) ilum++;
        else { rachaOscura += paso; rachaMax = Math.max(rachaMax, rachaOscura); }
        if (tierra.elevacion > -0.5) com++;
        if (iluminado) rachaOscura = 0;
        serie.push({
          t: f.toISOString(),
          solEl: Number(sol.elevacion.toFixed(1)),
          solAz: Number(sol.azimut.toFixed(0)),
          tierraEl: Number(tierra.elevacion.toFixed(1)),
          iluminado,
        });
      }
      return {
        ...s,
        serie,
        resumen: {
          iluminacionPct: Number(((ilum / (puntos + 1)) * 100).toFixed(0)),
          comunicacionPct: Number(((com / (puntos + 1)) * 100).toFixed(0)),
          oscuridadMaxHoras: rachaMax,
        },
      };
    });

    const jdAhora = julianDate(new Date());
    const R = rotacionLunar(jdAhora);
    const subSolar = latLonDeVector(aCuerpo(R, vectorSolEc(jdAhora)));

    return {
      inicio: inicio.toISOString(),
      dias,
      pasoHoras: paso,
      subSolar: { lat: Number(subSolar.lat.toFixed(2)), lon: Number(subSolar.lon.toFixed(2)) },
      sitios,
      meta: {
        fuentes: ['NASA LRO LOLA (topografía de referencia)', 'NAIF SPICE (efemérides)', 'NASA Moon Trek'],
        modelo: 'Iluminación geométrica de baja precisión; no incluye horizonte topográfico local.',
        nota: 'Las elevaciones son referencias topográficas aproximadas para comparar sitios, no cotas de ingeniería.',
      },
    };
  })));
});

/* ------------------------------------------------------------------------- */
/* 7. Mapa Marciano — MSL weather + MOLA (USGS) + EMM SDC documentado         */
/* ------------------------------------------------------------------------- */

const SITIOS_MARTE = [
  { id: 'jezero', nombre: 'Jezero', lat: 18.38, lon: 77.58, elevM: -2600, pendiente: 2, polvo: 'Medio' },
  { id: 'gale', nombre: 'Gale', lat: -4.59, lon: 137.44, elevM: -4500, pendiente: 3, polvo: 'Medio' },
  { id: 'oxia', nombre: 'Oxia Planum', lat: 18.2, lon: 335.5, elevM: -3000, pendiente: 1, polvo: 'Bajo' },
  { id: 'utopia', nombre: 'Utopia', lat: 46.9, lon: 117.5, elevM: -5000, pendiente: 1, polvo: 'Alto' },
];

const OBLICUIDAD_MARTE = 25.19 * D2R;

app.get('/api/marte', async (req, res) => {
  const hora = clamp(num(req.query.hora, 12), 0, 24);
  const clave = 'marte:clima';

  const clima = await deCache(clave, TTL.medio, async () => {
    const j = await traerJSON('https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json', { timeout: 45000 });
    const soles = j.soles || [];
    const sol = soles.reduce((a, b) => (Number(b.sol) > Number(a.sol) ? b : a), soles[0] || {});
    if (!sol || sol.ls == null) throw new Error('MSL sin datos');
    return {
      sol: sol.sol,
      fechaTierra: sol.terrestrial_date,
      ls: Number(sol.ls),
      estacion: sol.season,
      tempMin: num(sol.min_temp),
      tempMax: num(sol.max_temp),
      presion: num(sol.pressure),
      opacidad: sol.atmo_opacity,
      uv: sol.local_uv_irradiance_index,
      amanecer: sol.sunrise,
      atardecer: sol.sunset,
    };
  });

  const dec = Math.asin(Math.sin(OBLICUIDAD_MARTE) * Math.sin(clima.ls * D2R)) * R2D;
  const sitios = SITIOS_MARTE.map((s) => {
    const H = (hora - 12) * 15 * D2R;
    const elev = Math.asin(clamp(
      Math.sin(s.lat * D2R) * Math.sin(dec * D2R) +
      Math.cos(s.lat * D2R) * Math.cos(dec * D2R) * Math.cos(H), -1, 1)) * R2D;
    const x = -Math.tan(s.lat * D2R) * Math.tan(dec * D2R);
    const horasLuz = x <= -1 ? 24.66 : x >= 1 ? 0 : (2 * Math.acos(x) * R2D) / 14.62;
    return {
      ...s,
      elevacionSol: Number(elev.toFixed(1)),
      horasLuz: Number(horasLuz.toFixed(1)),
      riesgoPolvo: clima.ls > 180 ? (s.polvo === 'Alto' ? 'Alto' : 'Medio') : s.polvo,
      indiceRiesgo: Number(clamp(
        (s.pendiente / 15) * 35 + ((5000 + s.elevM) / 10000) * 25 + (clima.ls > 180 ? 25 : 8) + (s.polvo === 'Alto' ? 15 : 5), 0, 100).toFixed(0)),
    };
  });

  const ruta = [];
  for (let i = 0; i < sitios.length - 1; i++) {
    const a = sitios[i], b = sitios[i + 1];
    const dLat = (b.lat - a.lat) * D2R;
    const dLon = (b.lon - a.lon) * D2R;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
    const km = 2 * 3389.5 * Math.asin(Math.min(1, Math.sqrt(h)));
    ruta.push({
      desde: a.nombre,
      hasta: b.nombre,
      km: Math.round(km),
      solsRover: Number((km / (0.09 * 24.66)).toFixed(0)),
      riesgo: Math.round((a.indiceRiesgo + b.indiceRiesgo) / 2),
    });
  }

  res.json({
    clima,
    horaLocal: hora,
    subsolarLat: Number(dec.toFixed(2)),
    sitios,
    ruta,
    meta: {
      fuentes: ['NASA MSL Weather API (Gale)', 'USGS Astrogeology MOLA WMS', 'NASA MRO CTX', 'EMM SDC (Hope, registro gratuito)'],
      modelo: 'Elevación solar a partir de Ls y hora local; día marciano = 24 h 39 min.',
      nota: 'La opacidad atmosférica es la reportada por Curiosity en Gale, no un pronóstico global.',
    },
    _meta: { fuente: 'vivo', generado: new Date().toISOString() },
  });
});

/* ------------------------------------------------------------------------- */
/* 8. Jukebox de la Tierra — NASA EPIC (DSCOVR) + GIBS                        */
/* ------------------------------------------------------------------------- */

function fechaEPIC(d) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }

app.get('/api/jukebox', async (req, res) => {
  const pedida = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fecha || '')) ? String(req.query.fecha) : null;
  const clave = `jukebox:${pedida || 'ultima'}`;

  res.json(await conRespaldo('jukebox', () => deCache(clave, TTL.medio, async () => {
    let fecha = pedida;
    let lista = null;
    if (fecha) {
      lista = await traerJSON(`https://epic.gsfc.nasa.gov/api/natural/date/${fecha}`, { timeout: 25000 });
      if (!Array.isArray(lista)) lista = [];
    }
    if (!fecha || !lista.length) {
      const base = new Date();
      for (let i = 0; i < 20 && (!lista || !lista.length); i++) {
        const d = new Date(base.getTime() - i * 86400000);
        fecha = fechaEPIC(d);
        lista = await traerJSON(`https://epic.gsfc.nasa.gov/api/natural/date/${fecha}`, { timeout: 25000 });
        if (!Array.isArray(lista)) lista = [];
      }
    }
    if (!lista?.length) throw new Error('EPIC sin imágenes recientes');

    const [y, m, d] = fecha.split('-');
    const imagenes = lista.map((img) => ({
      id: img.image,
      fecha: img.date,
      caption: img.caption,
      lat: img.centroid_coordinates?.lat,
      lon: img.centroid_coordinates?.lon,
      png: `https://epic.gsfc.nasa.gov/archive/natural/${y}/${m}/${d}/png/${img.image}.png`,
      local: `/api/jukebox/imagen?fecha=${fecha}&id=${encodeURIComponent(img.image)}`,
      version: img.version,
    }));

    return {
      fecha,
      imagenes,
      resumen: {
        cantidad: imagenes.length,
        primera: imagenes[0]?.fecha,
        ultima: imagenes.at(-1)?.fecha,
        satelite: 'DSCOVR / EPIC (L1)',
        distanciaTierraKm: 1480000,
      },
      gibs: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${fecha}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      meta: {
        fuentes: ['NASA EPIC (DSCOVR)', 'NASA GIBS / Worldview', 'NASA Earth Information Center'],
        licencia: 'Dominio público NASA',
      },
    };
  })));
});

app.get('/api/jukebox/imagen', async (req, res) => {
  const fecha = String(req.query.fecha || '');
  const id = String(req.query.id || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^epic_1b_\d{14}$/.test(id)) {
    return res.status(400).json({ error: 'parámetros inválidos' });
  }
  const [y, m, d] = fecha.split('-');
  const url = `https://epic.gsfc.nasa.gov/archive/natural/${y}/${m}/${d}/png/${id}.png`;
  try {
    const clave = 'img:' + url;
    const c = cache.get(clave);
    if (c && c.exp > Date.now()) {
      res.set('Content-Type', 'image/png').set('Cache-Control', 'public, max-age=21600');
      return res.send(c.dato);
    }
    const r = await traer(url, { timeout: 30000 });
    const buf = Buffer.from(await r.arrayBuffer());
    cache.set(clave, { exp: Date.now() + TTL.largo, dato: buf });
    res.set('Content-Type', 'image/png').set('Cache-Control', 'public, max-age=21600');
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------------- */
/* 9. Clima Espacial para Operadores — NOAA SWPC (+ KSWC/SWE documentados)    */
/* ------------------------------------------------------------------------- */

app.get('/api/clima-espacial', async (req, res) => {
  res.json(await conRespaldo('clima', () => deCache('swpc', TTL.corto, async () => {
    const [kpRaw, escalas, flujo, alertasRaw] = await Promise.all([
      traerJSON('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', { timeout: 25000 }),
      traerJSON('https://services.swpc.noaa.gov/products/noaa-scales.json', { timeout: 25000 }),
      traerJSON('https://services.swpc.noaa.gov/products/10cm-flux-30-day.json', { timeout: 25000 }).catch(() => []),
      traerJSON('https://services.swpc.noaa.gov/products/alerts.json', { timeout: 25000 }).catch(() => []),
    ]);

    const kp = (Array.isArray(kpRaw) ? kpRaw : []).map((x) => ({
      t: x.time_tag,
      kp: Number(x.Kp),
      a: Number(x.a_running),
    })).filter((x) => Number.isFinite(x.kp));

    const ult24 = kp.filter((x) => Date.now() - new Date(x.t + 'Z').getTime() < 86400000);
    const kpActual = kp.at(-1)?.kp ?? 0;
    const kpMax24 = ult24.length ? Math.max(...ult24.map((x) => x.kp)) : kpActual;
    const nivel = kpMax24 >= 7 ? 'severo' : kpMax24 >= 5.5 ? 'tormenta' : kpMax24 >= 4 ? 'alerta' : 'quieto';

    const alertas = (Array.isArray(alertasRaw) ? alertasRaw : [])
      .filter((a) => /WARNING|WATCH|ALERT/i.test(String(a.message || '')))
      .slice(0, 10)
      .map((a) => {
        const msg = String(a.message || '');
        const lineas = msg.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        return {
          producto: a.product_id,
          emitido: a.issue_datetime,
          titulo: lineas.find((l) => /^(WARNING|WATCH|ALERT|SUMMARY)/i.test(l)) || lineas[0] || 'Aviso SWPC',
          detalle: lineas.slice(0, 6).join(' · '),
        };
      });

    const flujoActual = Array.isArray(flujo) && flujo.length
      ? Number(flujo.at(-1)?.flux ?? flujo.at(-1)?.observed_flux ?? 0) || null
      : null;

    return {
      actual: {
        kp: kpActual,
        kpMax24: Number(kpMax24.toFixed(1)),
        nivel,
        flujo10cm: flujoActual,
        actualizado: new Date().toISOString(),
      },
      kp: kp.slice(-80),
      escalas: escalas?.['0'] || escalas || null,
      alertas,
      rutas: [
        { id: 'polar', nombre: 'EZE → MAD (ruta polar)', exposicion: 'Alta', gnss: 'HF y GNSS degradados con Kp≥5', umbral: 5 },
        { id: 'templada', nombre: 'EZE → GRU (vuelo regional)', exposicion: 'Media', gnss: 'Impacto moderado en posicionamiento', umbral: 6 },
        { id: 'agro', nombre: 'Riego de precisión (Pampa)', exposicion: 'Baja', gnss: 'Precisión submétrica puede degradarse', umbral: 7 },
      ],
      meta: {
        fuentes: ['NOAA SWPC (Kp, escalas, alertas, flujo 10.7 cm)', 'KASA/KSWC (clima espacial, documentado)', 'ESA Space Weather Service (documentado)'],
        nota: 'Índice operativo simplificado; no reemplaza boletines ICAO/NOAA.',
      },
    };
  })));
});

/* ------------------------------------------------------------------------- */
/* 10. Aula de Misión — catálogo de vehículos + CelesTrak                      */
/* ------------------------------------------------------------------------- */

function leerVehiculos() {
  try {
    return JSON.parse(fs.readFileSync(path.join(RAIZ, 'data', 'vehiculos.json'), 'utf8'));
  } catch (_) {
    return [];
  }
}

app.get('/api/misiones', async (req, res) => {
  res.json(await conRespaldo('misiones', () => deCache('misiones', TTL.largo, async () => {
    const satcat = await traerJSON('https://celestrak.org/satcat/records.php?GROUP=active&FORMAT=json', { timeout: 60000 });
    const objetos = Array.isArray(satcat) ? satcat : [];
    const porPais = {}, porTipo = {}, porDecada = {};
    for (const o of objetos) {
      const pais = o.OWNER || '—';
      porPais[pais] = (porPais[pais] || 0) + 1;
      porTipo[o.OBJECT_TYPE || '—'] = (porTipo[o.OBJECT_TYPE || '—'] || 0) + 1;
      const anio = Number(String(o.LAUNCH_DATE || '').slice(0, 4));
      if (anio) {
        const dec = Math.floor(anio / 10) * 10;
        porDecada[dec] = (porDecada[dec] || 0) + 1;
      }
    }
    return {
      satcat: {
        total: objetos.length,
        porPais: Object.entries(porPais).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([nombre, valor]) => ({ nombre, valor })),
        porTipo: Object.entries(porTipo).map(([nombre, valor]) => ({ nombre, valor })),
        porDecada: Object.entries(porDecada).sort((a, b) => a[0] - b[0]).map(([decada, valor]) => ({ decada: decada + 's', valor })),
      },
      vehiculos: leerVehiculos().vehiculos || [],
      catalogoNota: leerVehiculos().nota || '',
      meta: {
        fuentes: ['CelesTrak SATCAT (objetos activos)', 'NASA mission pages', 'ESA launcher pages', 'JAXA H3', 'ISRO PSLV'],
        nota: 'Especificaciones aproximadas de fuentes públicas; el juego usa supuestos editables.',
      },
    };
  })));
});

/* ------------------------------------------------------------------------- */
/* Salud y arranque                                                           */
/* ------------------------------------------------------------------------- */

app.get('/api/salud', (req, res) => {
  let respaldos = [];
  try { respaldos = fs.readdirSync(DIR_RESPALDO).filter((f) => f.endsWith('.json')); } catch (_) {}
  res.json({
    ok: true,
    puerto: PORT,
    uptimeSeg: Math.round(process.uptime()),
    cacheEntradas: cache.size,
    respaldos,
    fuentes: [
      'CDSE OData', 'INPE Queimadas', 'NASA POWER', 'ISRO SoilGrids',
      'NASA EPIC', 'NOAA SWPC', 'CelesTrak', 'NASA MSL Weather',
    ],
  });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'endpoint no encontrado' }));

app.listen(PORT, () => {
  console.log('\n  Space Apps 10');
  console.log(`  Panel:  http://localhost:${PORT}`);
  console.log('  Apps:   /apps/01-radar-cambios/ … /apps/10-aula-mision/');
  console.log('  Salud:  /api/salud\n');
});
