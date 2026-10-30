(function () {
  const { qs, qsa, fmt, num, toast, fetchJSON, barras, graficoLineas, descargar } = UI;
  const estado = { datos: null, matriz: null };

  UI.initTabs();

  function normCdf(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp((-z * z) / 2);
    const p = 1 - d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? p : 1 - p;
  }

  function mannKendall(x) {
    const v = x.filter((n) => n !== null && Number.isFinite(Number(n))).map(Number);
    const n = v.length;
    if (n < 4) return { n, S: 0, tau: 0, z: 0, p: 1 };
    let S = 0;
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) S += Math.sign(v[j] - v[i]);
    const varS = (n * (n - 1) * (2 * n + 5)) / 18;
    const z = S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0;
    return { n, S, tau: S / (n * (n - 1) / 2), z, p: 2 * (1 - normCdf(Math.abs(z))) };
  }

  function senSlope(x) {
    const v = x.filter((n) => n !== null && Number.isFinite(Number(n))).map(Number);
    const pendientes = [];
    for (let i = 0; i < v.length - 1; i++) for (let j = i + 1; j < v.length; j++) pendientes.push((v[j] - v[i]) / (j - i));
    if (!pendientes.length) return 0;
    pendientes.sort((a, b) => a - b);
    const m = Math.floor(pendientes.length / 2);
    return pendientes.length % 2 ? pendientes[m] : (pendientes[m - 1] + pendientes[m]) / 2;
  }

  function veredicto(pend, p, unidad) {
    if (p >= 0.05) return { texto: 'Sin tendencia significativa', clase: 'no' };
    return pend > 0
      ? { texto: `Tendencia ${unidad === 'mm' ? 'húmeda' : 'cálida'} significativa`, clase: 'si' }
      : { texto: `Tendencia ${unidad === 'mm' ? 'seca' : 'fría'} significativa`, clase: 'si' };
  }

  function render(j) {
    estado.datos = j;
    if (j.error) { toast('No se pudo cargar POWER: ' + j.error, 'error'); return; }
    const chip = qs('#chip-fuente');
    const vivo = j._meta?.fuente === 'vivo';
    chip.textContent = vivo ? `POWER en vivo · ${j.rango.desde}–${j.rango.hasta}` : 'respaldo local declarado';
    chip.classList.toggle('vivo', vivo);
    chip.title = j._meta?.aviso || '';

    const anios = j.anual || [];
    const precip = anios.map((a) => a.precip);
    const temp = anios.map((a) => a.temp);
    const mkP = mannKendall(precip);
    const mkT = mannKendall(temp);
    const pendP = senSlope(precip) * 10;
    const pendT = senSlope(temp) * 10;

    qs('#m-pend').textContent = (pendP >= 0 ? '+' : '') + fmt(pendP, 0);
    qs('#m-pend-sub').textContent = `${fmt(precip.reduce((a, b) => a + b, 0) / Math.max(1, precip.length), 0)} mm/año promedio`;
    qs('#m-tau').textContent = mkP.tau.toFixed(2);
    qs('#m-p').textContent = mkP.p < 0.001 ? '<0,001' : fmt(mkP.p, 3);
    qs('#m-p-sub').textContent = mkP.p < 0.05 ? 'significativo al 5%' : mkP.p < 0.1 ? 'marginal al 10%' : 'no significativo';
    qs('#m-temp').textContent = (pendT >= 0 ? '+' : '') + fmt(pendT, 2);

    const mediaP = precip.reduce((a, b) => a + b, 0) / Math.max(1, precip.length);
    qs('#chart-precip').innerHTML = barras({
      valores: precip, etiquetas: anios.map((a) => a.anio), color: '#35d39a', alto: 240, formato: (v) => fmt(v, 0),
    }) + `<p class="nota">Media del período: <b>${fmt(mediaP, 0)} mm/año</b> · pendiente de Sen: <b>${pendP >= 0 ? '+' : ''}${fmt(pendP, 0)} mm/década</b></p>`;

    qs('#chart-temp').innerHTML = graficoLineas({
      series: [{ nombre: 'Temperatura media anual', color: '#ffb03d', valores: temp }],
      etiquetas: anios.map((a) => a.anio), alto: 240, yLabel: 'Temperatura media anual',
      formatoY: (v) => fmt(v, 1) + '°', mostrarPuntos: true,
    });

    const v = veredicto(pendP, mkP.p, 'mm');
    const vt = veredicto(pendT, mkT.p, '°C');
    qs('#interpretacion').innerHTML = `
      <div class="veredicto"><b>${v.texto}</b><span class="pill ${v.clase}">p = ${mkP.p < 0.001 ? '<0,001' : fmt(mkP.p, 3)}</span><span class="pill ${mkP.tau > 0 ? 'calido' : 'frio'}">tau ${mkP.tau.toFixed(2)}</span></div>
      <p>Con ${mkP.n} años, la pendiente de Sen es <b>${pendP >= 0 ? '+' : ''}${fmt(pendP, 0)} mm/década</b>. ${mkP.p < 0.05 ? 'La evidencia estadística alcanza el umbral convencional del 5%.' : 'No hay evidencia suficiente para afirmar una tendencia monotónica; puede haber ciclos o ruido.'}</p>
      <div class="veredicto"><b>Temperatura: ${vt.texto.toLowerCase()}</b><span class="pill ${vt.clase}">p = ${mkT.p < 0.001 ? '<0,001' : fmt(mkT.p, 3)}</span></div>
      <p>Pendiente: <b>${pendT >= 0 ? '+' : ''}${fmt(pendT, 2)} °C/década</b>. Mann-Kendall detecta monotonía, no causalidad.</p>`;
  }

  async function cargar() {
    const lat = num(qs('#lat').value, -34.6);
    const lon = num(qs('#lon').value, -58.4);
    const desde = num(qs('#desde').value, 2015);
    const hasta = num(qs('#hasta').value, 2025);
    const chip = qs('#chip-fuente');
    chip.textContent = 'consultando POWER…';
    chip.classList.remove('vivo');
    try {
      const j = await fetchJSON(`/api/tendencias?lat=${lat}&lon=${lon}&desde=${desde}&hasta=${hasta}`);
      render(j);
    } catch (e) {
      chip.textContent = 'sin conexión';
      toast('Error al consultar POWER: ' + e.message, 'error');
    }
  }

  async function calcularMatriz() {
    const lat = num(qs('#lat').value, -34.6);
    const lon = num(qs('#lon').value, -58.4);
    const desde = num(qs('#desde').value, 2015);
    const hasta = num(qs('#hasta').value, 2025);
    const cont = qs('#matriz');
    cont.innerHTML = '<div class="aviso">Consultando 9 puntos…</div>';
    const offsets = [0.5, 0, -0.5];
    const tareas = [];
    for (const dy of offsets) for (const dx of [-0.5, 0, 0.5]) {
      tareas.push(fetchJSON(`/api/tendencias?lat=${lat + dy}&lon=${lon + dx}&desde=${desde}&hasta=${hasta}`)
        .then((j) => {
          const p = (j.anual || []).map((a) => a.precip);
          const mk = mannKendall(p);
          const pend = senSlope(p) * 10;
          return { dy, dx, pend, p: mk.p, sig: mk.p < 0.05 };
        }).catch(() => ({ dy, dx, pend: null, p: 1, sig: false })));
    }
    const celdas = await Promise.all(tareas);
    estado.matriz = celdas;
    cont.innerHTML = celdas.map((c) => {
      const clase = c.sig && c.pend > 0 ? 'sig-humedo' : c.sig && c.pend < 0 ? 'sig-seco' : 'no-sig';
      const etiqueta = c.pend == null ? 'sin dato' : `${c.pend >= 0 ? '+' : ''}${fmt(c.pend, 0)} mm/déc`;
      return `<div class="celda-matriz ${clase}" title="p=${fmt(c.p, 3)}">
        <b>${etiqueta}</b><small>p ${c.p < 0.001 ? '<0,001' : fmt(c.p, 2)}</small>
      </div>`;
    }).join('');
    toast('Mapa local calculado (9 puntos POWER)');
  }

  qs('#btn-consultar').addEventListener('click', cargar);
  qs('#btn-matriz').addEventListener('click', calcularMatriz);
  qsa('.preset').forEach((b) => b.addEventListener('click', () => {
    qs('#lat').value = b.dataset.lat;
    qs('#lon').value = b.dataset.lon;
    cargar();
  }));

  cargar();
})();
