const express = require('express');
const router = express.Router();
const LGPDController = require('../controllers/LGPDController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Todos os endpoints requerem autenticação
router.use(authenticateToken);

// Exportar dados do usuário (Direito à portabilidade)
router.get('/export', LGPDController.exportUserData);

// Deletar conta (Direito ao esquecimento)
router.delete('/delete', LGPDController.deleteUserAccount);

// Gerenciar consentimentos
router.get('/consent', LGPDController.getConsents);
router.post('/consent', LGPDController.updateConsents);

module.exports = router;
