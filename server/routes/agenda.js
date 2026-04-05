const {
  validateAddActiveOrderRequest,
  validateConfirmationMailSyncRequest,
  validateConfirmationTaskSetInAgendaRequest,
  validateDraftEmailRequest,
  validateInterestedLeadDismissRequest,
  validateInterestedLeadSetInAgendaRequest,
  validatePostCallRequest,
  validateSendEmailRequest,
  validateTaskActorRequest,
} = require('../schemas/agenda');
const { withValidation } = require('./validation');

function registerAgendaMutationRoutes(app, deps) {
  app.post(
    '/api/agenda/appointments/:id/post-call',
    withValidation(validatePostCallRequest, (req, res) =>
      deps.updateAgendaAppointmentPostCallDataById(req, res, req.params.id)
    )
  );

  app.post(
    '/api/agenda/appointment-post-call',
    withValidation(validatePostCallRequest, (req, res) =>
      deps.updateAgendaAppointmentPostCallDataById(req, res, req.query.appointmentId)
    )
  );

  app.post(
    '/api/agenda/appointments/:id/add-active-order',
    withValidation(validateAddActiveOrderRequest, (req, res) =>
      deps.addAgendaAppointmentToPremiumActiveOrders(req, res, req.params.id)
    )
  );

  app.post(
    '/api/agenda/add-active-order',
    withValidation(validateAddActiveOrderRequest, (req, res) =>
      deps.addAgendaAppointmentToPremiumActiveOrders(req, res, req.query.appointmentId)
    )
  );

  app.post(
    '/api/agenda/interested-leads/set-in-agenda',
    withValidation(validateInterestedLeadSetInAgendaRequest, (req, res) =>
      deps.setInterestedLeadInAgendaResponse(req, res)
    )
  );

  app.post(
    '/api/agenda/interested-lead-set-in-agenda',
    withValidation(validateInterestedLeadSetInAgendaRequest, (req, res) =>
      deps.setInterestedLeadInAgendaResponse(req, res)
    )
  );

  app.post(
    '/api/agenda/interested-leads/dismiss',
    withValidation(validateInterestedLeadDismissRequest, (req, res) =>
      deps.dismissInterestedLeadResponse(req, res)
    )
  );

  app.post(
    '/api/agenda/interested-lead-dismiss',
    withValidation(validateInterestedLeadDismissRequest, (req, res) =>
      deps.dismissInterestedLeadResponse(req, res)
    )
  );

  app.post(
    '/api/agenda/confirmation-mail-sync',
    withValidation(validateConfirmationMailSyncRequest, (req, res) =>
      deps.syncConfirmationMailResponse(req, res)
    )
  );

  app.post(
    '/api/agenda/confirmation-tasks/:id/draft-email',
    withValidation(validateDraftEmailRequest, (req, res) =>
      deps.sendConfirmationTaskDraftEmailResponse(req, res, req.params.id)
    )
  );

  app.post(
    '/api/agenda/confirmation-task-draft-email',
    withValidation(validateDraftEmailRequest, (req, res) =>
      deps.sendConfirmationTaskDraftEmailResponse(req, res, req.query.taskId)
    )
  );

  app.post(
    '/api/agenda/confirmation-tasks/:id/send-email',
    withValidation(validateSendEmailRequest, (req, res) =>
      deps.sendConfirmationTaskEmailResponse(req, res, req.params.id)
    )
  );

  app.post(
    '/api/agenda/confirmation-task-send-email',
    withValidation(validateSendEmailRequest, (req, res) =>
      deps.sendConfirmationTaskEmailResponse(req, res, req.query.taskId)
    )
  );

  app.post(
    '/api/agenda/confirmation-tasks/:id/mark-sent',
    withValidation(validateTaskActorRequest, (req, res) =>
      deps.markConfirmationTaskSentById(req, res, req.params.id)
    )
  );

  app.post(
    '/api/agenda/confirmation-tasks/:id/set-in-agenda',
    withValidation(validateConfirmationTaskSetInAgendaRequest, (req, res) =>
      deps.setLeadTaskInAgendaById(req, res, req.params.id)
    )
  );

  app.post(
    '/api/agenda/lead-to-agenda',
    withValidation(validateConfirmationTaskSetInAgendaRequest, (req, res) =>
      deps.setLeadTaskInAgendaById(req, res, req.query.taskId)
    )
  );

  app.post(
    '/api/agenda/confirmation-tasks/:id/mark-response-received',
    withValidation(validateTaskActorRequest, (req, res) =>
      deps.markConfirmationTaskResponseReceivedById(req, res, req.params.id)
    )
  );

  app.post(
    '/api/agenda/confirmation-tasks/:id/mark-cancelled',
    withValidation(validateTaskActorRequest, (req, res) =>
      deps.markLeadTaskCancelledById(req, res, req.params.id)
    )
  );

  app.post(
    '/api/agenda/confirmation-task-mark-cancelled',
    withValidation(validateTaskActorRequest, (req, res) =>
      deps.markLeadTaskCancelledById(req, res, req.query.taskId)
    )
  );

  app.post(
    '/api/agenda/confirmation-tasks/:id/complete',
    withValidation(validateTaskActorRequest, (req, res) =>
      deps.completeConfirmationTaskById(req, res, req.params.id)
    )
  );
}

module.exports = {
  registerAgendaMutationRoutes,
};
