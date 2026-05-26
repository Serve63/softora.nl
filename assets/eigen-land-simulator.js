const START_STATE = {
  year: 1120,
  round: 1,
  treasury: 120,
  population: 95,
  food: 58,
  economy: 52,
  happiness: 60,
  defense: 40,
  ecology: 64,
  knowledge: 28,
  stability: 62,
};

const STAT_LIMITS = {
  treasury: { min: 0, max: 200 },
  population: { min: 20, max: 180 },
  food: { min: 0, max: 100 },
  economy: { min: 0, max: 100 },
  happiness: { min: 0, max: 100 },
  defense: { min: 0, max: 100 },
  ecology: { min: 0, max: 100 },
  knowledge: { min: 0, max: 100 },
  stability: { min: 0, max: 100 },
};

const TERRAIN_PROFILES = {
  kust: {
    label: "Kust",
    startDelta: { economy: 6, food: -4, defense: -1, ecology: -2 },
  },
  rivier: {
    label: "Rivierdelta",
    startDelta: { food: 10, population: 5, happiness: 2, economy: 4 },
  },
  berg: {
    label: "Bergland",
    startDelta: { defense: 10, ecology: 4, stability: 3, economy: -4 },
  },
  bos: {
    label: "Bosrand",
    startDelta: { ecology: 8, knowledge: 4, happiness: 4, economy: -2 },
  },
  woestijn: {
    label: "Droogte-regio",
    startDelta: { food: -8, treasury: -4, stability: -2, defense: 2 },
  },
};

