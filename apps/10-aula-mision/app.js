/* App 10 · Aula de Misión
   Flujo: /api/misiones devuelve el conteo de objetos activos (CelesTrak) y un
   catálogo local de lanzadores con capacidad LEO/GTO, costo, confiabilidad y
   reutilización. El juego es 100 % cliente: la capacidad física filtra; el
   resto se puntúa con cinco pesos editables (incluido el remanente).

   Fórmulas (todas comentadas abajo en calcularRanking):
     costoPorKg      = (costoMUSD × 1e6) / masa útil              [USD/kg]
     margen          = capacidad de la órbita / masa útil          [×]
     scoreCosto      = 100 × (costoPorKg mínimo / costoPorKg)      [0–100]
     scoreConfiab.   = confiabilidad × 100                         [0–100]
     scoreMargen     = 100 × min(1, (margen − 1) / 4)              [0–100]
     scoreReutil.    = 100 si reutilizable, 0 si no                [0–100]
     scoreRemanente  = 100 × máx(0, (presupuesto − costo) / presupuesto) [0–100]
     peso_i          = crudo_i / Σ crudos (5 sliders; Σ = 0 → 0,20 c/u)
     total           = Σ peso_i · score_i                          [0–100] */
(function () {
  const { qs, qsa, fmt, num, toast, fetchJSON, barras, esc, descargar } = UI;
  const estado = { datos: null, vehiculos: [] };

  UI.initTabs();

  /* Presets de ejemplo: cargan los cinco sliders (los cuatro criterios más el
     remanente de presupuesto). No son perfiles cerrados; después de aplicarlos,
     cualquier peso se puede mover a mano. Cada preset suma 100 para que se lea
     como porcentaje antes de normalizar. */
  const PESOS_PRESET = {
    equilibrado: { costo: 30, margen: 20, confiabilidad: 25, reutilizable: 10, remanente: 15 },
    costo: { costo: 60, margen: 10, confiabilidad: 15, reutilizable: 5, remanente: 10 },
  };

  function clamp100(v) { return Math.max(0, Math.min(100, v)); }

  /* Lee los parámetros de la misión y los pesos crudos de la interfaz.
     Son cinco criterios (costo, margen, confiabilidad, reutilización y
     remanente de presupuesto) y se normalizan dividiendo cada uno por la suma
     total. Si Σ = 0, se reparten en partes iguales: 1/5 = 0,20 cada uno. */
  function supuestos() {
    const crudos = {
      costo: num(qs('#peso-costo').value, 30),
      margen: num(qs('#peso-margen').value, 20),
      confiabilidad: num(qs('#peso-confiabilidad').value, 25),
      reutilizable: num(qs('#peso-reutilizable').value, 10),
      remanente: num(qs('#peso-remanente').value, 15),
    };
    const suma = crudos.costo + crudos.margen + crudos.confiabilidad + crudos.reutilizable + crudos.remanente;
    // Con Σ > 0 cada peso se divide por la suma; con Σ = 0 se reparte 1/5 (20 %) por criterio.
    const pesos = suma > 0
      ? {
          costo: crudos.costo / suma,
          margen: crudos.margen / suma,
          confiabilidad: crudos.confiabilidad / suma,
          reutilizable: crudos.reutilizable / suma,
          remanente: crudos.remanente / suma,
        }
      : { costo: 0.2, margen: 0.2, confiabilidad: 0.2, reutilizable: 0.2, remanente: 0.2 };
    return {
      orbita: qs('#orbita').value === 'GTO' ? 'GTO' : 'LEO',
      masa: Math.max(1, num(qs('#masa').value, 5000)),
      presupuesto: Math.max(1, num(qs('#presupuesto').value, 120)),
      crudos,
      suma,
      pesos,
    };
  }

  /* Filtra por capacidad física y puntúa. El presupuesto NO descarta: se
     convierte en `scoreRemanente`. Devuelve ranking ordenado + descartados. */
  function calcularRanking(vehiculos, sup) {
    const elegibles = [];
    const fuera = [];

    for (const v of vehiculos) {
      // Capacidad según la órbita pedida: LEO o GTO (0 = no aplica).
      const capacidad = sup.orbita === 'GTO' ? num(v.gtoKg, 0) : num(v.leoKg, 0);
      const costo = num(v.costoMUSD, 0);
      // Único filtro duro: el cohete no puede levantar la carga.
      if (capacidad < sup.masa) {
        fuera.push({ v, motivo: `capacidad ${fmt(capacidad, 0)} kg en ${sup.orbita} < ${fmt(sup.masa, 0)} kg de carga` });
        continue;
      }
      elegibles.push({ ...v, capacidad, costo });
    }

    if (!elegibles.length) return { ranking: [], fuera, minCosto: null };

    // Costo por kg de la carga realmente volada: se paga el cohete completo,
    // no solo la fracción de capacidad que se usa.
    elegibles.forEach((v) => { v.costoPorKg = (v.costo * 1e6) / sup.masa; });
    const minCosto = Math.min(...elegibles.map((v) => v.costoPorKg));

    const ranking = elegibles.map((v) => {
      const margen = v.capacidad / sup.masa;                 // ≥ 1 por el filtro
      const scoreCosto = v.costoPorKg > 0 ? 100 * (minCosto / v.costoPorKg) : 0; // el más barato = 100
      const scoreConfiabilidad = num(v.confiabilidad, 0) * 100;
      // Margen 1× = 0 puntos; 5× o más = 100. Premia reserva de capacidad.
      const scoreMargen = clamp100(((margen - 1) / 4) * 100);
      const scoreReutilizable = v.reutilizable ? 100 : 0;

      // Remanente: cuánto del presupuesto sobra después de pagar el cohete.
      // 100 = sobra todo; 0 = costó todo o más que el presupuesto.
      // No se descarta: un vehículo caro puede seguir en el ranking con 0 acá.
      const remanenteMUSD = sup.presupuesto - v.costo;
      const scoreRemanente = clamp100((remanenteMUSD / sup.presupuesto) * 100);

      // Score total: suma ponderada de los CINCO criterios. Cada peso ya está
      // normalizado por Σ, así que un crudo de 15 aporta 15 % al total.
      // El remanente dejó de ser un caso aparte: es un criterio más del score.
      const total = clamp100(
        sup.pesos.costo * scoreCosto +
        sup.pesos.confiabilidad * scoreConfiabilidad +
        sup.pesos.margen * scoreMargen +
        sup.pesos.reutilizable * scoreReutilizable +
        sup.pesos.remanente * scoreRemanente
      );

      return {
        ...v, margen, remanenteMUSD, scoreCosto, scoreConfiabilidad,
        scoreMargen, scoreReutilizable, scoreRemanente, total,
      };
    }).sort((a, b) => b.total - a.total);

    return { ranking, fuera, minCosto };
  }

  function renderDescartados(fuera) {
    qs('#descartados').innerHTML = fuera.length
      ? `<ul class="lista-descartes">${fuera.map((f) => `<li><b>${esc(f.v.nombre)}</b> — ${esc(f.motivo)}</li>`).join('')}</ul>`
      : '<p class="nota">Todos los vehículos del catálogo pueden levantar la carga. El presupuesto solo afecta el score, no la elegibilidad.</p>';
  }

  function renderFormula(sup, minCosto) {
    const p = sup.pesos;
    const pctPeso = (x) => fmt(x * 100, 0) + '%';
    qs('#formula').innerHTML = `<b>Score = ${pctPeso(p.costo)}·costo + ${pctPeso(p.confiabilidad)}·confiabilidad + ${pctPeso(p.margen)}·margen + ${pctPeso(p.reutilizable)}·reutilización + ${pctPeso(p.remanente)}·remanente</b>
      <br>Pesos crudos: costo ${fmt(sup.crudos.costo, 0)} · margen ${fmt(sup.crudos.margen, 0)} · confiabilidad ${fmt(sup.crudos.confiabilidad, 0)} · reutilización ${fmt(sup.crudos.reutilizable, 0)} · remanente ${fmt(sup.crudos.remanente, 0)}; Σ = ${fmt(sup.suma, 0)}. ${sup.suma > 0 ? 'Cada uno se divide por Σ para normalizar.' : 'Σ = 0: se reparten 20 % cada uno (1/5).'}
      <br>costoPorKg = costoMUSD × 1e6 ÷ ${fmt(sup.masa, 0)} kg${minCosto ? ` (mejor del grupo: ${fmt(minCosto, 0)} USD/kg)` : ''}; scoreCosto = 100 × mín(costoPorKg) ÷ costoPorKg.
      <br>margen = capacidad ${sup.orbita} ÷ masa; scoreMargen = 100 × mín(1, (margen − 1) ÷ 4).
      <br>remanente = 100 × máx(0, (presupuesto − costo) ÷ presupuesto); scoreRemanente = 0 si el cohete cuesta más que el presupuesto.
      <br>Supuestos: capacidades nominales, sin Δv ni integración; los cinco pesos son sliders editables (el remanente ya no es fijo).`;
  }

  function renderRanking() {
    if (!estado.vehiculos.length) {
      qs('#ranking').innerHTML = '<p class="aviso">Sin catálogo de vehículos: el endpoint no devolvió datos.</p>';
      qs('#descartados').innerHTML = '<p class="nota">—</p>';
      return;
    }
    const sup = supuestos();
    qs('#v-masa').textContent = fmt(sup.masa, 0);
    qs('#v-presupuesto').textContent = fmt(sup.presupuesto, 0);
    ['costo', 'margen', 'confiabilidad', 'reutilizable', 'remanente'].forEach((k) => {
      qs(`#v-peso-${k}`).textContent = fmt(sup.crudos[k], 0);
    });
    qs('#v-suma').textContent = fmt(sup.suma, 0);
    qs('#v-suma-nota').textContent = sup.suma > 0 ? 'normalizado' : 'Σ=0: partes iguales';
    qs('#params').textContent = `${sup.orbita} · ${fmt(sup.masa, 0)} kg · ${fmt(sup.presupuesto, 0)} MUSD · Σ pesos ${fmt(sup.suma, 0)}`;

    const { ranking, fuera, minCosto } = calcularRanking(estado.vehiculos, sup);
    renderFormula(sup, minCosto);
    renderDescartados(fuera);

    if (!ranking.length) {
      qs('#ranking').innerHTML = '<p class="aviso">Ningún lanzador puede levantar esta carga en la órbita elegida. Probá bajar la masa o cambiar de órbita: el presupuesto ya no descarta.</p>';
      return;
    }

    qs('#ranking').innerHTML = ranking.map((r, i) => `<div class="lanzador ${i === 0 ? 'ganador' : ''}">
      <div class="cab">
        <div>
          <span class="kicker">${i === 0 ? 'Recomendado' : 'Alternativa ' + (i + 1)}</span>
          <h3>${esc(r.nombre)}</h3>
          <span class="agencia">${esc(r.agencia)} · ${esc(r.pais)}</span>
        </div>
        <div class="score">${fmt(r.total, 0)}</div>
      </div>
      <div class="barra"><i style="width:${r.total}%"></i></div>
      <div class="datos">
        <div><span>Costo por kg</span><b>${fmt(r.costoPorKg, 0)} USD/kg</b></div>
        <div><span>Costo total</span><b>${fmt(r.costo, 0)} MUSD</b></div>
        <div><span>Capacidad ${sup.orbita}</span><b>${fmt(r.capacidad, 0)} kg</b></div>
        <div><span>Margen</span><b>${fmt(r.margen, 2)}×</b></div>
        <div><span>Remanente</span><b>${fmt(r.remanenteMUSD, 0)} MUSD</b></div>
        <div><span>Peso remanente</span><b>${fmt(sup.pesos.remanente * 100, 0)} %</b></div>
      </div>
      <div class="desglose">costo ${fmt(r.scoreCosto, 0)} · confiabilidad ${fmt(r.scoreConfiabilidad, 0)} · margen ${fmt(r.scoreMargen, 0)} · reutilización ${fmt(r.scoreReutilizable, 0)} · remanente ${fmt(r.scoreRemanente, 0)}</div>
      <p class="nota-lanzador">${esc(r.notas || '')}</p>
      <div class="tags">
        <span>${r.reutilizable ? 'reutilizable' : 'expendable'}</span>
        <span>1.er vuelo ${r.primerVuelo || '—'}</span>
        <span>${fmt(r.etapas, 0)} etapas</span>
        <span>${fmt(r.alturaM, 0)} m</span>
        ${r.costo > sup.presupuesto ? '<span class="tag-alerta">excede presupuesto</span>' : ''}
      </div>
    </div>`).join('');
  }

  /* Catálogo completo: sirve para auditar los supuestos del juego. */
  function renderCatalogo(vehiculos) {
    qs('#tabla-vehiculos').innerHTML = vehiculos.length ? vehiculos.map((v) => `<tr>
      <td>${esc(v.nombre)}</td>
      <td>${esc(v.agencia)}</td>
      <td class="num">${fmt(v.leoKg, 0)} kg</td>
      <td class="num">${v.gtoKg ? fmt(v.gtoKg, 0) + ' kg' : '—'}</td>
      <td class="num">${fmt(v.costoMUSD, 0)} M</td>
      <td class="num">${fmt(num(v.confiabilidad, 0) * 100, 0)}%</td>
      <td>${v.reutilizable ? '<span class="badge ok">sí</span>' : '<span class="badge">no</span>'}</td>
      <td class="num">${v.primerVuelo || '—'}</td>
    </tr>`).join('') : '<tr><td colspan="8">Sin vehículos en el catálogo.</td></tr>';
  }

  function render(j) {
    estado.datos = j;
    if (j.error) {
      toast('No se pudo cargar el catálogo de misión: ' + j.error, 'error');
      qs('#chip-fuente').textContent = 'sin conexión';
      qs('#chip-fuente').classList.remove('vivo');
      qs('#ranking').innerHTML = '<p class="aviso">El servidor no pudo leer CelesTrak. Reintentá en unos segundos.</p>';
      return;
    }
    const chip = qs('#chip-fuente');
    const vivo = j._meta?.fuente === 'vivo';
    chip.textContent = vivo ? 'SATCAT en vivo + catálogo local' : 'respaldo local declarado';
    chip.classList.toggle('vivo', vivo);
    chip.title = j._meta?.aviso || '';

    const s = j.satcat || {};
    qs('#m-total').textContent = s.total == null ? '—' : fmt(s.total, 0);
    qs('#m-paises').textContent = s.porPais?.length ? fmt(s.porPais.length, 0) : '—';
    qs('#m-paises-sub').textContent = s.porPais?.[0] ? `líder: ${s.porPais[0].nombre}` : 'por cantidad de objetos';
    qs('#m-tipos').textContent = s.porTipo?.length ? fmt(s.porTipo.length, 0) : '—';
    const dec = (s.porDecada || []).reduce((a, b) => (b.valor > a.valor ? b : a), { decada: '—', valor: 0 });
    qs('#m-decada').textContent = dec.decada;
    qs('#m-decada-sub').textContent = `${fmt(dec.valor, 0)} objetos activos`;

    qs('#chart-pais').innerHTML = s.porPais?.length
      ? barras({ valores: s.porPais.map((x) => x.valor), etiquetas: s.porPais.map((x) => x.nombre), color: '#ffd166', alto: 230, formato: (v) => fmt(v, 0) })
      : '<p class="aviso">Sin datos por país.</p>';
    qs('#chart-tipo').innerHTML = s.porTipo?.length
      ? barras({ valores: s.porTipo.map((x) => x.valor), etiquetas: s.porTipo.map((x) => x.nombre), color: '#ffb703', alto: 230, formato: (v) => fmt(v, 0) })
      : '<p class="aviso">Sin datos por tipo.</p>';
    qs('#chart-decada').innerHTML = s.porDecada?.length
      ? barras({ valores: s.porDecada.map((x) => x.valor), etiquetas: s.porDecada.map((x) => x.decada), color: '#ffd166', alto: 230, formato: (v) => fmt(v, 0) })
      : '<p class="aviso">Sin datos por década.</p>';

    estado.vehiculos = j.vehiculos || [];
    renderCatalogo(estado.vehiculos);
    qs('#nota-catalogo').textContent = j.catalogoNota || 'Especificaciones aproximadas de fuentes públicas; se usan como supuestos editables.';
    renderRanking();
  }

  async function cargar() {
    const chip = qs('#chip-fuente');
    chip.textContent = 'consultando SATCAT…';
    chip.classList.remove('vivo');
    try {
      const j = await fetchJSON('/api/misiones');
      render(j);
    } catch (e) {
      qs('#chip-fuente').textContent = 'sin conexión';
      qs('#chip-fuente').classList.remove('vivo');
      qs('#ranking').innerHTML = '<p class="aviso">No se pudo cargar el catálogo. Revisá la conexión e intentá de nuevo.</p>';
      toast('Error al consultar CelesTrak: ' + e.message, 'error');
    }
  }

  /* Sliders y órbita recalculan el ranking sin volver a consultar el endpoint. */
  ['#masa', '#presupuesto', '#peso-costo', '#peso-margen', '#peso-confiabilidad', '#peso-reutilizable', '#peso-remanente']
    .forEach((sel) => qs(sel).addEventListener('input', renderRanking));
  qs('#orbita').addEventListener('change', renderRanking);

  /* Presets de ejemplo: cargan los sliders y dejan el ranking listo para
     comparar. No bloquean: el usuario puede mover cualquier peso después. */
  qsa('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const p = PESOS_PRESET[b.dataset.preset];
    if (!p) return;
    qs('#peso-costo').value = p.costo;
    qs('#peso-margen').value = p.margen;
    qs('#peso-confiabilidad').value = p.confiabilidad;
    qs('#peso-reutilizable').value = p.reutilizable;
    qs('#peso-remanente').value = p.remanente;
    renderRanking();
    toast(`Pesos cargados: ${b.textContent.trim()}`);
  }));

  qs('#btn-formula').addEventListener('click', () => {
    const f = qs('#formula');
    f.hidden = !f.hidden;
  });

  qs('#btn-json').addEventListener('click', () => {
    if (!estado.datos) return toast('Todavía no hay datos para descargar', 'error');
    descargar('aula-de-mision.json', estado.datos);
  });

  cargar();
})();
