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
  assert.match(apiClientSource, /who: draft\.planner\.apiValue/);
  assert.match(apiClientSource, /manualLeadOwner: isBusinessMeeting \? draft\.leadOwner\.apiValue : ""/);
  assert.doesNotMatch(
    apiClientSource,
    /who: isBusinessMeeting \? Planner\.both\.apiValue : draft\.planner\.apiValue/,
    'Business meetings must no longer force the appointment target to both.'
  );
});