const QUESTIONS = [
  {
    question: "Een jaar van droogte trekt in aantocht. Wat doe je?",
    choices: [
      {
        title: "Waterreserves vrijmaken",
        description: "Bouw dammen en kanalen, bescherm de oogst en werk naar voren.",
        effects: { treasury: -18, food: 12, stability: -2, happiness: 3, ecology: 4 },
      },
      {
        title: "Belastingen verlagen",
        description: "Mensen krijgen lucht, maar de schatkist raakt dunner.",
        effects: { treasury: 8, happiness: 7, economy: -4, stability: -4 },
      },
      {
        title: "Noodrantsoen verplichten",
        description: "Eerlijk systeem, minder onrust en minder verspilling.",
        effects: { food: 6, happiness: -8, stability: 2, treasury: -4 },
      },
    ],
  },
  {
    question: "Handelaars bieden een deal voor een nieuwe haven aan.",
    choices: [
      {
        title: "Haven uitbouwen",
        description: "Je kiest voor handel en exportgroei.",
        effects: { treasury: -14, economy: 12, happiness: 4, ecology: -5, population: 3 },
      },
      {
        title: "Eerst defensie versterken",
        description: "Bescherming eerst, handel wacht nog even.",
        effects: { treasury: -12, defense: 10, stability: 3, economy: -3 },
      },
      {
        title: "Geen investering",
        description: "Hou geld in reserve en voorkom risico.",
        effects: { treasury: 3, happiness: -4, economy: -2 },
      },
    ],
  },
  {
    question: "Een boze burgergroep eist meer inspraak in het beleid.",
    choices: [
      {
        title: "Raad van dorpshoofden instellen",
        description: "Meer betrokkenheid, lagere spanning.",
        effects: { happiness: 10, stability: 5, treasury: -6 },
      },
      {
        title: "Verdere straffen",
        description: "Snel orde houden, maar vertrouwen daalt.",
        effects: { defense: 4, stability: -6, happiness: -8 },
      },
      {
        title: "Geen actie nemen",
        description: "Krijg tijd, maar de onrust groeit langzaam.",
        effects: { happiness: -4, stability: -4 },
      },
    ],
  },
  {
    question: "Wetenschappers vragen om subsidie voor een onderzoekscentrum.",
    choices: [
      {
        title: "Financiering geven",
        description: "Innovatie wint, je bevolking is nieuwsgierig en ambitieus.",
        effects: { treasury: -16, knowledge: 14, economy: 5, happiness: 2, stability: 2 },
      },
      {
        title: "Project uitstellen",
        description: "Je spaart geld voor later.",
        effects: { treasury: 4, happiness: -2 },
      },
      {
        title: "Onderzoek aan banden leggen",
        description: "Goedkoper nu, maar talent trekt weg.",
        effects: { knowledge: -8, stability: -2, treasury: 3 },
      },
    ],
  },
  {
    question: "Een naburige koninkrijk kijkt naar jouw grondstoffen.",
    choices: [
      {
        title: "Diplomatieke missie sturen",
        description: "Maak duidelijk je grenzen en zoek vrede.",
        effects: { stability: 4, happiness: 1, treasury: -4 },
      },
      {
        title: "Grenzen verdubbeld beveiligen",
        description: "Sterke grens, hoge uitgaven.",
        effects: { defense: 12, treasury: -14, economy: -2, happiness: -2 },
      },
      {
        title: "Handel aanbieden",
        description: "Open ruil en verminder dreiging met voordeel voor de markt.",
        effects: { economy: 8, stability: 2, treasury: -6, happiness: 3 },
      },
    ],
  },
  {
    question: "De rivieren staan te laag; visvangst en landbouw lijden.",
    choices: [
      {
        title: "Waterwacht en kanalen",
        description: "Lange-termijn-oplossing met gematigde kosten.",
        effects: { treasury: -12, food: 11, ecology: 8, happiness: 3, stability: 2 },
      },
      {
        title: "Import van voedsel toestaan",
        description: "Snelle oplossing, maar schatkist loopt terug.",
        effects: { treasury: -10, food: 8, happiness: 1 },
      },
      {
        title: "Boeren belasten voor reddingsfonds",
        description: "Stevige inkomsten nu, maar boze dorpen groeien.",
        effects: { treasury: 14, happiness: -10, stability: -3 },
      },
    ],
  },
  {
    question: "Er is onrust onder mijnwerkers over veiligheid.",
    choices: [
      {
        title: "Veiligheidsnormen verhogen",
        description: "Minder ongelukken, duurder werken.",
        effects: { treasury: -10, happiness: 8, stability: 4, economy: -2 },
      },
      {
        title: "Alleen toezicht doen",
        description: "Milde stap met beperkte verbetering.",
        effects: { happiness: 2, economy: 2, stability: -1 },
      },
      {
        title: "Geen verandering",
        description: "Je hoopt dat het overwaait.",
        effects: { happiness: -10, stability: -6 },
      },
    ],
  },
  {
    question: "Een oude kapel en markt willen verbouwd worden.",
    choices: [
      {
        title: "Publiek project starten",
        description: "Investeer in cultuur en werkgelegenheid.",
        effects: { treasury: -12, happiness: 9, economy: 4, stability: 3 },
      },
      {
        title: "Alleen kernpad repareren",
        description: "Goedkoop, maar minder zichtbaar.",
        effects: { treasury: 2, ecology: 2, economy: 1 },
      },
      {
        title: "Project schrappen",
        description: "Sparen op budget, bevolking voelt zich genegeerd.",
        effects: { treasury: 8, happiness: -6 },
      },
    ],
  },
  {
    question: "Je krijgt de kans op een grote militaire parade.",
    choices: [
      {
        title: "Parade houden",
        description: "Verhoog de moraal met één grote gebeurtenis.",
        effects: { treasury: -9, defense: 8, happiness: 6, stability: 3 },
      },
      {
        title: "Rustig blijven",
        description: "Minder kosten, minder schijn.",
        effects: { treasury: 3, defense: -2, happiness: -2 },
      },
      {
        title: "Minder zichtbaar optreden",
        description: "Zet geld op rustiger beleid en sociale steun.",
        effects: { treasury: 2, happiness: 1, stability: 2 },
      },
    ],
  },
  {
    question: "Jonge mensen vertrekken door gebrek aan kansen.",
    choices: [
      {
        title: "Nieuwe ambachten opzetten",
        description: "Meer banen, meer talent, hogere economie.",
        effects: { treasury: -16, economy: 10, population: 4, happiness: 4 },
      },
      {
        title: "Hofsubsidies tijdelijk verhogen",
        description: "Koopt rust maar kost veel geld.",
        effects: { treasury: -12, happiness: 8, stability: 3 },
      },
      {
        title: "Niets veranderen",
        description: "Je hoopt dat de situatie vanzelf verbetert.",
        effects: { population: -3, happiness: -6 },
      },
    ],
  },
];

