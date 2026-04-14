const express = require('express');
const router = express.Router();
const AdminController = require('../controllers/AdminController');
const ConfigurationController = require('../controllers/ConfigurationController');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');
const { validateBody } = require('../middleware/validation.middleware');
const { SaveConfigurationSchema } = require('../schemas/configuration.schemas');

// All routes here require Authentication
router.use(authenticateToken);

// Dashboard & Config
router.get('/config', AdminController.getConfig);

// URAs (Flows) Management
router.get('/uras', authorizeRole(['OWNER', 'ADMIN']), AdminController.getURAs);
router.post('/uras', authorizeRole(['OWNER', 'ADMIN']), AdminController.saveURAs);

// Pause Reasons
router.get('/pauses', authorizeRole(['OWNER', 'ADMIN']), AdminController.getPauses);
router.post('/pauses', authorizeRole(['OWNER', 'ADMIN']), AdminController.savePauses);

// Agents (Admins and Owners can manage agents)
router.get('/agents', authorizeRole(['OWNER', 'ADMIN']), AdminController.listAgents);
router.post('/agents', authorizeRole(['OWNER', 'ADMIN']), AdminController.createAgent);
router.delete('/agents/:id', authorizeRole(['OWNER', 'ADMIN']), AdminController.deleteAgent);
router.put('/agents/:id', authorizeRole(['OWNER', 'ADMIN']), AdminController.updateAgent);

// Skills
router.get('/skills', authorizeRole(['OWNER', 'ADMIN']), AdminController.listSkills);
router.post('/skills', authorizeRole(['OWNER', 'ADMIN']), AdminController.createSkill);
router.delete('/skills/:id', authorizeRole(['OWNER', 'ADMIN']), AdminController.deleteSkill);

// Tenant Settings (Only Owner)
router.get('/settings', authorizeRole(['OWNER']), AdminController.getSettings);
router.put('/settings', authorizeRole(['OWNER']), AdminController.updateSettings);

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

module.exports = router;
