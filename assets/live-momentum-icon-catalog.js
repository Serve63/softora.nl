(() => {
  const icons = [
    { key: 'dumbbell', label: 'Sport', keywords: 'gym workout fitness kracht trainen', markup: '<path d="M5 8v8M19 8v8M3 10v4M21 10v4M7 12h10" />' },
    { key: 'book', label: 'Boek', keywords: 'lezen studie focus deep work leren', markup: '<path d="M4 5.5c2.5-1 4.5-.7 7 1v12c-2.5-1.7-5-1.9-7-1V5.5Zm16 0c-2.5-1-4.5-.7-7 1v12c2.5-1.7 5-1.9 7-1V5.5Z" />' },
    { key: 'target', label: 'Doel', keywords: 'target doel focus resultaat', markup: '<circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="m15 9 4-4M19 5h-4v4" />' },
    { key: 'heart', label: 'Hart', keywords: 'gezondheid liefde voeding gezond', markup: '<path d="M20.4 5.9a5.1 5.1 0 0 0-7.2 0L12 7.1l-1.2-1.2a5.1 5.1 0 0 0-7.2 7.2L12 21l8.4-7.9a5.1 5.1 0 0 0 0-7.2Z" />' },
    { key: 'clock', label: 'Klok', keywords: 'tijd afspraak routine deadline', markup: '<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />' },
    { key: 'calendar', label: 'Agenda', keywords: 'kalender datum planning afspraak', markup: '<rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" />' },
    { key: 'briefcase', label: 'Werk', keywords: 'business kantoor werk bedrijf', markup: '<rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V4h8v3M3 12h18M10 12v2h4v-2" />' },
    { key: 'laptop', label: 'Laptop', keywords: 'computer werk digitaal code', markup: '<rect x="4" y="4" width="16" height="12" rx="2" /><path d="M2 20h20M8 20v-2h8v2" />' },
    { key: 'phone', label: 'Telefoon', keywords: 'bellen mobiel contact call', markup: '<rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" />' },
    { key: 'mail', label: 'Mail', keywords: 'email bericht inbox contact', markup: '<rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />' },
    { key: 'check', label: 'Check', keywords: 'klaar afgerond voltooid succes', markup: '<circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" />' },
    { key: 'star', label: 'Ster', keywords: 'favoriet belangrijk winnen', markup: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />' },
    { key: 'flame', label: 'Vuur', keywords: 'energie streak motivatie vuur', markup: '<path d="M12 22c4 0 7-2.8 7-7 0-3.2-1.8-6.1-5.3-9-.2 2-1 3.6-2.4 4.8.1-3.1-1.4-5.8-4-7.8.2 3.4-2.3 5.7-2.3 9.7C5 18.2 8 22 12 22Z" /><path d="M9 18c0-2 1.1-3.3 3-4.8.1 1.5.8 2.4 1.8 3.1.4.3.7.9.7 1.5 0 1.2-1 2.2-2.5 2.2S9 19.2 9 18Z" />' },
    { key: 'bolt', label: 'Bliksem', keywords: 'energie snel kracht actie', markup: '<path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" />' },
    { key: 'sun', label: 'Zon', keywords: 'ochtend dag buiten licht', markup: '<circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />' },
    { key: 'moon', label: 'Maan', keywords: 'avond nacht slaap rust', markup: '<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />' },
    { key: 'droplet', label: 'Water', keywords: 'drinken hydratatie water', markup: '<path d="M12 2.5S5.5 9.8 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 9.8 12 2.5 12 2.5Z" />' },
    { key: 'apple', label: 'Voeding', keywords: 'eten appel gezond dieet', markup: '<path d="M12 7c-2.4-2.2-7-1.3-7 4.7C5 17 8.5 21 12 21s7-4 7-9.3c0-6-4.6-6.9-7-4.7Z" /><path d="M12 7c0-2.5 1.6-4 4-4M12 5c-1.5 0-2.7-.7-3.5-2" />' },
    { key: 'activity', label: 'Beweging', keywords: 'lopen rennen stappen cardio hartslag', markup: '<path d="M3 12h4l2-6 4 12 2-6h6" />' },
    { key: 'brain', label: 'Brein', keywords: 'mindset denken meditatie kennis', markup: '<path d="M9.5 4.5A3 3 0 0 0 5 7a3 3 0 0 0-1 5.8A3.5 3.5 0 0 0 7.5 18H10V5.5a2 2 0 0 0-.5-1ZM14.5 4.5A3 3 0 0 1 19 7a3 3 0 0 1 1 5.8 3.5 3.5 0 0 1-3.5 5.2H14V5.5a2 2 0 0 1 .5-1Z" /><path d="M7 10h3M14 14h3" />' },
    { key: 'euro', label: 'Geld', keywords: 'euro omzet sparen finance financiën', markup: '<circle cx="12" cy="12" r="9" /><path d="M16 8.5a5 5 0 1 0 0 7M7 11h7M7 14h6" />' },
    { key: 'home', label: 'Huis', keywords: 'thuis woning huishouden', markup: '<path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7" />' },
    { key: 'car', label: 'Auto', keywords: 'rijden vervoer reizen auto', markup: '<path d="m5 11 2-5h10l2 5M3 11h18v7H3v-7Z" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" />' },
    { key: 'users', label: 'Mensen', keywords: 'team familie vrienden sociaal', markup: '<circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3 20c0-4 2.5-6 6-6s6 2 6 6M15 15c3.5 0 6 1.5 6 5" />' },
    { key: 'music', label: 'Muziek', keywords: 'luisteren audio lied piano', markup: '<path d="M9 18V5l10-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="16" cy="16" r="3" />' },
    { key: 'camera', label: 'Camera', keywords: 'foto video content creatie', markup: '<rect x="3" y="6" width="18" height="14" rx="2" /><path d="m8 6 1.5-3h5L16 6" /><circle cx="12" cy="13" r="4" />' },
    { key: 'trophy', label: 'Trofee', keywords: 'winnen prijs prestatie succes', markup: '<path d="M8 3h8v5c0 4-1.5 6-4 6s-4-2-4-6V3Z" /><path d="M8 5H4v2c0 3 2 4 5 4M16 5h4v2c0 3-2 4-5 4M12 14v4M8 21h8M9 18h6" />' },
    { key: 'shield', label: 'Schild', keywords: 'veilig bescherming discipline', markup: '<path d="M12 2 4 5v6c0 5 3.4 8.8 8 11 4.6-2.2 8-6 8-11V5l-8-3Z" /><path d="m9 12 2 2 4-4" />' },
    { key: 'coffee', label: 'Koffie', keywords: 'pauze drinken ochtend routine', markup: '<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z" /><path d="M17 10h2a2 2 0 0 1 0 4h-2M7 3v2M11 3v2M15 3v2" />' },
    { key: 'leaf', label: 'Natuur', keywords: 'plant groen buiten rust', markup: '<path d="M20 4C10 4 5 8 5 15c0 3 2 5 5 5 7 0 10-7 10-16Z" /><path d="M4 21c3-5 7-8 12-11" />' },
    { key: 'plus', label: 'Plus', keywords: 'nieuw toevoegen algemeen', markup: '<path d="M12 5v14M5 12h14" />' }
  ];

  window.SoftoraMomentumIconCatalog = Object.freeze(icons.map((icon) => Object.freeze(icon)));
})();
