const { registerAgendaRetellRoutes } = require('../routes/agenda-retell');
const { registerAgendaMutationRoutes } = require('../routes/agenda');
const { registerAgendaReadRoutes } = require('../routes/agenda-read');
const { createAgendaRuntime } = require('./agenda-runtime');

function createAgendaAppRuntime(app, deps = {}) {
  const agendaRuntime = createAgendaRuntime(deps);

  const {
    agendaInterestedLeadReadService,
    backfillOpenLeadFollowUpAppointmentsFromLatestCalls,
    upsertGeneratedAgendaAppointment,
    buildRuntimeHtmlPageBootstrapData,
    retellRouteDeps,
    readRouteDeps,
    mutationRouteDeps,
  } = agendaRuntime;

  registerAgendaRetellRoutes(app, retellRouteDeps);
  registerAgendaReadRoutes(app, readRouteDeps);
  registerAgendaMutationRoutes(app, mutationRouteDeps);

  return {
    agendaInterestedLeadReadService,
    backfillOpenLeadFollowUpAppointmentsFromLatestCalls,
    upsertGeneratedAgendaAppointment,
    buildRuntimeHtmlPageBootstrapData,
  };
}

module.exports = {
  createAgendaAppRuntime,
};
