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
  const modelsSource = readRepoFile('ios/SoftoraAgenda/SoftoraAgenda/Models.swift');
  const agendaListSource = readRepoFile('ios/SoftoraAgenda/SoftoraAgenda/Views/AgendaListView.swift');
  const addViewSource = readRepoFile('ios/SoftoraAgenda/SoftoraAgenda/Views/AddAppointmentView.swift');
  const agendaStoreSource = readRepoFile('ios/SoftoraAgenda/SoftoraAgenda/AgendaStore.swift');

  assert.match(
    agendaListSource,
    /AgendaShortcutBar\([^]*showGymShortcut: store\.selectedPlanner == \.serve/,
    'The gym shortcut should only be visible for the Serve account.'
  );
  assert.match(
    agendaListSource,
    /@State private var isShowingMailbox = false/,
    'The mail shortcut should open a native mailbox screen inside the app.'
  );
  assert.match(
    agendaListSource,
    /@State private var isShowingGym = false/,
    'The gym shortcut should open a native workout screen inside the app.'
  );
  assert.match(agendaListSource, /MailboxView\(apiClient: SoftoraAPIClient\(\)\)/);
  assert.match(agendaListSource, /private struct MailboxView: View/);
  assert.match(modelsSource, /struct MailboxLink: Identifiable, Decodable, Hashable/);
  assert.match(modelsSource, /struct MailboxInlineImage: Identifiable, Decodable, Hashable/);
  assert.match(modelsSource, /let links: \[MailboxLink\]/);
  assert.match(modelsSource, /let inlineImages: \[MailboxInlineImage\]/);
  assert.match(agendaListSource, /MailboxBodyView\(presentation: bodyPresentation\)/);
  assert.match(agendaListSource, /private struct MailboxBodyView: View/);
  assert.match(agendaListSource, /private struct MailboxBodySectionView: View/);
  assert.match(agendaListSource, /private struct MailboxInlineImageView: View/);
  assert.match(agendaListSource, /Image\(uiImage: uiImage\)/);
  assert.match(agendaListSource, /AsyncImage\(url: remoteURL\)/);
  assert.match(agendaListSource, /private struct MailboxBodyLinkView: View/);
  assert.match(agendaListSource, /Link\(destination: destination\)/);
  assert.match(agendaListSource, /MailboxBodySection\(title: "Reactie"/);
  assert.match(agendaListSource, /MailboxBodySection\(title: "Eerdere mail"/);
  assert.match(agendaListSource, /private enum MailboxBodyFormatter/);
  assert.match(agendaListSource, /static func presentation\(rawBody: String, images: \[MailboxInlineImage\], links: \[MailboxLink\]\) -> MailboxBodyPresentation/);
  assert.match(agendaListSource, /static func readable\(_ rawBody: String\) -> String/);
  assert.match(agendaListSource, /\.map\(stripQuotePrefix\)/);
  assert.match(agendaListSource, /imagePlaceholderLabel\(from: trimmed\)/);
  assert.match(agendaListSource, /uniqueLinks\(links\)/);
  assert.match(agendaListSource, /while output\.trimmingCharacters\(in: \.whitespaces\)\.hasPrefix\(">"\)/);
  assert.doesNotMatch(agendaListSource, /Text\(\(message\.body\.isEmpty \? message\.preview : message\.body\)\.trimmingCharacters/);
  assert.match(agendaListSource, /GymWorkoutView\(\)/);
  assert.match(agendaListSource, /private struct GymWorkoutView: View/);
  assert.match(agendaListSource, /@State private var selectedDay: GymWorkoutDay = \.today/);
  assert.match(agendaListSource, /@State private var isChoosingDay = false/);
  assert.match(agendaListSource, /private enum GymWorkoutDay: String, CaseIterable, Identifiable/);
  assert.match(agendaListSource, /private struct GymDayPickerOverlay: View/);
  assert.match(agendaListSource, /private struct GymDayButton: View/);
  assert.match(agendaListSource, /Text\(selectedDay\.title\)/);
  assert.match(agendaListSource, /case \.today:[^]*"Vandaag"/);
  assert.match(agendaListSource, /ForEach\(GymWorkoutDay\.allCases\)/);
  assert.match(agendaListSource, /Array\(GymExercise\.defaultWorkout\.prefix\(4\)\)/);
  assert.match(agendaListSource, /GymExerciseRow\(day: selectedDay, exercise: exercise\)/);
  assert.ok(agendaListSource.includes('.id("\\(selectedDay.storageID)-\\(exercise.id)")'));
  assert.doesNotMatch(agendaListSource, /Schema van vandaag/);
  assert.match(agendaListSource, /private struct GymExercise: Identifiable/);
  assert.match(agendaListSource, /isShowingGym = true/);
  assert.match(agendaListSource, /Text\("Oefeningen"\)/);
  assert.match(agendaListSource, /GymExercise\(order: 1, title: "Bankdrukken"/);
  assert.match(agendaListSource, /private struct GymMetricField: View/);
  assert.match(agendaListSource, /GymMetricField\(label: "Sets"/);
  assert.match(agendaListSource, /GymMetricField\(label: "Reps"/);
  assert.match(agendaListSource, /GymMetricField\(label: "Kg"/);
  assert.match(agendaListSource, /\.keyboardType\(keyboardType\)/);
  assert.match(agendaListSource, /TextField\("", text: \$value\)[^]*Text\(label\)/);
  assert.match(agendaListSource, /\.frame\(width: 36\)/);
  assert.doesNotMatch(agendaListSource, /Text\(String\(format: "%02d", exercise\.order\)\)/);
  assert.match(agendaListSource, /@AppStorage private var exerciseName: String/);
  assert.match(agendaListSource, /@AppStorage private var notes: String/);
  assert.match(agendaListSource, /@AppStorage private var sets: String/);
  assert.match(agendaListSource, /@AppStorage private var reps: String/);
  assert.match(agendaListSource, /@AppStorage private var kilograms: String/);
  assert.match(agendaListSource, /private enum GymExerciseStorageField: String/);
  assert.match(agendaListSource, /private enum GymExerciseStorage/);
  assert.match(agendaListSource, /"nl\.softora\.agenda\.gym\.\\\(day\.storageID\)\.exercise\.\\\(exercise\.order\)\.\\\(field\.rawValue\)"/);
  assert.match(agendaListSource, /TextField\("OEFENING", text: uppercasedExerciseName\)[^]*\.font\(\.softoraDisplay\(14, weight: \.bold\)\)[^]*\.lineLimit\(1\)[^]*\.minimumScaleFactor\(0\.58\)/);
  assert.match(agendaListSource, /TextField\("NOTITIES", text: uppercasedNotes, axis: \.vertical\)[^]*\.lineLimit\(1\.\.\.2\)/);
  assert.match(agendaListSource, /private var uppercasedExerciseName: Binding<String>/);
  assert.match(agendaListSource, /private var uppercasedNotes: Binding<String>/);
  assert.doesNotMatch(agendaListSource, /premium-mailbox/);
  assert.match(agendaListSource, /title: "Mail"[^]*systemImage: "envelope\.fill"/);
  assert.match(agendaListSource, /Text\("Servé's logboek"\)/);
  assert.match(agendaListSource, /title: "Servé's logboek"[^]*systemImage: "dumbbell\.fill"/);
  assert.doesNotMatch(agendaListSource, /Text\("Gym"\)/);
  assert.match(agendaStoreSource, /guard !isRecoverableSupabaseHydrationIssue\(error\) else \{ return \}/);
  assert.doesNotMatch(
    agendaStoreSource,
    /\.filter\(\\\.isUpcoming\)/,
    'The app must keep past appointments so swiping back to older weeks matches the web agenda.'
  );
  assert.match(agendaStoreSource, /private func isRecoverableSupabaseHydrationIssue\(_ error: Error\) -> Bool/);
  assert.match(agendaStoreSource, /gedeelde supabase-opslag/);
  assert.match(agendaStoreSource, /niet veilig geladen/);
  assert.match(agendaStoreSource, /nog niet geladen/);
  assert.doesNotMatch(
    agendaListSource,
    /prefilledTitle: "Gym"/,
    'The gym shortcut should not open the add-appointment form anymore.'
  );
  assert.doesNotMatch(
    agendaListSource,
    /private struct AgendaShortcutBar:[^]*?\.overlay\(alignment: \.top\)[^]*?private struct AgendaShortcutButton:/,
    'The bottom shortcut bar should not render a separator line above the buttons.'
  );
  assert.match(addViewSource, /prefilledTitle: String = ""/);
  assert.match(addViewSource, /initialDraft\.title = trimmedTitle\.softoraUppercased/);
});

test('ios agenda native mailbox has folders, account selector and mailbox api calls', () => {
  const modelsSource = readRepoFile('ios/SoftoraAgenda/SoftoraAgenda/Models.swift');
  const apiClientSource = readRepoFile('ios/SoftoraAgenda/SoftoraAgenda/SoftoraAPIClient.swift');
  const agendaListSource = readRepoFile('ios/SoftoraAgenda/SoftoraAgenda/Views/AgendaListView.swift');
  const infoPlistSource = readRepoFile('ios/SoftoraAgenda/SoftoraAgenda/Info.plist');

  assert.match(modelsSource, /struct MailboxAccount: Identifiable, Decodable, Hashable/);
  assert.match(modelsSource, /struct MailboxMessage: Identifiable, Decodable, Hashable/);
  assert.match(apiClientSource, /func fetchMailboxAccounts\(\) async throws -> \[MailboxAccount\]/);
  assert.match(apiClientSource, /\/api\/mailbox\/accounts/);
  assert.match(apiClientSource, /func fetchMailboxMessages\(account: String, folder: String, limit: Int = 50\) async throws -> \[MailboxMessage\]/);
  assert.match(apiClientSource, /\/api\/mailbox\/messages\?account=/);
  assert.match(apiClientSource, /func sendMailboxMessage\(account: String, to: String, subject: String, body: String\) async throws/);
  assert.match(apiClientSource, /\/api\/mailbox\/send/);
  assert.match(apiClientSource, /func improveMailboxDraft\(account: String, to: String, subject: String, body: String, context: MailboxDraftContextPayload\) async throws -> String/);
  assert.match(apiClientSource, /\/api\/mailbox\/improve-draft/);
  assert.match(modelsSource, /struct MailboxSendResponse: Decodable/);
  assert.match(modelsSource, /struct MailboxImproveDraftResponse: Decodable/);
  assert.match(agendaListSource, /private enum MailboxFolder: String, CaseIterable, Identifiable/);
  assert.match(agendaListSource, /case important/);
  assert.match(agendaListSource, /case promotions/);
  assert.match(agendaListSource, /case spam/);
  assert.match(agendaListSource, /\"starred\"/);
  assert.match(agendaListSource, /\"Reclame\"/);
  assert.match(agendaListSource, /MailboxFolderDrawer/);
  assert.match(agendaListSource, /MailboxAccountSelector/);
  assert.match(agendaListSource, /private var mailboxHeader: some View \{[^]*ZStack \{[^]*Text\("Mailbox"\)[^]*HStack \{/);
  assert.match(agendaListSource, /ScrollView\(\.horizontal, showsIndicators: false\)/);
  assert.match(agendaListSource, /Text\(account\.email\)/);
  assert.match(agendaListSource, /Text\("Kies het gewenste mailadres"\)/);
  assert.match(agendaListSource, /@State private var isExpanded = true/);
  assert.match(agendaListSource, /isExpanded\.toggle\(\)/);
  assert.match(agendaListSource, /if isExpanded \{/);
  assert.match(agendaListSource, /accessibilityLabel\(isExpanded \? "Mailadressen inklappen" : "Mailadressen uitklappen"\)/);
  assert.match(agendaListSource, /guard !error\.isMailboxCancellation else \{ return \}/);
  assert.match(agendaListSource, /var isMailboxCancellation: Bool/);
  assert.match(agendaListSource, /isoFormatterWithFractionalSeconds/);
  assert.match(agendaListSource, /\.withFractionalSeconds/);
  assert.match(agendaListSource, /return "ZOJUIST"/);
  assert.ok(agendaListSource.includes('return "VANDAAG \\(time)"'));
  assert.ok(agendaListSource.includes('return "GISTEREN \\(time)"'));
  assert.match(agendaListSource, /Image\(systemName: "wand\.and\.stars"\)/);
  assert.match(agendaListSource, /Task \{ await improveReply\(\) \}/);
  assert.match(agendaListSource, /Task \{ await sendReply\(\) \}/);
  assert.match(agendaListSource, /apiClient\.sendMailboxMessage/);
  assert.match(agendaListSource, /apiClient\.improveMailboxDraft/);
  assert.match(agendaListSource, /MailboxDraftContextPayload/);
  assert.match(agendaListSource, /Text\("TYP JE ANTWOORD\.\.\."\)/);
  assert.match(agendaListSource, /isLocked: selectedMessage != nil/);
  assert.match(agendaListSource, /\.disabled\(isLocked\)/);
  assert.match(agendaListSource, /lockedBackground/);
  assert.doesNotMatch(agendaListSource, /Text\(selectedAccount\?\.email \?\? "Geen account"\)/);
  assert.doesNotMatch(agendaListSource, /Image\(systemName: "arrow\.clockwise"\)/);
  assert.doesNotMatch(
    agendaListSource,
    /Text\(account\.displayName\)[^]*Text\(account\.email\)/,
    'Mailbox account buttons should not show the same email twice.'
  );
  assert.match(infoPlistSource, /<key>CFBundleDisplayName<\/key>\s*<string>Softora\.nl<\/string>/);
});
