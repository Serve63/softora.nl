const {
  validateAgendaAppointmentsListRequest,
  validateConfirmationTaskDetailRequest,
  validateConfirmationTasksListRequest,
  validateInterestedLeadsListRequest,
  parseBooleanQuery,
} = require('../schemas/agenda-read');
const {
  buildLeadTraceContext,
  hasLeadTraceContext,
  logLeadTrace,
  summarizeLeadRow,
  traceMatchesLead,
} = require('../services/lead-trace');
const { withValidation } = require('./validation');

function registerAgendaReadRoutes(app, deps) {
  app.get(
    '/api/agenda/appointments',
    withValidation(validateAgendaAppointmentsListRequest, async (req, res) => {
      const payload = await deps.readCoordinator.listAppointments({
        limit: req.query.limit,
        freshSharedState: parseBooleanQuery(req.query.fresh),
      });
      return res.status(200).json(payload);
    })
  );

  app.get(
    '/api/agenda/confirmation-tasks',
    withValidation(validateConfirmationTasksListRequest, async (req, res) => {
      const trace = buildLeadTraceContext(req);
      const payload = await deps.readCoordinator.listConfirmationTasks({
        includeDemo: parseBooleanQuery(req.query.includeDemo),
        quickMode: parseBooleanQuery(req.query.quick),
        countOnly: parseBooleanQuery(req.query.countOnly),
        freshSharedState: parseBooleanQuery(req.query.fresh),
        limit: req.query.limit,
      });
      if (hasLeadTraceContext(trace)) {
        const matchedTasks = Array.isArray(payload?.tasks)
          ? payload.tasks.filter((task) => traceMatchesLead(trace, task)).map(summarizeLeadRow).slice(0, 25)
          : [];
        logLeadTrace('confirmation-tasks', 'response', {
          traceId: trace.traceId,
          trigger: trace.trigger,
          count: Number(payload?.count || 0),
          matchedTasks,
        });
      }
      return res.status(200).json(payload);
    })
  );

  app.get(
    '/api/agenda/interested-leads',
    withValidation(validateInterestedLeadsListRequest, async (req, res) => {
      const trace = buildLeadTraceContext(req);
      const payload = await deps.readCoordinator.listInterestedLeads({
        countOnly: parseBooleanQuery(req.query.countOnly),
        freshSharedState: parseBooleanQuery(req.query.fresh),
        limit: req.query.limit,
      });
      if (hasLeadTraceContext(trace)) {
        const matchedLeads = Array.isArray(payload?.leads)
          ? payload.leads.filter((lead) => traceMatchesLead(trace, lead)).map(summarizeLeadRow).slice(0, 25)
          : [];
        logLeadTrace('interested-leads', 'response', {
          traceId: trace.traceId,
          trigger: trace.trigger,
          count: Number(payload?.count || 0),
          matchedLeads,
        });
      }
      return res.status(200).json(payload);
    })
  );

  app.get(
    '/api/agenda/confirmation-tasks/:id',
    withValidation(validateConfirmationTaskDetailRequest, async (req, res) =>
      deps.sendConfirmationTaskDetailResponse(req, res, req.params.id)
    )
  );

  app.get(
    '/api/agenda/confirmation-task',
    withValidation(validateConfirmationTaskDetailRequest, async (req, res) =>
      deps.sendConfirmationTaskDetailResponse(req, res, req.query.taskId)
    )
  );
}

module.exports = {
  registerAgendaReadRoutes,
};