const ADVISOR_PARTIES = [
  {
    id: "groenlinks-pvda",
    name: "GroenLinks-PvdA",
    tone: "GroenLinks-PvdA denkt aan natuur, werkzekerheid en sociale rechtvaardigheid.",
    weights: { food: 1.2, economy: 0.8, happiness: 1.4, stability: 1, ecology: 1.8, knowledge: 1.1 },
    warning: "Deze combinatie let scherp op sociale samenhang en natuurkwaliteit.",
  },
  {
    id: "denk",
    name: "DENK",
    tone: "DENK focust op inclusie, vertrouwen en kansen voor alle bewoners.",
    weights: { food: 0.7, economy: 0.9, happiness: 1.5, stability: 1.1, defense: 0.5, ecology: 0.8, knowledge: 1 },
    warning: "DENK let vooral op rust in de samenleving en gelijke toegang tot kansen.",
  },
  {
    id: "fvd",
    name: "Forum voor Democratie",
    tone: "Forum voor Democratie benadrukt soevereiniteit, bescherming en harde budgetdiscipline.",
    weights: { food: 0.6, economy: 1.2, happiness: 0.6, stability: 1.4, defense: 1.6, ecology: 0.4, knowledge: 0.8 },
    warning: "Deze partij kijkt extra naar veiligheid en bestuurlijke bestendigheid.",
  },
  {
    id: "vvd",
    name: "VVD",
    tone: "VVD geeft prioriteit aan financiën, ondernemerskracht en snelheid.",
    weights: { food: 0.4, economy: 1.7, happiness: 1, stability: 0.9, defense: 1, ecology: 0.5, knowledge: 0.8 },
    warning: "VVD benadrukt dat een uitgeholde schatkist sneller dan je denkt pijn doet.",
  },
  {
    id: "d66",
    name: "D66",
    tone: "D66 kijkt naar kansen, innovatie en evenwichtige groei.",
    weights: { food: 0.45, economy: 1.6, happiness: 0.9, stability: 1.2, defense: 0.6, ecology: 0.9, knowledge: 1.4 },
    warning: "D66 signaleert dat een stabiele middenweg meestal het langst werkt.",
  },
  {
    id: "cda",
    name: "CDA",
    tone: "CDA zoekt rust, lokale samenhang en een veilige samenleving.",
    weights: { food: 0.8, economy: 1, happiness: 1.3, stability: 1.4, defense: 1.2, ecology: 1, knowledge: 0.7 },
    warning: "CDA waarschuwt dat stabiliteit de onderbouw is van elke groei.",
  },
  {
    id: "sp",
    name: "SP",
    tone: "SP legt nadruk op inkomenszekerheid en bescherming van werkers.",
    weights: { food: 1.1, economy: 0.9, happiness: 1.4, stability: 1, ecology: 0.7, knowledge: 1 },
    warning: "SP adviseert om de lasten eerlijk te verdelen en werkzekerheid te versterken.",
  },
  {
    id: "cu",
    name: "ChristenUnie",
    tone: "ChristenUnie zoekt samenhang tussen economie, zorg en sociale stabiliteit.",
    weights: { food: 0.8, economy: 0.9, happiness: 1.4, stability: 1.4, defense: 0.7, ecology: 0.9, knowledge: 0.7 },
    warning: "ChristenUnie benadrukt gemeenschapszin en draagvlak in moeilijke keuzes.",
  },
];

const CABINET_PARTIES_2026 = ["vvd", "d66", "cda"];

