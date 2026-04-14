const express = require('express');
const router = express.Router();
const TemplateController = require('../controllers/TemplateController');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

router.use(authenticateToken);
router.use(authorizeRole(['ADMIN', 'OWNER', 'SUPER_ADMIN']));

router.get('/', TemplateController.list);
router.post('/sync', TemplateController.sync);

module.exports = router;
