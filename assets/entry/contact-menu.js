(() => {
  const menus = [...document.querySelectorAll('.contact-menu, .login-menu')];
  if (!menus.length) return;
  menus.forEach((menu) => {
    menu.addEventListener('toggle', () => {
      if (menu.open) menus.forEach((other) => { if (other !== menu) other.open = false; });
    });
  });
  document.addEventListener('click', (event) => {
    menus.forEach((menu) => {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    menus.forEach((menu) => {
      if (!menu.open) return;
      menu.open = false;
      menu.querySelector('summary').focus();
    });
  });
  document.querySelectorAll('[data-login-product]').forEach((button) => {
    button.addEventListener('click', () => {
      const status = document.querySelector('.login-status');
      status.textContent = `${button.dataset.loginProduct} inloggen is binnenkort beschikbaar.`;
      status.hidden = false;
    });
  });
})();
