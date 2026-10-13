document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.querySelector('.invoice-sidebar, .ccc-sidebar');
  const trigger = document.getElementById('invoice-menu-trigger');
  const closeButton = document.getElementById('invoice-menu-close');
  const backdrop = document.getElementById('invoice-sidebar-backdrop');

  if (!sidebar || !trigger || !closeButton || !backdrop) return;

  const closeMenu = () => {
    sidebar.classList.remove('is-open');
    backdrop.classList.remove('is-visible');
    trigger.setAttribute('aria-expanded', 'false');
  };

  trigger.addEventListener('click', () => {
    const isOpen = sidebar.classList.toggle('is-open');
    backdrop.classList.toggle('is-visible', isOpen);
    trigger.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) closeButton.focus();
  });

  closeButton.addEventListener('click', () => {
    closeMenu();
    trigger.focus();
  });

  backdrop.addEventListener('click', closeMenu);
  sidebar.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && sidebar.classList.contains('is-open')) {
      closeMenu();
      trigger.focus();
    }
  });

  window.matchMedia('(min-width: 861px)').addEventListener('change', event => {
    if (event.matches) closeMenu();
  });
});
