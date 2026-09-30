const express = require('express');
const router = express.Router();
const AdminController = require('../controllers/AdminController');
const ConfigurationController = require('../controllers/ConfigurationController');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');
const { checkFeature } = require('../middleware/featureGuard');
const { validateBody } = require('../middleware/validation.middleware');
const {
  SaveURAsSchema,
  SavePausesSchema,
  SaveDispositionsSchema,
  CreateAgentSchema,
  UpdateAgentSchema,
  CreateSkillSchema,
  UpdateSettingsSchema
} = require('../schemas/admin.schemas');
const { SaveConfigurationSchema } = require('../schemas/configuration.schemas');
const WebchatController = require('../controllers/WebchatController');
const { SaveWebchatConnectionSchema } = require('../schemas/webchat.schemas');

// All routes here require Authentication
router.use(authenticateToken);

// Dashboard & Config
router.get('/config', AdminController.getConfig);

// URAs (Flows) Management
router.get('/uras', authorizeRole(['OWNER', 'ADMIN']), checkFeature('featureBotBuilder'), AdminController.getURAs);
router.post(
  '/uras',
  authorizeRole(['OWNER', 'ADMIN']),
  checkFeature('featureBotBuilder'),
  validateBody(SaveURAsSchema),
  AdminController.saveURAs
);

// Pause Reasons
router.get('/pauses', authorizeRole(['OWNER', 'ADMIN']), AdminController.getPauses);
router.post(
  '/pauses',
  authorizeRole(['OWNER', 'ADMIN']),
  validateBody(SavePausesSchema),
  AdminController.savePauses
);

// Close Dispositions (Motivos de Encerramento)
router.get('/dispositions', authorizeRole(['OWNER', 'ADMIN']), AdminController.getDispositions);
router.post(
  '/dispositions',
  authorizeRole(['OWNER', 'ADMIN']),
  validateBody(SaveDispositionsSchema),
  AdminController.saveDispositions
);

// Agents (Admins and Owners can manage agents)
router.get('/agents', authorizeRole(['OWNER', 'ADMIN']), AdminController.listAgents);
router.post(
  '/agents',
  authorizeRole(['OWNER', 'ADMIN']),
  validateBody(CreateAgentSchema),
  AdminController.createAgent
);
router.put(
  '/agents/:id',
  authorizeRole(['OWNER', 'ADMIN']),
  validateBody(UpdateAgentSchema),
  AdminController.updateAgent
);
router.delete('/agents/:id', authorizeRole(['OWNER', 'ADMIN']), AdminController.deleteAgent);

// Skills
router.get('/skills', authorizeRole(['OWNER', 'ADMIN']), AdminController.listSkills);
router.post(
  '/skills',
  authorizeRole(['OWNER', 'ADMIN']),
  validateBody(CreateSkillSchema),
  AdminController.createSkill
);
router.delete('/skills/:id', authorizeRole(['OWNER', 'ADMIN']), AdminController.deleteSkill);

// Tenant Settings (Only Owner)
router.get('/settings', authorizeRole(['OWNER']), AdminController.getSettings);
router.put(
  '/settings',
  authorizeRole(['OWNER']),
  validateBody(UpdateSettingsSchema),
  AdminController.updateSettings
);

// Configuration (WhatsApp API)
router.get(
  '/configuration',
  authorizeRole(['OWNER', 'ADMIN', 'SUPER_ADMIN']),
  ConfigurationController.getConfiguration
);
router.post(
  '/configuration',
  authorizeRole(['OWNER', 'ADMIN', 'SUPER_ADMIN']),
  validateBody(SaveConfigurationSchema),
  ConfigurationController.saveConfiguration
);
router.post(
  '/configuration/validate',
  authorizeRole(['OWNER', 'ADMIN', 'SUPER_ADMIN']),
  ConfigurationController.validateConfiguration
);
router.delete(
  '/configuration/:id',
  authorizeRole(['OWNER', 'ADMIN', 'SUPER_ADMIN']),
  ConfigurationController.deleteConfiguration
);

// Webchat Connections Management
router.get(
  '/webchat',
  authorizeRole(['OWNER', 'ADMIN', 'SUPER_ADMIN']),
  checkFeature('featureWebchat'),
  WebchatController.getWebchatConnections
);
router.post(
  '/webchat',
  authorizeRole(['OWNER', 'ADMIN', 'SUPER_ADMIN']),
  checkFeature('featureWebchat'),
  validateBody(SaveWebchatConnectionSchema),
  WebchatController.saveWebchatConnection
);
router.delete(
  '/webchat/:id',
  authorizeRole(['OWNER', 'ADMIN', 'SUPER_ADMIN']),
  checkFeature('featureWebchat'),
  WebchatController.deleteWebchatConnection
);

module.exports = router;
