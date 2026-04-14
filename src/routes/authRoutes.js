const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/AuthController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { registrationLimiter } = require('../middleware/rateLimiters');
const { checkLoginAttempts } = require('../middleware/loginRateLimiter');
const { validateBody } = require('../middleware/validation.middleware');
const { LoginSchema, RegisterSchema } = require('../schemas/auth.schemas');

router.post(
  '/register',
  registrationLimiter,
  validateBody(RegisterSchema),
  AuthController.register
);
router.post('/login', checkLoginAttempts, validateBody(LoginSchema), AuthController.login);
router.post('/logout', AuthController.logout);
router.get('/me', authenticateToken, AuthController.me);

module.exports = router;