const ADVISOR_GUIDES = [
  "De beste weg is nu eerst overleven in basisvoorzieningen, daarna groei.",
  "Koop geen prestige met de kern van de economie.",
  "Bij onrust in het land helpt erkenning en zichtbare inzet het meest.",
  "Investeren in kennis geeft later vaak de grootste marge.",
  "Diplomatie kan de kosten op veiligheid drukken zonder je toekomst te verzwakken.",
  "Energiebehoud en landbouwzekerheid winnen vaak bij acute druk op voedsel.",
  "Veilige werkplekken zijn politieke stabiliteit op de werkvloer.",
  "Publieke projecten werken wanneer ze tastbaar nut geven.",
  "Moraal en verdediging moet in balans blijven met reservegeld.",
  "Kaders voor jongeren en werkgelegenheid blijven sleutel voor een sterk land.",
];

const STAT_DEFS = [
  { key: "treasury", label: "Schatkist", suffix: "k", max: 200 },
  { key: "population", label: "Bevolking", suffix: "k", max: 180 },
  { key: "food", label: "Voedsel", suffix: "%", max: 100 },
  { key: "economy", label: "Economie", suffix: "%", max: 100 },
  { key: "happiness", label: "Geluk", suffix: "%", max: 100 },
  { key: "defense", label: "Verdediging", suffix: "%", max: 100 },
  { key: "ecology", label: "Natuur", suffix: "%", max: 100 },
  { key: "knowledge", label: "Kennis", suffix: "%", max: 100 },
  { key: "stability", label: "Stabiliteit", suffix: "%", max: 100 },
];

const MAX_TURNS = QUESTIONS.length;

let state = null;
let gameActive = false;
let setupDone = false;
let currentQuestionIndex = 0;

const setupPanel = document.getElementById("setupPanel");
const setupForm = document.getElementById("setupForm");
const kingdomInput = document.getElementById("kingdomInput");
const locationInput = document.getElementById("locationInput");
const terrainSelect = document.getElementById("terrainSelect");

const kingdomValue = document.getElementById("kingdomValue");
const locationValue = document.getElementById("locationValue");
const terrainValue = document.getElementById("terrainValue");
const roundValue = document.getElementById("roundValue");
const yearValue = document.getElementById("yearValue");
const statusMessage = document.getElementById("statusMessage");
const statsGrid = document.getElementById("statsGrid");
const actionGrid = document.getElementById("actionGrid");
const currentQuestion = document.getElementById("currentQuestion");
const resultPanel = document.getElementById("resultPanel");
const resultTitle = document.getElementById("resultTitle");
const resultReason = document.getElementById("resultReason");
const resultScore = document.getElementById("resultScore");
const restartButton = document.getElementById("restartButton");
const advisorPartySelect = document.getElementById("advisorPartySelect");
const advisorButton = document.getElementById("advisorButton");
const advisorMessage = document.getElementById("advisorMessage");

