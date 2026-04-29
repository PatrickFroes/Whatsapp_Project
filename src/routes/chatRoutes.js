const express = require('express');
const router = express.Router();
const ChatController = require('../controllers/ChatController');
const InternalNoteController = require('../controllers/InternalNoteController');
const TransferController = require('../controllers/TransferController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { validatePaginationLimits } = require('../middleware/queryLimits.middleware');
const { messageSendLimiter } = require('../middleware/rateLimiters');

router.use(authenticateToken);

// GET Chats - List conversations
router.get('/chats', validatePaginationLimits, ChatController.listChats);

// GET Messages - Retrieve message history
router.get('/chats/:phone/messages', validatePaginationLimits, ChatController.getMessages);
router.get('/history/:phone', validatePaginationLimits, ChatController.getMessages); // Alias for legacy/frontend support

// POST Send Message - Rate limited to prevent spam
router.post('/chats/:phone/send', messageSendLimiter, ChatController.sendMessage);

// POST Resolve Chat - Rate limited to prevent abuse
router.post('/chats/:phone/resolve', messageSendLimiter, ChatController.resolveChat);

// Internal Notes (em conversas)
router.get('/conversations/:conversationId/notes', ChatController.getMessages);
router.post('/conversations/:conversationId/notes', messageSendLimiter, InternalNoteController.create);
router.get('/conversations/:conversationId/notes/count', InternalNoteController.count);

// Transfers (em conversas)
router.post('/conversations/:conversationId/transfer', messageSendLimiter, TransferController.transfer);
router.post('/conversations/:conversationId/transfer-to-skill', messageSendLimiter, TransferController.transferToSkill);
router.get('/conversations/:conversationId/transfers', TransferController.listTransfers);

// Status
router.get('/agent/status', ChatController.getStatus);
router.post('/agent/status', ChatController.updateStatus);
router.get('/pauses', ChatController.getPauses); // Agent pause reasons

module.exports = router;
