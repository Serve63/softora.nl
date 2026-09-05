((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraSettingsModuleRoutes = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const RETURN_HREF = '/premium-instellingen#extra';
  const EXTRA_MODULES = Object.freeze([
    Object.freeze({ label: 'Winnen', description: 'Live momentum voor dagelijkse doelen, discipline en voortgang.', href: '/winnen', paths: ['/winnen', '/live-momentum', '/live-momentum.html', '/live-momentum-access', '/live-momentum-access.html'], files: ['live-momentum.html', 'live-momentum-access.html'], unlocked: true }),
    Object.freeze({ label: 'Database', description: 'Lokale database voor het scrapen en behandelen van bedrijven.', href: '/kvk-database', paths: ['/kvk-database', '/premium-kvk-database'], files: ['premium-kvk-database.html'], unlocked: true }),
    Object.freeze({ label: "Servé's gezondheidsdossier", description: 'WHOOP-herstel, slaap en trainingen, dagelijks automatisch bijgewerkt.', href: '/premium-gezondheidsdossier', paths: ['/premium-gezondheidsdossier'], files: ['premium-gezondheidsdossier.html'], unlocked: true }),
    Object.freeze({ label: 'OMZETWERK', description: 'Codex’ eigen zaak binnen Softora: koers, voortgang en bewijs richting €1.000.000.', href: '/premium-omzetwerk', paths: ['/premium-omzetwerk'], files: ['premium-omzetwerk.html'], unlocked: true }),
    Object.freeze({ label: 'Ruben zet toto', description: 'Interne template-module die later verder ingevuld kan worden.', href: '', paths: [], files: [], unlocked: false }),
    Object.freeze({ label: 'world watcher', description: 'Interne template-module die later verder ingevuld kan worden.', href: '', paths: [], files: [], unlocked: false }),
    Object.freeze({ label: 'Flynow', description: 'Zon, zee of sneeuw. Ontdek je volgende bestemming.', href: '/premium-flynow', paths: ['/premium-flynow', '/premium-flynow.html'], files: ['premium-flynow.html'], unlocked: true }),
    Object.freeze({ label: 'Transfermarkt', description: 'Interne template-module die later verder ingevuld kan worden.', href: '', paths: [], files: [], unlocked: false }),
    Object.freeze({ label: 'Ruben’s Trading System', description: 'Interne template-module die later verder ingevuld kan worden.', href: '', paths: [], files: [], unlocked: false })
  ]);

  function normalizePath(value) {
    const path = String(value || '/').split(/[?#]/, 1)[0].replace(/\/+$/, '');
    return path || '/';
  }

  function getLinkedModules() {
    return EXTRA_MODULES.filter((module) => module.unlocked && module.href);
  }

  function findByPath(pathname) {
    const path = normalizePath(pathname);
    return getLinkedModules().find((module) => module.paths.includes(path)) || null;
  }

  return { EXTRA_MODULES, RETURN_HREF, findByPath, getLinkedModules, normalizePath };
});
