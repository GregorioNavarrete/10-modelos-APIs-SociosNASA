/* Tema claro/oscuro compartido por el panel y las 10 apps. */
(function () {
  const CLAVE = 'spaceapps10-tema';

  function preferido() {
    try {
      const guardado = localStorage.getItem(CLAVE);
      if (guardado === 'claro' || guardado === 'oscuro') return guardado;
    } catch (_) {}
    return 'oscuro';
  }

  function aplicar(tema) {
    document.documentElement.dataset.theme = tema;
    document.querySelectorAll('[data-tema-boton]').forEach((b) => {
      b.setAttribute('aria-pressed', String(tema === 'claro'));
      b.title = tema === 'claro' ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro';
      const icono = b.querySelector('.tema-icono');
      if (icono) icono.textContent = tema === 'claro' ? '☾' : '☀';
    });
    try { localStorage.setItem(CLAVE, tema); } catch (_) {}
  }

  function alternar() {
    aplicar(document.documentElement.dataset.theme === 'claro' ? 'oscuro' : 'claro');
  }

  document.addEventListener('DOMContentLoaded', () => {
    aplicar(preferido());
    document.querySelectorAll('[data-tema-boton]').forEach((b) => {
      b.addEventListener('click', alternar);
    });
  });

  window.Tema = { aplicar, alternar };
})();
