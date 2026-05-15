const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('ios agenda add appointment keeps appointment target separate from meeting lead owner', () => {
  const modelsSource = readRepoFile('ios/SoftoraAgenda/SoftoraAgenda/Models.swift');
  const addViewSource = readRepoFile('ios/SoftoraAgenda/SoftoraAgenda/Views/AddAppointmentView.swift');
  const apiClientSource = readRepoFile('ios/SoftoraAgenda/SoftoraAgenda/SoftoraAPIClient.swift');

  assert.match(
    modelsSource,
    /static let appointmentTargetCases: \[Planner\] = \[\.serve, \.martijn, \.both\]/,
    'Appointment target choices must include Serve, Martijn and both.'
  );
  assert.match(
    modelsSource,
    /static let leadOwnerCases: \[Planner\] = \[\.serve, \.martijn\]/,
    'Lead owner choices must stay limited to Serve and Martijn.'
  );
  assert.match(addViewSource, /FormLabel\("Voor wie\?"\)[^]*appointmentTargetChoices/);
  assert.match(addViewSource, /FormLabel\("Wie heeft deze lead geregeld\?"\)[^]*leadOwnerChoices/);
  assert.match(addViewSource, /options: orderedPlannerOptions\(Planner\.appointmentTargetCases\)/);
  assert.match(addViewSource, /options: orderedPlannerOptions\(Planner\.leadOwnerCases\)/);
  assert.match(addViewSource, /let selectedPlanner = store\.selectedPlanner/);
  assert.match(addViewSource, /return \[selectedPlanner\] \+ options\.filter \{ \$0 != selectedPlanner \}/);
  assert.match(apiClientSource, /who: draft\.planner\.apiValue/);
  assert.match(apiClientSource, /manualLeadOwner: isBusinessMeeting \? draft\.leadOwner\.apiValue : ""/);
  assert.doesNotMatch(
    apiClientSource,
    /who: isBusinessMeeting \? Planner\.both\.apiValue : draft\.planner\.apiValue/,
    'Business meetings must no longer force the appointment target to both.'
  );
});

test('ios agenda shows bottom mail shortcut and Serve-only gym shortcut', () => {
  const agendaListSource = readRepoFile('ios/SoftoraAgenda/SoftoraAgenda/Views/AgendaListView.swift');
  const addViewSource = readRepoFile('ios/SoftoraAgenda/SoftoraAgenda/Views/AddAppointmentView.swift');

  assert.match(
    agendaListSource,
    /AgendaShortcutBar\([^]*showGymShortcut: store\.selectedPlanner == \.serve/,
    'The gym shortcut should only be visible for the Serve account.'
  );
  assert.match(
    agendaListSource,
    /URL\(string: "https:\/\/www\.softora\.nl\/premium-mailbox"\)/,
    'The mail shortcut should open the existing Softora mailbox.'
  );
  assert.match(agendaListSource, /title: "Mail"[^]*systemImage: "envelope\.fill"/);
  assert.match(agendaListSource, /title: "Gym"[^]*systemImage: "dumbbell\.fill"/);
  assert.match(agendaListSource, /prefilledTitle: "Gym"/);
  assert.doesNotMatch(
    agendaListSource,
    /private struct AgendaShortcutBar:[^]*?\.overlay\(alignment: \.top\)[^]*?private struct AgendaShortcutButton:/,
    'The bottom shortcut bar should not render a separator line above the buttons.'
  );
  assert.match(addViewSource, /prefilledTitle: String = ""/);
  assert.match(addViewSource, /initialDraft\.title = trimmedTitle\.softoraUppercased/);
});
