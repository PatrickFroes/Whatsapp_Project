const express = require('express');
const router = express.Router();
const SuperAdminController = require('../controllers/SuperAdminController');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

// Protect all routes
router.use(authenticateToken);
router.use(authorizeRole(['SUPER_ADMIN']));

// Tenant Management
router.get('/tenants', SuperAdminController.listTenants);
router.post('/tenants', SuperAdminController.createTenant);
router.get('/tenants/:id/analytics', SuperAdminController.getTenantAnalytics); // Financial & Usage
router.put('/tenants/:id', SuperAdminController.updateTenant); // Update keys/plan
router.put('/tenants/:id/status', SuperAdminController.toggleTenantStatus); // Active/Inactive

// Global Metrics
router.get('/metrics', SuperAdminController.getGlobalMetrics);

module.exports = router;