function updateAdvisorButtonLabel() {
  const selectedParty = ADVISOR_PARTIES.find((advisor) => advisor.id === advisorPartySelect?.value);
  advisorButton.textContent = selectedParty
    ? `Vraag ${selectedParty.name}-adviseur om hulp`
    : "Vraag partijadviseur om hulp";
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function applyChanges(target, changes) {
  Object.entries(changes).forEach(([key, delta]) => {
    const limits = STAT_LIMITS[key] || { min: 0, max: 200 };
    target[key] = clamp(target[key] + delta, limits.min, limits.max);
  });
}

function labelForStat(stat) {
  const map = {
    treasury: "Schatkist",
    population: "Bevolking",
    food: "Voedsel",
    economy: "Economie",
    happiness: "Geluk",
    defense: "Verdediging",
    ecology: "Natuur",
    knowledge: "Kennis",
    stability: "Stabiliteit",
  };
  return map[stat] || stat;
}

function buildActionCards(question) {
  actionGrid.innerHTML = "";
  question.choices.forEach((choice, index) => {
    const button = document.createElement("button");
    button.className = "action-card";
    button.type = "button";
    button.dataset.choice = String(index);

    const minCost = choice.effects.treasury < 0 ? Math.abs(choice.effects.treasury) : 0;
    button.disabled = !gameActive || state.treasury < minCost;

    const title = document.createElement("h3");
    title.textContent = choice.title;

    const description = document.createElement("p");
    description.textContent = choice.description;

    const impact = document.createElement("p");
    impact.className = "impact";
    impact.textContent = `Uitwerking: ${Object.entries(choice.effects)
      .map(([key, value]) => `${labelForStat(key)} ${value >= 0 ? "+" : ""}${value}`)
      .join(" · ")}`;

    button.appendChild(title);
    button.appendChild(description);
    button.appendChild(impact);
    actionGrid.appendChild(button);
  });
}

function renderStats() {
  statsGrid.innerHTML = "";

  STAT_DEFS.forEach((stat) => {
    const value = state[stat.key];
    const clamped = clamp(value, 0, stat.max);

    const card = document.createElement("section");
    card.className = "stat-card";

    const row = document.createElement("div");
    row.className = "stat-row";

    const label = document.createElement("strong");
    label.textContent = stat.label;
    const amount = document.createElement("strong");
    amount.textContent = `${Math.round(clamped)} ${stat.suffix}`;

    row.appendChild(label);
    row.appendChild(amount);

    const bar = document.createElement("progress");
    bar.max = stat.max;
    bar.value = clamped;

    card.appendChild(row);
    card.appendChild(bar);
    statsGrid.appendChild(card);
  });
}

function nextQuestionView() {
  const question = QUESTIONS[currentQuestionIndex];
  roundValue.textContent = `${currentQuestionIndex + 1} / ${MAX_TURNS}`;
  yearValue.textContent = String(state.year);
  kingdomValue.textContent = state.kingdomName;
  locationValue.textContent = state.location;
  terrainValue.textContent = TERRAIN_PROFILES[state.terrain].label;
  currentQuestion.textContent = question.question;
  advisorMessage.classList.add("hidden");
  advisorMessage.textContent = "";
  advisorButton.disabled = false;
  updateAdvisorButtonLabel();
  buildActionCards(question);
}

function evaluateGameState() {
  if (state.food <= 8) {
    return {
      status: "lose",
      reason: "Er is hongersnood ontstaan. Je bevolking overleeft niet meer.",
    };
  }

  if (state.stability <= 10) {
    return {
      status: "lose",
      reason: "De staat verkeert in instabiliteit en opstanden breken uit.",
    };
  }

  if (state.treasury <= 0) {
    return {
      status: "lose",
      reason: "De schatkist is leeg; je kunt geen nieuw beleid meer financieren.",
    };
  }

  if (state.ecology <= 10) {
    return {
      status: "lose",
      reason: "Je land verliest zijn leefbaarheid door teveel natuurdruk.",
    };
  }

  if (state.happiness <= 10) {
    return {
      status: "lose",
      reason: "De bevolking vertrouwt het bestuur niet meer.",
    };
  }

  return { status: "continue" };
}

function setupAdvisorPartyOptions() {
  if (!advisorPartySelect || advisorPartySelect.options.length > 0) {
    return;
  }

  ADVISOR_PARTIES.forEach((advisor) => {
    const option = document.createElement("option");
    option.value = advisor.id;
    option.textContent = `${advisor.name}${CABINET_PARTIES_2026.includes(advisor.id) ? " (kabinet)" : ""}`;
    advisorPartySelect.appendChild(option);
  });

  advisorPartySelect.value = "d66";
  updateAdvisorButtonLabel();
}

function applyAutomaticProgress() {
  const income = Math.round((state.economy - 50) / 8);
  state.treasury = clamp(state.treasury + income - 3, 0, STAT_LIMITS.treasury.max);
  state.food = clamp(state.food - 4, 0, 100);

  if (state.food < 40) {
    state.happiness = clamp(state.happiness - 3, 0, 100);
  }
  if (state.defense > 65) {
    state.stability = clamp(state.stability + 1, 0, 100);
  }
}

function scoreBoard() {
  return Math.round(
    state.population +
      state.economy +
      state.happiness +
      state.defense +
      state.ecology +
      state.knowledge +
      state.stability +
      state.treasury
  );
}

function showResult(outcome) {
  gameActive = false;
  setupDone = false;
  advisorButton.disabled = true;

  if (outcome.status === "win") {
    resultTitle.textContent = `Je hebt ${MAX_TURNS} vragen doorstaan!`;
  } else {
    resultTitle.textContent = "Je bent op een fout pad beland";
  }

  resultReason.textContent = `${outcome.reason}`;
  resultScore.textContent = `${state.kingdomName} eindscore: ${scoreBoard()}`;
  resultPanel.classList.remove("hidden");
}

function makeAdvisorMessage(questionIndex, currentState) {
  const baselineAdvice = ADVISOR_GUIDES[questionIndex] || "Kies een evenwicht tussen veiligheid, voedsel en schatkist.";
  const partyId = advisorPartySelect ? advisorPartySelect.value : ADVISOR_PARTIES[0].id;
  const party = ADVISOR_PARTIES.find((item) => item.id === partyId) || ADVISOR_PARTIES[0];
  const question = QUESTIONS[questionIndex];
  const recommended = getRecommendedChoice(question, currentState, party);
  const pressurePoints = [];

  if (currentState.food <= 40) {
    pressurePoints.push("voedsel staat onder druk");
  }
  if (currentState.treasury <= 35) {
    pressurePoints.push("de schatkist is kwetsbaar");
  }
  if (currentState.stability <= 45) {
    pressurePoints.push("de stabiliteit voelt broos");
  }
  if (currentState.happiness <= 40) {
    pressurePoints.push("de tevredenheid daalt");
  }
  if (currentState.ecology <= 35) {
    pressurePoints.push("natuurkwaliteit verslechtert");
  }
  if (currentState.defense <= 35) {
    pressurePoints.push("verdediging is zwak");
  }
  if (currentState.economy <= 35) {
    pressurePoints.push("economie blijft hangen");
  }

  if (!pressurePoints.length) {
    pressurePoints.push("de basis is stabiel");
  }

  return `AI-adviseur ${party.name}: ${party.tone} ${baselineAdvice} Actueel signaal: ${pressurePoints.slice(0, 2).join(", ")}. Aanbevolen optie: ${recommended.title}.`;
}

function getRecommendedChoice(question, currentState, advisor) {
  const scoreChoice = (choice) => {
    let score = 0;

    const food = currentState.food;
    const treasury = currentState.treasury;
    const stability = currentState.stability;
    const happiness = currentState.happiness;
    const ecology = currentState.ecology;
    const economy = currentState.economy;

    Object.entries(choice.effects).forEach(([key, delta]) => {
      const weight = advisor.weights[key] || 1;

      if (key === "treasury" && delta < 0 && Math.abs(delta) > treasury) {
        score -= 28;
      }

      if (key === "food" && food < 40) score += delta * 1.7 * weight;
      else if (key === "food" && food > 70) score += delta * 0.5 * weight;

      if (key === "happiness" && happiness < 45) score += delta * 1.2 * weight;
      if (key === "stability" && stability < 45) score += delta * 1.3 * weight;
      if (key === "ecology" && ecology < 35) score += delta * 1.1 * weight;
      if (key === "economy" && economy < 45) score += delta * 1.2 * weight;
      if (key === "knowledge" && currentState.knowledge < 40) score += delta * weight * 0.9;
      if (key === "defense" && currentState.defense < 45) score += delta * weight * 1.1;

      if (key !== "food" && key !== "happiness" && key !== "stability" && key !== "ecology" && key !== "economy") {
        score += delta * 0.4 * weight;
      }
    });

    return score;
  };

  let best = question.choices[0];
  let bestScore = -Infinity;
  question.choices.forEach((choice) => {
    const score = scoreChoice(choice);
    if (score > bestScore) {
      bestScore = score;
      best = choice;
    }
  });

  return best;
}

function handleAdvisorRequest() {
  if (!gameActive || !state) return;
  const selectedParty = ADVISOR_PARTIES.find((item) => item.id === advisorPartySelect.value);
  if (!selectedParty) {
    return;
  }

  const advice = makeAdvisorMessage(currentQuestionIndex, state);
  advisorMessage.textContent = advice;
  advisorMessage.classList.remove("hidden");
  statusMessage.textContent = `${selectedParty.name}-advies is klaar. Je hebt nu nog steeds alle keuzeopties.`;
}

function render() {
  if (!state) return;
  renderStats();
  if (gameActive) {
    nextQuestionView();
  } else {
    roundValue.textContent = "-";
    yearValue.textContent = String(state.year);
    kingdomValue.textContent = state.kingdomName;
    locationValue.textContent = state.location;
    terrainValue.textContent = TERRAIN_PROFILES[state.terrain].label;
  }
}

function handleChoice(event) {
  const button = event.target.closest(".action-card");
  if (!button || !gameActive) return;

  const index = Number(button.dataset.choice);
  const question = QUESTIONS[currentQuestionIndex];
  const choice = question.choices[index];
  if (!choice) return;

  const requiredBudget = choice.effects.treasury < 0 ? Math.abs(choice.effects.treasury) : 0;
  if (state.treasury < requiredBudget) {
    statusMessage.textContent = "Deze keuze past nu niet in je budget.";
    return;
  }

  statusMessage.textContent = `Je koos: ${choice.title}`;

  applyChanges(state, choice.effects);
  applyAutomaticProgress();

  state.round += 1;
  state.year += 1;
  currentQuestionIndex += 1;

  const outcome = evaluateGameState();
  if (outcome.status !== "continue") {
    render();
    showResult(outcome);
    return;
  }

  if (currentQuestionIndex >= MAX_TURNS) {
    showResult({
      status: "win",
      reason: `Je hebt alle rondes voltooid. ${state.kingdomName} staat stevig op ${state.location}.`,
    });
    render();
    return;
  }

  render();
}

function startGame(event) {
  event.preventDefault();

  const kingdomName = kingdomInput.value.trim();
  const location = locationInput.value.trim();
  const terrain = terrainSelect.value;

  if (!kingdomName || !location) {
    statusMessage.textContent = "Vul eerst een landnaam en plaats in.";
    return;
  }

  state = clone(START_STATE);
  state.round = 1;
  state.year = START_STATE.year;
  state.kingdomName = kingdomName;
  state.location = location;
  state.terrain = terrain;

  applyChanges(state, TERRAIN_PROFILES[terrain].startDelta);

  setupDone = true;
  gameActive = true;
  currentQuestionIndex = 0;

  setupPanel.classList.add("hidden");
  resultPanel.classList.add("hidden");
  statusMessage.textContent = `Welkom in ${state.kingdomName}! Kies nu je eerste beleid.`;
  render();
}

function handleAdvisorPartyChange() {
  const selectedParty = ADVISOR_PARTIES.find((advisor) => advisor.id === advisorPartySelect.value);
  if (!selectedParty) return;
  updateAdvisorButtonLabel();
  advisorMessage.classList.remove("hidden");
  advisorMessage.textContent = `Je hebt nu de adviesstijl van ${selectedParty.name} geselecteerd. Vraag nu om een nieuw advies voor deze ronde.`;

  if (!gameActive) {
    statusMessage.textContent = "Je hebt nog geen land gestart. Start eerst in het invulvenster.";
  }
}

function resetGame() {
  gameActive = false;
  setupDone = false;
  currentQuestionIndex = 0;
  state = null;

  setupPanel.classList.remove("hidden");
  resultPanel.classList.add("hidden");
  actionGrid.innerHTML = "";

  kingdomValue.textContent = "-";
  locationValue.textContent = "-";
  terrainValue.textContent = "-";
  roundValue.textContent = "-";
  yearValue.textContent = "-";
  statusMessage.textContent = "Vul eerst je land op via het invulvenster.";
  currentQuestion.textContent = "Vul eerst je land in om te beginnen.";
  advisorButton.disabled = true;
  advisorMessage.classList.add("hidden");
  advisorMessage.textContent = "";
  advisorPartySelect.value = "d66";
  updateAdvisorButtonLabel();
  statsGrid.innerHTML = "";
}

actionGrid.addEventListener("click", handleChoice);
setupForm.addEventListener("submit", startGame);
advisorPartySelect.addEventListener("change", handleAdvisorPartyChange);
restartButton.addEventListener("click", resetGame);
advisorButton.addEventListener("click", handleAdvisorRequest);
window.addEventListener("load", () => {
  setupAdvisorPartyOptions();
  resetGame();
});
