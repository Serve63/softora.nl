const {
  validateAgendaAppointmentsListRequest,
  validateConfirmationTaskDetailRequest,
  validateConfirmationTasksListRequest,
  validateInterestedLeadsListRequest,
  parseBooleanQuery,
} = require('../schemas/agenda-read');
const { withValidation } = require('./validation');

function registerAgendaReadRoutes(app, deps) {
  app.get(
    '/api/agenda/appointments',
    withValidation(validateAgendaAppointmentsListRequest, async (req, res) => {
      const payload = await deps.readCoordinator.listAppointments({
        limit: req.query.limit,
      });
      return res.status(200).json(payload);
    })
  );

  app.get(
    '/api/agenda/confirmation-tasks',
    withValidation(validateConfirmationTasksListRequest, async (req, res) => {
      const payload = await deps.readCoordinator.listConfirmationTasks({
        includeDemo: parseBooleanQuery(req.query.includeDemo),
        quickMode: parseBooleanQuery(req.query.quick),
        countOnly: parseBooleanQuery(req.query.countOnly),
        limit: req.query.limit,
      });
      return res.status(200).json(payload);
    })
  );

  app.get(
    '/api/agenda/interested-leads',
    withValidation(validateInterestedLeadsListRequest, async (req, res) => {
      const payload = await deps.readCoordinator.listInterestedLeads({
        countOnly: parseBooleanQuery(req.query.countOnly),
        limit: req.query.limit,
      });
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
